-- Apply before deploying the Calendar compliance changes. No new OAuth keys.
begin;
set local lock_timeout = '5s';

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

-- Bridge writes from the old Worker until cutover is verified. Never remove
-- its source rows before deployment. Lock writers while installing the bridge
-- and copying the snapshot so an in-flight authorization cannot be missed.
lock table public.google_business_credentials in share row exclusive mode;
create or replace function public.bridge_legacy_google_calendar_credentials()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.scopes && array[
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.events.owned'
  ]::text[] then
    insert into public.google_calendar_credentials
      (organization_id, client_id, refresh_token_ciphertext, refresh_token_iv,
       scopes, connected_by_email, created_at, updated_at)
    values (new.organization_id, new.client_id, new.refresh_token_ciphertext,
      new.refresh_token_iv, new.scopes, new.connected_by_email,
      new.created_at, new.updated_at)
    on conflict (organization_id, client_id) do update set
      refresh_token_ciphertext = excluded.refresh_token_ciphertext,
      refresh_token_iv = excluded.refresh_token_iv,
      scopes = excluded.scopes,
      connected_by_email = excluded.connected_by_email,
      updated_at = excluded.updated_at
    where public.google_calendar_credentials.updated_at < excluded.updated_at;
  end if;
  return new;
end;
$$;
revoke all on function public.bridge_legacy_google_calendar_credentials() from public, anon, authenticated;
drop trigger if exists bridge_legacy_google_calendar_credentials on public.google_business_credentials;
create trigger bridge_legacy_google_calendar_credentials
after insert or update on public.google_business_credentials
for each row execute function public.bridge_legacy_google_calendar_credentials();

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

-- Cleanup is intentionally a separate post-deployment operation. The previous
-- Worker still reads this table during rollout and on a pre-cutover rollback.

comment on table public.google_calendar_credentials is
  'Server-only AES-GCM encrypted Calendar refresh tokens; no browser grants.';
commit;
