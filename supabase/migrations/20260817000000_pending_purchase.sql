-- Pending Purchase.
--
-- A deal can be marked won before anyone types the amount, and Meta rejects a
-- Purchase with no value outright. So a won deal without a value waits, and the
-- conversion is sent once, later, when the amount is entered.
--
-- purchase_sent_at is the permanent record and the idempotency key: once set,
-- no further Purchase is ever sent for that lead, so a corrected value never
-- produces a second conversion for the same customer.
--
-- purchase_claimed_at / purchase_claim_id are a short-lived reservation, not a
-- record. They stop two concurrent saves from both sending. The claim carries a
-- unique id so a request can only ever release its own, and it expires on age
-- so a Worker that crashes or times out mid-send cannot block the lead forever.

alter table public.leads
  add column if not exists purchase_sent_at timestamptz,
  add column if not exists purchase_pending_since timestamptz,
  add column if not exists purchase_claimed_at timestamptz,
  add column if not exists purchase_claim_id text;

-- Existing won deals are historical. Stamping them closed means entering or
-- correcting a value on an old deal cannot fire a conversion for something that
-- closed weeks ago — which Meta would reject anyway, since it refuses events
-- older than seven days.
update public.leads
set purchase_sent_at = updated_at
where status = 'WON'
  and purchase_sent_at is null;

-- Constraints come after the backfill so the existing rows already satisfy them.
do $$
begin
  -- A reservation is meaningless without knowing who holds it, and an owner
  -- without a timestamp could never expire. The pair moves together or not at
  -- all, so a half-written claim cannot exist at rest.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.leads'::regclass
      and conname = 'leads_purchase_claim_pair_check'
  ) then
    alter table public.leads
      add constraint leads_purchase_claim_pair_check
      check (
        (purchase_claimed_at is null and purchase_claim_id is null)
        or (purchase_claimed_at is not null and purchase_claim_id is not null)
      );
  end if;

  -- Once a Purchase is recorded, the lead is no longer waiting for one. Holding
  -- both would leave a reported deal looking permanently pending.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.leads'::regclass
      and conname = 'leads_purchase_sent_not_pending_check'
  ) then
    alter table public.leads
      add constraint leads_purchase_sent_not_pending_check
      check (purchase_sent_at is null or purchase_pending_since is null);
  end if;
end
$$;

-- Finding the leads still waiting on an amount, without scanning the table.
create index if not exists leads_purchase_pending_idx
  on public.leads (organization_id, client_id)
  where status = 'WON' and purchase_sent_at is null;

comment on column public.leads.purchase_sent_at is
  'When a Purchase conversion was confirmed recorded by Meta. Set only after events_received = 1. Once set, never send again.';
comment on column public.leads.purchase_pending_since is
  'When this won deal started waiting for a value. Cleared implicitly once purchase_sent_at is set.';
comment on column public.leads.purchase_claimed_at is
  'Start of a short-lived send reservation. Expires by age so a crashed request cannot block the lead.';
comment on column public.leads.purchase_claim_id is
  'Unique id of the request holding the reservation, so a request can only release its own claim.';
