-- Per-user UI preferences (theme). Keyed by the Cloudflare Access email so it
-- works for every identity, including the main admin who has no profiles row.
-- Service-role only, like credential tables: all reads and writes go through
-- the Worker using the authenticated context email.

create table if not exists public.user_preferences (
  email text primary key check (email = lower(email)),
  theme text not null default 'classic'
    check (theme in ('classic', 'cyberpunk', 'midnight')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
revoke all on table public.user_preferences from anon, authenticated;

comment on table public.user_preferences is
  'Server-only per-user UI preferences; writes go through the CRM action API using the authenticated context email.';
