# BrizBuilder Feature Parity Matrix

## Status definitions

- **Not Started:** no user-facing workflow or committed implementation contract.
- **Architecture Ready:** a boundary, flag, schema seam, or event supports future work, but the feature is not user-ready.
- **In Progress:** meaningful implementation exists but the primary workflow or release gate is incomplete.
- **MVP Complete:** the primary workflow is durable, authorized, responsive, and tested for the current scope.
- **Production Ready:** production operations, security review, provider/compliance gates, and release verification are complete.
- **Blocked:** an external decision, credential, approval, source connection, or required dependency prevents completion.

No Phase 1 row is marked Production Ready until hosted deployment, production onboarding, rate limiting/monitoring, backup recovery, and external tenant-isolation review are complete.

| Feature | Module | Role | Priority | Status | Dependencies/provider | Security | Compliance | Testing |
|---|---|---|---|---|---|---|---|---|
| Hosted authentication | Platform | All | P0 | MVP Complete | Sites dispatch | Server identity mapping; protected cookies | Privacy notice before public launch | Anonymous rejection; local/production split |
| Organizations and memberships | Platform | Agency owner/admin | P0 | MVP Complete | D1 | Server-derived organization scope | Export/deletion policy pending | Seed and tenant context integration |
| Client subaccounts | Platform | Agency owner/admin | P0 | MVP Complete | D1 | Client scope on every record/query | Retention policy pending | Cross-client isolation integration |
| Roles and permissions | Platform | All | P0 | MVP Complete | Application policy | Named server capabilities | Access-review process pending | Forbidden-action integration |
| Dashboard | CRM | Agency and client users | P1 | MVP Complete | CRM aggregates | Tenant-filtered metrics | None specific | Build and isolation coverage |
| Contacts | CRM | CRM writers/viewers | P0 | MVP Complete | D1 | Scoped search/write; duplicate checks | Consent fields and deletion workflow pending | CRUD/isolation integration |
| Contact CSV import | CRM | Authorized writers | P0 | MVP Complete | Browser parser; D1 | 400 KB/500-row bounds; server validation | Importer is responsible for lawful data | Duplicate/import integration |
| Contact CSV export | CRM | Authorized users | P1 | MVP Complete | Browser export | Current tenant snapshot only | Data-export policy pending | Manual/browser acceptance |
| Companies | CRM | CRM writers/viewers | P0 | MVP Complete | D1 | Scoped CRUD and archive | None specific | Create/isolation integration |
| Contact-company relationships | CRM | CRM writers | P1 | MVP Complete | D1 foreign keys | Both records validated in tenant | None specific | Import/link integration |
| Custom field definitions | CRM | Agency/client managers | P0 | MVP Complete | D1 | Tenant scope; typed definitions | Sensitive field policy pending | Create/isolation integration |
| Custom field record values | CRM | CRM writers | P0 | MVP Complete | D1 JSON values | Definition/entity/record scope validation | Sensitive field policy pending | Persist/isolation integration |
| Reusable custom values | CRM | Agency/client managers | P1 | MVP Complete | D1; token renderer | Allowlisted tokens; no evaluation | None specific | Upsert/isolation integration |
| Pipelines and stages | CRM | CRM writers/viewers | P0 | MVP Complete | D1 | Scoped stages and movement | None specific | Stage-history integration |
| Opportunities | CRM | CRM writers/viewers | P0 | MVP Complete | `crm_leads` aggregate | Scoped CRUD; assignment permission | Consent for outreach remains separate | Create/move/isolation integration |
| Tasks | CRM | CRM writers/viewers | P1 | MVP Complete | D1 | Scoped create/complete | None specific | Build and service coverage |
| Notes and activity | CRM | CRM writers/viewers | P1 | MVP Complete | D1 | Scoped record timeline | Retention policy pending | Build and tenant snapshot coverage |
| Appointments | CRM | CRM writers/viewers | P1 | MVP Complete | D1 | Scoped create/status | Time-zone disclosure pending | Build and service coverage |
| Reports and attribution | CRM | Agency and client users | P1 | MVP Complete | CRM aggregates | Tenant-filtered output | Analytics disclosure pending | Build and isolation coverage |
| Audit log | Platform | Agency owner/admin | P0 | MVP Complete | D1 | Agency-only read; append workflow | Retention/immutability policy pending | Visibility/mutation integration |
| Feature flags | Platform | Agency owner/admin | P0 | MVP Complete | D1 | Server-read tenant flags | None specific | Enabled/disabled integration |
| Domain-event outbox | Platform | Internal | P0 | Architecture Ready | D1; future Queues | Tenant scope; bounded payload | Retention policy pending | Event insertion integration |
| Source publishing to hosted project | Platform | Operator | P0 | Blocked | Sites source connection/network | Release credential must remain external | None specific | Local build/test green; hosted smoke blocked |
| Unified conversation inbox | Communications | CRM users | P0 | In Progress | UI preview; outbox; email/SMS/call adapters | Message tenant scope and redaction | Consent/retention required | Responsive UI build passes; provider tests pending |
| Two-way email | Communications | CRM users | P0 | Not Started | Email provider; DNS | Encrypted credentials; signed webhooks | CAN-SPAM; suppression | Sandbox/delivery tests pending |
| Two-way SMS/MMS | Communications | CRM users | P0 | Not Started | Twilio/Telnyx | Signed webhooks; abuse/rate controls | TCPA/A2P/opt-out | Carrier sandbox and consent tests pending |
| Calling and call tracking | Communications | CRM users | P1 | Not Started | Telephony provider; R2 | Number access; recording controls | Recording consent; retention | Call lifecycle tests pending |
| Calendars and booking | Scheduling | CRM users/public | P0 | In Progress | Current appointments; Google/Microsoft future | OAuth tokens; availability scope | Time zone/privacy notices | Conflict/sync tests pending |
| Workflow builder | Automation | Managers | P0 | In Progress | UI preview; outbox; Queues | Versioning; loop/cost limits | Consent inherited per action | Responsive UI build passes; runner tests pending |
| Workflow execution/history | Automation | Managers/internal | P0 | Architecture Ready | Queues; scheduler | Idempotent steps; retry/dead letter | Audit/retention | Replay/failure tests pending |
| Forms | Capture | Managers/public | P0 | In Progress | UI preview; public endpoint future | Rate limiting; validation | Consent evidence; privacy notice | Responsive UI build passes; submission tests pending |
| Surveys | Capture | Managers/public | P1 | Not Started | Form runtime | Rate limits; tenant routing | Consent and retention | Submission tests pending |
| Chat widget | Capture | Managers/public | P1 | Not Started | Conversations adapter | Origin allowlist; abuse controls | Privacy/cookie notice | Embed/security tests pending |
| Attribution tracking | Capture | Managers | P1 | Architecture Ready | Current source fields; future events | Tenant-safe identifiers | Cookie/analytics disclosure | End-to-end attribution pending |
| Website and funnel builder | Publishing | Designers | P0 | In Progress | Management/funnel UI previews; R2/Cloudflare future | Output sanitization; tenant assets | Accessibility/privacy/cookies | Responsive UI build passes; publishing tests pending |
| Templates and brand system | Publishing | Designers | P1 | Not Started | Asset service | Tenant asset boundaries | Asset licensing | Snapshot tests pending |
| Custom domains and SSL | Publishing | Agency/client admins | P0 | Architecture Ready | Cloudflare DNS/Workers | Ownership proof; routing isolation | Domain/abuse policy | Provision/rollback tests pending |
| Image optimization | Publishing | Designers | P1 | Architecture Ready | R2/image transforms | MIME validation; signed access | Asset rights and deletion | Performance/format tests pending |
| SEO/schema/analytics injection | Publishing | Designers | P1 | Not Started | Published page runtime | Script allowlists; CSP | Cookie/analytics disclosure | HTML/schema tests pending |
| Products and estimates | Commerce | Managers | P1 | Not Started | Catalog/ledger | Price and permission integrity | Tax/terms review | Currency/calculation tests pending |
| Invoices and payment links | Commerce | Managers/customers | P0 | In Progress | Payments UI preview; Stripe future | Hosted card collection; signed webhooks | PCI scope; receipts/tax | Responsive UI build passes; ledger tests pending |
| Subscriptions/refunds/disputes | Commerce | Admins | P1 | Not Started | Stripe Billing/Connect | Idempotency; reconciliation | PCI/consumer law | Lifecycle/reconciliation pending |
| Review requests | Reputation | CRM users | P1 | In Progress | Reputation UI preview; messaging/review providers future | Scoped templates and sending limits | Consent/platform policy | Responsive UI build passes; delivery tests pending |
| Review monitoring/replies | Reputation | Managers | P1 | In Progress | Reputation UI preview; Google Business Profile future | OAuth scope; approval | Platform policy | Responsive UI build passes; sync tests pending |
| Social composer/calendar | Social | Marketers | P1 | Not Started | Social provider APIs | Token scope; approvals | Platform and media rights | Scheduling/retry tests pending |
| Social publishing/analytics | Social | Marketers | P1 | Not Started | Meta/LinkedIn/Google | Webhook/token security | Platform policy | Provider conformance pending |
| Courses and lessons | Membership | Creators/members | P2 | Not Started | R2; commerce | Entitlement and media access | Content rights/privacy | Access/progress tests pending |
| Communities and moderation | Membership | Members/moderators | P2 | Not Started | Notifications/search | Moderation and abuse controls | Community/privacy terms | Moderation/access tests pending |
| AI content and reply assistance | AI | CRM/marketing users | P1 | In Progress | Guarded UI preview; OpenAI API future | Tenant budget; prompt/input policy | AI disclosure and content rights | Responsive UI build passes; evaluation pending |
| AI summaries and extraction | AI | CRM users | P1 | Architecture Ready | OpenAI API; outbox | Sensitive-data policy; audit | Retention/disclosure | Accuracy/privacy evaluation pending |
| Conversation/voice agents | AI | Admins/customers | P2 | Not Started | AI, messaging, telephony | Tool allowlists; human escalation | Consent/disclosure/recording | Safety/tool-call evaluation pending |
| Knowledge bases | AI | Managers | P2 | Not Started | R2; vector/search store | Document ACLs; injection defense | Data rights/deletion | Retrieval/isolation tests pending |
| Agency plans and entitlements | SaaS | Agency owner | P1 | Architecture Ready | Feature flags; Stripe Billing future | Server entitlement checks | Billing terms/tax | Lifecycle tests pending |
| Usage metering and dunning | SaaS | Agency owner/internal | P1 | Not Started | Stripe Billing; event pipeline | Tamper-resistant meter | Billing/tax/retention | Reconciliation tests pending |
| White-label domains/branding | SaaS | Agency owner | P1 | Architecture Ready | Cloudflare domains | Ownership proof; asset scope | Trademark/domain policy | Provision/isolation pending |
| Scoped API keys | Developer | Developers/admins | P2 | Not Started | API gateway | Hashing, scope, rotation, quotas | Developer terms/privacy | Auth/abuse tests pending |
| OAuth applications | Developer | Developers/admins | P2 | Not Started | OAuth 2.1 service | PKCE, redirect validation, consent | Developer terms | Protocol/conformance pending |
| Public API and webhooks | Developer | Developers | P2 | Architecture Ready | Outbox; API gateway | Signing, versioning, rate limits | Data processing terms | Contract/idempotency pending |
| Marketplace | Developer | Developers/agencies | P3 | Not Started | OAuth, billing, review system | App isolation and revocation | Marketplace terms/review | Install/upgrade/uninstall pending |

## Review cadence

Update this matrix in the same change that alters a module's release state. A status can advance only with linked implementation and test evidence; a provider-dependent feature cannot become Production Ready without sandbox and production webhook/reconciliation evidence.
