-- Google Business Profile records. OAuth credentials are intentionally not stored
-- in this table; the connection flow will keep secrets in a separate protected
-- credential store. This table only contains the selected location's safe details.
create table if not exists public.google_business_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null default 'not_connected',
  account_name text,
  location_name text,
  location_id text,
  business_name text,
  address text,
  phone text,
  website text,
  primary_category text,
  google_review_url text,
  last_synced_at timestamptz,
  connected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id)
);

create index if not exists google_business_profiles_scope_idx
  on public.google_business_profiles(organization_id, client_id, status);

alter table public.google_business_profiles enable row level security;
drop policy if exists "tenant read" on public.google_business_profiles;
drop policy if exists "agency manage" on public.google_business_profiles;
drop policy if exists "client manage" on public.google_business_profiles;
create policy "tenant read" on public.google_business_profiles
  for select using (public.is_agency_member(organization_id) or public.is_client_member(client_id));
create policy "agency manage" on public.google_business_profiles
  for all using (public.is_agency_member(organization_id))
  with check (public.is_agency_member(organization_id));
create policy "client manage" on public.google_business_profiles
  for update using (public.is_client_member(client_id))
  with check (public.is_client_member(client_id));
