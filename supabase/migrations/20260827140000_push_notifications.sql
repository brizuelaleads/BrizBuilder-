-- Web Push delivery for the white-label tenant apps.
--
-- A subscription is a browser-issued endpoint plus two keys that let us seal a
-- payload so only that device can read it. They are per device, not per user:
-- one person with a phone and a laptop has two rows, and every row belongs to
-- exactly one tenant so a fan-out can never cross a client boundary.
--
-- Service-role only, like client_branding. The subscribe endpoint writes with
-- the authenticated context, never with a client-supplied client_id.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,

  -- Who asked for these alerts. Kept as the login email rather than a profile
  -- id so it matches user_preferences and works for every identity.
  email text not null check (email = lower(email)),

  -- The push service URL the browser handed us. Unique because a browser
  -- re-subscribing must update its row, not accumulate duplicates that would
  -- deliver the same alert several times to one device.
  endpoint text not null unique,

  -- RFC 8291 material, base64url. p256dh is the device public key; auth is the
  -- 16-byte shared secret mixed into the content encryption key.
  p256dh text not null,
  auth text not null,

  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- Set when a push service answers 404/410. Kept briefly rather than deleted
  -- outright so a delivery audit can still explain a silent device.
  failed_at timestamptz
);

create index if not exists push_subscriptions_client_id_idx
  on public.push_subscriptions (client_id);
create index if not exists push_subscriptions_email_idx
  on public.push_subscriptions (email);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;

comment on table public.push_subscriptions is
  'Server-only Web Push subscriptions, one row per device per tenant; written through the authenticated push subscribe endpoint.';

-- The two alert types that need a number rather than an on/off.
alter table public.client_branding
  add column if not exists stale_lead_hours integer not null default 4
    check (stale_lead_hours between 1 and 168),
  add column if not exists hot_lead_score integer not null default 80
    check (hot_lead_score between 1 and 100);

-- Extend the notification default to the full event set. Existing rows keep
-- whatever they already store: normalizeNotifications() in db/branding.ts
-- fills any missing key from DEFAULT_NOTIFICATIONS on read, so no backfill is
-- needed and a partially populated object stays valid.
alter table public.client_branding
  alter column notification_preferences set default jsonb_build_object(
    'newLead', true,
    'missedCall', true,
    'transcriptReady', true,
    'leadNotContacted', true,
    'appointmentReminder', true,
    'hotLead', true,
    'reviewRequest', false,
    'dailyDigest', false
  );

-- Records what was actually delivered, so a "why didn't I get an alert"
-- question has an answer and so a retry cannot double-send. The event_key is
-- the caller's idempotency key (e.g. lead:<id>:created).
create table if not exists public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  event_key text not null,
  notification_type text not null,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (client_id, event_key)
);

create index if not exists push_deliveries_client_created_idx
  on public.push_deliveries (client_id, created_at desc);

alter table public.push_deliveries enable row level security;
revoke all on table public.push_deliveries from anon, authenticated;

comment on table public.push_deliveries is
  'Server-only push delivery ledger; the unique (client_id, event_key) is what makes a retried trigger idempotent.';
