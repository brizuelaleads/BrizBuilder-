alter table public.leads
  add column if not exists purchase_sent_at timestamptz,
  add column if not exists purchase_pending_since timestamptz,
  add column if not exists purchase_claimed_at timestamptz,
  add column if not exists purchase_claim_id text;

update public.leads
set purchase_sent_at = updated_at
where status = 'WON'
  and purchase_sent_at is null;

do $$
begin
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

create index if not exists leads_purchase_pending_idx
  on public.leads (organization_id, client_id)
  where status = 'WON' and purchase_sent_at is null;

comment on column public.leads.purchase_sent_at is
  'When a Purchase conversion was confirmed recorded by Meta. Set only after events_received = 1. Once set, never send again.';
comment on column public.leads.purchase_pending_since is
  'When this won deal started waiting for a value. Cleared in the same write that records the Purchase as sent.';
comment on column public.leads.purchase_claimed_at is
  'Start of a short-lived send reservation. Expires by age so a crashed request cannot block the lead.';
comment on column public.leads.purchase_claim_id is
  'Unique id of the request holding the reservation, so a request can only release its own claim.';;
