-- Google refresh tokens are encrypted by the Worker before storage. This table
-- intentionally has no RLS policies and no anon/authenticated grants, so only
-- the server-side Supabase service role can access credential material.
-- The composite client key lets child tables prove that a client belongs to
-- the same organization recorded on each tenant-scoped row.
create unique index if not exists clients_organization_id_id_uidx
  on public.clients(organization_id, id);

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

-- CREATE TABLE IF NOT EXISTS does not add new constraints to an existing
-- table, so add both composite foreign keys separately and idempotently too.
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

-- OAuth state and Google profile mutations are server-only. Tenant users can
-- still read their safe selected-profile row through the existing read policy.
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
