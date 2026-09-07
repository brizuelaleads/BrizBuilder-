-- Public applicants are not tenants or users. Only the service role can
-- access these records; the app additionally gates the inbox to MAIN_ADMIN_EMAIL.
create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254),
  business text not null check (char_length(business) between 1 and 160),
  message text not null default '' check (char_length(message) <= 2000),
  network_hash text not null check (network_hash ~ '^[a-f0-9]{64}$'),
  contact_consent_at timestamptz not null default now(),
  notification_status text not null default 'pending'
    check (notification_status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now()
);
alter table public.access_requests enable row level security;
revoke all on public.access_requests from public, anon, authenticated;
grant select, insert, update, delete on public.access_requests to service_role;
create index access_requests_network_window on public.access_requests(network_hash, created_at desc);
create index access_requests_email_window on public.access_requests(email, created_at desc);
create index access_requests_recent on public.access_requests(created_at desc);

create function public.submit_access_request(
  p_name text, p_email text, p_business text, p_message text, p_network_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_email text := lower(btrim(p_email));
begin
  -- Database locks keep throttling and deduplication atomic across Worker instances.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('access-network:' || p_network_hash, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('access-email:' || v_email, 0));
  if (select count(*) from public.access_requests
      where network_hash = p_network_hash and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  if exists(select 1 from public.access_requests where email = v_email and created_at > now() - interval '1 hour') then
    return jsonb_build_object('status', 'duplicate');
  end if;
  insert into public.access_requests(name, email, business, message, network_hash)
    values (btrim(p_name), v_email, btrim(p_business), btrim(p_message), p_network_hash)
    returning id into v_id;
  return jsonb_build_object('status', 'accepted', 'request_id', v_id);
end;
$$;
revoke all on function public.submit_access_request(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_access_request(text, text, text, text, text) to service_role;
