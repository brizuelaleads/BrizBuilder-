-- Reconcile legacy Twilio calls and number registrations without inventing a
-- provider connection. A connection is linked only after Twilio Connect has
-- produced an active, account-matched provider_connections row.

create or replace function public.sync_twilio_configured_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number text;
  v_connection_id uuid;
begin
  v_number := public.normalize_phone_number(new.phone_number);
  if new.provider <> 'twilio' or v_number is null then
    return new;
  end if;

  select connection.id into v_connection_id
    from public.provider_connections as connection
   where connection.organization_id = new.organization_id
     and connection.client_id = new.client_id
     and connection.provider = 'twilio'
     and connection.status = 'connected'
     and connection.disconnected_at is null
     and connection.external_account_id = new.provider_account_sid
   limit 1;

  update public.phone_numbers
     set is_default = false, updated_at = pg_catalog.now()
   where organization_id = new.organization_id
     and client_id = new.client_id
     and is_default = true
     and normalized_phone_number <> v_number;

  insert into public.phone_numbers (
    organization_id, client_id, connection_id, provider, phone_number,
    normalized_phone_number, display_name, purpose, provider_number_id,
    provider_config, is_active, is_default, updated_at
  ) values (
    new.organization_id, new.client_id, v_connection_id, 'twilio', new.phone_number,
    v_number, new.phone_number, 'Main phone', new.phone_number_sid,
    pg_catalog.jsonb_build_object('forwardingNumber', new.forwarding_number),
    new.provider_status = 'connected', true, pg_catalog.now()
  )
  on conflict (organization_id, client_id, provider, normalized_phone_number)
  do update set
    connection_id = excluded.connection_id,
    phone_number = excluded.phone_number,
    provider_number_id = excluded.provider_number_id,
    provider_config = excluded.provider_config,
    is_active = excluded.is_active,
    is_default = true,
    updated_at = pg_catalog.now();
  return new;
end
$$;

-- Link registered numbers only when the selected number and provider account
-- both agree with one genuine, active Twilio connection in the same tenant.
with matched_numbers as (
  select number.id as number_id, connection.id as connection_id
    from public.phone_numbers as number
    join public.phone_system_configs as config
      on config.organization_id = number.organization_id
     and config.client_id = number.client_id
     and config.provider = 'twilio'
     and public.normalize_phone_number(config.phone_number) = number.normalized_phone_number
     and config.phone_number_sid = number.provider_number_id
    join public.provider_connections as connection
      on connection.organization_id = number.organization_id
     and connection.client_id = number.client_id
     and connection.provider = 'twilio'
     and connection.status = 'connected'
     and connection.disconnected_at is null
     and connection.external_account_id = config.provider_account_sid
   where number.provider = 'twilio'
)
update public.phone_numbers as number
   set connection_id = matched.connection_id,
       updated_at = pg_catalog.now()
  from matched_numbers as matched
 where number.id = matched.number_id
   and number.connection_id is distinct from matched.connection_id;

-- A legacy call is linked only when exactly one active Twilio number in that
-- call's organization/client scope matches its normalized business number.
with unique_number_matches as (
  select
    call.id as call_id,
    min(number.id::text)::uuid as number_id
  from public.phone_calls as call
  join public.phone_numbers as number
    on number.organization_id = call.organization_id
   and number.client_id = call.client_id
   and number.provider = 'twilio'
   and number.is_active = true
   and number.normalized_phone_number = public.normalize_phone_number(call.business_phone)
  where call.provider = 'twilio'
    and call.business_phone_number_id is null
  group by call.id
  having count(*) = 1
)
update public.phone_calls as call
   set business_phone_number_id = matched.number_id,
       updated_at = pg_catalog.now()
  from unique_number_matches as matched
 where call.id = matched.call_id
   and call.business_phone_number_id is null;
