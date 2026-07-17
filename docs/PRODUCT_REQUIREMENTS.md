# BrizBuilder Product Requirements

## Product definition

BrizBuilder is a white-label operating platform for marketing agencies and their service-business clients. The product should eventually combine CRM, communication, automation, lead capture, web publishing, payments, reputation, content, AI, SaaS billing, and developer tools in a tenant-safe system.

The delivery strategy is deliberately incremental. Production modules must persist data, enforce permissions on the server, handle loading/empty/error states, create an audit trail where required, and have proportional automated test coverage. Future modules may be visible as clearly labeled, read-only UI previews for product planning; every preview must state that live actions and providers are unavailable. Persisted feature flags continue to control real capability access.

## Users and tenant model

- **Agency owner**: full organization administration, clients, users, audit data, and CRM data.
- **Agency admin**: operational administration without ownership transfer authority.
- **Agency member**: agency-wide CRM work within assigned permissions.
- **Client admin**: administration and CRM work within one client subaccount.
- **Client manager**: operational CRM work within one client subaccount.
- **Client member**: limited day-to-day CRM work within one client subaccount.
- **Client viewer**: read-only access within one client subaccount.

An organization owns every record. Client-level records also carry a client identifier. The server derives both scopes from the authenticated membership; it never trusts a client or organization identifier supplied by the browser. A client user must not discover, read, search, export, update, or infer another client's data.

## Phase 1: CRM foundation

Phase 1 is an MVP-complete, durable foundation consisting of:

- Authentication and protected routes.
- Organizations, agency memberships, client subaccounts, and client memberships.
- Seven roles with explicit server-side permissions.
- Agency/client dashboard with filtered CRM metrics.
- Contacts with search, create, CSV import, CSV export, and duplicate handling.
- Companies and contact-to-company relationships.
- Configurable custom field definitions and persisted record values for contacts, companies, and opportunities.
- Reusable custom values with allowlisted template substitution.
- Pipeline stages, opportunities, assignment, value, status, history, and Kanban movement.
- Tasks, notes, appointments, activity timeline, and attribution reports.
- Agency audit-log viewer and immutable mutation records.
- Persisted feature flags and a domain-event outbox for future modules.
- D1 schema, generated migrations, clean baseline initialization, and integration tests.

The current `crm_leads` aggregate is the Phase 1 opportunity record. That name is retained to avoid a destructive migration; application language uses **opportunity** where a deal has entered a pipeline.

## Phase 1 acceptance criteria

A Phase 1 release is acceptable when all of the following are true:

1. An anonymous request cannot access the application API.
2. Hosted access uses dispatch-owned authentication; development credentials work only on localhost and never in production.
3. Every read and mutation is organization-scoped, and client members are additionally restricted to their assigned client.
4. Role permissions are enforced in the service layer, not only hidden in the UI.
5. CRM changes survive refresh and produce audit records.
6. Company links, custom fields, custom values, CSV import, and feature flags use durable D1 storage.
7. Duplicate imports do not create duplicate contacts within a client subaccount.
8. The interface has useful loading, empty, validation, error, confirmation, and mobile states.
9. Navigation clearly distinguishes working modules from UI previews, and preview screens cannot perform unavailable external actions.
10. Lint, strict TypeScript checking, production build, and the D1 integration test pass.

## Product-wide quality requirements

- WCAG-oriented keyboard navigation, visible focus, semantic controls, sufficient contrast, and responsive layouts.
- Server-side validation and authorization for all writes.
- Same-origin protection for cookie-authenticated mutations.
- Bounded request bodies, imports, and text fields.
- Idempotent webhook and background-job design for integrations.
- No secrets in source control or browser bundles.
- Auditability for security-sensitive and business-critical changes.
- Provider-independent domain records so integrations can be replaced.
- Feature gates evaluated on the server before protected capability use.
- Data export/deletion and retention workflows before regulated or high-risk modules launch.

## Out of scope for Phase 1

The following remain gated from live use until their phase-level acceptance criteria are met: live email/SMS/calling, conversations, advanced calendars, workflow automation, public forms and surveys, website/funnel publishing, commerce and payments, reputation and social publishing, courses/communities, production AI agents, agency SaaS billing, OAuth applications, public API keys, and a third-party marketplace. Selected modules can still appear as explicitly labeled design previews.

## Success measures

Phase 1 success is measured with operational outcomes rather than screen count:

- zero known cross-tenant data paths;
- successful first-client setup without database intervention;
- contact import success and duplicate rate visibility;
- opportunity stage/value accuracy;
- task and appointment completion visibility;
- audit coverage for all supported mutations;
- fast, usable layouts on phone and desktop;
- reliable migration and release verification.

Future phases add their own provider delivery, consent, compliance, observability, cost, and support metrics before rollout.
