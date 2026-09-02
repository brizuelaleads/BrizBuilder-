-- Account/security email tokens. Raw tokens are only sent to the user's email;
-- the database stores SHA-256 hashes plus expiry and single-use state.

create table if not exists public.invite_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by_email text not null check (created_by_email = lower(created_by_email)),
  created_at timestamptz not null default now()
);

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  email text not null check (email = lower(email)),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  email text not null check (email = lower(email)),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists invite_tokens_profile_active_idx
  on public.invite_tokens(profile_id, expires_at)
  where used_at is null;

create index if not exists password_reset_tokens_profile_active_idx
  on public.password_reset_tokens(profile_id, expires_at)
  where used_at is null;

create index if not exists email_verification_tokens_profile_active_idx
  on public.email_verification_tokens(profile_id, expires_at)
  where used_at is null;

alter table public.invite_tokens enable row level security;
alter table public.password_reset_tokens enable row level security;
alter table public.email_verification_tokens enable row level security;

revoke all on table public.invite_tokens from public, anon, authenticated;
revoke all on table public.password_reset_tokens from public, anon, authenticated;
revoke all on table public.email_verification_tokens from public, anon, authenticated;

comment on table public.invite_tokens is
  'Server-only invite token hashes for transactional account email links.';
comment on table public.password_reset_tokens is
  'Server-only password reset token hashes for transactional account email links.';
comment on table public.email_verification_tokens is
  'Server-only email verification token hashes for transactional account email links.';

;
