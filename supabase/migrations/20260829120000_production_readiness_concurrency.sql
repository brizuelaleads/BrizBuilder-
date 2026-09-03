-- Production-readiness concurrency controls.
--
-- Additive only. This migration deliberately leaves every production-applied
-- migration untouched and is not applied by this change set.

-- -------------------------------------------------------------------------
-- CallRail transcript ordering

alter table public.callrail_calls
  add column if not exists transcript_requested_generation bigint not null default 0,
  add column if not exists transcript_generation bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.callrail_calls'::regclass
       and conname = 'callrail_calls_transcript_generation_check'
  ) then
    alter table public.callrail_calls
      add constraint callrail_calls_transcript_generation_check
      check (
        transcript_requested_generation >= 0
        and transcript_generation >= 0
        and transcript_generation <= transcript_requested_generation
      );
  end if;
end
$$;

-- Reserve a monotonically increasing generation before calling CallRail.
-- An active ingestion lease blocks a new provider fetch, so once enrichment
-- validates its generation no later response can become current underneath
-- its CRM/calendar mutations. A dead owner remains recoverable via the same
-- stale threshold used by claim_callrail_call_for_ingestion.
create or replace function public.reserve_callrail_transcript_generation(
  p_organization_id uuid,
  p_client_id uuid,
  p_callrail_call_id text,
  p_stale_before timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
begin
  if p_organization_id is null or p_client_id is null
     or nullif(pg_catalog.btrim(coalesce(p_callrail_call_id, '')), '') is null
     or p_stale_before is null then
    raise exception 'reserve_callrail_transcript_generation requires a tenant, call, and stale threshold';
  end if;

  update public.callrail_calls as call
     set transcript_requested_generation = call.transcript_requested_generation + 1,
         updated_at = pg_catalog.now()
   where call.organization_id = p_organization_id
     and call.client_id = p_client_id
     and call.callrail_call_id = p_callrail_call_id
     and (
       call.ingest_status <> 'enriching'
       or call.updated_at < p_stale_before
     )
  returning call.transcript_requested_generation into v_generation;

  return v_generation;
end
$$;

revoke all on function public.reserve_callrail_transcript_generation(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.reserve_callrail_transcript_generation(
  uuid, uuid, text, timestamptz
) to service_role;

-- This compare-and-set is the required gate before transcript-derived CRM
-- work. The surrounding ingestion lease prevents a new generation reservation
-- until the owner finishes (or its lease is stale), while this transaction
-- proves the hash and both generation counters are still the expected ones.
create or replace function public.claim_callrail_transcript_enrichment(
  p_call_row_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_transcript_sha256 text,
  p_transcript_generation bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean := false;
begin
  update public.callrail_calls as call
     set enrichment_status = 'processing',
         enrichment_attempted_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where call.id = p_call_row_id
     and call.organization_id = p_organization_id
     and call.client_id = p_client_id
     and call.ingest_status = 'enriching'
     and call.transcript_sha256 = p_transcript_sha256
     and call.transcript_generation = p_transcript_generation
     and call.transcript_requested_generation = p_transcript_generation;

  v_claimed := found;
  return v_claimed;
end
$$;

revoke all on function public.claim_callrail_transcript_enrichment(
  uuid, uuid, uuid, text, bigint
) from public, anon, authenticated;
grant execute on function public.claim_callrail_transcript_enrichment(
  uuid, uuid, uuid, text, bigint
) to service_role;

comment on column public.callrail_calls.transcript_requested_generation is
  'Monotonic per-call generation reserved before each CallRail fetch; blocks out-of-order responses and stale enrichment.';
comment on column public.callrail_calls.transcript_generation is
  'Generation of the non-null transcript currently stored on this call.';

-- -------------------------------------------------------------------------
-- Atomic CallRail lead reuse/creation

create or replace function public.find_or_create_callrail_lead(
  p_organization_id uuid,
  p_client_id uuid,
  p_contact_id uuid,
  p_message text,
  p_campaign text,
  p_lead_score integer,
  p_attribution jsonb,
  p_meta_eligible boolean,
  p_meta_eligibility_reason text,
  p_first_contacted_at timestamptz,
  p_last_contacted_at timestamptz,
  p_field_provenance jsonb
)
returns table (
  lead_id uuid,
  created boolean,
  reused boolean,
  status text,
  created_at timestamptz,
  first_contacted_at timestamptz,
  last_contacted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_lead_id uuid;
  v_now timestamptz := pg_catalog.now();
begin
  if p_organization_id is null or p_client_id is null or p_contact_id is null then
    raise exception 'find_or_create_callrail_lead requires a tenant and contact';
  end if;
  if not exists (
    select 1
      from public.contacts as contact
     where contact.id = p_contact_id
       and contact.organization_id = p_organization_id
       and contact.client_id = p_client_id
       and contact.archived_at is null
  ) then
    raise exception 'find_or_create_callrail_lead contact is outside the tenant';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_client_id::text || ':' || p_contact_id::text || ':callrail-lead',
      0
    )
  );

  select lead.*
    into v_lead
    from public.leads as lead
   where lead.organization_id = p_organization_id
     and lead.client_id = p_client_id
     and lead.contact_id = p_contact_id
   order by lead.created_at desc, lead.id desc
   limit 1
   for update;

  if v_lead.id is not null and v_lead.status::text = any (array[
    'NEW', 'CONTACTED', 'QUALIFIED', 'APPOINTMENT_BOOKED',
    'ESTIMATE_SENT', 'UNRESPONSIVE'
  ]) then
    update public.leads
       set first_contacted_at = least(
             coalesce(first_contacted_at, created_at),
             coalesce(p_first_contacted_at, created_at)
           ),
           last_contacted_at = greatest(
             coalesce(last_contacted_at, created_at),
             coalesce(p_last_contacted_at, created_at)
           ),
           updated_at = v_now
     where id = v_lead.id;
    return query
      select v_lead.id, false, true, v_lead.status::text,
             v_lead.created_at,
             least(
               coalesce(v_lead.first_contacted_at, v_lead.created_at),
               coalesce(p_first_contacted_at, v_lead.created_at)
             ),
             greatest(
               coalesce(v_lead.last_contacted_at, v_lead.created_at),
               coalesce(p_last_contacted_at, v_lead.created_at)
             );
    return;
  end if;

  insert into public.leads (
    organization_id, client_id, contact_id, pipeline_id, stage_id,
    service_requested, message, source, campaign, status, lead_score, tags,
    consent_status, attribution, meta_eligible, meta_eligibility_reason,
    first_contacted_at, last_contacted_at, field_provenance
  ) values (
    p_organization_id,
    p_client_id,
    p_contact_id,
    '00000000-0000-4000-8000-000000000101'::uuid,
    '00000000-0000-4000-8000-000000000201'::uuid,
    'Phone call',
    coalesce(p_message, ''),
    'CallRail',
    p_campaign,
    'NEW'::public.lead_status,
    greatest(0, least(100, coalesce(p_lead_score, 50))),
    array['CallRail'],
    'unknown',
    coalesce(p_attribution, '{}'::jsonb),
    coalesce(p_meta_eligible, false),
    p_meta_eligibility_reason,
    coalesce(p_first_contacted_at, p_last_contacted_at, v_now),
    coalesce(p_last_contacted_at, p_first_contacted_at, v_now),
    coalesce(p_field_provenance, '{}'::jsonb)
  ) returning id into v_lead_id;

  return query
    select lead.id, true, false, lead.status::text, lead.created_at,
           lead.first_contacted_at, lead.last_contacted_at
      from public.leads as lead
     where lead.id = v_lead_id;
end
$$;

revoke all on function public.find_or_create_callrail_lead(
  uuid, uuid, uuid, text, text, integer, jsonb, boolean, text,
  timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.find_or_create_callrail_lead(
  uuid, uuid, uuid, text, text, integer, jsonb, boolean, text,
  timestamptz, timestamptz, jsonb
) to service_role;

-- -------------------------------------------------------------------------
-- Retryable Web Push delivery claims

alter table public.push_deliveries
  add column if not exists status text not null default 'delivered',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists last_error text,
  add column if not exists event_payload jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.push_deliveries'::regclass
       and conname = 'push_deliveries_status_check'
  ) then
    alter table public.push_deliveries
      add constraint push_deliveries_status_check
      check (status in ('pending', 'processing', 'delivered', 'failed', 'permanently_failed'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.push_deliveries'::regclass
       and conname = 'push_deliveries_attempt_count_check'
  ) then
    alter table public.push_deliveries
      add constraint push_deliveries_attempt_count_check
      check (attempt_count >= 0);
  end if;
end
$$;

create index if not exists push_deliveries_retry_idx
  on public.push_deliveries (next_attempt_at, lease_expires_at)
  where status in ('pending', 'processing', 'failed');

create or replace function public.claim_push_delivery(
  p_organization_id uuid,
  p_client_id uuid,
  p_event_key text,
  p_notification_type text,
  p_event_payload jsonb,
  p_lease_seconds integer default 300
)
returns table (delivery_id uuid, claim_token uuid, attempt_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.push_deliveries%rowtype;
  v_token uuid := extensions.gen_random_uuid();
  v_now timestamptz := pg_catalog.now();
  v_lease interval := pg_catalog.make_interval(secs => greatest(30, least(1800, coalesce(p_lease_seconds, 300))));
begin
  if p_organization_id is null or p_client_id is null
     or nullif(pg_catalog.btrim(coalesce(p_event_key, '')), '') is null
     or nullif(pg_catalog.btrim(coalesce(p_notification_type, '')), '') is null then
    raise exception 'claim_push_delivery requires a tenant, event key, and notification type';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_client_id::text || ':' || p_event_key, 0)
  );

  select delivery.*
    into v_row
    from public.push_deliveries as delivery
   where delivery.client_id = p_client_id
     and delivery.event_key = p_event_key
   for update;

  if v_row.id is null then
    insert into public.push_deliveries (
      organization_id, client_id, event_key, notification_type, status,
      attempt_count, lease_token, lease_expires_at, event_payload, updated_at
    ) values (
      p_organization_id, p_client_id, p_event_key, p_notification_type,
      'processing', 1, v_token, v_now + v_lease,
      coalesce(p_event_payload, '{}'::jsonb), v_now
    )
    returning id into v_row.id;
    return query select v_row.id, v_token, 1;
    return;
  end if;

  if v_row.organization_id <> p_organization_id then
    raise exception 'push delivery tenant mismatch';
  end if;
  if v_row.status in ('delivered', 'permanently_failed') then return; end if;
  if v_row.status = 'processing' and v_row.lease_expires_at > v_now then return; end if;
  if v_row.status in ('pending', 'failed') and v_row.next_attempt_at > v_now then return; end if;

  update public.push_deliveries
     set status = 'processing',
         attempt_count = v_row.attempt_count + 1,
         lease_token = v_token,
         lease_expires_at = v_now + v_lease,
         next_attempt_at = null,
         notification_type = p_notification_type,
         event_payload = coalesce(p_event_payload, v_row.event_payload),
         updated_at = v_now
   where id = v_row.id;

  return query select v_row.id, v_token, v_row.attempt_count + 1;
end
$$;

revoke all on function public.claim_push_delivery(
  uuid, uuid, text, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.claim_push_delivery(
  uuid, uuid, text, text, jsonb, integer
) to service_role;

create or replace function public.complete_push_delivery(
  p_client_id uuid,
  p_event_key text,
  p_claim_token uuid,
  p_status text,
  p_sent_count integer,
  p_failed_count integer,
  p_next_attempt_at timestamptz default null,
  p_last_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean := false;
begin
  if p_status not in ('delivered', 'failed', 'permanently_failed') then
    raise exception 'invalid push delivery completion status';
  end if;

  update public.push_deliveries
     set status = p_status,
         sent_count = greatest(0, coalesce(p_sent_count, 0)),
         failed_count = greatest(0, coalesce(p_failed_count, 0)),
         lease_token = null,
         lease_expires_at = null,
         next_attempt_at = case when p_status = 'failed' then p_next_attempt_at else null end,
         delivered_at = case when p_status = 'delivered' then pg_catalog.now() else delivered_at end,
         last_error = nullif(pg_catalog.left(coalesce(p_last_error, ''), 120), ''),
         updated_at = pg_catalog.now()
   where client_id = p_client_id
     and event_key = p_event_key
     and status = 'processing'
     and lease_token = p_claim_token;

  v_updated := found;
  return v_updated;
end
$$;

revoke all on function public.complete_push_delivery(
  uuid, text, uuid, text, integer, integer, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.complete_push_delivery(
  uuid, text, uuid, text, integer, integer, timestamptz, text
) to service_role;

comment on table public.push_deliveries is
  'Server-only retryable Web Push ledger. Processing claims expire and scheduled sweeps can recover abandoned or failed deliveries.';
