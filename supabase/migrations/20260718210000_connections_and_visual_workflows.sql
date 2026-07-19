-- Customer-funded provider connections and versioned visual workflows.
-- Customer provider secrets are never stored here. Twilio Connect returns a
-- customer-funded subaccount SID that is used with the platform credential.

create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null,
  status text not null default 'not_connected',
  billing_owner text not null default 'customer',
  external_account_id text,
  external_account_name text,
  scopes jsonb not null default '[]'::jsonb,
  public_config jsonb not null default '{}'::jsonb,
  connected_by_email text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_health_check_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, provider)
);

create table if not exists public.provider_authorization_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null,
  state_hash text not null unique,
  requested_by_email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'draft',
  trigger_key text not null default 'manual',
  current_version integer not null default 1,
  published_version integer,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  version integer not null,
  graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  unique (workflow_id, version)
);

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  version integer not null,
  trigger_key text not null,
  trigger_event_id text not null,
  status text not null default 'running',
  is_test boolean not null default false,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workflow_id, trigger_event_id)
);

create table if not exists public.workflow_run_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  node_id text not null,
  node_type text not null,
  status text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists provider_connections_scope_idx on public.provider_connections(organization_id, client_id, provider);
create index if not exists provider_auth_expiry_idx on public.provider_authorization_states(provider, expires_at);
create index if not exists workflows_scope_status_idx on public.workflows(organization_id, client_id, status, updated_at desc);
create index if not exists workflow_runs_scope_time_idx on public.workflow_runs(organization_id, client_id, started_at desc);
create index if not exists workflow_run_steps_run_idx on public.workflow_run_steps(run_id, started_at);

alter table public.provider_connections enable row level security;
alter table public.provider_authorization_states enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_run_steps enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['provider_connections','workflows','workflow_versions','workflow_runs','workflow_run_steps']
  loop
    execute format('drop policy if exists "tenant read" on public.%I', table_name);
    execute format('drop policy if exists "agency manage" on public.%I', table_name);
    execute format('create policy "tenant read" on public.%I for select using (public.is_agency_member(organization_id) or public.is_client_member(client_id))', table_name);
    execute format('create policy "agency manage" on public.%I for all using (public.is_agency_member(organization_id)) with check (public.is_agency_member(organization_id))', table_name);
  end loop;
end $$;

drop policy if exists "authorization states agency only" on public.provider_authorization_states;
create policy "authorization states agency only"
on public.provider_authorization_states for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));
