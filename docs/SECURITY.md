# BrizBuilder Security Model

## Security objectives

The highest-priority property is tenant isolation: an authenticated client must never access another client's records, and one organization must never access another organization. Secondary objectives are least privilege, mutation integrity, auditability, secret protection, and safe integration rollout.

## Trust boundaries

- The browser and all request input are untrusted.
- Cloudflare Access establishes hosted identity and sends a signed application JWT. The Worker independently verifies its signature, issuer, audience, algorithm, required claims, and time limits before mapping the email to persisted membership.
- The administrator cookie session is an independent fallback and is accepted only when its long random token matches the server-side Cloudflare secret.
- Unsigned identity headers are untrusted. Integration tests use a separately enabled, host-bound, short-lived HMAC identity that must never be configured in production.
- The CRM application service is the authorization boundary. UI visibility is not authorization.
- Provider webhooks and asynchronous jobs will be untrusted until signature, replay, scope, and idempotency checks succeed.

## Current controls

### Authentication

- All CRM API reads and writes require an authenticated user.
- Hosted deployments use Cloudflare Access as the primary identity provider.
- The Worker reads `Cf-Access-Jwt-Assertion` and verifies RS256 against the remote JWKS at the configured `TEAM_DOMAIN`, with the exact `POLICY_AUD` and issuer required.
- Missing, malformed, expired, wrongly issued, wrongly scoped, or unsigned identity tokens do not establish a user.
- Administrator fallback credentials are configurable only through environment variables; the session token is compared without early exit and is never exposed to client JavaScript.
- Session cookies are HTTP-only, SameSite protected, and Secure on HTTPS.

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

### Remote AI connector

- Remote AI apps authenticate with OAuth authorization code plus PKCE S256;
  BrizBuilder browser cookies are never accepted by the MCP endpoint.
- Access and refresh tokens are opaque random values. Only SHA-256 token hashes
  are stored, access tokens expire quickly, and refresh tokens rotate.
- Consent records pin the requesting app, callback address, exact businesses,
  scopes, resource, actor, expiration, and PKCE challenge. New businesses are
  never added to an existing grant automatically.
- Every tool call rechecks the actor's current organization membership, role,
  explicit business grant, and scope. Records are queried by both organization
  and business before data is returned or changed.
- The tool allowlist excludes customer messaging, calls, deletion, payments,
  user administration, credentials, and arbitrary database access.
- Connector audit events store only the app, tool, business, outcome, record
  reference, and timing. They do not store prompts or returned CRM content.

## Threat model

| Threat | Primary control | Verification |
|---|---|---|
| Spoofed identity header or JWT | Remote-JWKS signature verification plus exact issuer, audience, RS256, claim, and expiry checks | Worker integration test rejects unsigned/tampered identities; deployment smoke test uses a real Access token |
| Cross-client ID manipulation | Server-derived tenant context and scoped queries | D1 integration test |
| Privilege escalation | Named server permissions | Forbidden-action tests and audit |
| Cross-site mutation | Same-origin enforcement and protected cookies | Integration test |
| Injection | Parameter binding, enum validation, allowlisted template tokens | Lint/typecheck/tests and review |
| Oversized import or payload | Request, file, row, and field limits | Validation tests |
| Duplicate webhook/job delivery | Planned idempotency keys and receipt table | Required before provider launch |
| Secret leakage | Environment-managed secrets and log redaction | Deployment review |
| Audit tampering | Agency-only read and append-only application workflow | Database access review |
| Provider outage | Transactional outbox and adapter isolation | Required before live delivery |
| Stolen or replayed AI connector token | Short access-token lifetime, hashed opaque tokens, rotating refresh tokens, revocation, exact resource binding | OAuth/MCP integration tests and audit review |
| AI app crosses business boundaries | Explicit immutable business grant plus current membership and tenant checks on every tool call | Cross-client connector tests |

## Compliance posture

BrizBuilder does not claim certification or legal compliance. Before launching the relevant modules, the operator must complete policy and counsel review for applicable requirements, including CAN-SPAM, TCPA and messaging consent, carrier registration, PCI scope, privacy notices, deletion/export rights, retention, breach response, call-recording consent, accessibility, and AI disclosure.

Payment card data must remain on provider-hosted collection surfaces; BrizBuilder should store provider tokens and normalized transaction metadata only. Sensitive communication content, recordings, identity documents, health data, or other regulated data must not be enabled without a documented classification, retention, and access-control plan.

## Production security gate

Before a public production release:

1. Replace main-admin bootstrap provisioning with an approved invitation/onboarding flow.
2. Configure `TEAM_DOMAIN` and `POLICY_AUD`, then verify Access authentication, origin JWT rejection, and logout behavior on the final domain.
3. Run migration backup/restore and tenant-isolation smoke tests.
4. Add rate limiting and structured security telemetry.
5. Add CSRF tokens if cross-origin product surfaces are introduced.
6. Complete dependency, SAST, secret, and infrastructure scans.
7. Perform an external authorization/tenant-isolation review.
8. Define incident response, retention, export, deletion, and recovery procedures.
9. Require signed, idempotent webhooks before any provider integration is enabled.
10. Review every enabled feature flag against its security and compliance gate.
