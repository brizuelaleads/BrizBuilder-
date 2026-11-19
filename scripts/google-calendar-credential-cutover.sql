-- Run ONLY after the new Worker and existing Calendar connections are verified,
-- and all requests handled by the old Worker have drained. Do not include in
-- pre-deployment migrations. After this point, do not roll back to old code
-- without a reviewed reverse credential migration.
begin;
set local lock_timeout = '5s';
lock table public.google_business_credentials in share row exclusive mode;
drop trigger if exists bridge_legacy_google_calendar_credentials on public.google_business_credentials;
drop function if exists public.bridge_legacy_google_calendar_credentials();
delete from public.google_business_credentials
where scopes && array[
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.owned'
]::text[]
and not ('https://www.googleapis.com/auth/business.manage' = any(scopes));
commit;
