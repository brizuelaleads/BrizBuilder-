-- Allow the Glass CRM theme. The original inline check was unnamed, so Postgres
-- named it user_preferences_theme_check; replace it with the widened list.
alter table public.user_preferences
  drop constraint if exists user_preferences_theme_check;

alter table public.user_preferences
  add constraint user_preferences_theme_check
  check (theme in ('classic', 'cyberpunk', 'midnight', 'glass'));
