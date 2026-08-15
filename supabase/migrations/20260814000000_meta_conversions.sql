-- Meta Conversions API credentials are customer-owned: each client generates a
-- dataset access token in their own Meta Events Manager and connects it here.
-- The Worker encrypts the token before storage, so this table intentionally has
-- no RLS policies and no anon/authenticated grants — only the server-side
-- service role can reach credential material. Same locked pattern as
-- google_business_credentials.
create table if not exists public.meta_conversion_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  dataset_id text not null,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  test_event_code text,
  connected_by_email text not null,
  last_event_at timestamptz,
  last_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id),
  -- A dataset (pixel) id is numeric. Checking the shape here stops a malformed
  -- value from ever reaching the Graph API URL.
  constraint meta_conversion_credentials_dataset_id_check
    check (dataset_id ~ '^[0-9]{5,32}$'),
  -- Deliberately a closed set: provider responses must never be written here,
  -- because an error body can echo back token material.
  constraint meta_conversion_credentials_last_status_check
    check (last_status is null or last_status in ('ok', 'rejected', 'unauthorized', 'error')),
  -- Proves the client belongs to the same organization recorded on the row.
  constraint meta_conversion_credentials_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

alter table public.meta_conversion_credentials enable row level security;
revoke all on table public.meta_conversion_credentials from anon, authenticated;

-- Ad attribution captured from the landing page URL. Kept on the lead because
-- the WON conversion fires days later and still needs the original click id to
-- match. Visitor IP and user agent are deliberately NOT stored here: they are
-- used only in-request at capture time and then discarded.
alter table public.leads
  add column if not exists attribution jsonb not null default '{}'::jsonb;

comment on table public.meta_conversion_credentials is
  'Server-only encrypted Meta Conversions API dataset tokens, one per client.';
comment on column public.meta_conversion_credentials.access_token_ciphertext is
  'AES-256-GCM ciphertext; the encryption key is stored only in Cloudflare secrets.';
comment on column public.meta_conversion_credentials.dataset_id is
  'Meta dataset (pixel) id that events are posted to.';
comment on column public.meta_conversion_credentials.last_status is
  'Outcome of the most recent send. Never store raw provider responses here.';
comment on column public.leads.attribution is
  'Ad click attribution (fbclid, fbc, fbp, utm_*) captured at form submission.';
