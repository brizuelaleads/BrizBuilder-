-- Call ingestion.
--
-- CallRail sends a webhook when a call starts, when it ends, and again when
-- late-arriving detail is attached. None of those bodies is treated as a source
-- of truth: they are notifications, and every field that matters is refetched
-- from the API against the same call id. A body can be replayed, reordered, or
-- forged; an authenticated read cannot.
--
-- Everything here is keyed on CallRail's own call id, which is what makes the
-- pipeline safe to re-run. A missed webhook, a duplicate delivery and a
-- reconciliation sweep all converge on the same row.

alter table public.callrail_credentials
  add column if not exists ingest_enabled boolean not null default false,
  add column if not exists re_inquiry_window_days integer not null default 30,
  add column if not exists webhook_path_id text,
  add column if not exists webhook_signing_key_ciphertext text,
  add column if not exists webhook_signing_key_iv text,
  add column if not exists webhook_integration_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.callrail_credentials'::regclass
      and conname = 'callrail_credentials_signing_key_pair_check'
  ) then
    alter table public.callrail_credentials
      add constraint callrail_credentials_signing_key_pair_check
      check (
        (webhook_signing_key_ciphertext is null and webhook_signing_key_iv is null)
        or (webhook_signing_key_ciphertext is not null and webhook_signing_key_iv is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.callrail_credentials'::regclass
      and conname = 'callrail_credentials_re_inquiry_window_check'
  ) then
    alter table public.callrail_credentials
      add constraint callrail_credentials_re_inquiry_window_check
      check (re_inquiry_window_days between 1 and 365);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.callrail_credentials'::regclass
      and conname = 'callrail_credentials_webhook_path_id_check'
  ) then
    alter table public.callrail_credentials
      add constraint callrail_credentials_webhook_path_id_check
      check (
        webhook_path_id is null
        or webhook_path_id ~ '^[A-Za-z0-9_-]{32,96}$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.callrail_credentials'::regclass
      and conname = 'callrail_credentials_webhook_integration_id_check'
  ) then
    alter table public.callrail_credentials
      add constraint callrail_credentials_webhook_integration_id_check
      check (
        webhook_integration_id is null
        or webhook_integration_id ~ '^[A-Za-z0-9_-]{1,80}$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.callrail_credentials'::regclass
      and conname = 'callrail_credentials_ingest_ready_check'
  ) then
    alter table public.callrail_credentials
      add constraint callrail_credentials_ingest_ready_check
      check (
        ingest_enabled = false
        or (
          account_id is not null
          and company_id is not null
          and webhook_path_id is not null
          and webhook_integration_id is not null
          and webhook_signing_key_ciphertext is not null
          and webhook_signing_key_iv is not null
        )
      );
  end if;
end
$$;

comment on column public.callrail_credentials.ingest_enabled is
  'Whether calls for this client may create CRM records. Off until deliberately enabled.';
comment on column public.callrail_credentials.webhook_path_id is
  'Opaque random URL path segment used to resolve the tenant before reading a signed webhook body.';
comment on column public.callrail_credentials.webhook_signing_key_ciphertext is
  'AES-256-GCM ciphertext of the CallRail webhook signing key. Server-only, like the API key.';
comment on column public.callrail_credentials.re_inquiry_window_days is
  'Days after a lead is raised during which a further call from the same contact attaches to it instead of opening another.';

create unique index if not exists callrail_credentials_webhook_path_uidx
  on public.callrail_credentials (webhook_path_id)
  where webhook_path_id is not null;

create index if not exists callrail_credentials_ingest_enabled_idx
  on public.callrail_credentials (updated_at)
  where ingest_enabled = true;

create table if not exists public.callrail_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  callrail_call_id text not null,
  company_id text not null,
  direction text,
  answered boolean,
  duration_seconds integer,
  started_at timestamptz,
  ended_at timestamptz,
  tracking_phone_number text,
  business_phone_number text,
  customer_phone_e164 text,
  customer_name text,
  customer_city text,
  customer_state text,
  customer_country text,
  source text,
  medium text,
  campaign text,
  keywords text,
  referrer_domain text,
  landing_page_url text,
  last_requested_url text,
  gclid text,
  msclkid text,
  session_uuid text,
  tracker_id text,
  fbclid text,
  is_session_tracker boolean,
  recording_url text,
  transcript text,
  call_summary text,
  ingest_status text not null default 'received',
  ingest_error text,
  last_webhook_kind text,
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  classification text,
  first_seen_at timestamptz not null default now(),
  refetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, callrail_call_id),
  constraint callrail_calls_ingest_status_check
    check (ingest_status in ('received', 'enriching', 'ingested', 'skipped', 'failed')),
  constraint callrail_calls_classification_check
    check (
      classification is null
      or classification in (
        'new_sales_inquiry', 'existing_customer', 'support',
        'spam', 'wrong_number', 'unclassified'
      )
    ),
  constraint callrail_calls_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

alter table public.callrail_calls enable row level security;
revoke all on table public.callrail_calls from anon, authenticated;

create index if not exists callrail_calls_scope_idx
  on public.callrail_calls (organization_id, client_id, started_at desc);
create index if not exists callrail_calls_pending_idx
  on public.callrail_calls (organization_id, client_id, updated_at)
  where ingest_status in ('received', 'enriching', 'failed');
create index if not exists callrail_calls_contact_idx
  on public.callrail_calls (contact_id) where contact_id is not null;

comment on table public.callrail_calls is
  'One row per CallRail call per client, keyed on CallRail''s call id.';
comment on column public.callrail_calls.fbclid is
  'Evidence for the immutable Meta eligibility decision made when the lead was created.';

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
set search_path = public
as $$
begin
  return query
  update public.callrail_calls as call
     set ingest_status = 'enriching',
         ingest_error = null,
         updated_at = now()
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
grant execute on function public.claim_callrail_call_for_ingestion(uuid, timestamptz)
  to service_role;

create table if not exists public.callrail_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  webhook_kind text,
  callrail_call_id text,
  company_id text,
  body_sha256 text not null,
  signature_valid boolean not null,
  outcome text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint callrail_webhook_deliveries_outcome_check
    check (
      outcome in (
        'accepted', 'duplicate', 'rejected_signature', 'rejected_payload',
        'rejected_unknown_client', 'rejected_ingest_disabled', 'failed'
      )
    )
);

alter table public.callrail_webhook_deliveries enable row level security;
revoke all on table public.callrail_webhook_deliveries from anon, authenticated;

create index if not exists callrail_webhook_deliveries_scope_idx
  on public.callrail_webhook_deliveries (organization_id, client_id, received_at desc);
create index if not exists callrail_webhook_deliveries_replay_idx
  on public.callrail_webhook_deliveries (body_sha256, received_at desc);

comment on table public.callrail_webhook_deliveries is
  'Audit of every CallRail webhook received, authentic or not. Raw bodies are never stored.';

create table if not exists public.callrail_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  window_start timestamptz not null,
  window_end timestamptz not null,
  calls_seen integer not null default 0,
  calls_ingested integer not null default 0,
  calls_repaired integer not null default 0,
  status text not null default 'running',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint callrail_sync_runs_status_check
    check (status in ('running', 'ok', 'partial', 'failed')),
  constraint callrail_sync_runs_window_check
    check (window_end > window_start)
);

alter table public.callrail_sync_runs enable row level security;
revoke all on table public.callrail_sync_runs from anon, authenticated;

create index if not exists callrail_sync_runs_scope_idx
  on public.callrail_sync_runs (organization_id, client_id, started_at desc);

do $$
begin
  alter table public.leads
    drop constraint if exists leads_meta_eligibility_reason_check;
  alter table public.leads
    add constraint leads_meta_eligibility_reason_check
    check (
      meta_eligibility_reason is null
      or meta_eligibility_reason in (
        'meta_fbclid', 'invalid_fbclid', 'client_supplied_fbc', 'fbp_only',
        'utm_only', 'unverified_label', 'no_meta_attribution',
        'backfill_no_evidence',
        'callrail_no_session_tracker',
        'callrail_no_click_id'
      )
    );
end
$$;

create or replace function public.find_or_create_callrail_contact(
  p_organization_id uuid,
  p_client_id uuid,
  p_phone_e164 text,
  p_first_name text,
  p_last_name text,
  p_city text,
  p_state text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := nullif(pg_catalog.btrim(coalesce(p_phone_e164, '')), '');
  v_contact_id uuid;
  v_now timestamptz := pg_catalog.now();
begin
  if p_organization_id is null or p_client_id is null then
    raise exception 'find_or_create_callrail_contact requires an organization and a client';
  end if;

  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'find_or_create_callrail_contact requires a canonical E.164 phone number';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_client_id::text || ':' || v_phone,
      0
    )
  );

  select c.id
    into v_contact_id
    from public.contacts as c
   where c.organization_id = p_organization_id
     and c.client_id = p_client_id
     and c.phone = v_phone
     and c.archived_at is null
   order by c.created_at asc, c.id asc
   limit 1;

  if v_contact_id is not null then
    update public.contacts
       set last_interaction_at = v_now,
           updated_at = v_now
     where id = v_contact_id;
    return v_contact_id;
  end if;

  insert into public.contacts (
    organization_id, client_id, first_name, last_name, phone,
    city, state, marketing_consent, tags, last_interaction_at
  )
  values (
    p_organization_id, p_client_id,
    coalesce(nullif(pg_catalog.btrim(coalesce(p_first_name, '')), ''), 'Caller'),
    coalesce(p_last_name, ''),
    v_phone, p_city, p_state, 'unknown', array['CallRail'], v_now
  )
  returning id into v_contact_id;

  return v_contact_id;
end
$$;

revoke all on function public.find_or_create_callrail_contact(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.find_or_create_callrail_contact(
  uuid, uuid, text, text, text, text, text
) to service_role;

comment on function public.find_or_create_callrail_contact(
  uuid, uuid, text, text, text, text, text
) is
  'Service-role only. Returns one contact per (organization, client, canonical E.164 phone) under a transaction-scoped advisory lock, resolving pre-existing duplicates deterministically, without constraining shared numbers elsewhere in the CRM.';;
