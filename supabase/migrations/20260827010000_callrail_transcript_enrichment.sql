-- Durable CallRail transcript retrieval and conservative CRM enrichment.
--
-- A post-call webhook can legally arrive before CallRail has attached its
-- transcript (the provider waits at most 20 minutes). Call ingestion and
-- transcript completion are therefore separate state machines: creating the
-- call/lead may finish while the transcript remains pending.

alter table public.contacts
  add column if not exists field_provenance jsonb not null default '{}'::jsonb;

alter table public.leads
  add column if not exists field_provenance jsonb not null default '{}'::jsonb,
  add column if not exists first_contacted_at timestamptz,
  add column if not exists appointment_status text not null default 'none',
  add column if not exists appointment_start timestamptz,
  add column if not exists appointment_end timestamptz,
  add column if not exists appointment_timezone text,
  add column if not exists appointment_confidence double precision,
  add column if not exists appointment_source text,
  add column if not exists appointment_verified_at timestamptz;

alter table public.appointments
  add column if not exists source text not null default 'manual',
  add column if not exists source_callrail_call_id text,
  add column if not exists time_zone text,
  add column if not exists confidence double precision,
  add column if not exists verified_at timestamptz,
  add column if not exists calendar_event_id text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.leads
  add column if not exists transcript_appointment_id uuid
    references public.appointments(id) on delete set null;

alter table public.callrail_calls
  add column if not exists source_name text,
  add column if not exists person_id text,
  add column if not exists call_type text,
  add column if not exists lead_status text,
  add column if not exists call_tags text[] not null default '{}',
  add column if not exists transcript_status text not null default 'pending',
  add column if not exists transcript_attempt_count integer not null default 0,
  add column if not exists transcript_last_attempt_at timestamptz,
  add column if not exists transcript_next_attempt_at timestamptz,
  add column if not exists transcript_completed_at timestamptz,
  add column if not exists transcript_failure_reason text,
  add column if not exists transcript_sha256 text,
  add column if not exists enrichment_status text not null default 'not_ready',
  add column if not exists enrichment_attempted_at timestamptz,
  add column if not exists enrichment_completed_at timestamptz,
  add column if not exists enrichment_transcript_sha256 text,
  add column if not exists extracted_data jsonb not null default '{}'::jsonb,
  add column if not exists appointment_status text not null default 'none',
  add column if not exists appointment_start timestamptz,
  add column if not exists appointment_end timestamptz,
  add column if not exists appointment_timezone text,
  add column if not exists appointment_confidence double precision,
  add column if not exists appointment_verified_at timestamptz,
  add column if not exists appointment_id uuid
    references public.appointments(id) on delete set null;

do $$
begin
  alter table public.leads
    drop constraint if exists leads_appointment_status_check;
  alter table public.leads
    add constraint leads_appointment_status_check
    check (appointment_status in ('none', 'tentative', 'confirmed', 'cancelled', 'rescheduled'));

  alter table public.leads
    drop constraint if exists leads_appointment_confidence_check;
  alter table public.leads
    add constraint leads_appointment_confidence_check
    check (appointment_confidence is null or appointment_confidence between 0 and 1);

  alter table public.appointments
    drop constraint if exists appointments_source_check;
  alter table public.appointments
    add constraint appointments_source_check
    check (source in ('manual', 'form', 'callrail', 'transcript', 'ai_summary'));

  alter table public.appointments
    drop constraint if exists appointments_confidence_check;
  alter table public.appointments
    add constraint appointments_confidence_check
    check (confidence is null or confidence between 0 and 1);

  alter table public.callrail_calls
    drop constraint if exists callrail_calls_transcript_status_check;
  alter table public.callrail_calls
    add constraint callrail_calls_transcript_status_check
    check (transcript_status in ('pending', 'available', 'unavailable'));

  alter table public.callrail_calls
    drop constraint if exists callrail_calls_transcript_attempt_count_check;
  alter table public.callrail_calls
    add constraint callrail_calls_transcript_attempt_count_check
    check (transcript_attempt_count between 0 and 10);

  alter table public.callrail_calls
    drop constraint if exists callrail_calls_transcript_failure_reason_check;
  alter table public.callrail_calls
    add constraint callrail_calls_transcript_failure_reason_check
    check (
      transcript_failure_reason is null
      or transcript_failure_reason in ('retry_limit', 'provider_unavailable')
    );

  alter table public.callrail_calls
    drop constraint if exists callrail_calls_enrichment_status_check;
  alter table public.callrail_calls
    add constraint callrail_calls_enrichment_status_check
    check (enrichment_status in ('not_ready', 'pending', 'processing', 'completed', 'failed'));

  alter table public.callrail_calls
    drop constraint if exists callrail_calls_appointment_status_check;
  alter table public.callrail_calls
    add constraint callrail_calls_appointment_status_check
    check (appointment_status in ('none', 'tentative', 'confirmed', 'cancelled', 'rescheduled'));

  alter table public.callrail_calls
    drop constraint if exists callrail_calls_appointment_confidence_check;
  alter table public.callrail_calls
    add constraint callrail_calls_appointment_confidence_check
    check (appointment_confidence is null or appointment_confidence between 0 and 1);

  alter table public.callrail_calls
    drop constraint if exists callrail_calls_transcript_sha256_check;
  alter table public.callrail_calls
    add constraint callrail_calls_transcript_sha256_check
    check (transcript_sha256 is null or transcript_sha256 ~ '^[0-9a-f]{64}$');

  alter table public.callrail_calls
    drop constraint if exists callrail_calls_enrichment_sha256_check;
  alter table public.callrail_calls
    add constraint callrail_calls_enrichment_sha256_check
    check (enrichment_transcript_sha256 is null or enrichment_transcript_sha256 ~ '^[0-9a-f]{64}$');
end
$$;

-- One transcript-managed appointment per lead. Subsequent confirmed calls
-- update this row; manual appointments remain outside this uniqueness rule.
-- This should be empty on the first application because source was just added
-- with a manual default. Refuse a partially applied/hand-edited database with
-- an actionable error rather than letting index creation fail opaquely or
-- deleting an appointment to make it pass.
do $$
begin
  if exists (
    select 1
      from public.appointments
     where source = 'transcript' and lead_id is not null
     group by organization_id, client_id, lead_id
    having count(*) > 1
  ) then
    raise exception using
      message = 'Duplicate transcript appointments exist for a lead.',
      hint = 'Merge the duplicate appointment rows without deleting the valid Google-linked appointment, then rerun this migration.';
  end if;
end
$$;

create unique index if not exists appointments_transcript_lead_uidx
  on public.appointments (organization_id, client_id, lead_id)
  where source = 'transcript' and lead_id is not null;

create index if not exists callrail_calls_transcript_due_idx
  on public.callrail_calls (transcript_next_attempt_at, updated_at)
  where transcript_status = 'pending' and transcript_attempt_count < 10;

create index if not exists callrail_calls_enrichment_pending_idx
  on public.callrail_calls (updated_at)
  where enrichment_status in ('pending', 'processing', 'failed');

create index if not exists callrail_calls_person_contact_idx
  on public.callrail_calls (organization_id, client_id, person_id, started_at desc)
  where person_id is not null and contact_id is not null;

-- Website forms historically retained display-formatted US numbers while
-- CallRail supplies canonical E.164. Match the same digits inside the existing
-- transaction/advisory-lock function so a form contact and its next phone call
-- converge on one record without imposing a global phone uniqueness rule.
create or replace function public.find_or_create_callrail_contact(
  p_organization_id uuid,
  p_client_id uuid,
  p_phone_e164 text,
  p_first_name text,
  p_last_name text,
  p_city text,
  p_state text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := nullif(pg_catalog.btrim(coalesce(p_phone_e164, '')), '');
  v_digits text;
  v_local_digits text;
  v_contact_id uuid;
  v_now timestamptz := pg_catalog.now();
begin
  if p_organization_id is null or p_client_id is null then
    raise exception 'find_or_create_callrail_contact requires an organization and a client';
  end if;
  if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'find_or_create_callrail_contact requires a canonical E.164 phone number';
  end if;

  v_digits := pg_catalog.regexp_replace(v_phone, '[^0-9]', '', 'g');
  v_local_digits := case
    when pg_catalog.length(v_digits) = 11 and pg_catalog.left(v_digits, 1) = '1'
      then pg_catalog.substring(v_digits, 2)
    else v_digits
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_client_id::text || ':' || v_phone,
      0
    )
  );

  select c.id
    into v_contact_id
    from public.contacts as c
   where c.organization_id = p_organization_id
     and c.client_id = p_client_id
     and c.archived_at is null
     and (
       pg_catalog.regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = v_digits
       or pg_catalog.regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = v_local_digits
     )
   order by c.created_at asc, c.id asc
   limit 1;

  if v_contact_id is not null then
    update public.contacts
       set last_interaction_at = v_now,
           updated_at = v_now
     where id = v_contact_id;
    return v_contact_id;
  end if;

  insert into public.contacts (
    organization_id, client_id, first_name, last_name, phone,
    city, state, marketing_consent, tags, last_interaction_at
  )
  values (
    p_organization_id, p_client_id,
    coalesce(nullif(pg_catalog.btrim(coalesce(p_first_name, '')), ''), 'Caller'),
    coalesce(p_last_name, ''),
    v_phone, p_city, p_state, 'unknown', array['CallRail'], v_now
  )
  returning id into v_contact_id;

  return v_contact_id;
end
$$;

revoke all on function public.find_or_create_callrail_contact(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.find_or_create_callrail_contact(
  uuid, uuid, text, text, text, text, text
) to service_role;

-- Give legacy structured CRM fields a conservative provenance before any
-- transcript can make an explicit-correction update. Website-originated
-- contacts retain form priority. Every other old value is conservatively
-- treated as manual because legacy rows cannot prove that a CallRail-created
-- value was not edited later by a person. Newly ingested values carry exact
-- provenance from the application.
with contact_sources as (
  select contact.id,
         case
           when exists (
             select 1 from public.leads as lead
              where lead.contact_id = contact.id and lead.source ilike 'Website%'
           ) then 'form'
           else 'manual'
         end as source
    from public.contacts as contact
   where contact.field_provenance = '{}'::jsonb
)
update public.contacts as contact
   set field_provenance = pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
         'first_name', case when nullif(pg_catalog.btrim(contact.first_name), '') is not null then pg_catalog.jsonb_build_object('source', sources.source, 'confidence', 1, 'verified', sources.source <> 'callrail', 'updatedAt', now()) end,
         'last_name', case when nullif(pg_catalog.btrim(contact.last_name), '') is not null then pg_catalog.jsonb_build_object('source', sources.source, 'confidence', 1, 'verified', sources.source <> 'callrail', 'updatedAt', now()) end,
         'phone', case when nullif(pg_catalog.btrim(contact.phone), '') is not null then pg_catalog.jsonb_build_object('source', sources.source, 'confidence', 1, 'verified', sources.source <> 'callrail', 'updatedAt', now()) end,
         'email', case when nullif(pg_catalog.btrim(contact.email), '') is not null then pg_catalog.jsonb_build_object('source', sources.source, 'confidence', 1, 'verified', sources.source <> 'callrail', 'updatedAt', now()) end,
         'address', case when nullif(pg_catalog.btrim(contact.address), '') is not null then pg_catalog.jsonb_build_object('source', sources.source, 'confidence', 1, 'verified', sources.source <> 'callrail', 'updatedAt', now()) end,
         'city', case when nullif(pg_catalog.btrim(contact.city), '') is not null then pg_catalog.jsonb_build_object('source', sources.source, 'confidence', 1, 'verified', sources.source <> 'callrail', 'updatedAt', now()) end,
         'state', case when nullif(pg_catalog.btrim(contact.state), '') is not null then pg_catalog.jsonb_build_object('source', sources.source, 'confidence', 1, 'verified', sources.source <> 'callrail', 'updatedAt', now()) end,
         'zip', case when nullif(pg_catalog.btrim(contact.zip), '') is not null then pg_catalog.jsonb_build_object('source', sources.source, 'confidence', 1, 'verified', sources.source <> 'callrail', 'updatedAt', now()) end
       ))
  from contact_sources as sources
 where contact.id = sources.id;

-- Existing lead fields predate per-field provenance. Protect anything that
-- could have been manually edited, while retaining the known source of
-- website and untouched CallRail placeholder/attribution fields.
update public.leads as lead
   set field_provenance = pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
         'service_requested', case
           when nullif(pg_catalog.btrim(lead.service_requested), '') is null then null
           when lead.source = 'CallRail'
            and lead.service_requested ~* '^(phone call|callrail call|unknown|not provided)$'
             then pg_catalog.jsonb_build_object('source', 'callrail', 'confidence', 1, 'verified', false, 'updatedAt', now())
           when lead.source ilike 'Website%'
             then pg_catalog.jsonb_build_object('source', 'form', 'confidence', 1, 'verified', true, 'updatedAt', now())
           else pg_catalog.jsonb_build_object('source', 'manual', 'confidence', 1, 'verified', true, 'updatedAt', now())
         end,
         'message', case
           when nullif(pg_catalog.btrim(lead.message), '') is null then null
           when lead.source = 'CallRail'
            and (
              (
                lead.message ilike '%Transcript is available on the CallRail call record.%'
                and lead.message ilike '%Call started:%'
                and lead.message ~* 'Duration:\s*[0-9]+s'
              )
              or (lead.message ilike 'Call started:%' and lead.message ~* 'Duration:\s*[0-9]+s')
            )
             then pg_catalog.jsonb_build_object('source', 'callrail', 'confidence', 1, 'verified', false, 'updatedAt', now())
           when lead.source ilike 'Website%'
             then pg_catalog.jsonb_build_object('source', 'form', 'confidence', 1, 'verified', true, 'updatedAt', now())
           else pg_catalog.jsonb_build_object('source', 'manual', 'confidence', 1, 'verified', true, 'updatedAt', now())
         end,
         'campaign', case
           when nullif(pg_catalog.btrim(lead.campaign), '') is null then null
           when lead.source = 'CallRail'
             then pg_catalog.jsonb_build_object('source', 'callrail', 'confidence', 1, 'verified', false, 'updatedAt', now())
           when lead.source ilike 'Website%'
             then pg_catalog.jsonb_build_object('source', 'form', 'confidence', 1, 'verified', true, 'updatedAt', now())
           else pg_catalog.jsonb_build_object('source', 'manual', 'confidence', 1, 'verified', true, 'updatedAt', now())
         end,
         'estimated_value_cents', case
           when coalesce(lead.estimated_value_cents, 0) <= 0 then null
           else pg_catalog.jsonb_build_object('source', 'manual', 'confidence', 1, 'verified', true, 'updatedAt', now())
         end
       ))
 where lead.field_provenance = '{}'::jsonb;

-- Existing rows have already had at least one API fetch. Recent missing
-- transcripts enter the retry queue; old rows stop instead of causing a large
-- surprise API sweep after deployment.
update public.callrail_calls
   set transcript_status = case
         when transcript is not null and pg_catalog.btrim(transcript) <> '' then 'available'
         when coalesce(ended_at, started_at, created_at) >= now() - interval '7 days' then 'pending'
         else 'unavailable'
       end,
       transcript_attempt_count = greatest(transcript_attempt_count, 1),
       transcript_last_attempt_at = coalesce(transcript_last_attempt_at, refetched_at, updated_at),
       transcript_next_attempt_at = case
         when transcript is null
          and coalesce(ended_at, started_at, created_at) >= now() - interval '7 days'
           then now()
         else null
       end,
       transcript_completed_at = case
         when transcript is not null and pg_catalog.btrim(transcript) <> ''
           then coalesce(transcript_completed_at, refetched_at, updated_at)
         else transcript_completed_at
       end,
       -- Historical transcripts remain evidence but do not opt themselves
       -- into a new enrichment policy at deploy time. A later provider
       -- response with genuinely different transcript text changes the hash
       -- and queues enrichment through the application.
       enrichment_status = 'not_ready';

-- The old call-lead mapper put internal call facts in the customer-authored
-- message field. Legacy rows predate reliable message provenance, so preserve
-- the exact old value internally before replacing only recognizable generated
-- text. This keeps an operator-recoverable copy even if someone manually wrote
-- something that happened to mimic the old system format.
update public.leads as lead
   set field_provenance = pg_catalog.jsonb_set(
         coalesce(lead.field_provenance, '{}'::jsonb),
         '{_legacy_customer_message}',
         pg_catalog.jsonb_build_object(
           'value', lead.message,
           'preserved_at', now()
         ),
         true
       )
 where lead.source = 'CallRail'
   and (
     (
       lead.message ilike '%Transcript is available on the CallRail call record.%'
       and lead.message ilike '%Call started:%'
       and lead.message ~* 'Duration:\s*[0-9]+s'
     )
     or (lead.message ilike 'Call started:%' and lead.message ~* 'Duration:\s*[0-9]+s')
   );

-- Real website and manually entered messages that do not match the generated
-- format are untouched.
update public.leads as lead
   set message = coalesce((
         select call.call_summary
           from public.callrail_calls as call
          where call.lead_id = lead.id
          order by coalesce(call.ended_at, call.started_at, call.created_at) desc,
                   call.id desc
          limit 1
       ), ''),
       updated_at = now()
 where lead.source = 'CallRail'
   and (
     (
       lead.message ilike '%Transcript is available on the CallRail call record.%'
       and lead.message ilike '%Call started:%'
       and lead.message ~* 'Duration:\s*[0-9]+s'
     )
     or (lead.message ilike 'Call started:%' and lead.message ~* 'Duration:\s*[0-9]+s')
   );

update public.leads
   set first_contacted_at = coalesce(first_contacted_at, created_at),
       last_contacted_at = coalesce(last_contacted_at, created_at)
 where first_contacted_at is null or last_contacted_at is null;

update public.leads as lead
   set first_contacted_at = least(
         coalesce(lead.first_contacted_at, lead.created_at),
         calls.first_call_at
       ),
       last_contacted_at = greatest(
         coalesce(lead.last_contacted_at, lead.created_at),
         calls.last_call_at
       )
  from (
    select lead_id,
           min(coalesce(started_at, created_at)) as first_call_at,
           max(coalesce(ended_at, started_at, created_at)) as last_call_at
      from public.callrail_calls
     where lead_id is not null
     group by lead_id
  ) as calls
 where lead.id = calls.lead_id;

comment on column public.contacts.field_provenance is
  'Per-field source/confidence metadata used to keep lower-trust transcript extraction from replacing trusted CRM values.';
comment on column public.callrail_calls.transcript_status is
  'Transcript availability is independent from ingest_status so a created lead can continue waiting for late CallRail transcription.';
comment on column public.callrail_calls.extracted_data is
  'Conservative structured facts derived from the raw transcript; the transcript remains the historical evidence.';
comment on column public.appointments.calendar_event_id is
  'Google Calendar event id when synced. The BrizBuilder appointment id remains the idempotency key in Google extended properties.';
