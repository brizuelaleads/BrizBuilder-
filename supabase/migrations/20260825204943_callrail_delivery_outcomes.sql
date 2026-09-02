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
    );;
