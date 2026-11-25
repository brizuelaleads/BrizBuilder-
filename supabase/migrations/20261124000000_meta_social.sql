create table public.social_meta_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null,
  meta_user_id text not null,
  page_id text not null unique,
  page_name text not null,
  instagram_id text unique,
  instagram_name text,
  token_ciphertext text not null,
  token_iv text not null,
  connected_at timestamptz not null default now(),
  unique (organization_id, client_id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade
);

create table public.social_meta_authorizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null,
  actor_email text not null,
  meta_user_id text,
  state_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  token_ciphertext text,
  token_iv text,
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade
);

create index social_meta_authorizations_expiry_idx on public.social_meta_authorizations(expires_at);
create index social_meta_authorizations_user_idx on public.social_meta_authorizations(meta_user_id) where meta_user_id is not null;
create index social_meta_connections_user_idx on public.social_meta_connections(meta_user_id);

alter table public.social_meta_connections enable row level security;
alter table public.social_meta_authorizations enable row level security;
revoke all on public.social_meta_connections, public.social_meta_authorizations from public, anon, authenticated;
grant select, insert, update, delete on public.social_meta_connections, public.social_meta_authorizations to service_role;

alter table public.social_posts
  add column delivery_results jsonb not null default '{}'::jsonb,
  add column delivery_account_id uuid,
  add column publishing_started_at timestamptz;
