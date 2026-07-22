-- Cover every Reviews workspace foreign key so parent updates and deletes stay
-- predictable as an agency grows. The tenant-scoped indexes also support the
-- authorization filters used by the Worker on every request.

create index if not exists review_settings_client_id_idx
  on public.review_settings(client_id);

create index if not exists review_consents_client_id_idx
  on public.contact_message_consents(client_id);
create index if not exists review_consents_contact_id_idx
  on public.contact_message_consents(contact_id);

create index if not exists review_requests_contact_id_idx
  on public.review_requests(contact_id);
create index if not exists review_requests_tenant_contact_idx
  on public.review_requests(organization_id, client_id, contact_id);
create index if not exists review_requests_tenant_consent_idx
  on public.review_requests(organization_id, client_id, consent_id);
create index if not exists review_requests_tenant_message_idx
  on public.review_requests(organization_id, client_id, message_id);
