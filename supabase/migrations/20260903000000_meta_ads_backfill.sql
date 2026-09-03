-- Historical Meta ad spend, fetched a chunk at a time.
--
-- A backfill cannot be one request. Ninety days of ad-level daily rows is more
-- Meta pages, more subrequests and more CPU than a Worker invocation may spend,
-- and Meta rate-limits an application rather than a caller. So the range is
-- walked in windows, each run remembers where it got to, and the scheduled tick
-- carries it forward. This table is that memory.
--
-- Nothing here stores spend. The rows land in meta_ad_insights under its
-- existing (organization, client, date, ad) key, so a window fetched twice
-- corrects itself instead of adding a second copy.

create table if not exists public.meta_ads_backfill_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_since date not null,
  requested_until date not null,
  -- The next day still to fetch. Walks forward from requested_since and is
  -- cleared when the range is done, so a resumed run never refetches a window
  -- it already stored.
  cursor_date date,
  status text not null default 'running',
  chunk_days integer not null default 7,
  days_total integer not null,
  days_done integer not null default 0,
  rows_written bigint not null default 0,
  -- Sanitized operator-facing text only, same rule as the connection row.
  last_error text,
  requested_by_email text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint meta_ads_backfill_runs_status_check
    check (status in ('running', 'completed', 'failed', 'canceled')),
  constraint meta_ads_backfill_runs_range_check
    check (requested_until >= requested_since),
  constraint meta_ads_backfill_runs_chunk_check
    check (chunk_days between 1 and 31),
  constraint meta_ads_backfill_runs_progress_check
    check (days_done >= 0 and days_done <= days_total),
  constraint meta_ads_backfill_runs_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

alter table public.meta_ads_backfill_runs enable row level security;
revoke all on table public.meta_ads_backfill_runs from anon, authenticated;

-- One active backfill per client. Two runs walking the same account would
-- spend the same rate limit twice to write rows that overwrite each other.
create unique index if not exists meta_ads_backfill_runs_active_uidx
  on public.meta_ads_backfill_runs (organization_id, client_id)
  where status = 'running';

create index if not exists meta_ads_backfill_runs_client_idx
  on public.meta_ads_backfill_runs (organization_id, client_id, started_at desc);

comment on table public.meta_ads_backfill_runs is
  'Resumable progress for historical Meta ad insight backfills. Holds no spend.';
comment on column public.meta_ads_backfill_runs.cursor_date is
  'Next day still to fetch; null once the requested range is complete.';
comment on column public.meta_ads_backfill_runs.last_error is
  'Sanitized reason only. Never store a raw provider response.';
