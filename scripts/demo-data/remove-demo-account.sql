-- Removes the BrizBuilder DEMO sub-account ("DEMO — Summit Roofing Co") and
-- everything seeded under it. Touches nothing else: every statement is pinned
-- to the one demo client id.
do $$
declare
  cid uuid := md5('brizbuilder-demo:client')::uuid;
begin
  delete from public.form_submissions where client_id = cid;
  delete from public.forms where client_id = cid;
  delete from public.website_pages where client_id = cid;
  delete from public.websites where client_id = cid;
  delete from public.review_requests where client_id = cid;
  delete from public.contact_message_consents where client_id = cid;
  delete from public.review_settings where client_id = cid;
  delete from public.messages where client_id = cid;
  delete from public.conversations where client_id = cid;
  delete from public.phone_calls where client_id = cid;
  delete from public.workflow_runs where client_id = cid;
  delete from public.workflow_versions where client_id = cid;
  delete from public.workflows where client_id = cid;
  delete from public.meta_ad_insights where client_id = cid;
  delete from public.tasks where client_id = cid;
  delete from public.notes where client_id = cid;
  delete from public.appointments where client_id = cid;
  delete from public.leads where client_id = cid;
  delete from public.contacts where client_id = cid;
  delete from public.companies where client_id = cid;
  delete from public.client_branding where client_id = cid;
  delete from public.square_invoices where client_id = cid;
  delete from public.square_connections where client_id = cid;
  delete from public.clients where id = cid;
end
$$;
