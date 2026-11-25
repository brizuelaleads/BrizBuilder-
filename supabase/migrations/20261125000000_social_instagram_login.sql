create table public.social_instagram_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null,
  instagram_id text not null unique,
  app_user_id text not null unique,
  instagram_name text not null,
  token_ciphertext text not null,
  token_iv text not null,
  expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  unique (organization_id, client_id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade
);

create table public.social_instagram_authorizations (
  state_hash text primary key,
  organization_id uuid not null,
  client_id uuid not null,
  actor_email text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade
);

create index social_instagram_authorizations_client_idx
  on public.social_instagram_authorizations(organization_id, client_id, expires_at);

alter table public.social_instagram_connections enable row level security;
alter table public.social_instagram_authorizations enable row level security;
revoke all on public.social_instagram_connections, public.social_instagram_authorizations from public, anon, authenticated;
grant select, insert, update, delete on public.social_instagram_connections, public.social_instagram_authorizations to service_role;

-- OAuth completion and disconnect lock the same business row. Completion
-- consumes the pending grant and stores credentials in one transaction.
create function public.complete_social_instagram_login(
  p_organization uuid, p_client uuid, p_actor text, p_state text,
  p_instagram_id text, p_app_user_id text, p_username text, p_ciphertext text, p_iv text, p_expires_at timestamptz
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform 1 from public.clients where organization_id = p_organization and id = p_client
    and status <> 'archived' for update;
  if not found then
    return null;
  end if;

  delete from public.social_instagram_authorizations
    where state_hash = p_state and organization_id = p_organization and client_id = p_client
      and actor_email = p_actor and consumed_at is not null and expires_at > now();
  if not found then
    return null;
  end if;

  insert into public.social_instagram_connections as existing (
    organization_id, client_id, instagram_id, app_user_id, instagram_name, token_ciphertext, token_iv, expires_at
  ) values (
    p_organization, p_client, p_instagram_id, p_app_user_id, p_username, p_ciphertext, p_iv, p_expires_at
  ) on conflict (organization_id, client_id) do update
    set app_user_id = excluded.app_user_id, instagram_name = excluded.instagram_name, token_ciphertext = excluded.token_ciphertext,
      token_iv = excluded.token_iv, expires_at = excluded.expires_at, connected_at = now()
    where existing.instagram_id = excluded.instagram_id
    returning id into v_id;
  if v_id is null then
    raise unique_violation using message = 'Disconnect Instagram before choosing a different account.';
  end if;

  insert into public.audit_events(organization_id, client_id, actor_email, action, record_type, record_id)
    values(p_organization, p_client, p_actor, 'social.instagram.connected', 'social_instagram_connection', v_id::text);
  return v_id;
end;
$$;

create function public.disconnect_social_instagram_login(p_organization uuid, p_client uuid, p_actor text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform 1 from public.clients where organization_id = p_organization and id = p_client for update;
  delete from public.social_instagram_authorizations where organization_id = p_organization and client_id = p_client;
  delete from public.social_instagram_connections where organization_id = p_organization and client_id = p_client
    returning id into v_id;
  if v_id is not null then
    insert into public.audit_events(organization_id, client_id, actor_email, action, record_type, record_id)
      values(p_organization, p_client, p_actor, 'social.instagram.disconnected', 'social_instagram_connection', v_id::text);
  end if;
end;
$$;

revoke all on function public.complete_social_instagram_login(uuid, uuid, text, text, text, text, text, text, text, timestamptz),
  public.disconnect_social_instagram_login(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_social_instagram_login(uuid, uuid, text, text, text, text, text, text, text, timestamptz),
  public.disconnect_social_instagram_login(uuid, uuid, text) to service_role;
