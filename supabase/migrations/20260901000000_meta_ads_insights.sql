-- Meta Ads reporting.
--
-- Separate from meta_conversion_credentials on purpose. Conversions and
-- Marketing are different Meta permissions: a dataset-scoped Conversions token
-- cannot read an ad account, and an ads_read token has no business posting
-- conversions. Two connections, two tokens, either one usable without the
-- other.

create table if not exists public.meta_ads_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  ad_account_id text not null,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  account_name text,
  currency text,
  connected_by_email text not null,
  -- Claimed by the scheduled sync before it calls Meta, so two isolates on the
  -- same tick cannot both spend this client's rate limit. Cleared on finish.
  sync_started_at timestamptz,
  last_sync_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id),
  constraint meta_ads_credentials_ad_account_id_check
    check (ad_account_id ~ '^act_[0-9]{1,32}$'),
  constraint meta_ads_credentials_currency_check
    check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint meta_ads_credentials_last_status_check
    check (last_status is null or last_status in ('ok', 'unauthorized', 'rate_limited', 'error')),
  constraint meta_ads_credentials_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

alter table public.meta_ads_credentials enable row level security;
revoke all on table public.meta_ads_credentials from anon, authenticated;

-- One row per ad per day. Every rollup the product shows -- by campaign, by
-- month, by client -- is an aggregate over this table, so Meta is asked once
-- per client per sync rather than once per campaign.
create table if not exists public.meta_ad_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  date_start date not null,
  campaign_id text not null,
  campaign_name text not null default '',
  adset_id text not null default '',
  ad_id text not null,
  ad_name text not null default '',
  spend_cents bigint not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  synced_at timestamptz not null default now(),
  -- Meta restates the last few days after the fact, so the sync re-fetches a
  -- rolling window and upserts onto this key. Correction is the normal path,
  -- not an error path.
  unique (organization_id, client_id, date_start, ad_id),
  constraint meta_ad_insights_spend_cents_check check (spend_cents >= 0),
  constraint meta_ad_insights_impressions_check check (impressions >= 0),
  constraint meta_ad_insights_clicks_check check (clicks >= 0),
  constraint meta_ad_insights_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

alter table public.meta_ad_insights enable row level security;
revoke all on table public.meta_ad_insights from anon, authenticated;

create index if not exists meta_ad_insights_client_date_idx
  on public.meta_ad_insights (organization_id, client_id, date_start desc);
create index if not exists meta_ad_insights_campaign_idx
  on public.meta_ad_insights (organization_id, client_id, campaign_id);

-- The join from a lead back to the ad that produced it. utm_campaign carries
-- the campaign id because Meta substitutes {{campaign.id}} into the ad's URL
-- parameters at click time; there is no lookup from fbclid to a campaign, so
-- this label is the only durable link. Names are read from meta_ad_insights so
-- renaming a campaign in Ads Manager never orphans a lead.
create index if not exists leads_attribution_campaign_idx
  on public.leads ((attribution ->> 'utm_campaign'))
  where attribution ->> 'utm_campaign' is not null;

comment on table public.meta_ads_credentials is
  'Server-only encrypted Meta Marketing API (ads_read) tokens, one per client.';
comment on column public.meta_ads_credentials.access_token_ciphertext is
  'AES-256-GCM ciphertext; the encryption key is stored only in Cloudflare secrets.';
comment on column public.meta_ads_credentials.sync_started_at is
  'Set when the scheduled sync claims this client; cleared when it finishes.';
comment on column public.meta_ads_credentials.last_error is
  'Sanitized operator-facing reason only. Never store a raw provider response.';
comment on table public.meta_ad_insights is
  'Daily per-ad spend and delivery pulled from the Meta Marketing API.';
comment on column public.meta_ad_insights.spend_cents is
  'Spend in the ad account currency, minor units, matching the cents convention elsewhere.';
