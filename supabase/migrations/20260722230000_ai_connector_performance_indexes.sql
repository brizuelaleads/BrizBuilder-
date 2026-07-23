-- Cover the remaining AI connector foreign-key lookups reported by the
-- Supabase performance advisor after the transactional mutation migration.

create index if not exists ai_oauth_consent_organization_idx
  on public.ai_oauth_consent_requests(organization_id);

create index if not exists ai_mutation_idempotency_org_client_idx
  on public.ai_mutation_idempotency(organization_id, client_id);
