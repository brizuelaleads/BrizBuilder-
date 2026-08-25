-- Split rejected_payload into the cases it was hiding.
--
-- A delivery could be refused for four different reasons — an unparseable
-- body, no call id, no company id, a company that was not ours — and all four
-- were filed as 'rejected_payload'. When a real CallRail post-call webhook was
-- refused in production, the row could not say which had happened.
--
-- Three of those cases stay. The fourth is no longer a refusal at all: a
-- post-call notification carries the call object's default fields, and
-- company_id is not among them, so its absence is ordinary rather than
-- suspicious. The company is still checked, against the call refetched from
-- the API with company_id explicitly requested.
--
-- 'rejected_payload' is kept in the vocabulary. Nothing writes it any more,
-- but rows written before this migration hold it and must still read back.

alter table public.callrail_webhook_deliveries
  drop constraint if exists callrail_webhook_deliveries_outcome_check;

alter table public.callrail_webhook_deliveries
  add constraint callrail_webhook_deliveries_outcome_check
    check (
      outcome in (
        'accepted', 'duplicate', 'rejected_signature',
        'rejected_payload',
        'rejected_unparseable', 'rejected_missing_call_id',
        'rejected_company_mismatch',
        'rejected_unknown_client', 'rejected_ingest_disabled', 'failed'
      )
    );
