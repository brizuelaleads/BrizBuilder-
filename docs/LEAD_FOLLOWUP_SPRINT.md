# Lead follow-up sprint

## Changes

- All landing-page Request Access calls to action open `/request-access`.
- Requests are stored before the existing Resend email service notifies `MAIN_ADMIN_EMAIL`.
- `/access-requests` is restricted to that authenticated platform administrator. A dashboard link is visible only to that user. Requests never create users or memberships.
- The form confirms receipt and provides support/retry paths. It records consent to contact about the request, not marketing consent. Email failure leaves the request in the owner inbox with its notification status.
- The database serializes submissions by network hash and normalized email: at most five saved requests per network per hour, and one per email per hour. Duplicate submissions do not send another email. Bodies are limited to 8 KiB, including streamed requests without a Content-Length header. No raw IP is stored.
- Dashboard, Ads, and Reports use `buildAdsReport` for Meta-attributed costs and ROAS. Organic wins no longer inflate dashboard Meta ROAS. Monthly budget is labeled separately and never substituted for spending. Missing insight rows produce unknown costs; explicit zero-spend rows can produce zero costs.
- Date filters use one snapshot clock and whole UTC calendar days including today. CRM results describe leads created during the period and their current outcomes, not cash receipts during the period. Meta daily dates retain the ad account timezone. Loaded record limits and missing sync history are disclosed in Reports; this sprint does not introduce server-side aggregate reporting.
- The dashboard opens unresolved calls across all loaded workspace history and the oldest unanswered lead or earliest overdue lead follow-up directly. Handled calls and later successful conversations no longer remain in the attention count. Withheld numbers do not match unrelated callers. Calls has a Needs follow-up filter and an explicit return to the selected period.

## Release requirements

Use the canonical repository and existing Worker described in `PRODUCTION.md`.
The checkout on this machine is an isolated feature worktree, not the canonical deployment checkout.

1. Apply `supabase/migrations/20260906150000_access_requests.sql` to the existing production Supabase database after earlier migrations, using the established migration workflow.
2. Verify the existing configuration includes the Supabase service credentials, `MAIN_ADMIN_EMAIL`, `RESEND_API_KEY`, `SYSTEM_EMAIL_FROM`, and the correct `APP_BASE_URL`. Do not copy or rotate their values. There are no new Worker bindings, cron triggers, domains, or required new secrets.
3. Run `npm run typecheck`, `npm run lint`, and `npm test` with Node 22, then follow `PRODUCTION.md` for the existing Worker deployment.
4. Submit an authorized test application, verify one saved request and one administrator email, and confirm the owner inbox rejects client sessions. Do not use customer addresses for smoke tests.

If the migration/database is unavailable, submission returns a retryable error rather than claiming success. If email is unavailable, a successfully saved request remains reviewable by the administrator.

## Validation

`npm run test:sprint` covers request validation and failure paths, attribution, reporting boundaries, handled/unknown callers, rendered report figures, and dashboard click destinations. Existing Ads, unified-call, landing-page, and system-email checks cover adjacent behavior.

The migration was also executed against an isolated in-memory PostgreSQL (PGlite) instance: insert, email normalization/deduplication, rate-limit expiry, and anon/authenticated permission denial passed. That is a single-connection check, not a concurrent production load test. No production database or email provider is used by the automated tests.
