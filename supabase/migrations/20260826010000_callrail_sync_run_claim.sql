-- One reconciliation per connection at a time.
--
-- Reconciliation is about to run on a fifteen-minute schedule as well as from
-- a button somebody can press. Two passes over the same connection would fetch
-- the same calls and race each other into the same rows. Ingestion itself is
-- idempotent — claim_callrail_call_for_ingestion and the unique call id see to
-- that — so the damage would be wasted CallRail API quota and confusing sync
-- history rather than duplicate leads. Still not worth allowing.
--
-- The slot is the run row itself: a partial unique index means only one row
-- per connection can be 'running', so the second claim simply gets nothing
-- back and skips that connection.

create unique index if not exists callrail_sync_runs_active_uidx
  on public.callrail_sync_runs (organization_id, client_id)
  where status = 'running';

-- Claim the slot, or return null when another run holds it.
--
-- A run whose worker died would otherwise hold the slot forever, so anything
-- older than the staleness window is closed out first. It is recorded as
-- abandoned rather than deleted: a run that never finished is a fact worth
-- keeping, and the closed vocabulary already has a place for it.
create or replace function public.claim_callrail_sync_run(
  p_organization_id uuid,
  p_client_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_stale_after interval default interval '30 minutes'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if p_organization_id is null or p_client_id is null then
    raise exception 'claim_callrail_sync_run requires an organization and a client';
  end if;

  update public.callrail_sync_runs
     set status = 'failed',
         error = 'abandoned',
         finished_at = pg_catalog.now()
   where organization_id = p_organization_id
     and client_id = p_client_id
     and status = 'running'
     and started_at < pg_catalog.now() - p_stale_after;

  insert into public.callrail_sync_runs (
    organization_id, client_id, window_start, window_end
  )
  values (p_organization_id, p_client_id, p_window_start, p_window_end)
  on conflict do nothing
  returning id into v_run_id;

  return v_run_id;
end;
$$;

revoke all on function public.claim_callrail_sync_run(
  uuid, uuid, timestamptz, timestamptz, interval
) from public, anon, authenticated;

-- While here: take a writable schema off a definer function's path.
--
-- claim_callrail_call_for_ingestion runs with the owner's rights and had
-- `search_path = public`, so an unqualified name inside it resolved through a
-- schema other roles can create objects in. Its table reference was already
-- qualified; now() was not, which is why the path was not empty to begin with.
-- The behaviour is unchanged — this is the same hardening the contact
-- function already carries.
create or replace function public.claim_callrail_call_for_ingestion(
  p_call_row_id uuid,
  p_stale_before timestamptz
)
returns table (
  id uuid,
  contact_id uuid,
  lead_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.callrail_calls as call
     set ingest_status = 'enriching',
         ingest_error = null,
         updated_at = pg_catalog.now()
   where call.id = p_call_row_id
     and (
       call.ingest_status <> 'enriching'
       or call.updated_at < p_stale_before
     )
   returning call.id, call.contact_id, call.lead_id;
end
$$;

revoke all on function public.claim_callrail_call_for_ingestion(uuid, timestamptz)
  from public, anon, authenticated;
