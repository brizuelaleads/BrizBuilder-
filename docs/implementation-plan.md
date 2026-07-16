# Implementation plan and roadmap

## Completed Phase 1

- authentication integration and protected workspace
- organization and seven-role membership model
- client management and team access assignment
- agency/client dashboard and filters
- lead inbox, details, timeline, notes, assignments, scores, values, archive, search, CSV export
- contacts and lead-time deduplication
- pipeline stages, drag/drop, accessible move control, and stage history
- tasks and appointments
- basic performance and funnel reports
- seed data, migration, audit logging, error/loading/empty states, mobile layouts, and integration tests

## Phase 2

1. Add `Conversation`, `Message`, `Call`, `TrackingNumber`, and `WebhookEvent` tables.
2. Implement signed Twilio/CallRail adapters and a missed-call queue.
3. Add Meta Ads, Google Ads, GA4, Search Console, and call-tracking provider interfaces.
4. Add campaign, ad set, ad, creative, daily marketing metrics, and first/last-touch attribution.
5. Add the public form-submission endpoint with honeypot, rate limit, idempotency, and duplicate detection.
6. Add tracking-health checks and alert records.

## Phase 3

1. Implement automations with run/action logs and loop prevention.
2. Add review requests and consent-aware templates.
3. Add server-calculated estimates, invoices, payments, and revenue attribution.
4. Add optional AI provider functions for summaries, reply suggestions, scoring explanations, and reports.
5. Add saved report presets and read-only report links.

## Phase 4

1. Connect production Twilio, Meta, Google, Calendar, email, Stripe, and OpenAI providers.
2. Add a durable job/queue system for syncs, reminders, messages, reports, automations, and transcript processing.
3. Add billing plans and usage limits.
4. Add retention policies, self-service export/deletion, and enhanced audit review.

## Recommended next step

Build the Phase 2 public form webhook and tracking-health monitor first. They create the reliable lead-ingestion foundation needed before paid advertising and communication integrations are connected.
