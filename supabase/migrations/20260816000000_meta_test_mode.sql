-- Test Mode for Meta conversions.
--
-- A connection starts in test mode, carrying the test event code that Meta's
-- Test Events view uses. Going live is a deliberate, one-way step that clears
-- the code, so a live connection cannot send one: production payloads omit
-- test_event_code because the column is null, not because a branch decided to
-- skip it.
--
-- Returning to test mode means disconnecting and reconnecting with a fresh
-- code. There is deliberately no transition back, so nobody can quietly move a
-- live integration into a state where real conversions stop counting.

alter table public.meta_conversion_credentials
  add column if not exists mode text not null default 'test',
  add column if not exists went_live_at timestamptz,
  add column if not exists went_live_by_email text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.meta_conversion_credentials'::regclass
      and conname = 'meta_conversion_credentials_mode_check'
  ) then
    alter table public.meta_conversion_credentials
      add constraint meta_conversion_credentials_mode_check
      check (mode in ('test', 'live'));
  end if;

  -- The database refuses to hold a contradictory state, so no bug can produce
  -- a live connection that still carries a test event code.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.meta_conversion_credentials'::regclass
      and conname = 'meta_conversion_credentials_mode_code_check'
  ) then
    alter table public.meta_conversion_credentials
      add constraint meta_conversion_credentials_mode_code_check
      check (
        (mode = 'live' and test_event_code is null)
        or (mode = 'test' and test_event_code is not null)
      );
  end if;

  -- Going live records who did it and when; test mode records neither.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.meta_conversion_credentials'::regclass
      and conname = 'meta_conversion_credentials_went_live_check'
  ) then
    alter table public.meta_conversion_credentials
      add constraint meta_conversion_credentials_went_live_check
      check (
        (mode = 'live' and went_live_at is not null and went_live_by_email is not null)
        or (mode = 'test' and went_live_at is null and went_live_by_email is null)
      );
  end if;
end
$$;

comment on column public.meta_conversion_credentials.mode is
  'test while verifying with a test event code, live once conversions should count. One-way.';
comment on column public.meta_conversion_credentials.went_live_at is
  'When this connection was switched to live. Null in test mode.';
comment on column public.meta_conversion_credentials.went_live_by_email is
  'Which admin switched this connection to live. Null in test mode.';
