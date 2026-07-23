-- Cover every OAuth foreign-key lookup used for grant validation, rotation,
-- revocation, and cleanup. Token/code hashes already have unique indexes.

create index if not exists ai_authorizations_oauth_client_idx
  on public.ai_authorizations(oauth_client_id);
create index if not exists ai_oauth_consent_client_idx
  on public.ai_oauth_consent_requests(oauth_client_id);
create index if not exists ai_oauth_codes_authorization_idx
  on public.ai_oauth_authorization_codes(authorization_id);
create index if not exists ai_oauth_codes_client_idx
  on public.ai_oauth_authorization_codes(oauth_client_id);
create index if not exists ai_oauth_access_authorization_idx
  on public.ai_oauth_access_tokens(authorization_id);
create index if not exists ai_oauth_access_client_idx
  on public.ai_oauth_access_tokens(oauth_client_id);
create index if not exists ai_oauth_refresh_authorization_idx
  on public.ai_oauth_refresh_tokens(authorization_id);
create index if not exists ai_oauth_refresh_client_idx
  on public.ai_oauth_refresh_tokens(oauth_client_id);
create index if not exists ai_oauth_refresh_replacement_idx
  on public.ai_oauth_refresh_tokens(replacement_token_id)
  where replacement_token_id is not null;
