-- Calendly: each client business can link its own Calendly account. Bookings
-- arrive by signed webhook (and a background check as a safety net) and become
-- contacts, leads and appointments.
--
-- Both tables are service-role only, like the other provider credential tables:
-- RLS is on with no policies and every grant to anon/authenticated is revoked.
-- The OAuth round trip reuses public.provider_authorization_states.

create table if not exists public.calendly_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  calendly_user_uri text not null,
  calendly_organization_uri text not null,
  user_name text not null default '',
  user_email text not null default '',
  scheduling_url text,
  time_zone text,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  access_token_expires_at timestamptz not null,
  -- Calendly refresh tokens are single-use, so only one worker may refresh at
  -- a time: it claims the row by setting these, and the claim expires by age.
  refresh_claim_id uuid,
  refresh_claimed_at timestamptz,
  -- Unguessable path segment that routes a webhook to this row.
  webhook_path_id text not null unique,
  webhook_subscription_uri text,
  delivery text not null default 'webhook'
    check (delivery in ('webhook', 'polling')),
  status text not null default 'connected'
    check (status in ('connected', 'attention')),
  last_error text,
  last_synced_at timestamptz,
  last_booking_at timestamptz,
  connected_by_email text not null,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id),
  constraint calendly_connections_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

-- One Calendly account feeds one business, so bookings cannot land twice.
create unique index if not exists calendly_connections_user_uri_idx
  on public.calendly_connections(calendly_user_uri);

-- One row per Calendly invitee: the idempotency key for webhook redeliveries
-- and the background check, and the link a cancellation follows back to the
-- appointment it created. Kept after a disconnect so a reconnect does not
-- import the same bookings again.
create table if not exists public.calendly_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  invitee_uri text not null,
  event_uri text not null,
  status text not null check (status in ('active', 'canceled')),
  appointment_id uuid references public.appointments(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  starts_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, invitee_uri),
  constraint calendly_bookings_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

alter table public.appointments
  drop constraint if exists appointments_source_check;
alter table public.appointments
  add constraint appointments_source_check
  check (source in ('manual', 'form', 'callrail', 'transcript', 'ai_summary', 'calendly'));

alter table public.calendly_connections enable row level security;
alter table public.calendly_bookings enable row level security;
revoke all on table public.calendly_connections from anon, authenticated;
revoke all on table public.calendly_bookings from anon, authenticated;
