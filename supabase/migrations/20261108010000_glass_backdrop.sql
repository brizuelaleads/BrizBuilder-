-- Per-user backdrop (and its blur) behind the Glass theme. Same table and access model as the
-- theme: service-role only, written through the CRM action API.
alter table public.user_preferences
  add column if not exists backdrop text not null default 'red';

alter table public.user_preferences
  drop constraint if exists user_preferences_backdrop_check;

alter table public.user_preferences
  add constraint user_preferences_backdrop_check
  check (backdrop in ('red', 'chrome', 'halftone', 'eyes', 'silk', 'red-halftone', 'pink-swirl'));

alter table public.user_preferences
  add column if not exists backdrop_blur text not null default 'none';

alter table public.user_preferences
  drop constraint if exists user_preferences_backdrop_blur_check;

alter table public.user_preferences
  add constraint user_preferences_backdrop_blur_check
  check (backdrop_blur in ('none', 'soft', 'strong'));
