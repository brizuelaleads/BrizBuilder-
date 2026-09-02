create unique index if not exists callrail_sync_runs_active_uidx
  on public.callrail_sync_runs (organization_id, client_id)
  where status = 'running';

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
  from public, anon, authenticated;;
