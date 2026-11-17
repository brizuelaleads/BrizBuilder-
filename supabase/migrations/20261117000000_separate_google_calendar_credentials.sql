-- Apply before deploying the Calendar compliance changes. No new OAuth keys.
begin;

create table if not exists public.google_calendar_credentials (
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
  constraint google_calendar_credentials_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete cascade
);

alter table public.google_calendar_credentials enable row level security;
revoke all on table public.google_calendar_credentials from public, anon, authenticated;
grant all on table public.google_calendar_credentials to service_role;

-- Preserve existing encrypted connections. Encryption is bound to the same
-- organization/client identity, so no decrypt/re-encrypt or key changes occur.
insert into public.google_calendar_credentials
  (organization_id, client_id, refresh_token_ciphertext, refresh_token_iv,
   scopes, connected_by_email, created_at, updated_at)
select organization_id, client_id, refresh_token_ciphertext, refresh_token_iv,
       scopes, connected_by_email, created_at, updated_at
from public.google_business_credentials
where scopes && array[
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.owned'
]::text[]
on conflict (organization_id, client_id) do nothing;

-- Calendar-only tokens should no longer be kept in the Business Profile store.
delete from public.google_business_credentials
where scopes && array[
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.owned'
]::text[]
and not ('https://www.googleapis.com/auth/business.manage' = any(scopes));

comment on table public.google_calendar_credentials is
  'Server-only AES-GCM encrypted Calendar refresh tokens; no browser grants.';
commit;
