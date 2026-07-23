# BrizBuilder

BrizBuilder is a multi-tenant agency operating platform. This repository delivers its Phase 1 CRM foundation: organizations, client subaccounts, contacts, companies, custom data, opportunities, tasks, appointments, reports, and audit controls.

Phase 1 is implemented as a production-quality MVP. Records are stored in Cloudflare D1, hosted identity is provided by Cloudflare Access and cryptographically verified again by the Worker, and every CRM query is scoped on the server to an authorized organization and, for client users, a single client.

## Current architecture

- Vinext / Next.js App Router, React 19, and TypeScript strict mode
- Cloudflare Worker deployment target
- Cloudflare D1 with Drizzle schema and generated migrations
- Cloudflare Access application JWT authentication with origin-side signature, issuer, audience, algorithm, and expiry verification
- Independent administrator cookie-session fallback backed by Cloudflare secrets
- Server-rendered tenant snapshot with a focused `/api/crm` action API
- Responsive custom component system in `app/globals.css`
- Miniflare integration tests using a real local D1 binding

Canonical product documentation:

- [Product requirements](docs/PRODUCT_REQUIREMENTS.md)
- [Feature parity matrix](docs/FEATURE_PARITY_MATRIX.md)
- [Architecture decisions](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [Integration strategy](docs/INTEGRATIONS.md)
- [Roadmap](docs/ROADMAP.md)
- [Database implementation](docs/database.md)

## Prerequisites

- Node.js 22.13 or newer
- npm

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Supabase backend setup

Supabase support has been added as the production backend foundation. The app now has:

- Supabase SDK installed
- server-side Supabase helpers
- `/api/supabase/status` connection check
- baseline SQL snapshot at `supabase/schema.sql` plus ordered production migrations in `supabase/migrations`
- row-level security policies so client accounts cannot see other clients' data
- storage buckets for assets, website photos, and imports

To connect your Supabase project:

1. Open Supabase > SQL Editor.
2. Paste and run `supabase/schema.sql`.
3. Then paste and run these files one at a time, in this exact order:

```txt
supabase/migrations/20260718170000_phone_system.sql
supabase/migrations/20260718210000_connections_and_visual_workflows.sql
supabase/migrations/20260721170000_remove_stored_twilio_balances.sql
supabase/migrations/20260721190000_google_business_profiles.sql
supabase/migrations/20260722040000_google_business_oauth_credentials.sql
supabase/migrations/20260722130000_reviews_workspace.sql
supabase/migrations/20260722143000_reviews_workspace_indexes.sql
supabase/migrations/20260722200000_ai_connector.sql
supabase/migrations/20260722210000_ai_connector_indexes.sql
supabase/migrations/20260722220000_ai_connector_transactional_mutations.sql
supabase/migrations/20260722230000_ai_connector_performance_indexes.sql
```

`supabase/schema.sql` is the same baseline as
`20260717150000_brizbuilder_initial_schema.sql`, so do not run both on a fresh
database. The dated migrations are authoritative for every change after that
baseline. If you use the Supabase CLI instead, apply the complete
`supabase/migrations` directory to an empty database and skip `schema.sql`.

4. Add these environment variables in Cloudflare/Vercel:

```txt
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
BRIZBUILDER_BACKEND=supabase
BRIZBUILDER_PUBLIC_ORIGIN=https://brizbuilder.brizuelaleads.workers.dev
```

Do not put the real `SUPABASE_SERVICE_ROLE_KEY` in GitHub. After deploying, open `/api/supabase/status` to confirm the backend is connected.

Copy `.env.example` to `.env.local`, then set `MAIN_ADMIN_EMAIL`, `MAIN_ADMIN_NAME`, `LOCAL_DEV_ADMIN_PASSWORD`, and a long random `LOCAL_DEV_SESSION_TOKEN`. Restart the development server after changing them. The `.env.local` file is intentionally excluded from Git. The same administrator fallback can remain available on the hosted Worker when those values are stored as Cloudflare secrets.

## Production authentication

The dashboard is protected by Cloudflare Access. Add these two runtime variables
to the production Worker:

```txt
TEAM_DOMAIN=https://your-team-name.cloudflareaccess.com
POLICY_AUD=your-application-audience-aud-tag
```

Find the team domain under **Zero Trust > Settings**. Find the AUD tag under
**Zero Trust > Access controls > Applications > BrizBuilder > Additional
settings**. Access sends the application token in `Cf-Access-Jwt-Assertion`;
BrizBuilder verifies its RS256 signature against Cloudflare's remote JWKS and
also verifies the exact issuer, audience, required identity claims, and token
time limits before using the email address.

Unsigned identity headers are ignored. The `BRIZBUILDER_TEST_AUTH_*` variables
exist only for the Miniflare integration suite and must never be configured on
the production Worker.

## Database and migrations

The logical D1 binding is declared as `DB` in `.openai/hosting.json`.

Supabase/Postgres changes live in `supabase/migrations` and must be applied in
filename order. `supabase/schema.sql` is only the baseline snapshot; a fresh
manual SQL Editor setup is not current until the later migrations listed above
have also run. These migrations create the Google Business Profile connection,
protected Google OAuth credentials, and tenant-scoped review request settings,
consent evidence, and delivery history.

Generate a migration after changing `db/schema.ts`:

```bash
npm run db:generate
```

Phase 1 uses ordered migrations through `drizzle/0003_unusual_midnight.sql`. Sites packages migrations under `.openai/drizzle` during deployment. Local development also initializes missing tables safely with `CREATE TABLE IF NOT EXISTS` so a new workspace can run immediately.

## Clean workspace initialization

The first CRM request safely initializes the Brizuela Leads organization, the main admin membership, feature flags, and the default pipeline stages. It does not create fake clients, contacts, leads, appointments, tasks, companies, or revenue.

Baseline inserts use stable IDs and `INSERT OR IGNORE`, so user changes are not overwritten on later requests.

## Testing

```bash
npm run lint
npm run typecheck
npm test
```

The integration suite builds the Worker and verifies:

- anonymous API rejection
- authenticated agency-owner access
- same-origin write protection
- lead creation and validation
- pipeline movement and stage history
- company creation and contact relationships
- duplicate-safe contact CSV import
- custom field definitions and persisted record values
- reusable custom values and feature flags
- audit visibility and domain-event outbox writes
- client-level tenant isolation
- client role restrictions

Run the deployment build by itself with:

```bash
npm run build
```

## Phase 1 features

- Protected agency and client workspaces
- Organization membership and seven-role data model
- Client management and archive flow
- Team access assignment for agency admins and members
- Agency and client-filtered dashboard
- Lead inbox with search, filters, CSV export, creation, updates, archive, and lead detail drawer
- Contact database with CSV import/export and duplicate handling
- Companies and contact-to-company relationships
- Typed custom fields for contacts, companies, and opportunities
- Reusable custom values with safe token substitution
- Drag-and-drop Kanban pipeline with an accessible stage selector and durable history
- Lead timeline, notes, assignments, values, scores, consent, and follow-up fields
- Task creation and completion
- Appointment creation and status management
- Basic CRM and attribution reports with print/PDF-ready layout
- Command-menu global search
- Mobile, tablet, keyboard, empty, loading, error, and disabled-feature states
- Audit records for important mutations
- Agency audit-log viewer, persisted feature flags, and domain-event outbox
- Connected website management for WordPress, Wix, Squarespace, Webflow, Shopify, and custom sites
- Public website lead-capture gateway that creates tenant-scoped contacts and pipeline leads
- Copy-ready webhook URL and JavaScript integration instructions for every connected site
- Navigable UI previews for conversations, automations, forms, funnels, and payments
- Secure AI Connector for compatible AI subscriptions, with explicit business and permission consent, short-lived OAuth access, revocation, and sanitized audit history
- A real Reviews workspace with per-business settings, honest empty states, Google review-link copy/QR tools, and manual SMS request history

### Reviews workspace

- The copy button and QR code use the selected business's official Google review
  link. Connect or configure that Google Business Profile before sharing them.
- A manual SMS review request is available only after that business has a
  connected Twilio account, an approved A2P registration, and explicit consent
  from the selected contact for this review-request message.
- BrizBuilder records its own request status and delivery history. It does not
  claim that an SMS recipient later posted a particular Google review.
- The Google review inbox and reply controls remain unavailable until Google
  approves BrizBuilder for Business Profile API access. After approval, Google
  reviews are loaded on demand and are not permanently copied into BrizBuilder's
  database.
- Empty accounts stay empty: BrizBuilder does not create sample ratings, fake
  reviews, or made-up review totals.

### AI Connector

- Customers add BrizBuilder as a custom connector inside a compatible AI app
  and continue chatting in that AI app. BrizBuilder does not run a paid model
  API or add a per-message AI charge; the customer remains subject to their AI
  provider's normal plan limits and connector availability.
- Every connection uses OAuth authorization-code flow with PKCE. The approving
  user chooses the exact businesses and CRM permissions before access begins.
- Available tools are deliberately narrow: view CRM summaries, contacts,
  opportunities, tasks, and appointments; create follow-up tasks; add internal
  opportunity notes; and move opportunities between valid stages.
- The connector cannot send messages, make calls, delete records, manage users,
  collect payments, reveal credentials, or run arbitrary database queries.
- Access is rechecked against the current BrizBuilder membership on every tool
  call. Disconnecting an app revokes both access and refresh tokens.

## Not implemented yet

The following have clearly labeled UI previews, but their live providers and actions are intentionally unavailable in Phase 1:

- live SMS, email, chat, and call providers
- missed-call text-back
- Meta Ads, Google Ads, GA4, Search Console, and call-tracking sync
- general-purpose form builder publishing and tracking-health monitor
- automatic review follow-ups and workflow-triggered review requests
- live Google review inbox and replies until Business Profile API access is approved
- estimates, invoices, payments, and Stripe
- built-in AI generation, scoring automation, and reply suggestions that would
  require BrizBuilder to pay a model provider
- background job infrastructure

See [the phased roadmap](docs/ROADMAP.md) and [feature parity matrix](docs/FEATURE_PARITY_MATRIX.md).

## Deployment

1. Run `npm test`.
2. Confirm `.openai/hosting.json` contains the existing Sites `project_id` and `"d1": "DB"`.
3. Package and publish through the Sites hosting workflow.
4. Keep the site private or explicitly configure an allowlist before sharing it.
5. Verify Cloudflare Access sign-in, origin JWT validation, the D1 migration, and one agency/client isolation check after deployment.

Runtime secrets belong in Sites environment settings, never in the repository.
