alter table public.callrail_calls
  add column if not exists recording_available boolean not null default false;

alter table public.callrail_calls
  add column if not exists recording_duration_seconds integer;

alter table public.callrail_calls
  drop constraint if exists callrail_calls_recording_duration_check;

alter table public.callrail_calls
  add constraint callrail_calls_recording_duration_check
    check (
      recording_duration_seconds is null
      or (recording_duration_seconds >= 0 and recording_duration_seconds <= 86400)
    );

comment on column public.callrail_calls.recording_url is
  'Always null. Recording URLs expire and can be HIPAA-sensitive, so audio is '
  'fetched from CallRail per request through an authenticated route instead of '
  'being stored. See recording_available.';

comment on column public.callrail_calls.recording_available is
  'Whether CallRail reported a recording for this call at ingestion time.';

comment on column public.callrail_calls.callrail_call_id is
  'CallRail''s own call id. Unique per (organization_id, client_id), and the '
  'key the authenticated recording route resolves against.';

comment on column public.callrail_credentials.re_inquiry_window_days is
  'DEPRECATED. Unused since repeat callers began reusing any open lead '
  'regardless of age. Retained rather than dropped; safe to remove in a '
  'migration of its own.';;
