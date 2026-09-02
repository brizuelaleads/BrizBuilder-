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
  'Which admin switched this connection to live. Null in test mode.';;
