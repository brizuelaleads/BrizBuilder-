-- Preserve existing admin assignments in the explicit assignment role.
update public.client_members cm
set role = 'AGENCY_ADMIN'
from public.organization_members om
where cm.organization_id = om.organization_id
  and cm.profile_id = om.profile_id
  and cm.status = 'active'
  and om.status = 'active'
  and om.role = 'AGENCY_ADMIN';

-- Agency admins work through the CRM server and are confined to their assignments.
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
      and om.role in ('SUPER_ADMIN', 'AGENCY_OWNER', 'AGENCY_MEMBER')
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
      and (cm.role = 'AGENCY_ADMIN') = exists (
          select 1
          from public.organization_members om
          where om.organization_id = cm.organization_id
            and om.profile_id = cm.profile_id
            and om.status = 'active'
            and om.role = 'AGENCY_ADMIN'
      )
  );
$$;

create or replace function public.assign_admin_sub_accounts(
  p_organization_id uuid,
  p_profile_id uuid,
  p_client_ids uuid[],
  p_actor_email text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  perform 1 from public.profiles where id = p_profile_id and status = 'active' for update;
  if not found then
    raise exception 'Active profile required';
  end if;

  if exists (
    select 1 from public.organization_members
    where profile_id = p_profile_id
      and status = 'active'
      and (organization_id <> p_organization_id or role in ('SUPER_ADMIN', 'AGENCY_OWNER'))
  ) then
    raise exception 'This account already has protected agency access';
  end if;

  if p_client_ids is null or exists (
    select 1 from unnest(p_client_ids) as assignment(client_id)
    where not exists (
      select 1 from public.clients
      where id = assignment.client_id
        and organization_id = p_organization_id
        and status = 'active'
    )
  ) then
    raise exception 'Choose active sub-accounts from this agency';
  end if;

  insert into public.organization_members (organization_id, profile_id, role, status)
  values (p_organization_id, p_profile_id, 'AGENCY_ADMIN', 'active')
  on conflict (organization_id, profile_id) do update
    set role = excluded.role, status = excluded.status;

  update public.client_members
  set status = 'archived'
  where organization_id = p_organization_id
    and profile_id = p_profile_id
    and status = 'active'
    and not (client_id = any(p_client_ids));

  insert into public.client_members (organization_id, client_id, profile_id, role, status)
  select p_organization_id, client_id, p_profile_id, 'AGENCY_ADMIN', 'active'
  from (select distinct unnest(p_client_ids) as client_id) as assignments
  on conflict (client_id, profile_id) do update
    set role = excluded.role, status = excluded.status;

  insert into public.audit_events (organization_id, actor_email, action, record_type, record_id, metadata)
  values (
    p_organization_id,
    p_actor_email,
    'team.admin_assignments_changed',
    'profile',
    p_profile_id::text,
    jsonb_build_object('role', 'LB_ADMIN', 'clientIds', p_client_ids)
  );
end;
$$;

revoke all on function public.assign_admin_sub_accounts(uuid, uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.assign_admin_sub_accounts(uuid, uuid, uuid[], text) to service_role;
