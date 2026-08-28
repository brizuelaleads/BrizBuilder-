-- Per-tenant white-label branding for the installable PWA.
--
-- One codebase serves every tenant, so the only thing that distinguishes an
-- "Acme Plumbing" home-screen app from a "BrizBuilder" one is this row: it
-- drives the tenant manifest, the app shell colours, and the logo.
--
-- Service-role only, like user_preferences and the credential tables. The
-- manifest route reads it through the Worker after resolving the tenant from
-- the request host, and every write goes through the CRM action API under a
-- clients.manage permission check, so anon/authenticated need no grants.

create table if not exists public.client_branding (
  client_id uuid primary key references public.clients(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Installed-app label. Falls back to clients.business_name when blank.
  app_name text not null default '',

  -- Both are validated in application code (https or root-relative only)
  -- before they ever reach a src/href or the manifest.
  logo_url text,
  icon_url text,

  primary_color text not null default '#6757e8'
    check (primary_color ~ '^#[0-9a-f]{6}$'),
  accent_color text not null default '#c9ff53'
    check (accent_color ~ '^#[0-9a-f]{6}$'),

  -- The host label this tenant is reachable at. Nullable: a tenant that has
  -- not been given a subdomain still works via the shared app host.
  subdomain text
    check (
      subdomain is null
      or (
        subdomain = lower(subdomain)
        and length(subdomain) between 3 and 63
        and subdomain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
      )
    ),

  notification_preferences jsonb not null default jsonb_build_object(
    'newLead', true,
    'appointmentReminder', true,
    'missedCall', true,
    'reviewRequest', false,
    'dailyDigest', false
  ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Host resolution looks a tenant up by subdomain alone, so the name has to be
-- unique across every organization, not just within one.
create unique index if not exists client_branding_subdomain_key
  on public.client_branding (subdomain)
  where subdomain is not null;

create index if not exists client_branding_organization_id_idx
  on public.client_branding (organization_id);

alter table public.client_branding enable row level security;
revoke all on table public.client_branding from anon, authenticated;

comment on table public.client_branding is
  'Server-only per-tenant white-label branding (PWA manifest, colours, logo, notification preferences); writes go through the CRM action API under clients.manage.';
comment on column public.client_branding.subdomain is
  'Globally unique host label used to resolve a tenant from the request Host header.';
comment on column public.client_branding.notification_preferences is
  'Boolean map keyed by the NOTIFICATION_KEYS allowlist in db/branding.ts; unknown keys are ignored on read.';
