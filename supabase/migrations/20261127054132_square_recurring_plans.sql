-- Recurring Square billing.
--
-- A recurring plan is a saved invoice plus a schedule. On each billing day the
-- Worker's cron creates and sends an ordinary Square invoice from it, so the
-- customer pays by link exactly as with a one-off invoice; no card is stored
-- and no new Square permission is needed.
--
-- Server-only, like the other Square tables: RLS on, no policies, and every
-- grant to anon/authenticated revoked.

create table if not exists public.square_recurring_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The business that bills; null when the agency bills its own clients.
  client_id uuid references public.clients(id) on delete cascade,
  -- Agency plans only: the client business being billed.
  billed_client_id uuid references public.clients(id) on delete set null,
  -- Client plans only: the contact being billed.
  contact_id uuid references public.contacts(id) on delete set null,
  recipient_name text not null,
  recipient_email text not null,
  title text not null,
  message text,
  line_items jsonb not null,
  amount_cents bigint not null,
  frequency text not null,
  -- Day of the month the plan bills on (monthly and longer). Kept separately so
  -- a plan on the 31st returns to the 31st after a shorter month.
  anchor_day smallint not null,
  due_in_days smallint not null default 14,
  status text not null default 'active',
  -- The next billing day. Null once a plan has ended.
  next_run_on date,
  end_after_count integer,
  invoices_created integer not null default 0,
  last_run_at timestamptz,
  last_invoice_id uuid references public.square_invoices(id) on delete set null,
  last_error text,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint square_recurring_plans_frequency_check
    check (frequency in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  constraint square_recurring_plans_status_check
    check (status in ('active', 'paused', 'ended')),
  constraint square_recurring_plans_anchor_check
    check (anchor_day between 1 and 31),
  constraint square_recurring_plans_due_check
    check (due_in_days between 0 and 90),
  constraint square_recurring_plans_end_check
    check (end_after_count is null or end_after_count between 1 and 500),
  constraint square_recurring_plans_amount_check
    check (amount_cents > 0),
  constraint square_recurring_plans_line_items_check
    check (jsonb_typeof(line_items) = 'array'),
  constraint square_recurring_plans_next_run_check
    check ((status = 'ended') = (next_run_on is null)),
  constraint square_recurring_plans_recipient_scope_check
    check (
      (client_id is null and contact_id is null)
      or (client_id is not null and billed_client_id is null)
    ),
  constraint square_recurring_plans_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

create index if not exists square_recurring_plans_due_idx
  on public.square_recurring_plans(next_run_on)
  where status = 'active';
create index if not exists square_recurring_plans_scope_idx
  on public.square_recurring_plans(organization_id, client_id, created_at desc);

-- Each invoice a plan creates records the billing day it covers. The unique
-- index is what stops two overlapping cron runs from billing a period twice.
alter table public.square_invoices
  add column if not exists recurring_plan_id uuid
    references public.square_recurring_plans(id) on delete set null,
  add column if not exists recurring_period date;
create unique index if not exists square_invoices_recurring_period_uidx
  on public.square_invoices(recurring_plan_id, recurring_period)
  where recurring_plan_id is not null;

alter table public.square_recurring_plans enable row level security;
revoke all on table public.square_recurring_plans from anon, authenticated;

comment on table public.square_recurring_plans is
  'Saved invoices that the Worker cron sends through the business''s own Square account on a schedule. No card data.';
