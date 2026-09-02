# Production migration history reconciliation

Production migration history was reconciled read-only on 2026-08-27.

The production ledger contains 30 migrations. Their exact recorded versions,
names, and statements are represented in `supabase/migrations` using production
timestamps. The pending CallRail transcript/enrichment migration is intentionally
the only local-only migration.

`20260722040000_google_business_oauth_credentials.sql` is retained here as audit
evidence because every material schema effect is present in production, but no
production migration-history row records these statements. Keeping it outside
`supabase/migrations` prevents the CLI from treating an unrecorded historical
timestamp as pending. Do not move it back or mark it applied without a separately
reviewed production-history decision.
