# BrizBuilder Architecture

## Decision summary

BrizBuilder is a modular monolith built as a Cloudflare Worker-compatible
Vinext application. The existing Cloudflare Worker named `brizbuilder` owns the
production runtime and serves `brizbuilder.com`. The UI, authenticated route
handlers, CRM application service, and persistence live in one deployable unit,
but module boundaries and provider adapters are explicit.

Sites is not a production owner or deployment target. It may be used only for
non-production work unless the repository owner explicitly requests a future
hosting migration. Production secrets and encryption keys remain on the
existing `brizbuilder` Worker.

The `brizbuilder-leads` and `brizbuilder-ai` Workers are narrow public gateways,
not alternate application deployments. They forward allowed requests to
`brizbuilder.com` over HTTPS and must not service-bind to a separately deployed
copy of the main application.

```mermaid
flowchart LR
    U["Agency or client user"] --> E["Cloudflare edge and Access"]
    E --> A["brizbuilder Worker: authenticated Next.js/Vinext application"]
    A --> P["Tenant context and permission policy"]
    P --> C["CRM application service"]
    C --> D["D1 relational data"]
    C --> O["Domain-event outbox"]
    O -. "future worker/queue" .-> I["Provider adapters"]
    I -.-> X["Email, SMS, calls, payments, publishing, AI"]
```

## Architecture decisions

### ADR-001: Modular monolith first

**Decision:** Use a single deployable application with domain-oriented services and tables.

**Reason:** Phase 1 transactions require strong tenant consistency and do not justify distributed operations. Future workload isolation can be introduced behind event and adapter boundaries.

**Exit signal:** Split a module only when independent scaling, reliability, compliance, deployment cadence, or ownership provides measurable value.

### ADR-002: D1 is the Phase 1 system of record

**Decision:** Store tenant, CRM, customization, flags, audit, and outbox data in Cloudflare D1 through Drizzle schema and generated migrations.

**Reason:** The data is relational and fits an edge-deployed Phase 1. Foreign keys and composite indexes make tenant scoping inspectable.

**Evolution:** Provider payloads and files move to R2; ephemeral locks/rate limits move to KV or Durable Objects; heavy job delivery uses Queues. A PostgreSQL migration is reserved for workloads that require higher write concurrency, advanced full-text search, or complex analytics.

### ADR-003: Tenant scope is server-derived

**Decision:** Build request context from the authenticated identity and persisted membership. Repositories receive that context and always filter by organization; client users receive an additional client constraint.

**Reason:** Browser-provided tenant identifiers are untrusted. UI filtering is a usability feature, never a security boundary.

### ADR-003A: Verify Access identity at the origin

**Decision:** Treat `Cf-Access-Jwt-Assertion` as the only hosted identity input
and verify it in the Worker with Cloudflare's remote JWKS, the configured team
issuer, the application's audience tag, RS256, required claims, and JWT time
limits. Do not trust unsigned user-email or user-name headers.

**Reason:** An Access policy protects the normal edge route, but origin-side
verification prevents a routing mistake or forged request header from becoming
an authenticated BrizBuilder user. The administrator cookie remains a separate,
secret-backed recovery path.

### ADR-004: Explicit role permissions

**Decision:** Map each role to named capabilities such as `contacts.write`, `contacts.import`, `companies.write`, `custom_data.manage`, and `audit.read`. Mutations call `requirePermission` before touching data.

**Reason:** Capability names survive role changes and provide a future path to custom roles.

### ADR-005: Transactional outbox boundary

**Decision:** Critical mutations append a durable `domain_events` record alongside audit data. The event contains a stable type, tenant scope, actor, JSON payload, and processing state.

**Reason:** Future automations and provider delivery must not make core CRM writes depend on third-party availability. A queue dispatcher can later claim and deliver events idempotently.

### ADR-006: Persisted feature flags

**Decision:** Flags are tenant-scoped data. Phase 1 flags enable functional CRM modules; future module flags remain disabled and create no navigation entry.

**Reason:** Product rollout must be deliberate, observable, and reversible. A visible placeholder is not a feature flag.

### ADR-007: Provider adapters

**Decision:** External providers implement internal contracts for messaging, telephony, payments, domains, analytics, storage, and AI. Domain records hold internal IDs plus external references; raw provider payloads are not the business model.

**Reason:** Provider replacement, replay, sandboxing, and testing remain possible.

## Current module boundaries

- `app/`: responsive product shell, views, forms, and authenticated API handlers.
- `db/schema.ts`: canonical relational schema.
- `db/crm.ts`: tenant context, authorization, Phase 1 queries/actions, audit, seeding, and template rendering.
- `drizzle/`: ordered generated database migrations.
- `tests/`: Worker-level D1 and tenant-isolation integration coverage.
- `.openai/hosting.json`: non-production Sites project metadata; it does not
  define or own the production runtime.

## Production ownership and change control

- The canonical repository is `D:/brizl/Websites/BrizBuilder-` on `main`.
- The canonical production runtime is the existing `brizbuilder` Cloudflare
  Worker, and its production domain is `brizbuilder.com`.
- Normal feature work targets this repository and the existing Worker
  architecture. It must not introduce a competing production deployment.
- Sites is not production and must not be treated as the deployment target
  without an explicit hosting-migration request from the repository owner.
- Production secrets and encryption keys remain configured on the existing
  Worker and are never stored in the repository.
- DNS, custom domains, routes, bindings, cron triggers, and production secrets
  must not be changed unless the repository owner explicitly requests that
  specific production change.
- Before every deployment, verify the exact `brizbuilder` Worker target and
  preserve its existing routes, bindings, schedules, variables, and secrets.

See [`PRODUCTION.md`](../PRODUCTION.md) for the operational source of truth.

## Data rules

- IDs are opaque and stable; email addresses and names are never tenant keys.
- Organization-owned tables carry `organization_id`.
- Client data additionally carries `client_id`.
- Relationship tables validate both sides under the same tenant scope.
- Custom field definitions are scoped and typed; values are JSON with server validation.
- Reusable custom values use an allowlisted token renderer. Arbitrary evaluation is prohibited.
- Audit logs are append-only through application workflows.
- Baseline initialization uses stable, idempotent inserts for the organization, admin membership, feature flags, and pipeline stages only.

## Future infrastructure seams

1. A dispatcher reads unprocessed outbox events and publishes them to Cloudflare Queues.
2. Module workers handle idempotent jobs with retry/backoff/dead-letter policies.
3. Provider webhook adapters verify signatures, store receipt IDs, and emit normalized events.
4. R2 stores media, exports, call recordings, website assets, and large payload archives.
5. A search projection supports global and conversation search without bypassing tenant filters.
6. An analytics projection separates operational queries from long-running reporting workloads.

These are architecture-ready seams, not claims that the corresponding product modules exist today.
