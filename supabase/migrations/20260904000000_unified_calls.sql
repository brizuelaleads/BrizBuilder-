-- Provider-neutral phone numbers, calls, lead routing, and callback state.
-- Provider ingestion tables remain as lossless adapter snapshots. phone_calls is
-- the CRM-owned ledger read by Leads and Calls.

create or replace function public.normalize_phone_number(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    when pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g') ~ '^1[0-9]{10}$'
      then '+' || pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g')
    when pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g') ~ '^[0-9]{10}$'
      then '+1' || pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g')
    when pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g') ~ '^[1-9][0-9]{7,14}$'
      then '+' || pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g')
    else null
  end
$$;

revoke all on function public.normalize_phone_number(text) from public, anon, authenticated;
grant execute on function public.normalize_phone_number(text) to service_role;

create table if not exists public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  connection_id uuid references public.provider_connections(id) on delete set null,
  provider text not null,
  phone_number text not null,
  normalized_phone_number text not null,
  display_name text not null,
  purpose text,
  provider_number_id text,
  provider_config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, provider, normalized_phone_number),
  unique (organization_id, client_id, id),
  constraint phone_numbers_normalized_check
    check (normalized_phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  constraint phone_numbers_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

create unique index if not exists phone_numbers_one_default_uidx
  on public.phone_numbers (organization_id, client_id)
  where is_default = true and is_active = true;
create index if not exists phone_numbers_scope_idx
  on public.phone_numbers (organization_id, client_id, is_active, provider);
create index if not exists phone_numbers_connection_idx
  on public.phone_numbers (connection_id) where connection_id is not null;

alter table public.phone_numbers enable row level security;
revoke all on table public.phone_numbers from anon, authenticated;
drop policy if exists "scoped read" on public.phone_numbers;
create policy "scoped read" on public.phone_numbers for select
using (public.is_agency_member(organization_id) or public.is_client_member(client_id));
drop policy if exists "agency manage" on public.phone_numbers;
create policy "agency manage" on public.phone_numbers for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

alter table public.contacts
  add column if not exists last_inbound_phone_number_id uuid
    references public.phone_numbers(id) on delete set null;
alter table public.leads
  add column if not exists last_inbound_phone_number_id uuid
    references public.phone_numbers(id) on delete set null;

alter table public.phone_calls
  add column if not exists provider text,
  add column if not exists provider_connection_id uuid
    references public.provider_connections(id) on delete set null,
  add column if not exists provider_call_id text,
  add column if not exists business_phone_number_id uuid
    references public.phone_numbers(id) on delete set null,
  add column if not exists answered boolean,
  add column if not exists customer_phone text,
  add column if not exists business_phone text,
  add column if not exists customer_name text,
  add column if not exists source text,
  add column if not exists source_name text,
  add column if not exists medium text,
  add column if not exists campaign text,
  add column if not exists classification text,
  add column if not exists call_summary text,
  add column if not exists transcript text,
  add column if not exists transcript_status text,
  add column if not exists recording_available boolean not null default false,
  add column if not exists recording_duration_seconds integer,
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by_call_id uuid;

update public.phone_calls
set provider = coalesce(nullif(provider, ''), 'twilio'),
    provider_call_id = coalesce(nullif(provider_call_id, ''), provider_call_sid),
    customer_phone = coalesce(
      customer_phone,
      case when lower(direction) = 'outbound' then to_number else from_number end
    ),
    business_phone = coalesce(
      business_phone,
      case when lower(direction) = 'outbound' then from_number else to_number end
    ),
    answered = coalesce(
      answered,
      case
        when lower(status) in ('completed', 'in-progress', 'answered') then true
        when lower(status) in ('no-answer', 'busy', 'failed', 'canceled') then false
        else null
      end
    );

alter table public.phone_calls
  alter column provider set default 'twilio',
  alter column provider set not null,
  alter column provider_call_id set not null;

create unique index if not exists phone_calls_tenant_provider_call_uidx
  on public.phone_calls (organization_id, client_id, provider, provider_call_id);
create index if not exists phone_calls_customer_time_idx
  on public.phone_calls (organization_id, client_id, customer_phone, started_at desc);
create index if not exists phone_calls_attention_idx
  on public.phone_calls (organization_id, client_id, started_at desc)
  where direction = 'inbound' and answered = false and handled_at is null;

-- A selected Twilio number is registered immediately and becomes the client's
-- default callback route. Older numbers remain active so historical callbacks
-- can continue to use the number a caller originally dialed.
create or replace function public.sync_twilio_configured_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
  v_connection_id uuid;
begin
  v_number := public.normalize_phone_number(new.phone_number);
  if new.provider <> 'twilio' or v_number is null then
    return new;
  end if;

  select connection.id into v_connection_id
    from public.provider_connections as connection
   where connection.organization_id = new.organization_id
     and connection.client_id = new.client_id
     and connection.provider = 'twilio'
   limit 1;

  update public.phone_numbers
     set is_default = false, updated_at = pg_catalog.now()
   where organization_id = new.organization_id
     and client_id = new.client_id
     and is_default = true
     and normalized_phone_number <> v_number;

  insert into public.phone_numbers (
    organization_id, client_id, connection_id, provider, phone_number,
    normalized_phone_number, display_name, purpose, provider_number_id,
    provider_config, is_active, is_default, updated_at
  ) values (
    new.organization_id, new.client_id, v_connection_id, 'twilio', new.phone_number,
    v_number, new.phone_number, 'Main phone', new.phone_number_sid,
    pg_catalog.jsonb_build_object('forwardingNumber', new.forwarding_number),
    new.provider_status = 'connected', true, pg_catalog.now()
  )
  on conflict (organization_id, client_id, provider, normalized_phone_number)
  do update set
    connection_id = excluded.connection_id,
    phone_number = excluded.phone_number,
    provider_number_id = excluded.provider_number_id,
    provider_config = excluded.provider_config,
    is_active = excluded.is_active,
    is_default = true,
    updated_at = pg_catalog.now();
  return new;
end
$$;

drop trigger if exists phone_system_configs_sync_number on public.phone_system_configs;
create trigger phone_system_configs_sync_number
after insert or update of phone_number, phone_number_sid, forwarding_number, provider_status
on public.phone_system_configs
for each row execute function public.sync_twilio_configured_number();

-- Backfill existing Twilio configurations through the same trigger logic.
update public.phone_system_configs
set phone_number = phone_number
where provider = 'twilio' and phone_number is not null;

-- CallRail remains the durable provider snapshot used by its retry and
-- transcript-enrichment pipeline. This trigger projects each revision into the
-- normalized CRM call ledger and number registry idempotently.
create or replace function public.sync_callrail_call_to_phone_calls()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
  v_number_id uuid;
  v_connection_id uuid;
  v_direction text := lower(coalesce(new.direction, 'inbound'));
  v_status text;
begin
  v_number := public.normalize_phone_number(
    coalesce(new.tracking_phone_number, new.business_phone_number)
  );

  select connection.id into v_connection_id
    from public.provider_connections as connection
   where connection.organization_id = new.organization_id
     and connection.client_id = new.client_id
     and connection.provider = 'callrail'
   limit 1;

  if v_number is not null then
    insert into public.phone_numbers (
      organization_id, client_id, connection_id, provider, phone_number,
      normalized_phone_number, display_name, purpose, provider_number_id,
      provider_config, is_active, is_default, updated_at
    ) values (
      new.organization_id, new.client_id, v_connection_id, 'callrail', v_number,
      v_number, coalesce(nullif(new.source_name, ''), v_number),
      coalesce(nullif(new.campaign, ''), nullif(new.source_name, ''), 'Call tracking'),
      new.tracker_id,
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'businessPhoneNumber', public.normalize_phone_number(new.business_phone_number),
        'trackerId', new.tracker_id
      )),
      true, false, pg_catalog.now()
    )
    on conflict (organization_id, client_id, provider, normalized_phone_number)
    do update set
      connection_id = coalesce(excluded.connection_id, public.phone_numbers.connection_id),
      display_name = excluded.display_name,
      purpose = excluded.purpose,
      provider_number_id = coalesce(excluded.provider_number_id, public.phone_numbers.provider_number_id),
      provider_config = public.phone_numbers.provider_config || excluded.provider_config,
      is_active = true,
      updated_at = pg_catalog.now()
    returning id into v_number_id;

    if not exists (
      select 1 from public.phone_numbers
       where organization_id = new.organization_id
         and client_id = new.client_id
         and is_default = true and is_active = true
    ) then
      update public.phone_numbers set is_default = true
       where id = v_number_id;
    end if;
  end if;

  v_status := case
    when new.answered is true then 'completed'
    when new.answered is false then 'no-answer'
    else coalesce(new.ingest_status, 'processing')
  end;

  insert into public.phone_calls (
    organization_id, client_id, contact_id, lead_id,
    provider_call_sid, provider, provider_connection_id, provider_call_id,
    business_phone_number_id, direction, from_number, to_number, status,
    answered, customer_phone, business_phone, customer_name, duration_seconds,
    started_at, ended_at, source, source_name, medium, campaign,
    classification, call_summary, transcript, transcript_status,
    recording_available, recording_duration_seconds, raw_event, updated_at
  ) values (
    new.organization_id, new.client_id, new.contact_id, new.lead_id,
    'callrail:' || new.callrail_call_id, 'callrail', v_connection_id,
    new.callrail_call_id, v_number_id, v_direction,
    case when v_direction = 'outbound' then coalesce(v_number, '') else coalesce(new.customer_phone_e164, '') end,
    case when v_direction = 'outbound' then coalesce(new.customer_phone_e164, '') else coalesce(v_number, '') end,
    v_status, new.answered, new.customer_phone_e164, v_number, new.customer_name,
    new.duration_seconds, coalesce(new.started_at, new.first_seen_at, pg_catalog.now()),
    new.ended_at, new.source, new.source_name, new.medium, new.campaign,
    new.classification, new.call_summary, new.transcript, new.transcript_status,
    coalesce(new.recording_available, false), new.recording_duration_seconds,
    '{}'::jsonb, pg_catalog.now()
  )
  on conflict (organization_id, client_id, provider, provider_call_id)
  do update set
    contact_id = excluded.contact_id,
    lead_id = excluded.lead_id,
    provider_connection_id = coalesce(excluded.provider_connection_id, public.phone_calls.provider_connection_id),
    business_phone_number_id = coalesce(excluded.business_phone_number_id, public.phone_calls.business_phone_number_id),
    direction = excluded.direction,
    from_number = excluded.from_number,
    to_number = excluded.to_number,
    status = excluded.status,
    answered = excluded.answered,
    customer_phone = excluded.customer_phone,
    business_phone = excluded.business_phone,
    customer_name = excluded.customer_name,
    duration_seconds = excluded.duration_seconds,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    source = excluded.source,
    source_name = excluded.source_name,
    medium = excluded.medium,
    campaign = excluded.campaign,
    classification = excluded.classification,
    call_summary = excluded.call_summary,
    transcript = excluded.transcript,
    transcript_status = excluded.transcript_status,
    recording_available = excluded.recording_available,
    recording_duration_seconds = excluded.recording_duration_seconds,
    updated_at = pg_catalog.now();
  return new;
end
$$;

drop trigger if exists callrail_calls_sync_unified on public.callrail_calls;
create trigger callrail_calls_sync_unified
after insert or update on public.callrail_calls
for each row execute function public.sync_callrail_call_to_phone_calls();

-- Backfill every existing CallRail row through the projection.
update public.callrail_calls set updated_at = updated_at;

-- Keep the most recent valid inbound route on the person and opportunity. A
-- later successful conversation handles earlier missed calls from that caller.
create or replace function public.apply_phone_call_routing_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_later_success uuid;
begin
  if lower(new.direction) = 'inbound'
     and new.business_phone_number_id is not null then
    if new.contact_id is not null then
      update public.contacts
         set last_inbound_phone_number_id = new.business_phone_number_id,
             last_interaction_at = greatest(
               coalesce(last_interaction_at, new.started_at), new.started_at
             ),
             updated_at = pg_catalog.now()
       where id = new.contact_id
         and organization_id = new.organization_id
         and client_id = new.client_id;
    end if;
    if new.lead_id is not null then
      update public.leads
         set last_inbound_phone_number_id = new.business_phone_number_id,
             last_contacted_at = greatest(
               coalesce(last_contacted_at, new.started_at), new.started_at
             ),
             updated_at = pg_catalog.now()
       where id = new.lead_id
         and organization_id = new.organization_id
         and client_id = new.client_id;
    end if;
  end if;

  if new.answered is true and new.customer_phone is not null then
    update public.phone_calls
       set handled_at = coalesce(handled_at, new.ended_at, new.started_at, pg_catalog.now()),
           handled_by_call_id = coalesce(handled_by_call_id, new.id),
           updated_at = pg_catalog.now()
     where organization_id = new.organization_id
       and client_id = new.client_id
       and id <> new.id
       and lower(direction) = 'inbound'
       and answered is false
       and handled_at is null
       and customer_phone = new.customer_phone
       and started_at <= new.started_at;
  elsif lower(new.direction) = 'inbound'
        and new.answered is false
        and new.handled_at is null
        and new.customer_phone is not null then
    select call.id into v_later_success
      from public.phone_calls as call
     where call.organization_id = new.organization_id
       and call.client_id = new.client_id
       and call.id <> new.id
       and call.customer_phone = new.customer_phone
       and call.answered is true
       and call.started_at > new.started_at
     order by call.started_at asc
     limit 1;
    if v_later_success is not null then
      update public.phone_calls
         set handled_at = pg_catalog.now(),
             handled_by_call_id = v_later_success,
             updated_at = pg_catalog.now()
       where id = new.id;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists phone_calls_apply_routing_state on public.phone_calls;
create trigger phone_calls_apply_routing_state
after insert or update of answered, status, direction, customer_phone, business_phone_number_id
on public.phone_calls
for each row execute function public.apply_phone_call_routing_state();

-- Shared provider-neutral contact matching for all phone adapters. Tenant and
-- canonical phone are part of both the lock and lookup, so the same number may
-- safely belong to different clients without cross-tenant matches.
create or replace function public.find_or_create_phone_contact(
  p_organization_id uuid,
  p_client_id uuid,
  p_phone_e164 text,
  p_first_name text,
  p_last_name text,
  p_city text,
  p_state text,
  p_provider text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := public.normalize_phone_number(p_phone_e164);
  v_digits text;
  v_local_digits text;
  v_contact_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_provider text := lower(coalesce(nullif(pg_catalog.btrim(p_provider), ''), 'phone'));
begin
  if p_organization_id is null or p_client_id is null then
    raise exception 'find_or_create_phone_contact requires an organization and client';
  end if;
  if v_phone is null then
    raise exception 'find_or_create_phone_contact requires a valid phone number';
  end if;
  if not exists (
    select 1 from public.clients
     where organization_id = p_organization_id and id = p_client_id
  ) then
    raise exception 'find_or_create_phone_contact client is outside the tenant';
  end if;

  v_digits := pg_catalog.regexp_replace(v_phone, '[^0-9]', '', 'g');
  v_local_digits := case when pg_catalog.length(v_digits) = 11 and pg_catalog.left(v_digits, 1) = '1'
    then pg_catalog.substring(v_digits, 2) else v_digits end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_client_id::text || ':' || v_phone, 0
  ));

  select contact.id into v_contact_id
    from public.contacts as contact
   where contact.organization_id = p_organization_id
     and contact.client_id = p_client_id
     and contact.archived_at is null
     and pg_catalog.regexp_replace(coalesce(contact.phone, ''), '[^0-9]', '', 'g')
       in (v_digits, v_local_digits)
   order by contact.created_at asc, contact.id asc
   limit 1;

  if v_contact_id is not null then
    update public.contacts
       set last_interaction_at = v_now, updated_at = v_now
     where id = v_contact_id
       and organization_id = p_organization_id
       and client_id = p_client_id;
    return v_contact_id;
  end if;

  insert into public.contacts (
    organization_id, client_id, first_name, last_name, phone, city, state,
    marketing_consent, tags, last_interaction_at
  ) values (
    p_organization_id, p_client_id,
    coalesce(nullif(pg_catalog.btrim(coalesce(p_first_name, '')), ''), 'Phone'),
    coalesce(p_last_name, 'Caller'), v_phone, p_city, p_state, 'unknown',
    array[pg_catalog.initcap(v_provider)], v_now
  ) returning id into v_contact_id;
  return v_contact_id;
end
$$;

revoke all on function public.find_or_create_phone_contact(
  uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.find_or_create_phone_contact(
  uuid, uuid, text, text, text, text, text, text
) to service_role;

-- Shared lead reuse/creation. The newest open lead is reused; a closed lead
-- opens a new opportunity. Provider is attribution metadata, never routing.
create or replace function public.find_or_create_phone_lead(
  p_organization_id uuid,
  p_client_id uuid,
  p_contact_id uuid,
  p_provider text,
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
returns table (lead_id uuid, created boolean, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_lead_id uuid;
  v_pipeline_id uuid;
  v_stage_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_provider text := pg_catalog.initcap(lower(coalesce(nullif(pg_catalog.btrim(p_provider), ''), 'phone')));
begin
  if not exists (
    select 1 from public.contacts as contact
     where contact.id = p_contact_id
       and contact.organization_id = p_organization_id
       and contact.client_id = p_client_id
       and contact.archived_at is null
  ) then
    raise exception 'find_or_create_phone_lead contact is outside the tenant';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text || ':' || p_client_id::text || ':' || p_contact_id::text || ':phone-lead', 0
  ));
  select lead.* into v_lead
    from public.leads as lead
   where lead.organization_id = p_organization_id
     and lead.client_id = p_client_id
     and lead.contact_id = p_contact_id
   order by lead.created_at desc, lead.id desc
   limit 1 for update;

  if v_lead.id is not null and v_lead.status::text = any (array[
    'NEW', 'CONTACTED', 'QUALIFIED', 'APPOINTMENT_BOOKED',
    'ESTIMATE_SENT', 'UNRESPONSIVE'
  ]) then
    update public.leads set
      first_contacted_at = least(coalesce(first_contacted_at, created_at), coalesce(p_first_contacted_at, created_at)),
      last_contacted_at = greatest(coalesce(last_contacted_at, created_at), coalesce(p_last_contacted_at, created_at)),
      updated_at = v_now
    where id = v_lead.id
      and organization_id = p_organization_id
      and client_id = p_client_id;
    return query select v_lead.id, false, true;
    return;
  end if;

  select pipeline.id into v_pipeline_id
    from public.pipelines as pipeline
   where pipeline.organization_id = p_organization_id
     and (pipeline.client_id = p_client_id or pipeline.client_id is null)
   order by (pipeline.client_id = p_client_id) desc, pipeline.is_default desc, pipeline.created_at asc
   limit 1;
  select stage.id into v_stage_id
    from public.pipeline_stages as stage
   where stage.organization_id = p_organization_id
     and stage.pipeline_id = v_pipeline_id
   order by (stage.slug = 'new') desc, stage.position asc
   limit 1;

  insert into public.leads (
    organization_id, client_id, contact_id, pipeline_id, stage_id,
    service_requested, message, source, campaign, status, lead_score, tags,
    consent_status, attribution, meta_eligible, meta_eligibility_reason,
    first_contacted_at, last_contacted_at, field_provenance
  ) values (
    p_organization_id, p_client_id, p_contact_id, v_pipeline_id, v_stage_id,
    'Phone call', coalesce(p_message, ''), v_provider, p_campaign, 'NEW'::public.lead_status,
    greatest(0, least(100, coalesce(p_lead_score, 50))), array[v_provider],
    'unknown', coalesce(p_attribution, '{}'::jsonb), coalesce(p_meta_eligible, false),
    p_meta_eligibility_reason, coalesce(p_first_contacted_at, p_last_contacted_at, v_now),
    coalesce(p_last_contacted_at, p_first_contacted_at, v_now),
    coalesce(p_field_provenance, '{}'::jsonb)
  ) returning id into v_lead_id;
  return query select v_lead_id, true, false;
end
$$;

revoke all on function public.find_or_create_phone_lead(
  uuid, uuid, uuid, text, text, text, integer, jsonb, boolean, text,
  timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.find_or_create_phone_lead(
  uuid, uuid, uuid, text, text, text, integer, jsonb, boolean, text,
  timestamptz, timestamptz, jsonb
) to service_role;
