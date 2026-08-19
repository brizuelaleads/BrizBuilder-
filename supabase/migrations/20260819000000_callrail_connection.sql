-- CallRail credentials are customer-owned: each client generates an API key in
-- their own CallRail account and connects it here. The Worker encrypts the key
-- before storage, so this table intentionally has no RLS policies and no
-- anon/authenticated grants — only the server-side service role can reach
-- credential material. Same locked pattern as meta_conversion_credentials and
-- google_business_credentials.
--
-- A CallRail API key is scoped to the user who created it and can read every
-- account and company that user can see, so the key is strictly more sensitive
-- than the ids it accompanies. The account and company ids are safe to show on
-- the Connections card; the key never leaves this table in plain text and is
-- never returned to a browser after it is submitted.
--
-- The row is written in stages, which is why account_id and company_id are
-- nullable. The key is stored first so the account list can be fetched with it
-- server-side; the operator then picks an account, then a company. Asking the
-- browser to hold the key across those steps would be the alternative, and a
-- key that has to be re-submitted is a key that lives in browser memory.
create table if not exists public.callrail_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  account_id text,
  account_name text,
  company_id text,
  company_name text,
  api_key_ciphertext text not null,
  api_key_iv text not null,
  connected_by_email text not null,
  last_checked_at timestamptz,
  last_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id),

  -- Ids are interpolated into API paths, so their shape is constrained here as
  -- well as in the Worker. Two forms are accepted: the current v3 resource id
  -- (a three-letter uppercase prefix plus an opaque alphanumeric body) and the
  -- legacy bare-numeric form that CallRail's own Companies listing example
  -- still shows. The body length is deliberately a range rather than a fixed
  -- 32 — an identifier format belongs to the provider, and pinning the exact
  -- length would fail closed the day they extend it. Alphanumeric-only is what
  -- makes this a path-safety check too: no dot, slash or percent survives it.
  constraint callrail_credentials_account_id_check
    check (
      account_id is null
      or account_id ~ '^(ACC[A-Za-z0-9]{8,64}|[0-9]{6,20})$'
    ),
  constraint callrail_credentials_company_id_check
    check (
      company_id is null
      or company_id ~ '^(COM[A-Za-z0-9]{8,64}|[0-9]{6,20})$'
    ),

  -- Setup runs account-then-company, so a company without an account is a
  -- state the flow cannot produce and the database will not hold.
  constraint callrail_credentials_company_requires_account_check
    check (company_id is not null or company_name is null),
  constraint callrail_credentials_company_order_check
    check (company_id is null or account_id is not null),
  -- A name only means something once the thing it names has been chosen.
  constraint callrail_credentials_account_name_check
    check (account_id is not null or account_name is null),

  -- Deliberately a closed set: provider responses must never be written here,
  -- because an error body can echo back request material.
  constraint callrail_credentials_last_status_check
    check (
      last_status is null
      or last_status in ('ok', 'unauthorized', 'not_found', 'rejected', 'error')
    ),

  -- Proves the client belongs to the same organization recorded on the row.
  constraint callrail_credentials_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

alter table public.callrail_credentials enable row level security;
revoke all on table public.callrail_credentials from anon, authenticated;

create index if not exists callrail_credentials_scope_idx
  on public.callrail_credentials (organization_id, client_id);

-- Finding a setup that was started and never finished, without scanning the
-- table. A row with no company_id is the only state the connection cannot be
-- used from; anything with a company is a working connection and is never
-- swept, however old it is.
--
-- Leads with client_id because every user-triggered cleanup is scoped to one
-- authorized client: `call_tracking.manage` is held by client owners, so a
-- sweep with organization reach would let one business delete another's row.
-- An organization-wide sweep, if one is ever added, belongs to a scheduled
-- server process or an agency-admin-only action and can lead with
-- organization_id on its own index.
create index if not exists callrail_credentials_abandoned_setup_idx
  on public.callrail_credentials (organization_id, client_id, updated_at)
  where company_id is null;

comment on table public.callrail_credentials is
  'Server-only encrypted CallRail API keys, one per client.';
comment on column public.callrail_credentials.api_key_ciphertext is
  'AES-256-GCM ciphertext; the encryption key is stored only in Cloudflare secrets.';
comment on column public.callrail_credentials.account_id is
  'Selected CallRail account resource id. Null until the operator picks one from the accounts the key can read.';
comment on column public.callrail_credentials.company_id is
  'Selected CallRail company resource id. Null until an account is chosen and a company picked under it.';
comment on column public.callrail_credentials.last_status is
  'Outcome of the most recent health check. Never store raw provider responses here.';
