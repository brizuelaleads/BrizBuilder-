# BrizBuilder Security Model

## Security objectives

The highest-priority property is tenant isolation: an authenticated client must never access another client's records, and one organization must never access another organization. Secondary objectives are least privilege, mutation integrity, auditability, secret protection, and safe integration rollout.

## Trust boundaries

- The browser and all request input are untrusted.
- Sites dispatch establishes the hosted identity. The application verifies and maps that identity to persisted membership.
- The local password session exists only for localhost development and production rejects those routes.
- The CRM application service is the authorization boundary. UI visibility is not authorization.
- Provider webhooks and asynchronous jobs will be untrusted until signature, replay, scope, and idempotency checks succeed.

## Current controls

### Authentication

- All CRM API reads and writes require an authenticated user.
- Hosted deployments use dispatch-owned Sign in with ChatGPT.
- Local credentials are development-only, configurable through environment variables, and never a production fallback.
- Cookies use protected attributes appropriate to the runtime and are not exposed to client JavaScript.

### Authorization and tenancy

- The server derives organization and client scope from memberships.
- Client roles are restricted to exactly one client subaccount.
- Named permissions guard server actions.
- Agency-only audit and client-management data is omitted from client responses.
- Relationship mutations verify that all referenced records belong to the active scope.
- Integration tests exercise cross-client isolation and forbidden agency actions.

### Request and data safety

- Cookie-authenticated mutations enforce same-origin requests.
- CRM actions require JSON content type and limit request bodies to 512 KB.
- CSV import is limited to 400 KB in the browser and 500 parsed contacts on the server.
- Required fields, enum values, identifiers, email/phone presence, lengths, and numeric values are validated server-side.
- SQL values use bound parameters. The one dynamic entity-table selection uses an internal constant map, never user input.
- Custom-value templates accept only allowlisted tokens and never execute code.

### Audit and event integrity

- Supported mutations append actor, action, entity, tenant, timestamp, and bounded metadata to `audit_logs`.
- A domain-event outbox captures future integration work without making a third party part of the CRM transaction path.
- Audit access is limited to agency roles with `audit.read`.

### Secrets and provider data

- Secrets belong in deployment environment settings and must not be committed or returned to the browser.
- Future provider credentials must be encrypted at rest, redacted from logs, scoped per tenant, and rotatable.
- Webhook signing secrets and OAuth refresh tokens require separate access controls from normal CRM records.

## Threat model

| Threat | Primary control | Verification |
|---|---|---|
| Cross-client ID manipulation | Server-derived tenant context and scoped queries | D1 integration test |
| Privilege escalation | Named server permissions | Forbidden-action tests and audit |
| Cross-site mutation | Same-origin enforcement and protected cookies | Integration test |
| Injection | Parameter binding, enum validation, allowlisted template tokens | Lint/typecheck/tests and review |
| Oversized import or payload | Request, file, row, and field limits | Validation tests |
| Duplicate webhook/job delivery | Planned idempotency keys and receipt table | Required before provider launch |
| Secret leakage | Environment-managed secrets and log redaction | Deployment review |
| Audit tampering | Agency-only read and append-only application workflow | Database access review |
| Provider outage | Transactional outbox and adapter isolation | Required before live delivery |

## Compliance posture

BrizBuilder does not claim certification or legal compliance. Before launching the relevant modules, the operator must complete policy and counsel review for applicable requirements, including CAN-SPAM, TCPA and messaging consent, carrier registration, PCI scope, privacy notices, deletion/export rights, retention, breach response, call-recording consent, accessibility, and AI disclosure.

Payment card data must remain on provider-hosted collection surfaces; BrizBuilder should store provider tokens and normalized transaction metadata only. Sensitive communication content, recordings, identity documents, health data, or other regulated data must not be enabled without a documented classification, retention, and access-control plan.

## Production security gate

Before a public production release:

1. Replace main-admin bootstrap provisioning with an approved invitation/onboarding flow.
2. Verify hosted authentication and logout behavior on the final domain.
3. Run migration backup/restore and tenant-isolation smoke tests.
4. Add rate limiting and structured security telemetry.
5. Add CSRF tokens if cross-origin product surfaces are introduced.
6. Complete dependency, SAST, secret, and infrastructure scans.
7. Perform an external authorization/tenant-isolation review.
8. Define incident response, retention, export, deletion, and recovery procedures.
9. Require signed, idempotent webhooks before any provider integration is enabled.
10. Review every enabled feature flag against its security and compliance gate.
