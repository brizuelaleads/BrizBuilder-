-- Tenant-scoped reputation settings and BrizBuilder-owned review-request history.
-- Google review content is intentionally not persisted here; it will be loaded
-- on demand after Google grants Business Profile API access.

create unique index if not exists contacts_organization_client_id_uidx
  on public.contacts(organization_id, client_id, id);
create unique index if not exists messages_organization_client_id_uidx
  on public.messages(organization_id, client_id, id);

create table if not exists public.review_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  sms_enabled boolean not null default false,
  default_sms_template text not null default 'Hi {{first_name}}, thank you for choosing {{business_name}}. Would you share your honest experience? {{review_link}} Reply STOP to opt out.',
  follow_up_enabled boolean not null default false,
  follow_up_template text not null default 'A quick reminder from {{business_name}}: if you have a moment, you can share your honest experience here: {{review_link}} Reply STOP to opt out.',
  follow_up_delay_hours integer not null default 72,
  quiet_hours_start time not null default '20:00',
  quiet_hours_end time not null default '08:00',
  daily_limit integer not null default 25,
  notification_emails text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id),
  constraint review_settings_follow_up_delay_check
    check (follow_up_delay_hours between 1 and 720),
  constraint review_settings_daily_limit_check
    check (daily_limit between 1 and 250),
  constraint review_settings_quiet_hours_check
    check (quiet_hours_start <> quiet_hours_end),
  constraint review_settings_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

create table if not exists public.contact_message_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel text not null default 'sms',
  purpose text not null default 'review_request',
  status text not null,
  source text not null,
  evidence jsonb not null default '{}'::jsonb,
  policy_version text not null default 'review-request-v1',
  captured_by_email text not null,
  captured_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_message_consents_organization_client_id_key
    unique (organization_id, client_id, id),
  constraint contact_message_consents_channel_check check (channel = 'sms'),
  constraint contact_message_consents_purpose_check check (purpose = 'review_request'),
  constraint contact_message_consents_status_check check (status in ('granted', 'revoked')),
  constraint contact_message_consents_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade,
  constraint contact_message_consents_tenant_contact_fk
    foreign key (organization_id, client_id, contact_id)
    references public.contacts(organization_id, client_id, id)
    on delete cascade
);

create table if not exists public.review_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  message_id uuid,
  consent_id uuid not null,
  channel text not null default 'sms',
  status text not null default 'sending',
  request_kind text not null default 'initial',
  trigger_source text not null default 'manual',
  trigger_event_id text,
  idempotency_key text not null,
  message_body text not null,
  requested_by_email text not null,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, idempotency_key),
  constraint review_requests_channel_check check (channel = 'sms'),
  constraint review_requests_status_check
    check (status in ('sending', 'reconciling', 'queued', 'sent', 'delivered', 'failed', 'cancelled')),
  constraint review_requests_kind_check check (request_kind in ('initial', 'follow_up')),
  constraint review_requests_trigger_source_check
    check (trigger_source in ('manual', 'job_completed', 'workflow')),
  constraint review_requests_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade,
  constraint review_requests_tenant_contact_fk
    foreign key (organization_id, client_id, contact_id)
    references public.contacts(organization_id, client_id, id)
    on delete cascade,
  constraint review_requests_tenant_consent_fk
    foreign key (organization_id, client_id, consent_id)
    references public.contact_message_consents(organization_id, client_id, id)
    on delete restrict,
  constraint review_requests_tenant_message_fk
    foreign key (organization_id, client_id, message_id)
    references public.messages(organization_id, client_id, id)
    on delete restrict
);

create index if not exists review_settings_scope_idx
  on public.review_settings(organization_id, client_id);
create index if not exists review_consents_contact_idx
  on public.contact_message_consents(organization_id, client_id, contact_id);
create index if not exists review_requests_scope_time_idx
  on public.review_requests(organization_id, client_id, created_at desc);
create index if not exists review_requests_contact_time_idx
  on public.review_requests(client_id, contact_id, created_at desc);
create unique index if not exists review_requests_message_idx
  on public.review_requests(message_id) where message_id is not null;

-- Atomically reserves a request so concurrent clicks or team members cannot
-- send two review invitations to the same contact inside the 24-hour window.
create or replace function public.reserve_review_request(
  p_organization_id uuid,
  p_client_id uuid,
  p_contact_id uuid,
  p_idempotency_key text,
  p_message_body text,
  p_requested_by_email text,
  p_consent_evidence jsonb,
  p_daily_limit integer
)
returns table(request_id uuid, request_status text, duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_request public.review_requests%rowtype;
  new_consent_id uuid;
  new_request_id uuid;
begin
  if p_daily_limit < 1 or p_daily_limit > 250 then
    raise exception 'Daily sending limit must be between 1 and 250.';
  end if;
  if p_message_body is null or char_length(p_message_body) < 1 or char_length(p_message_body) > 1600 then
    raise exception 'The final review request must be between 1 and 1,600 characters.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('review-client:' || p_organization_id::text || ':' || p_client_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('review-contact:' || p_organization_id::text || ':' || p_client_id::text || ':' || p_contact_id::text, 0)
  );

  select rr.* into existing_request
  from public.review_requests rr
  where rr.organization_id = p_organization_id
    and rr.client_id = p_client_id
    and rr.idempotency_key = p_idempotency_key
  limit 1;
  if found then
    return query select existing_request.id, existing_request.status, true;
    return;
  end if;

  if exists (
    select 1
    from public.review_requests rr
    where rr.organization_id = p_organization_id
      and rr.client_id = p_client_id
      and rr.contact_id = p_contact_id
      and rr.status in ('sending', 'reconciling', 'queued', 'sent', 'delivered')
      and rr.created_at >= now() - interval '24 hours'
  ) then
    raise exception 'A review request was already submitted for this customer in the last 24 hours.';
  end if;

  if (
    select count(*)
    from public.review_requests rr
    where rr.organization_id = p_organization_id
      and rr.client_id = p_client_id
      and rr.status in ('sending', 'reconciling', 'queued', 'sent', 'delivered')
      and rr.created_at >= now() - interval '24 hours'
  ) >= p_daily_limit then
    raise exception 'This business reached its review-request daily limit.';
  end if;

  insert into public.contact_message_consents (
    organization_id,
    client_id,
    contact_id,
    channel,
    purpose,
    status,
    source,
    evidence,
    policy_version,
    captured_by_email,
    captured_at,
    updated_at
  ) values (
    p_organization_id,
    p_client_id,
    p_contact_id,
    'sms',
    'review_request',
    'granted',
    'manual_user_confirmation',
    coalesce(p_consent_evidence, '{}'::jsonb),
    'review-request-v1',
    p_requested_by_email,
    now(),
    now()
  ) returning id into new_consent_id;

  insert into public.review_requests (
    organization_id,
    client_id,
    contact_id,
    consent_id,
    channel,
    status,
    request_kind,
    trigger_source,
    idempotency_key,
    message_body,
    requested_by_email,
    updated_at
  ) values (
    p_organization_id,
    p_client_id,
    p_contact_id,
    new_consent_id,
    'sms',
    'sending',
    'initial',
    'manual',
    p_idempotency_key,
    p_message_body,
    p_requested_by_email,
    now()
  ) returning id into new_request_id;

  return query select new_request_id, 'sending'::text, false;
end;
$$;

revoke all on function public.reserve_review_request(uuid, uuid, uuid, text, text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_review_request(uuid, uuid, uuid, text, text, text, jsonb, integer)
  to service_role;

alter table public.review_settings enable row level security;
alter table public.contact_message_consents enable row level security;
alter table public.review_requests enable row level security;

-- All writes and reads are routed through the authenticated Worker, which
-- applies organization, client, and role checks before using the service role.
revoke all on table public.review_settings from anon, authenticated;
revoke all on table public.contact_message_consents from anon, authenticated;
revoke all on table public.review_requests from anon, authenticated;

comment on table public.review_requests is
  'BrizBuilder-owned review invitation delivery history; contains no Google review content.';
