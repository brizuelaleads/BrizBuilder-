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

-- Whether this client's calls may be ingested at all.
--
-- Defaults to false, including for connections that already exist. Ingestion
-- creates contacts and leads in a customer's CRM, so it is opted into per
-- client rather than following automatically from a connection being present.
alter table public.callrail_credentials
  add column if not exists ingest_enabled boolean not null default false,
  -- How long after an enquiry a further call still belongs to it. Per client,
  -- because how long a job stays "the same job" is a property of the trade.
  add column if not exists re_inquiry_window_days integer not null default 30,
  add column if not exists webhook_path_id text,
  add column if not exists webhook_signing_key_ciphertext text,
  add column if not exists webhook_signing_key_iv text,
  add column if not exists webhook_integration_id text;

-- The signing key is a credential and is encrypted like the API key. Both
-- halves move together or not at all, so a half-written pair cannot exist.
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
    -- Zero would make every call its own lead; a decade would attach a call to
    -- an enquiry nobody remembers. Both are refused rather than clamped.
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

create unique index if not exists callrail_credentials_webhook_path_uidx
  on public.callrail_credentials (webhook_path_id)
  where webhook_path_id is not null;

create index if not exists callrail_credentials_ingest_enabled_idx
  on public.callrail_credentials (updated_at)
  where ingest_enabled = true;

-- ---------------------------------------------------------------- the calls

create table if not exists public.callrail_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,

  -- CallRail's own identifier. The idempotency key for the whole pipeline.
  callrail_call_id text not null,
  company_id text not null,

  -- Call facts, all refetched from the API rather than read from a webhook.
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

  -- Attribution that belongs to the call rather than to the Meta payload.
  -- gclid, keywords, landing page and session identifiers live here and are
  -- deliberately never copied into leads.attribution: that column is the Meta
  -- match-key record, and widening it would put Google identifiers on the Meta
  -- send path.
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
  -- Kept for provenance: the eligibility decision made from it is immutable on
  -- the lead, so the evidence behind it has to remain inspectable.
  fbclid text,
  is_session_tracker boolean,

  -- Conversation intelligence, when the plan returns it.
  recording_url text,
  transcript text,
  call_summary text,

  -- Where this call got to in the pipeline.
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

  -- One row per CallRail call per client. This is what makes a replayed
  -- webhook, a duplicate delivery and a reconciliation sweep converge instead
  -- of multiplying.
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
-- Finding the calls a reconciliation sweep still owes work to.
create index if not exists callrail_calls_pending_idx
  on public.callrail_calls (organization_id, client_id, updated_at)
  where ingest_status in ('received', 'enriching', 'failed');
create index if not exists callrail_calls_contact_idx
  on public.callrail_calls (contact_id) where contact_id is not null;

comment on table public.callrail_calls is
  'One row per CallRail call per client, keyed on CallRail''s call id.';
comment on column public.callrail_calls.fbclid is
  'Evidence for the immutable Meta eligibility decision made when the lead was created.';

-- A single call can be delivered more than once and also be seen by a
-- reconciliation sweep. This claim is the mutex: one worker owns CRM mutation
-- for a call at a time, and a stale owner can be recovered by reconciliation.
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

-- ----------------------------------------------------------- the deliveries

-- What arrived, whether it was authentic, and what was done about it.
--
-- The raw body is deliberately not stored. It carries a caller's name, phone
-- number and click identifiers, and keeping a copy would create a second place
-- those have to be retained and deleted from. The digest is enough to
-- recognise a replay, and the call itself is refetched from the API anyway.
create table if not exists public.callrail_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  webhook_kind text,
  callrail_call_id text,
  company_id text,
  body_sha256 text not null,
  signature_valid boolean not null,
  -- Closed vocabulary: never a provider response or an exception message.
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
-- Recognising a replay of the exact same delivery.
create index if not exists callrail_webhook_deliveries_replay_idx
  on public.callrail_webhook_deliveries (body_sha256, received_at desc);

comment on table public.callrail_webhook_deliveries is
  'Audit of every CallRail webhook received, authentic or not. Raw bodies are never stored.';

-- ------------------------------------------------------------- the sweeps

-- CallRail does not reliably retry a webhook it failed to deliver, so a missed
-- delivery is silent. A scheduled read of the API is what closes that gap, and
-- this records what each sweep covered so a hole can be seen rather than
-- assumed absent.
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

-- ------------------------------------------- eligibility reasons for calls

-- Two ways a call fails Meta attribution that a web form cannot, added to the
-- closed vocabulary so an ineligible call can be explained without guessing.
-- Neither grants eligibility: the eligible side of the constraint is untouched,
-- so a lead may still only be eligible by reason of a validated click id.
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
        -- A Source or offline tracker cannot carry a click id at all, which is
        -- a different problem from a visitor who simply did not click an ad.
        'callrail_no_session_tracker',
        -- A session tracker that carried no Meta click id.
        'callrail_no_click_id'
      )
    );
end
$$;

comment on column public.callrail_credentials.re_inquiry_window_days is
  'Days after a lead is raised during which a further call from the same contact attaches to it instead of opening another.';

-- --------------------------------------------------- one contact per caller
--
-- Two ingestion workers handling different calls from the same new caller both
-- miss on the select and both insert, and the customer ends up with the same
-- person twice. A unique index on the phone number would prevent that, and is
-- deliberately not used: contacts legitimately share numbers outside this path
-- — a household, a switchboard, a spouse — and this pipeline has no business
-- imposing a rule on the rest of the CRM.
--
-- So the exclusion is scoped to the operation rather than the column. The lock
-- is transaction-scoped, keyed on the tenant and the number, and released when
-- the transaction ends however it ends. Callers outside CallRail ingestion
-- never take it and are unaffected.
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
-- Empty rather than 'public': a definer function runs with the owner's rights,
-- so it must not resolve any name through a path a caller could influence.
-- pg_catalog is still searched implicitly, and every other reference below is
-- schema-qualified.
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

  -- Canonical E.164 only. A blank, locally formatted or partially normalized
  -- number would key the lock on one string and match rows on another, which
  -- is the one way this function could still hand back two contacts for what
  -- is really one caller.
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'find_or_create_callrail_contact requires a canonical E.164 phone number';
  end if;

  -- Serialize only the callers competing for this exact number in this exact
  -- tenant. Two different numbers, or the same number in another client, never
  -- wait for each other. Transaction-scoped, so it is released however the
  -- transaction ends.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_client_id::text || ':' || v_phone,
      0
    )
  );

  -- Recheck inside the lock: whoever held it first may already have inserted
  -- the row this call was about to create.
  --
  -- Duplicates predating this function are resolved deterministically rather
  -- than arbitrarily. Ordering by created_at then id means every caller picks
  -- the same survivor, so a pre-existing pair does not oscillate between two
  -- contacts depending on which row the planner returned first.
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
  'Service-role only. Returns one contact per (organization, client, canonical E.164 phone) under a transaction-scoped advisory lock, resolving pre-existing duplicates deterministically, without constraining shared numbers elsewhere in the CRM.';
