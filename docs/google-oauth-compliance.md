# Google OAuth verification readiness

Project: `brizbuilder-gbp-prod` / `559192025256`.
This document is a readiness record, not a claim of Google approval or a completed live audit.

## Code changes

- Designated review-workspace Calendar authorizations request only `https://www.googleapis.com/auth/calendar.events.owned` with incremental scope inclusion disabled. The app uses the account's primary calendar, not shared calendars the account does not own. Ordinary production connections keep requesting `calendar.events` until owned-scope approval. Existing grants remain supported until users remove access and reconnect. `GOOGLE_CALENDAR_OWNED_REVIEW_CLIENT_IDS` is an explicit comma-separated demo-client allowlist; only after approval should `GOOGLE_CALENDAR_OWNED_SCOPE_ENABLED=true` enable the narrower flow generally. These settings have not been changed in production.
- Calendar credentials move into a separate server-only, RLS-protected table. Calendar reconnection no longer overwrites the Business Profile credential row or explicitly requests `business.manage`.
- Calendar lookups and connection checks request event identifiers only. Connection checks filter for a private application marker instead of reading unrelated event contents.
- Calendar has a Disconnect Google action protected by `calendar.connect`, tenant/client checks, and the existing `/api/crm` same-origin POST protections.
- Google revocation can remove all permissions for the account/project grant. The confirmation explains that both Calendar and Business Profile connections are stopped. Other workspaces using that same Google account may need reconnecting.
- Successful local cleanup removes both saved Google credential rows, selected profile details, pending authorizations, and stored Calendar event identifiers. Provider revocation failure does not retain a token for retries; the user is told to remove access in Google Account permissions. Cleanup failure is reported instead of being claimed as success.
- Existing CRM appointments and actual Google Calendar events are not deleted by disconnect.
- Privacy disclosures now explicitly cover raw/derived Google data, transfer restrictions, model training restrictions, and actual retention/deletion behavior. The unsupported seven-business-day revocation guarantee is removed.

## AI data-path review

Reviewed `lib/ai-connector/mcp.ts`, its OAuth routes, and `ai-gateway/src/index.ts`.
The optional connector exposes explicitly selected CRM fields under the user's separate connector consent and tenant scope. It does not query the Google credential/profile tables, return Calendar event identifiers, or fetch Google API event contents. `crm_list_appointments` returns CRM appointment fields; these records originate in the CRM, not an import from Google. The gateway proxies those scoped connector requests; it is not a Google-data model-training integration.

No direct model-training or Google-to-AI export path was found in these integrations. This is a source review, not verification of every external client's settings or a full penetration test. Future features that import Google content into the CRM must re-evaluate this boundary before exposing it to the AI connector.

## Reviewer account — not yet created or tested

Approved email: `brizuelaleads+google-review@gmail.com` (same inbox as the owner, separate app identity).

1. Create a new isolated client workspace named `Google OAuth Review Demo`; do not attach the reviewer to real customer workspaces.
2. Add fake contacts and a service appointment suitable for creation/rescheduling/cancellation tests. Do not connect the owner's real calendar for the reviewer.
3. Invite the alias as **Client Manager**, assigned only to this workspace. This role includes `calendar.connect` and `appointments.write`; do not grant agency/admin access.
4. The owner accepts the invitation through the existing inbox and sets a unique password. Do not place it in Git, this document, screenshots, or logs. No Google password should be shared.
5. Test a fresh private-browser sign-in. Verify the reviewer can open Calendar, choose the demo workspace, connect their own test Google account, and manage a fake appointment without payment or phone-number setup.
6. Verify direct requests cannot access a real customer's workspace. This live reviewer-account check is still pending.
7. Supply the dedicated **BrizBuilder** username/password directly through Google's verified review channel only after access is working. Keep the account available during review; remove its access afterward.

Reviewer navigation: `https://brizbuilder.com/login` → sign in → Calendar → choose Google OAuth Review Demo → Link Google Calendar → approve the owned-calendar permission → create/reschedule/cancel the demo appointment and verify each result in Google Calendar.

## Rollout sequence — do not merge/deploy out of order

1. Follow `PRODUCTION.md`: use `D:/brizl/Websites/BrizBuilder-`, branch `main`, and the existing `brizbuilder` Worker. The canonical checkout is currently unavailable in this environment. Do not deploy the Sites preview build or attach a replacement domain.
2. Inspect production schema/migration history and back up through the established process. The migration makes no encryption-key or OAuth-client changes. Stop if production schema differs from the expected credential tables.
3. Apply `supabase/migrations/20261117000000_separate_google_calendar_credentials.sql` before deploying this code. It copies existing encrypted Calendar credentials without decrypting them, retains mixed Business Profile credentials, and removes Calendar-only rows from the old store. Do not print token columns during verification. Check counts/statuses only.
4. Deploy to the existing Worker, preserving its current bindings, routes, cron settings, variables, and secrets. Do not regenerate encryption keys or OAuth clients.
5. With explicit approval for this new configuration, set only `GOOGLE_CALENDAR_OWNED_REVIEW_CLIENT_IDS` to the isolated demo client ID. Leave global enablement false. Re-test an existing Calendar connection, then a fresh owned-scope connection in that isolated reviewer workspace. Test disconnect and reconnection, including removal of any older Google grants. Do not exercise revoke/delete against a live customer's account.
6. Update the **existing** Google verification submission to the scope the deployed build requests. Add `calendar.events.owned` for the isolated review flow and explain that `calendar.events` remains in the existing production flow during the transition. Do not claim a one-scope match while both flows are running. After Google approves owned access, enable it for new production connections and remove the broader scope from new consent requests and the console when appropriate. Do not request `business.manage` as part of Calendar verification while GBP access remains pending. If that scope is already included in the review, discuss deferring it with the reviewer rather than claiming it is production-ready.
7. Record an updated video from the deployed review environment: expand every permission; show appointment creation, rescheduling, cancellation, and Google-side results. Old accounts may display previous grants; use a fresh test grant to show the new scope cleanly.
8. Check the privacy URL renders the new scope, AI restrictions, and disconnect language. Finish the reviewer-access test, replace all placeholders in the reply draft, and reply to the existing OAuth review email. No duplicate submission or new OAuth project is needed.

## Scope justification for the updated submission

BrizBuilder is an invite-only CRM for local service businesses. We request calendar.events.owned to sync CRM appointments to the connected user's existing primary Google Calendar. We look up linked event identifiers, create appointment events, update them when appointment details change, and delete them when appointments are canceled. Events contain the customer name, service type, notes, times, and a CRM appointment identifier. Read-only and free/busy permissions cannot perform these writes. calendar.app.created would require a separate app-created calendar rather than the user's existing primary calendar. We use owned-calendar access instead of calendar.events because access to calendars owned by others is unnecessary. Calendar consent does not request Business Profile permissions. Google data is not used for advertising or general-purpose AI training.

## Remaining live verification

- [ ] Production schema migration applied and code deployed through canonical checkout.
- [ ] Existing connection and fresh owned-scope connection work after rollout.
- [ ] Dedicated reviewer account provisioned and tested in a fresh browser session.
- [ ] Disconnect cleanup and cross-workspace access tested against fake data.
- [ ] Console scopes exactly match the deployed flow and reviewed production-ready features.
- [ ] Updated video and final Google reply supplied by the owner.
- [ ] Production backup retention and deletion-request operations confirmed with the operator. No fixed backup-erasure deadline has been invented.

## Local validation completed

- `npm run test:security`: passed across the repository's security suites.
- `npm run test:google-calendar`: 12 tests passed, including rollout gating, provider failure, unreadable credentials, local-deletion failure, data-minimized API requests, and legacy-grant compatibility.
- `npm run typecheck`: passed.
- ESLint on all changed TypeScript/TSX and test files: passed without warnings.
- `npm run build`: passed; the existing stylesheet emits optimization warnings unrelated to this change.
- Executed the migration in local PGlite/PostgreSQL with fake fixtures: credential preservation, Calendar-only separation, repeated execution without overwriting newer credentials, denied anon/authenticated access, service-role access, and rejection of cross-tenant credential rows all passed. No production migration was run.

This does not replace live account, Google OAuth, or production-schema validation.

## Sources

- https://developers.google.com/workspace/calendar/api/auth
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- https://developers.google.com/workspace/calendar/api/v3/reference/events/update
- https://developers.google.com/workspace/calendar/api/v3/reference/events/delete
- https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
- https://developers.google.com/workspace/workspace-api-user-data-developer-policy
