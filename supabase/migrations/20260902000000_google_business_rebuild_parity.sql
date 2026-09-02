-- Closes the gap between what production's schema contains and what this
-- migration folder can rebuild.
--
-- Background: the statements below were applied to production outside the
-- migration ledger, so `supabase/history-reconciliation/` holds the original
-- file as audit evidence and deliberately keeps it out of this folder -- moving
-- it back under its 20260722040000 version would assert a production history
-- row that does not exist.
--
-- The consequence was that a database rebuilt from this folder alone was not
-- production. It had no google_business_credentials table (the server reads and
-- writes it in five places), no google_business_profiles.account_id (used to
-- verify a selected location still belongs to the connected account), and it
-- kept two write policies plus a set of grants that production has revoked --
-- so a restore or a fresh staging environment came up both broken and more
-- permissive than the thing it was standing in for.
--
-- Every statement here is idempotent by construction, so against production it
-- is a no-op that records a ledger row, and against an empty database it
-- supplies what was missing. This is additive: it does not rewrite history, and
-- the evidence file stays where it is.

-- The composite key child tables use to prove a client belongs to the
-- organization recorded on the row. Also created by the sendblue migration;
-- repeated here so this file stands alone if that ordering ever changes.
create unique index if not exists clients_organization_id_id_uidx
  on public.clients(organization_id, id);

-- Google refresh tokens are encrypted by the Worker before storage. No RLS
-- policies and no anon/authenticated grants: only the service role reads this.
create table if not exists public.google_business_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  scopes text[] not null default '{}'::text[],
  connected_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id),
  constraint google_business_credentials_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

-- CREATE TABLE IF NOT EXISTS does not add new constraints to an existing table,
-- so both composite foreign keys are added separately and idempotently.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.google_business_profiles'::regclass
      and conname = 'google_business_profiles_organization_client_fk'
  ) then
    alter table public.google_business_profiles
      add constraint google_business_profiles_organization_client_fk
      foreign key (organization_id, client_id)
      references public.clients(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.google_business_credentials'::regclass
      and conname = 'google_business_credentials_organization_client_fk'
  ) then
    alter table public.google_business_credentials
      add constraint google_business_credentials_organization_client_fk
      foreign key (organization_id, client_id)
      references public.clients(organization_id, id)
      on delete cascade;
  end if;
end
$$;

create index if not exists google_business_credentials_scope_idx
  on public.google_business_credentials(organization_id, client_id);

alter table public.google_business_credentials enable row level security;
revoke all on table public.google_business_credentials from anon, authenticated;

-- OAuth state and Google profile mutations are server-only. Tenant users keep
-- their read of the safe selected-profile row through the existing read policy.
--
-- This is the half a rebuild was silently getting wrong: the profiles migration
-- creates "agency manage" and "client manage", and production has since dropped
-- them. Without these lines a rebuilt database grants writes production does
-- not.
drop policy if exists "authorization states agency only"
  on public.provider_authorization_states;
revoke all on table public.provider_authorization_states from anon, authenticated;

drop policy if exists "agency manage" on public.google_business_profiles;
drop policy if exists "client manage" on public.google_business_profiles;
revoke insert, update, delete on table public.google_business_profiles
  from anon, authenticated;

alter table public.google_business_profiles
  add column if not exists account_id text;

comment on table public.google_business_credentials is
  'Server-only encrypted Google Business Profile OAuth refresh tokens.';
comment on column public.google_business_credentials.refresh_token_ciphertext is
  'AES-256-GCM ciphertext; the encryption key is stored only in Cloudflare secrets.';
comment on column public.google_business_profiles.account_id is
  'Google account resource name the selected location belongs to.';
