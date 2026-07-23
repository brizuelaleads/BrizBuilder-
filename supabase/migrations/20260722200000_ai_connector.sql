-- Secure OAuth 2.1 grants and opaque tokens for the BrizBuilder remote MCP
-- connector. AI providers never receive BrizBuilder browser cookies, database
-- credentials, or customer-wide access that was not explicitly approved.

create table if not exists public.ai_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_name text not null,
  redirect_uris text[] not null,
  grant_types text[] not null default array['authorization_code', 'refresh_token']::text[],
  response_types text[] not null default array['code']::text[],
  token_endpoint_auth_method text not null default 'none',
  registration_fingerprint text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  constraint ai_oauth_clients_name_length_check check (char_length(client_name) between 1 and 100),
  constraint ai_oauth_clients_redirect_count_check check (cardinality(redirect_uris) between 1 and 8),
  constraint ai_oauth_clients_auth_method_check check (token_endpoint_auth_method = 'none')
);

create table if not exists public.ai_oauth_consent_requests (
  id uuid primary key default gen_random_uuid(),
  consent_token_hash text not null unique,
  oauth_client_id uuid not null references public.ai_oauth_clients(id) on delete cascade,
  actor_email text not null,
  actor_name text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  available_client_ids uuid[] not null,
  redirect_uri text not null,
  requested_scopes text[] not null,
  state text,
  resource text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint ai_oauth_consent_requests_client_count_check check (cardinality(available_client_ids) between 1 and 250),
  constraint ai_oauth_consent_requests_scope_count_check check (cardinality(requested_scopes) between 1 and 8),
  constraint ai_oauth_consent_requests_pkce_check check (code_challenge_method = 'S256')
);

create table if not exists public.ai_authorizations (
  id uuid primary key default gen_random_uuid(),
  oauth_client_id uuid not null references public.ai_oauth_clients(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  allowed_client_ids uuid[] not null,
  actor_email text not null,
  actor_name text not null,
  scopes text[] not null,
  status text not null default 'active',
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  revoked_at timestamptz,
  revoked_by_email text,
  constraint ai_authorizations_client_count_check check (cardinality(allowed_client_ids) between 1 and 250),
  constraint ai_authorizations_scope_count_check check (cardinality(scopes) between 1 and 8),
  constraint ai_authorizations_status_check check (status in ('active', 'revoked'))
);

create table if not exists public.ai_oauth_authorization_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  authorization_id uuid not null references public.ai_authorizations(id) on delete cascade,
  oauth_client_id uuid not null references public.ai_oauth_clients(id) on delete cascade,
  redirect_uri text not null,
  resource text not null,
  scopes text[] not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint ai_oauth_authorization_codes_pkce_check check (code_challenge_method = 'S256')
);

create table if not exists public.ai_oauth_access_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  authorization_id uuid not null references public.ai_authorizations(id) on delete cascade,
  oauth_client_id uuid not null references public.ai_oauth_clients(id) on delete cascade,
  resource text not null,
  scopes text[] not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.ai_oauth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  authorization_id uuid not null references public.ai_authorizations(id) on delete cascade,
  oauth_client_id uuid not null references public.ai_oauth_clients(id) on delete cascade,
  resource text not null,
  scopes text[] not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz,
  replacement_token_id uuid references public.ai_oauth_refresh_tokens(id) on delete set null
);

create index if not exists ai_oauth_clients_fingerprint_time_idx
  on public.ai_oauth_clients(registration_fingerprint, created_at desc);
create index if not exists ai_oauth_consent_expiry_idx
  on public.ai_oauth_consent_requests(expires_at) where consumed_at is null;
create index if not exists ai_authorizations_org_time_idx
  on public.ai_authorizations(organization_id, connected_at desc);
create index if not exists ai_authorizations_allowed_clients_gin_idx
  on public.ai_authorizations using gin(allowed_client_ids);
create index if not exists ai_oauth_codes_expiry_idx
  on public.ai_oauth_authorization_codes(expires_at) where consumed_at is null;
create index if not exists ai_oauth_access_expiry_idx
  on public.ai_oauth_access_tokens(expires_at) where revoked_at is null;
create index if not exists ai_oauth_refresh_expiry_idx
  on public.ai_oauth_refresh_tokens(expires_at) where revoked_at is null and rotated_at is null;

alter table public.ai_oauth_clients enable row level security;
alter table public.ai_oauth_consent_requests enable row level security;
alter table public.ai_authorizations enable row level security;
alter table public.ai_oauth_authorization_codes enable row level security;
alter table public.ai_oauth_access_tokens enable row level security;
alter table public.ai_oauth_refresh_tokens enable row level security;

revoke all on table public.ai_oauth_clients from public, anon, authenticated;
revoke all on table public.ai_oauth_consent_requests from public, anon, authenticated;
revoke all on table public.ai_authorizations from public, anon, authenticated;
revoke all on table public.ai_oauth_authorization_codes from public, anon, authenticated;
revoke all on table public.ai_oauth_access_tokens from public, anon, authenticated;
revoke all on table public.ai_oauth_refresh_tokens from public, anon, authenticated;

comment on table public.ai_authorizations is
  'Explicit tenant and business grants for remote AI clients; no AI credentials or conversation content is stored.';
comment on table public.ai_oauth_access_tokens is
  'Short-lived opaque MCP access tokens stored only as SHA-256 hashes.';
comment on table public.ai_oauth_refresh_tokens is
  'Rotating opaque MCP refresh tokens stored only as SHA-256 hashes.';
