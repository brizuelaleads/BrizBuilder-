-- Tenant-safe Stripe embedded account sessions and durable Connect webhooks.

create unique index if not exists clients_organization_id_id_uidx
  on public.clients(organization_id, id);

alter table public.provider_connections
  add column if not exists livemode boolean;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.provider_connections'::regclass
      and conname = 'provider_connections_organization_client_fk'
  ) then
    alter table public.provider_connections
      add constraint provider_connections_organization_client_fk
      foreign key (organization_id, client_id)
      references public.clients(organization_id, id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.provider_authorization_states'::regclass
      and conname = 'provider_authorization_states_organization_client_fk'
  ) then
    alter table public.provider_authorization_states
      add constraint provider_authorization_states_organization_client_fk
      foreign key (organization_id, client_id)
      references public.clients(organization_id, id)
      on delete cascade;
  end if;
end
$$;

create unique index if not exists provider_connections_active_stripe_account_uidx
  on public.provider_connections(external_account_id)
  where provider = 'stripe'
    and external_account_id is not null
    and disconnected_at is null;

create table if not exists public.provider_webhook_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  external_account_id text,
  livemode boolean not null,
  status text not null default 'received',
  attempts integer not null default 1,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create index if not exists provider_webhook_events_status_idx
  on public.provider_webhook_events(provider, status, updated_at);

alter table public.provider_webhook_events enable row level security;
revoke all on table public.provider_webhook_events from anon, authenticated;

-- Provider connection mutations are always performed by the server service
-- role after application-level role and tenant checks.
revoke insert, update, delete on table public.provider_connections
  from anon, authenticated;
revoke all on table public.provider_authorization_states
  from anon, authenticated;

create or replace function public.claim_provider_webhook_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_external_account_id text,
  p_livemode boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  insert into public.provider_webhook_events (
    provider,
    event_id,
    event_type,
    external_account_id,
    livemode
  )
  values (
    p_provider,
    p_event_id,
    p_event_type,
    p_external_account_id,
    p_livemode
  )
  on conflict (provider, event_id) do update
    set attempts = provider_webhook_events.attempts + 1,
        status = 'received',
        last_error = null,
        updated_at = now()
    where provider_webhook_events.status = 'failed';

  get diagnostics affected = row_count;
  return affected = 1;
end
$$;

revoke all on function public.claim_provider_webhook_event(
  text,
  text,
  text,
  text,
  boolean
) from public, anon, authenticated;
grant execute on function public.claim_provider_webhook_event(
  text,
  text,
  text,
  text,
  boolean
) to service_role;

comment on table public.provider_webhook_events is
  'Server-only idempotency receipts for signed provider webhooks; payloads are never stored.';
comment on column public.provider_connections.livemode is
  'Explicit Stripe test/live mode captured from the OAuth response.';
