# BrizBuilder Production

This document is the operational source of truth for BrizBuilder production
ownership and deployment targeting.

## Canonical production target

| Item | Canonical value |
| --- | --- |
| Repository | `D:/brizl/Websites/BrizBuilder-` |
| Branch | `main` |
| Production domain | `brizbuilder.com` |
| Production host | Existing Cloudflare Worker architecture |
| Production Worker | `brizbuilder` |

The existing `brizbuilder` Cloudflare Worker is the sole canonical production
runtime and serves `brizbuilder.com`.

## Sites status

Sites is not production and is not the owner of `brizbuilder.com`.
`.openai/hosting.json` records a non-production Sites project only; it does not
authorize a deployment, domain attachment, or production migration.

Do not create, publish, or use a Sites deployment as a BrizBuilder production
target unless the repository owner explicitly requests a future hosting
migration. A migration request must be treated as a separate production change
with its own plan, validation, and cutover approval.

## Production configuration ownership

Production environment variables, provider credentials, secrets, and
encryption keys remain on the existing `brizbuilder` Worker. Never commit their
values or copy, regenerate, rotate, delete, or replace them without explicit
authorization.

The following production configuration is protected change-controlled state:

- DNS records and zone configuration
- custom domains and Worker routes
- Worker bindings and compatibility configuration
- cron triggers and scheduled handlers
- environment variables and secrets
- encryption keys and provider credentials

Normal feature work must preserve this state and target the canonical repository
and existing Worker architecture. Feature implementation does not implicitly
authorize a production configuration change.

## Required pre-deployment verification

Before every production deployment:

1. Resolve the Git root and confirm it is
   `D:/brizl/Websites/BrizBuilder-`.
2. Confirm the checked-out branch is `main` and record the intended HEAD commit.
3. Confirm the deployment target is the existing Worker named `brizbuilder` in
   the established Cloudflare account.
4. Inspect the Worker's current routes/custom domains, bindings, cron triggers,
   environment-variable names, and secret names.
5. Confirm the deployment will preserve that configuration exactly except for
   changes the repository owner explicitly requested.
6. Run the applicable test and production-build checks.
7. Stop if the target is ambiguous, the configuration differs unexpectedly, or
   the action would create a second production runtime.

Do not infer permission to change DNS, domains, routes, bindings, schedules, or
secrets from a request to deploy application code. Each such change requires an
explicit request.
