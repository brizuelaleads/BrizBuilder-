-- Enough about a recording to offer it, and nothing that could serve it.
--
-- CallRail's `recording` field is a URL that redirects to the audio. Ingestion
-- has always written null there on purpose: the URL can expire, and on a HIPAA
-- account it points at material that must not be copied into another system's
-- database. That decision stands. What was missing was any way to know a
-- recording exists at all, so the interface could not tell "no audio" from
-- "audio we have not asked for".
--
-- These two columns are metadata, not media: a flag and a length. The audio
-- itself is fetched from CallRail per request, through a route that checks who
-- is asking, and is never stored here.

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

-- The URL column stays empty and is now documented as such, rather than being
-- dropped in the same change that explains why it was never used.
comment on column public.callrail_calls.recording_url is
  'Always null. Recording URLs expire and can be HIPAA-sensitive, so audio is '
  'fetched from CallRail per request through an authenticated route instead of '
  'being stored. See recording_available.';

comment on column public.callrail_calls.recording_available is
  'Whether CallRail reported a recording for this call at ingestion time.';

-- Serving a recording means finding one call by its CallRail id inside one
-- tenant. The existing unique key covers exactly that lookup, so no new index
-- is needed; this comment is here so the next person does not add one.
comment on column public.callrail_calls.callrail_call_id is
  'CallRail''s own call id. Unique per (organization_id, client_id), and the '
  'key the authenticated recording route resolves against.';

-- Mark the re-enquiry window deprecated. Nothing is dropped.
--
-- An open lead is now reused at any age, so this column gates nothing: no
-- code reads it to decide reuse, and no part of the interface writes it. The
-- column, its default and its bound all stay exactly as they are. Removing a
-- column is destructive and irreversible in a way a feature change should not
-- be, so it belongs in its own migration, decided on its own.
comment on column public.callrail_credentials.re_inquiry_window_days is
  'DEPRECATED. Unused since repeat callers began reusing any open lead '
  'regardless of age. Retained rather than dropped; safe to remove in a '
  'migration of its own.';
