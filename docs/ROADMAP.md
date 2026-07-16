# BrizBuilder Roadmap

## Delivery rule

Each phase is an independently releasable product increment. BrizBuilder may show future modules in navigation as read-only, clearly labeled UI previews so the product direction can be reviewed early. A preview is not a released capability: live actions remain disabled until the workflow passes its security, persistence, error-state, mobile, audit, provider, and test gates.

## Phase 1 — CRM foundation

**Status:** MVP Complete in this repository.

Includes authentication, organizations, clients, roles/permissions, contacts, companies, relationships, custom fields, reusable custom values, opportunities/pipeline stages, tasks, notes, appointments, activity, dashboards, audit logs, feature flags, CSV import/export, generated D1 migrations, and tenant-isolation integration tests.

Release gate: hosted source deployment, production identity/onboarding configuration, final-domain smoke test, rate limiting, monitoring, backup/restore exercise, and external security review.

## Phase 2 — Communications and scheduling

Unified conversations, two-way email/SMS, attachments, templates/snippets, calling/call tracking, missed-call text-back, calendars, availability, booking links, reminders, and Google/Microsoft sync.

Gate: signed/idempotent webhooks, consent and opt-out enforcement, deliverability controls, queue/retry/dead-letter infrastructure, recording policy, OAuth token protection, and provider reconciliation.

## Phase 3 — Workflow automation

Versioned workflow builder with triggers, waits, branches, CRM/task actions, communication actions, webhook actions, run history, retry/cancel, enrollment rules, and goal reporting.

Gate: immutable published versions, deterministic execution, idempotent steps, concurrency controls, loop/abuse protection, time-zone correctness, cost limits, and replayable diagnostics.

## Phase 4 — Capture and attribution

Forms, surveys, chat widget, QR codes, public ingestion API, UTM/referrer attribution, spam protection, routing, consent evidence, and embeddable assets.

Gate: signed or rate-limited endpoints, bot protection, schema/version compatibility, accessibility, consent retention, public abuse monitoring, and end-to-end attribution tests.

## Phase 5 — Websites, funnels, and publishing

Template library, visual page/section editor, reusable brand system, SEO/schema, domains, SSL, preview/versioning, rollback, forms, analytics injection, image optimization, and Cloudflare publishing.

Gate: website builder re-enabled only as a working module; tenant-safe asset pipeline, sanitized output, domain ownership, certificate lifecycle, rollback, performance budgets, accessibility and SEO checks.

## Phase 6 — Commerce and payments

Products, price books, estimates, invoices, subscriptions, payment links, transactions, refunds, disputes, taxes, coupons, receipts, and revenue reporting.

Gate: provider-hosted card collection, webhook ledger reconciliation, idempotency, currency/tax rules, authorization boundaries, accounting exports, and documented PCI scope.

## Phase 7 — Reputation and social

Review requests, feedback routing, Google Business Profile connections, review monitoring/replies, social accounts, composer, calendar, media library, approvals, publishing, and analytics.

Gate: provider approvals/policies, permissioned replies, scheduling retries, media validation, moderation/approval workflows, and account-disconnect handling.

## Phase 8 — Courses and communities

Products, offers, checkout links, courses, lessons, member access, progress, communities, posts/comments, moderation, notifications, certificates, and analytics.

Gate: entitlement consistency, media access control, moderation/reporting, privacy tools, payment reconciliation, and content export/deletion.

## Phase 9 — AI layer

AI content generation, reply assistance, summaries, extraction, knowledge bases, conversation agents, voice agents, appointment tools, workflow tools, evaluation, and spend controls.

Gate: approved model/tool contracts, tenant data boundaries, prompt-injection defenses, human approval by risk, hallucination evaluation, disclosure, safety policy, usage budgets, and full tool-call audit.

## Phase 10 — Agency SaaS and white label

Plans, entitlements, usage metering, automated provisioning, subscriptions, dunning, branded domains, email branding, custom terminology, client billing, usage limits, and support administration.

Gate: billing/entitlement source of truth, lifecycle state machine, proration/grace rules, safe impersonation, white-label domain verification, tax/legal review, and disaster recovery.

## Phase 11 — Developer platform and marketplace

Scoped API keys, OAuth applications, public APIs, webhooks, developer portal, SDKs, sandbox tenants, marketplace listings, install/uninstall, permissions, billing hooks, versioning, and review workflow.

Gate: OAuth 2.1 design, key hashing/rotation, least-privilege scopes, quotas, abuse controls, compatibility policy, marketplace security review, app isolation, audit, and rapid revocation.

## Cross-phase operating work

Every phase reserves capacity for accessibility, mobile behavior, performance, observability, backups, migrations, security testing, privacy/retention workflows, documentation, support tools, cost controls, and incident response. A phase is not complete while those requirements are deferred to an unspecified later cleanup.
