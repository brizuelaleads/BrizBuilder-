-- Transactional, idempotent write boundary for remote AI connectors.
-- The Worker validates OAuth and current membership first; these functions then
-- pin the final mutation to the active authorization, access token,
-- organization, and explicitly granted business in the same transaction.

create table if not exists public.ai_mutation_idempotency (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null references public.ai_authorizations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  request_id uuid not null,
  tool_name text not null,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint ai_mutation_idempotency_authorization_request_key
    unique (authorization_id, request_id),
  constraint ai_mutation_idempotency_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade,
  constraint ai_mutation_idempotency_tool_check check (
    tool_name in (
      'crm_create_task',
      'crm_add_opportunity_note',
      'crm_move_opportunity_stage'
    )
  ),
  constraint ai_mutation_idempotency_request_not_nil check (
    request_id <> '00000000-0000-0000-0000-000000000000'::uuid
  ),
  constraint ai_mutation_idempotency_payload_hash_check check (
    payload_hash ~ '^[0-9a-f]{64}$'
  )
);

create index if not exists ai_mutation_idempotency_org_time_idx
  on public.ai_mutation_idempotency(organization_id, created_at desc);

alter table public.ai_mutation_idempotency enable row level security;
revoke all on table public.ai_mutation_idempotency
  from public, anon, authenticated;
grant select on table public.ai_mutation_idempotency to service_role;

create or replace function public.ai_assert_mutation_grant(
  p_authorization_id uuid,
  p_access_token_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_resource text,
  p_required_scope text
)
returns table (
  grant_actor_email text,
  grant_actor_name text,
  grant_oauth_client_id uuid,
  grant_app_name text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_email text;
  v_actor_name text;
  v_oauth_client_id uuid;
  v_app_name text;
begin
  if p_authorization_id is null
    or p_access_token_id is null
    or p_organization_id is null
    or p_client_id is null
    or p_resource is null
    or char_length(p_resource) not between 12 and 500
    or p_required_scope is null
    or p_required_scope not in (
      'crm:tasks.write',
      'crm:opportunities.write'
    ) then
    raise exception 'Invalid AI mutation grant.' using errcode = '22023';
  end if;

  select
    authz.actor_email,
    authz.actor_name,
    authz.oauth_client_id,
    left(
      regexp_replace(oauth_client.client_name, '[[:cntrl:]]', '', 'g'),
      100
    )
  into
    v_actor_email,
    v_actor_name,
    v_oauth_client_id,
    v_app_name
  from public.ai_authorizations as authz
  join public.ai_oauth_clients as oauth_client
    on oauth_client.id = authz.oauth_client_id
   and oauth_client.revoked_at is null
  where authz.id = p_authorization_id
    and authz.organization_id = p_organization_id
    and authz.status = 'active'
    and authz.revoked_at is null
    and p_client_id = any(authz.allowed_client_ids)
    and p_required_scope = any(authz.scopes)
  for update of authz, oauth_client;

  if not found then
    raise exception 'AI authorization is not active for this business.'
      using errcode = '42501';
  end if;

  perform 1
  from public.ai_oauth_access_tokens as access_token
  where access_token.id = p_access_token_id
    and access_token.authorization_id = p_authorization_id
    and access_token.oauth_client_id = v_oauth_client_id
    and access_token.resource = p_resource
    and access_token.revoked_at is null
    and access_token.expires_at > statement_timestamp()
    and p_required_scope = any(access_token.scopes)
  for share;

  if not found then
    raise exception 'AI access token is not active for this mutation.'
      using errcode = '42501';
  end if;

  perform 1
  from public.clients as client
  where client.id = p_client_id
    and client.organization_id = p_organization_id
    and client.archived_at is null
    and client.status <> 'archived'
  for share;

  if not found then
    raise exception 'Approved business is not active.' using errcode = '42501';
  end if;

  return query select
    v_actor_email,
    v_actor_name,
    v_oauth_client_id,
    coalesce(nullif(btrim(v_app_name), ''), 'AI app');
end;
$$;

revoke all on function public.ai_assert_mutation_grant(
  uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

create or replace function public.ai_create_task(
  p_authorization_id uuid,
  p_access_token_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_resource text,
  p_request_id uuid,
  p_title text,
  p_description text default null,
  p_lead_id uuid default null,
  p_contact_id uuid default null,
  p_assignee text default null,
  p_due_at timestamptz default null,
  p_priority text default 'MEDIUM'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_email text;
  v_actor_name text;
  v_oauth_client_id uuid;
  v_app_name text;
  v_existing public.ai_mutation_idempotency%rowtype;
  v_payload_hash text;
  v_task_id uuid;
  v_result jsonb;
begin
  if p_request_id is null
    or p_request_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'A non-nil request ID is required.' using errcode = '22023';
  end if;

  select
    grant_actor_email,
    grant_actor_name,
    grant_oauth_client_id,
    grant_app_name
  into v_actor_email, v_actor_name, v_oauth_client_id, v_app_name
  from public.ai_assert_mutation_grant(
    p_authorization_id,
    p_access_token_id,
    p_organization_id,
    p_client_id,
    p_resource,
    'crm:tasks.write'
  );

  p_title := btrim(coalesce(p_title, ''));
  p_description := btrim(coalesce(p_description, ''));
  p_assignee := nullif(btrim(coalesce(p_assignee, '')), '');
  p_priority := upper(btrim(coalesce(p_priority, 'MEDIUM')));

  if char_length(p_title) not between 1 and 180
    or char_length(p_description) > 1000
    or char_length(coalesce(p_assignee, '')) > 120
    or p_priority not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then
    raise exception 'Invalid task input.' using errcode = '22023';
  end if;

  v_payload_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'title', p_title,
          'description', p_description,
          'lead_id', p_lead_id,
          'contact_id', p_contact_id,
          'assignee', p_assignee,
          'due_at_epoch', extract(epoch from p_due_at),
          'priority', p_priority
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_authorization_id::text || ':' || p_request_id::text,
      0
    )
  );

  select * into v_existing
  from public.ai_mutation_idempotency
  where authorization_id = p_authorization_id
    and request_id = p_request_id;

  if found then
    if v_existing.organization_id <> p_organization_id
      or v_existing.client_id <> p_client_id
      or v_existing.tool_name <> 'crm_create_task'
      or v_existing.payload_hash <> v_payload_hash then
      raise exception 'Request ID was already used for another mutation.'
        using errcode = '22023';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  if p_lead_id is not null then
    perform 1
    from public.leads as lead
    where lead.id = p_lead_id
      and lead.organization_id = p_organization_id
      and lead.client_id = p_client_id
      and lead.archived_at is null
    for share;
    if not found then
      raise exception 'Opportunity is not in the approved business.'
        using errcode = '42501';
    end if;
  end if;

  if p_contact_id is not null then
    perform 1
    from public.contacts as contact
    where contact.id = p_contact_id
      and contact.organization_id = p_organization_id
      and contact.client_id = p_client_id
      and contact.archived_at is null
    for share;
    if not found then
      raise exception 'Contact is not in the approved business.'
        using errcode = '42501';
    end if;
  end if;

  insert into public.tasks (
    organization_id,
    client_id,
    lead_id,
    contact_id,
    title,
    description,
    assignee,
    due_at,
    priority,
    status
  ) values (
    p_organization_id,
    p_client_id,
    p_lead_id,
    p_contact_id,
    p_title,
    p_description,
    coalesce(p_assignee, v_actor_name),
    p_due_at,
    p_priority,
    'TO_DO'
  )
  returning id into v_task_id;

  v_result := jsonb_build_object(
    'task_id', v_task_id,
    'created', true
  );

  insert into public.audit_events (
    organization_id,
    client_id,
    actor_email,
    action,
    record_type,
    record_id,
    metadata
  ) values (
    p_organization_id,
    p_client_id,
    v_actor_email,
    'ai.tool.crm_create_task',
    'task',
    v_task_id::text,
    jsonb_build_object(
      'connector', 'remote_mcp',
      'oauthClientId', v_oauth_client_id,
      'authorizationId', p_authorization_id,
      'appName', v_app_name,
      'toolName', 'crm_create_task',
      'outcome', 'success',
      'requestId', p_request_id
    )
  );

  insert into public.ai_mutation_idempotency (
    authorization_id,
    organization_id,
    client_id,
    request_id,
    tool_name,
    payload_hash,
    result
  ) values (
    p_authorization_id,
    p_organization_id,
    p_client_id,
    p_request_id,
    'crm_create_task',
    v_payload_hash,
    v_result
  );

  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$$;

revoke all on function public.ai_create_task(
  uuid, uuid, uuid, uuid, text, uuid, text, text, uuid, uuid, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.ai_create_task(
  uuid, uuid, uuid, uuid, text, uuid, text, text, uuid, uuid, text, timestamptz, text
) to service_role;

create or replace function public.ai_add_opportunity_note(
  p_authorization_id uuid,
  p_access_token_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_resource text,
  p_request_id uuid,
  p_opportunity_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_email text;
  v_actor_name text;
  v_oauth_client_id uuid;
  v_app_name text;
  v_existing public.ai_mutation_idempotency%rowtype;
  v_payload_hash text;
  v_contact_id uuid;
  v_note_id uuid;
  v_result jsonb;
begin
  if p_request_id is null
    or p_request_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'A non-nil request ID is required.' using errcode = '22023';
  end if;

  select
    grant_actor_email,
    grant_actor_name,
    grant_oauth_client_id,
    grant_app_name
  into v_actor_email, v_actor_name, v_oauth_client_id, v_app_name
  from public.ai_assert_mutation_grant(
    p_authorization_id,
    p_access_token_id,
    p_organization_id,
    p_client_id,
    p_resource,
    'crm:opportunities.write'
  );

  p_body := btrim(coalesce(p_body, ''));
  if p_opportunity_id is null or char_length(p_body) not between 1 and 2000 then
    raise exception 'Invalid opportunity note input.' using errcode = '22023';
  end if;

  v_payload_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'opportunity_id', p_opportunity_id,
          'body', p_body
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_authorization_id::text || ':' || p_request_id::text,
      0
    )
  );

  select * into v_existing
  from public.ai_mutation_idempotency
  where authorization_id = p_authorization_id
    and request_id = p_request_id;

  if found then
    if v_existing.organization_id <> p_organization_id
      or v_existing.client_id <> p_client_id
      or v_existing.tool_name <> 'crm_add_opportunity_note'
      or v_existing.payload_hash <> v_payload_hash then
      raise exception 'Request ID was already used for another mutation.'
        using errcode = '22023';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select lead.contact_id
  into v_contact_id
  from public.leads as lead
  where lead.id = p_opportunity_id
    and lead.organization_id = p_organization_id
    and lead.client_id = p_client_id
    and lead.archived_at is null
  for update;

  if not found then
    raise exception 'Opportunity is not in the approved business.'
      using errcode = '42501';
  end if;

  insert into public.notes (
    organization_id,
    client_id,
    lead_id,
    contact_id,
    body
  ) values (
    p_organization_id,
    p_client_id,
    p_opportunity_id,
    v_contact_id,
    p_body
  )
  returning id into v_note_id;

  v_result := jsonb_build_object(
    'note_id', v_note_id,
    'opportunity_id', p_opportunity_id,
    'created', true
  );

  insert into public.audit_events (
    organization_id,
    client_id,
    actor_email,
    action,
    record_type,
    record_id,
    metadata
  ) values (
    p_organization_id,
    p_client_id,
    v_actor_email,
    'ai.tool.crm_add_opportunity_note',
    'note',
    v_note_id::text,
    jsonb_build_object(
      'connector', 'remote_mcp',
      'oauthClientId', v_oauth_client_id,
      'authorizationId', p_authorization_id,
      'appName', v_app_name,
      'toolName', 'crm_add_opportunity_note',
      'outcome', 'success',
      'requestId', p_request_id
    )
  );

  insert into public.ai_mutation_idempotency (
    authorization_id,
    organization_id,
    client_id,
    request_id,
    tool_name,
    payload_hash,
    result
  ) values (
    p_authorization_id,
    p_organization_id,
    p_client_id,
    p_request_id,
    'crm_add_opportunity_note',
    v_payload_hash,
    v_result
  );

  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$$;

revoke all on function public.ai_add_opportunity_note(
  uuid, uuid, uuid, uuid, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.ai_add_opportunity_note(
  uuid, uuid, uuid, uuid, text, uuid, uuid, text
) to service_role;

create or replace function public.ai_move_opportunity_stage(
  p_authorization_id uuid,
  p_access_token_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_resource text,
  p_request_id uuid,
  p_opportunity_id uuid,
  p_stage_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor_email text;
  v_actor_name text;
  v_oauth_client_id uuid;
  v_app_name text;
  v_existing public.ai_mutation_idempotency%rowtype;
  v_payload_hash text;
  v_pipeline_id uuid;
  v_stage_name text;
  v_stage_slug text;
  v_next_status public.lead_status;
  v_result jsonb;
begin
  if p_request_id is null
    or p_request_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'A non-nil request ID is required.' using errcode = '22023';
  end if;

  select
    grant_actor_email,
    grant_actor_name,
    grant_oauth_client_id,
    grant_app_name
  into v_actor_email, v_actor_name, v_oauth_client_id, v_app_name
  from public.ai_assert_mutation_grant(
    p_authorization_id,
    p_access_token_id,
    p_organization_id,
    p_client_id,
    p_resource,
    'crm:opportunities.write'
  );

  if p_opportunity_id is null or p_stage_id is null then
    raise exception 'Opportunity and stage are required.' using errcode = '22023';
  end if;

  v_payload_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'opportunity_id', p_opportunity_id,
          'stage_id', p_stage_id
        )::text,
        'UTF8'
      )
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_authorization_id::text || ':' || p_request_id::text,
      0
    )
  );

  select * into v_existing
  from public.ai_mutation_idempotency
  where authorization_id = p_authorization_id
    and request_id = p_request_id;

  if found then
    if v_existing.organization_id <> p_organization_id
      or v_existing.client_id <> p_client_id
      or v_existing.tool_name <> 'crm_move_opportunity_stage'
      or v_existing.payload_hash <> v_payload_hash then
      raise exception 'Request ID was already used for another mutation.'
        using errcode = '22023';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  select lead.pipeline_id
  into v_pipeline_id
  from public.leads as lead
  where lead.id = p_opportunity_id
    and lead.organization_id = p_organization_id
    and lead.client_id = p_client_id
    and lead.archived_at is null
  for update;

  if not found or v_pipeline_id is null then
    raise exception 'Opportunity is not in an active approved pipeline.'
      using errcode = '42501';
  end if;

  perform 1
  from public.pipelines as pipeline
  where pipeline.id = v_pipeline_id
    and pipeline.organization_id = p_organization_id
    and (pipeline.client_id is null or pipeline.client_id = p_client_id)
  for share;

  if not found then
    raise exception 'Opportunity pipeline is not approved for this business.'
      using errcode = '42501';
  end if;

  select stage.name, stage.slug
  into v_stage_name, v_stage_slug
  from public.pipeline_stages as stage
  where stage.id = p_stage_id
    and stage.organization_id = p_organization_id
    and stage.pipeline_id = v_pipeline_id
  for share;

  if not found then
    raise exception 'Stage is not in the opportunity pipeline.'
      using errcode = '42501';
  end if;

  v_next_status := (
    case v_stage_slug
      when 'new' then 'NEW'
      when 'attempting-contact' then 'NEW'
      when 'contacted' then 'CONTACTED'
      when 'qualified' then 'QUALIFIED'
      when 'appointment-booked' then 'APPOINTMENT_BOOKED'
      when 'estimate-sent' then 'ESTIMATE_SENT'
      when 'won' then 'WON'
      when 'lost' then 'LOST'
      else 'NEW'
    end
  )::public.lead_status;

  update public.leads
  set
    stage_id = p_stage_id,
    status = v_next_status,
    updated_at = statement_timestamp()
  where id = p_opportunity_id
    and organization_id = p_organization_id
    and client_id = p_client_id
    and pipeline_id = v_pipeline_id
    and archived_at is null;

  if not found then
    raise exception 'Opportunity changed before the stage update.'
      using errcode = '40001';
  end if;

  v_result := jsonb_build_object(
    'opportunity_id', p_opportunity_id,
    'stage_id', p_stage_id,
    'stage_name', v_stage_name,
    'moved', true
  );

  insert into public.audit_events (
    organization_id,
    client_id,
    actor_email,
    action,
    record_type,
    record_id,
    metadata
  ) values (
    p_organization_id,
    p_client_id,
    v_actor_email,
    'ai.tool.crm_move_opportunity_stage',
    'opportunity',
    p_opportunity_id::text,
    jsonb_build_object(
      'connector', 'remote_mcp',
      'oauthClientId', v_oauth_client_id,
      'authorizationId', p_authorization_id,
      'appName', v_app_name,
      'toolName', 'crm_move_opportunity_stage',
      'outcome', 'success',
      'requestId', p_request_id
    )
  );

  insert into public.ai_mutation_idempotency (
    authorization_id,
    organization_id,
    client_id,
    request_id,
    tool_name,
    payload_hash,
    result
  ) values (
    p_authorization_id,
    p_organization_id,
    p_client_id,
    p_request_id,
    'crm_move_opportunity_stage',
    v_payload_hash,
    v_result
  );

  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$$;

revoke all on function public.ai_move_opportunity_stage(
  uuid, uuid, uuid, uuid, text, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.ai_move_opportunity_stage(
  uuid, uuid, uuid, uuid, text, uuid, uuid, uuid
) to service_role;

comment on table public.ai_mutation_idempotency is
  'Stores only bounded mutation results so retries return the original result without repeating CRM writes.';
