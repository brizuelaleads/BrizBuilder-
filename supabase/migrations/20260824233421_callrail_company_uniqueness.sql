-- One CallRail company may serve exactly one BrizBuilder client.
--
-- Two clients pointing at the same company would ingest the same calls twice
-- once webhooks are live: duplicate contacts, duplicate leads, duplicate
-- interactions, and — for a Meta-eligible call — two conversions reported for
-- one phone call. Nothing downstream can repair that, because both copies are
-- individually legitimate. The database refuses the arrangement rather than
-- relying on every present and future code path to remember to check.
--
-- Scoped to the organization rather than globally. Within a tenant this is the
-- real risk and the constraint is enforceable without surprise. Across tenants
-- a global constraint would leak the existence of another organization's
-- connection through a failed insert, which is a worse trade than the case it
-- guards.
--
-- A partial index rather than a table constraint, so the exemption is explicit:
-- a setup that has not chosen a company yet holds NULL and is not constrained.
-- Any number of half-finished setups can coexist; only a chosen company is
-- claimed.
--
-- This is uniqueness across *active* connections without needing a status
-- column: disconnecting deletes the credential row outright, so a row existing
-- at all is what "active" means here.
create unique index if not exists callrail_credentials_company_unique_idx
  on public.callrail_credentials (organization_id, company_id)
  where company_id is not null;

comment on index public.callrail_credentials_company_unique_idx is
  'One CallRail company serves one client. Prevents duplicate call ingestion.';;
