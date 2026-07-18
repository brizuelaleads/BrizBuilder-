-- BrizBuilder phone, conversation, and missed-call automation foundation.
-- Provider auth tokens are intentionally not stored in these tables.

create table if not exists public.phone_system_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null default 'twilio',
  provider_account_sid text,
  phone_number_sid text,
  messaging_service_sid text,
  phone_number text,
  forwarding_number text,
  ring_timeout_seconds integer not null default 20 check (ring_timeout_seconds between 10 and 60),
  voicemail_enabled boolean not null default true,
  missed_call_text_enabled boolean not null default false,
  missed_call_message text not null default 'Hi, this is {{business_name}}. Sorry we missed your call. How can we help? Reply STOP to unsubscribe.',
  cooldown_minutes integer not null default 20 check (cooldown_minutes between 1 and 1440),
  business_hours jsonb not null default '{}'::jsonb,
  provider_status text not null default 'not_configured',
  a2p_status text not null default 'not_started',
  last_tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel text not null default 'sms',
  status text not null default 'open',
  assigned_to text,
  unread_count integer not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, contact_id, channel)
);

create table if not exists public.phone_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  provider_call_sid text not null unique,
  direction text not null default 'inbound',
  from_number text not null,
  to_number text not null,
  forwarded_to text,
  status text not null default 'initiated',
  answered_by text,
  duration_seconds integer,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  missed_call_text_sent_at timestamptz,
  raw_event jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  provider_message_sid text unique,
  direction text not null,
  channel text not null default 'sms',
  from_number text not null,
  to_number text not null,
  body text not null,
  status text not null default 'queued',
  automation_key text,
  error_code text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  trigger_key text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, trigger_key)
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  rule_id uuid references public.automation_rules(id) on delete set null,
  trigger_event_id text not null,
  status text not null default 'started',
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (client_id, trigger_event_id)
);

create index if not exists phone_configs_number_idx on public.phone_system_configs(phone_number);
create index if not exists conversations_scope_time_idx on public.conversations(organization_id, client_id, last_message_at desc);
create index if not exists phone_calls_scope_time_idx on public.phone_calls(organization_id, client_id, started_at desc);
create index if not exists phone_calls_contact_time_idx on public.phone_calls(contact_id, started_at desc);
create index if not exists messages_conversation_time_idx on public.messages(conversation_id, created_at);
create index if not exists messages_scope_time_idx on public.messages(organization_id, client_id, created_at desc);
create index if not exists automation_runs_scope_time_idx on public.automation_runs(organization_id, client_id, started_at desc);

alter table public.phone_system_configs enable row level security;
alter table public.conversations enable row level security;
alter table public.phone_calls enable row level security;
alter table public.messages enable row level security;
alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['phone_system_configs','conversations','phone_calls','messages','automation_rules','automation_runs']
  loop
    execute format('drop policy if exists "scoped read" on public.%I', table_name);
    execute format('create policy "scoped read" on public.%I for select using (public.is_agency_member(organization_id) or public.is_client_member(client_id))', table_name);
    execute format('drop policy if exists "agency manage" on public.%I', table_name);
    execute format('create policy "agency manage" on public.%I for all using (public.is_agency_member(organization_id)) with check (public.is_agency_member(organization_id))', table_name);
  end loop;
end $$;

-- Client users can update conversation assignment/read state and reply through
-- the authenticated application. Provider credentials remain server-only.
drop policy if exists "client members manage conversations" on public.conversations;
create policy "client members manage conversations"
on public.conversations for update
using (public.is_client_member(client_id))
with check (public.is_client_member(client_id));

drop policy if exists "client members create messages" on public.messages;
create policy "client members create messages"
on public.messages for insert
with check (public.is_client_member(client_id));

insert into public.automation_rules (organization_id, client_id, name, trigger_key, enabled, config)
select c.organization_id, c.id, 'Missed call text back', 'call.missed', false,
  jsonb_build_object(
    'cooldownMinutes', 20,
    'message', 'Hi, this is {{business_name}}. Sorry we missed your call. How can we help? Reply STOP to unsubscribe.'
  )
from public.clients c
where c.status <> 'archived'
on conflict (client_id, trigger_key) do nothing;
