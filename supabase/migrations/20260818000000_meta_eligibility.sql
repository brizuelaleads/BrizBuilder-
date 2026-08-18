-- Meta attribution eligibility, decided once at capture and immutable after.
--
-- The lead capture endpoint is public and unauthenticated, so every submitted
-- field is caller-controlled. Only a Meta-issued click id survives that: Meta
-- validates it on receipt, so a forged one becomes an unmatched conversion
-- rather than credit against a real campaign. A utm_source or a "source: Meta"
-- label has no such backstop, and treating either as proof would let anyone
-- manufacture conversions in a customer's ad account.
--
-- Defaulting to false means every other path into this table — manual entry,
-- imports, integrations — is ineligible unless it proves otherwise.

alter table public.leads
  add column if not exists meta_eligible boolean not null default false,
  add column if not exists meta_eligibility_reason text;

-- Conservative backfill: only stored evidence of a well-formed click id
-- promotes a row. Everything else is recorded as having no evidence.
update public.leads
set meta_eligible = true,
    meta_eligibility_reason = 'meta_fbclid'
where meta_eligible = false
  and attribution->>'fbclid' ~ '^[A-Za-z0-9_-]{16,512}$';

update public.leads
set meta_eligibility_reason = 'backfill_no_evidence'
where meta_eligible = false
  and meta_eligibility_reason is null;

do $$
begin
  -- A closed vocabulary, so a reason can never drift into free text.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.leads'::regclass
      and conname = 'leads_meta_eligibility_reason_check'
  ) then
    alter table public.leads
      add constraint leads_meta_eligibility_reason_check
      check (
        meta_eligibility_reason is null
        or meta_eligibility_reason in (
          'meta_fbclid', 'invalid_fbclid', 'client_supplied_fbc', 'fbp_only',
          'utm_only', 'unverified_label', 'no_meta_attribution',
          'backfill_no_evidence'
        )
      );
  end if;

  -- Eligibility is only ever granted by one reason, so an eligible row cannot
  -- exist without the evidence that justified it.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.leads'::regclass
      and conname = 'leads_meta_eligible_reason_check'
  ) then
    alter table public.leads
      add constraint leads_meta_eligible_reason_check
      check (
        meta_eligible = false
        or meta_eligibility_reason = 'meta_fbclid'
      );
  end if;
end
$$;

-- Attribution is decided at capture from server-derived evidence. Nothing
-- later — an admin edit, an import, a future code path — may revise it, so the
-- database refuses the change rather than trusting every caller to behave.
create or replace function public.reject_meta_eligibility_change()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'meta eligibility is immutable: decided at capture and cannot be changed';
end;
$$;

drop trigger if exists leads_meta_eligibility_immutable on public.leads;
create trigger leads_meta_eligibility_immutable
  before update on public.leads
  for each row
  when (
    old.meta_eligible is distinct from new.meta_eligible
    or old.meta_eligibility_reason is distinct from new.meta_eligibility_reason
  )
  execute function public.reject_meta_eligibility_change();

comment on column public.leads.meta_eligible is
  'Whether this lead may ever be reported to Meta. Decided at capture from a validated fbclid, immutable after.';
comment on column public.leads.meta_eligibility_reason is
  'Closed-vocabulary explanation of the eligibility decision, for diagnosis.';
