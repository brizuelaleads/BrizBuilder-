-- BrizBuilder Supabase schema
-- Run this in Supabase Dashboard > SQL Editor after creating the project.
-- It creates the real backend tables plus row-level security so clients only
-- see records assigned to their client workspace.
-- This is the baseline schema (equivalent to the first dated migration).
-- After running it, run each later file in supabase/migrations in filename
-- order, beginning with 20260718170000_phone_system.sql. Those migrations add
-- the current phone, workflow, Google Business Profile, and OAuth tables.

create extension if not exists pgcrypto;

create type public.app_role as enum (
  'SUPER_ADMIN',
  'AGENCY_OWNER',
  'AGENCY_ADMIN',
  'AGENCY_MEMBER',
  'CLIENT_OWNER',
  'CLIENT_MANAGER',
  'CLIENT_EMPLOYEE'
);

create type public.record_status as enum ('active', 'paused', 'archived');
create type public.lead_status as enum (
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'APPOINTMENT_BOOKED',
  'ESTIMATE_SENT',
  'WON',
  'LOST',
  'SPAM',
  'UNRESPONSIVE'
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  avatar_url text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, 'New user'), '@', 1))
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update on auth.users
for each row execute function public.handle_new_user();

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (organization_id, profile_id)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  business_name text not null,
  slug text not null,
  industry text not null,
  website text,
  phone text,
  email text,
  address text,
  city text not null default '',
  state text not null default '',
  zip text not null default '',
  time_zone text not null default 'America/Chicago',
  status public.record_status not null default 'active',
  monthly_ad_budget_cents integer not null default 0,
  assigned_account_manager text,
  service_areas text[] not null default '{}',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, slug)
);

create table if not exists public.client_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (client_id, profile_id)
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  first_name text not null,
  last_name text not null default '',
  phone text,
  email text,
  address text,
  city text,
  state text,
  zip text,
  company text,
  tags text[] not null default '{}',
  marketing_consent text not null default 'unknown',
  notes text not null default '',
  lifetime_value_cents integer not null default 0,
  last_interaction_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  industry text,
  website text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  zip text,
  tags text[] not null default '{}',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  name text not null,
  is_default boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  slug text not null,
  color text not null default '#2563eb',
  position integer not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  unique (pipeline_id, slug)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  stage_id uuid references public.pipeline_stages(id) on delete set null,
  service_requested text not null,
  message text not null default '',
  source text not null default 'Manual',
  campaign text,
  status public.lead_status not null default 'NEW',
  assigned_user text,
  estimated_value_cents integer not null default 0,
  final_revenue_cents integer not null default 0,
  appointment_date timestamptz,
  lead_score integer not null default 50,
  tags text[] not null default '{}',
  consent_status text not null default 'unknown',
  lost_reason text,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  body text not null,
  author_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  title text not null,
  description text not null default '',
  assignee text,
  due_at timestamptz,
  priority text not null default 'MEDIUM',
  status text not null default 'TO_DO',
  reminder_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  assigned_employee text,
  service_type text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'SCHEDULED',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.websites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  domain text,
  status text not null default 'draft',
  brand_colors jsonb not null default '{}'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  analytics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_pages (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  slug text not null,
  page_type text not null default 'custom',
  content jsonb not null default '{}'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, slug)
);

create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  website_id uuid references public.websites(id) on delete cascade,
  name text not null,
  schema jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  form_id uuid references public.forms(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  bucket text not null,
  path text not null,
  content_type text,
  size_bytes bigint,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  provider text not null,
  status text not null default 'not_configured',
  public_config jsonb not null default '{}'::jsonb,
  secret_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, provider)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  action text not null,
  record_type text not null,
  record_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists clients_organization_id_id_uidx on public.clients (organization_id, id);
create index if not exists clients_org_status_idx on public.clients (organization_id, status);
create index if not exists client_members_profile_idx on public.client_members (profile_id);
create index if not exists contacts_client_idx on public.contacts (organization_id, client_id);
create index if not exists companies_client_idx on public.companies (organization_id, client_id);
create index if not exists leads_client_status_idx on public.leads (organization_id, client_id, status);
create index if not exists leads_stage_idx on public.leads (stage_id);
create index if not exists tasks_client_status_idx on public.tasks (organization_id, client_id, status, due_at);
create index if not exists appointments_client_time_idx on public.appointments (organization_id, client_id, starts_at);
create index if not exists audit_events_org_time_idx on public.audit_events (organization_id, created_at desc);

create or replace function public.is_agency_member(target_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_org_id
      and om.profile_id = auth.uid()
      and om.status = 'active'
      and om.role in ('SUPER_ADMIN', 'AGENCY_OWNER', 'AGENCY_ADMIN', 'AGENCY_MEMBER')
  );
$$;

create or replace function public.is_client_member(target_client_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.client_members cm
    where cm.client_id = target_client_id
      and cm.profile_id = auth.uid()
      and cm.status = 'active'
  );
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.clients enable row level security;
alter table public.client_members enable row level security;
alter table public.contacts enable row level security;
alter table public.companies enable row level security;
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.leads enable row level security;
alter table public.notes enable row level security;
alter table public.tasks enable row level security;
alter table public.appointments enable row level security;
alter table public.websites enable row level security;
alter table public.website_pages enable row level security;
alter table public.forms enable row level security;
alter table public.form_submissions enable row level security;
alter table public.assets enable row level security;
alter table public.integrations enable row level security;
alter table public.audit_events enable row level security;

create policy "profiles read own profile"
on public.profiles for select
using (id = auth.uid());

create policy "profiles update own profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "organizations read agency members"
on public.organizations for select
using (public.is_agency_member(id));

create policy "organization members read agency members"
on public.organization_members for select
using (public.is_agency_member(organization_id));

create policy "clients read agency or assigned client"
on public.clients for select
using (public.is_agency_member(organization_id) or public.is_client_member(id));

create policy "client members read agency or self"
on public.client_members for select
using (public.is_agency_member(organization_id) or profile_id = auth.uid());

create policy "contacts read scoped users"
on public.contacts for select
using (public.is_agency_member(organization_id) or public.is_client_member(client_id));

create policy "companies read scoped users"
on public.companies for select
using (public.is_agency_member(organization_id) or public.is_client_member(client_id));

create policy "pipelines read scoped users"
on public.pipelines for select
using (public.is_agency_member(organization_id) or client_id is null or public.is_client_member(client_id));

create policy "pipeline stages read scoped users"
on public.pipeline_stages for select
using (public.is_agency_member(organization_id));

create policy "leads read scoped users"
on public.leads for select
using (public.is_agency_member(organization_id) or public.is_client_member(client_id));

create policy "notes read scoped users"
on public.notes for select
using (public.is_agency_member(organization_id) or public.is_client_member(client_id));

create policy "tasks read scoped users"
on public.tasks for select
using (public.is_agency_member(organization_id) or public.is_client_member(client_id));

create policy "appointments read scoped users"
on public.appointments for select
using (public.is_agency_member(organization_id) or public.is_client_member(client_id));

create policy "websites read scoped users"
on public.websites for select
using (public.is_agency_member(organization_id) or public.is_client_member(client_id));

create policy "website pages read scoped users"
on public.website_pages for select
using (public.is_agency_member(organization_id) or public.is_client_member(client_id));

create policy "forms read scoped users"
on public.forms for select
using (public.is_agency_member(organization_id) or public.is_client_member(client_id));

create policy "form submissions read scoped users"
on public.form_submissions for select
using (public.is_agency_member(organization_id) or public.is_client_member(client_id));

create policy "assets read scoped users"
on public.assets for select
using (public.is_agency_member(organization_id) or client_id is null or public.is_client_member(client_id));

create policy "integrations read agency members"
on public.integrations for select
using (public.is_agency_member(organization_id));

create policy "audit events read agency members"
on public.audit_events for select
using (organization_id is null or public.is_agency_member(organization_id));

create policy "agency members manage clients"
on public.clients for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

create policy "agency members manage contacts"
on public.contacts for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

create policy "agency members manage companies"
on public.companies for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

create policy "agency members manage leads"
on public.leads for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

create policy "agency members manage tasks"
on public.tasks for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

create policy "agency members manage appointments"
on public.appointments for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

create policy "agency members manage websites"
on public.websites for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

create policy "agency members manage website pages"
on public.website_pages for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

create policy "agency members manage forms"
on public.forms for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

create policy "agency members manage form submissions"
on public.form_submissions for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

create policy "agency members manage assets"
on public.assets for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

create policy "agency members manage integrations"
on public.integrations for all
using (public.is_agency_member(organization_id))
with check (public.is_agency_member(organization_id));

create policy "agency members write audit events"
on public.audit_events for insert
with check (organization_id is null or public.is_agency_member(organization_id));

-- Storage buckets for logos, client photos, generated sites, and imports.
insert into storage.buckets (id, name, public)
values
  ('client-assets', 'client-assets', false),
  ('website-assets', 'website-assets', true),
  ('imports', 'imports', false)
on conflict (id) do nothing;
