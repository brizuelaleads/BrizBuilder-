-- Sendblue API keys (Key ID + Secret) are encrypted by the Worker before
-- storage. Like google_business_credentials, this table has no RLS policies and
-- no anon/authenticated grants, so only the server-side service role can touch
-- the credential material.

create unique index if not exists clients_organization_id_id_uidx
  on public.clients(organization_id, id);

create table if not exists public.sendblue_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  api_key_id_ciphertext text not null,
  api_key_id_iv text not null,
  api_secret_ciphertext text not null,
  api_secret_iv text not null,
  sendblue_number text,
  scopes text[] not null default '{}'::text[],
  connected_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id),
  constraint sendblue_credentials_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sendblue_credentials'::regclass
      and conname = 'sendblue_credentials_organization_client_fk'
  ) then
    alter table public.sendblue_credentials
      add constraint sendblue_credentials_organization_client_fk
      foreign key (organization_id, client_id)
      references public.clients(organization_id, id)
      on delete cascade;
  end if;
end
$$;

create index if not exists sendblue_credentials_scope_idx
  on public.sendblue_credentials(organization_id, client_id);

alter table public.sendblue_credentials enable row level security;
revoke all on table public.sendblue_credentials from anon, authenticated;

comment on table public.sendblue_credentials is
  'Server-only encrypted Sendblue API Key ID and Secret, per organization/client.';
comment on column public.sendblue_credentials.api_secret_ciphertext is
  'AES-256-GCM ciphertext; the encryption key is stored only in Cloudflare secrets.';;
