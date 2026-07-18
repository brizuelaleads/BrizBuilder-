# BrizBuilder

BrizBuilder is a multi-tenant agency operating platform. This repository delivers its Phase 1 CRM foundation: organizations, client subaccounts, contacts, companies, custom data, opportunities, tasks, appointments, reports, and audit controls.

Phase 1 is implemented as a production-quality MVP. Records are stored in Cloudflare D1, authentication is provided by the Sites dispatch layer, and every CRM query is scoped on the server to an authorized organization and, for client users, a single client.

## Current architecture

- Vinext / Next.js App Router, React 19, and TypeScript strict mode
- Cloudflare Worker deployment target
- Cloudflare D1 with Drizzle schema and generated migrations
- Dispatch-owned Sign in with ChatGPT for hosted authentication
- Local-only administrator test session for localhost development
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
- full SQL schema at `supabase/schema.sql`
- row-level security policies so client accounts cannot see other clients' data
- storage buckets for assets, website photos, and imports

To connect your Supabase project:

1. Open Supabase > SQL Editor.
2. Paste and run `supabase/schema.sql`.
3. Add these environment variables in Cloudflare/Vercel:

```txt
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
BRIZBUILDER_BACKEND=supabase
```

Do not put the real `SUPABASE_SERVICE_ROLE_KEY` in GitHub. After deploying, open `/api/supabase/status` to confirm the backend is connected.

Local credentials are required and are accepted only by the development server. Production builds reject the local login routes and use Sign in with ChatGPT.

Copy `.env.example` to `.env.local`, then set `MAIN_ADMIN_EMAIL`, `MAIN_ADMIN_NAME`, `LOCAL_DEV_ADMIN_PASSWORD`, and a long random `LOCAL_DEV_SESSION_TOKEN`. Restart the development server after changing them. The `.env.local` file is intentionally excluded from Git.

## Database and migrations

The logical D1 binding is declared as `DB` in `.openai/hosting.json`.

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
- Navigable UI previews for conversations, automations, forms, websites, funnels, payments, reviews, and AI

## Not implemented yet

The following have clearly labeled UI previews, but their live providers and actions are intentionally unavailable in Phase 1:

- live SMS, email, chat, and call providers
- missed-call text-back
- Meta Ads, Google Ads, GA4, Search Console, and call-tracking sync
- public form webhook and tracking-health monitor
- automations and review requests
- estimates, invoices, payments, and Stripe
- AI summaries, scoring automation, and reply suggestions
- background job infrastructure

See [the phased roadmap](docs/ROADMAP.md) and [feature parity matrix](docs/FEATURE_PARITY_MATRIX.md).

## Deployment

1. Run `npm test`.
2. Confirm `.openai/hosting.json` contains the existing Sites `project_id` and `"d1": "DB"`.
3. Package and publish through the Sites hosting workflow.
4. Keep the site private or explicitly configure an allowlist before sharing it.
5. Verify hosted Sign in with ChatGPT, the D1 migration, and one agency/client isolation check after deployment.

Runtime secrets belong in Sites environment settings, never in the repository.
