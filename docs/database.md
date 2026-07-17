# Phase 1 database design

## Tenant and identity model

- `accounts`: existing authenticated identities and coarse legacy access
- `organizations`: agency tenants
- `organization_members`: agency membership with `SUPER_ADMIN`, `AGENCY_OWNER`, `AGENCY_ADMIN`, or `AGENCY_MEMBER`
- `crm_clients`: service-business clients owned by one organization
- `client_members`: client membership with `CLIENT_OWNER`, `CLIENT_MANAGER`, or `CLIENT_EMPLOYEE`

Every Phase 1 business table includes `organization_id`. Client-owned records also include `client_id`. Client-session queries require both values.

## CRM model

- `contacts`: deduplicated customer identities, consent, tags, and lifetime value
- `pipelines` and `pipeline_stages`: ordered sales process
- `crm_leads`: inquiry, attribution, stage, score, value, revenue, assignment, and follow-up state
- `lead_stage_history`: durable pipeline movement history
- `crm_notes`: internal notes connected to leads and contacts
- `activities`: chronological lead activity events
- `tasks`: prioritized follow-up work
- `appointments`: scheduled service visits and status
- `audit_logs`: actor, action, record, metadata, and timestamp

The earlier `clients`, `leads`, and `audit_events` tables remain for backward compatibility with previously assigned portal accounts. New CRM records use the `crm_` ownership model.

## Indexing and integrity

Indexes cover organization/client/date lead filters, organization/stage and organization/status lead filters, contact phone/email matching, pipeline order, task status/due date, appointment time, activity timelines, membership lookup, and audit time.

Foreign keys prevent cross-table orphaning. Leads and contacts use soft deletion. Pipeline stages referenced by leads are restricted from deletion. Financial values are stored as integer cents.

## Migration

`drizzle/0002_curly_post.sql` adds the Phase 1 tables and indexes without deleting the legacy access tables. Generate later migrations with `npm run db:generate` and inspect the SQL before deployment.

## Baseline initialization strategy

Runtime initialization uses stable IDs and `INSERT OR IGNORE` for required platform records only: the agency organization, the main admin membership, feature flags, and the default pipeline stages. It does not create fake clients, contacts, leads, appointments, companies, tasks, or revenue.
