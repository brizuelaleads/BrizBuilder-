# Recovery gate for Google Calendar credential migration

Status on November 17, 2026: **not ready to migrate**. This is a prepared plan,
not an existing backup or a successful recovery exercise.

## Read-only findings

Target: Supabase `yrklqvexbiwacejixhll`, PostgreSQL 17.6, existing BrizBuilder production database.

`supabase backups list --remote` succeeded and returned `backups: null`,
`pitr_enabled: false`, `physical_backup_data: {}`, and `walg_enabled: true`.
WAL-G being enabled does not establish an accessible restore point. No recent,
usable backup can be confirmed from this response. Check the project's Dashboard
Database > Backups for any separately available downloadable daily backup; do
not claim one exists without a timestamp, successful status, and restore path.

The prior `.codex-reconcile` files contain migration history and schema metadata
only; they are not database data backups. No named backup/dump artifact was found
in the scoped workspace search. This does not establish that no off-machine
backup exists.

Docker CLI is installed, but its Linux engine is unavailable. No `pg_dump` or
`psql` was found on PATH or in the standard PostgreSQL installation directories.
Do not run a migration while backup tooling and a restore destination are missing.

## Proposed logical backup

1. Bring up the existing local Docker engine and use a compatible Supabase/Postgres
   17 toolchain. Prepare an isolated local Supabase restore instance, with outbound
   integrations, scheduled jobs, email, and webhooks disabled before loading data.
   It must not use the production domain or Worker. A hosted restore destination
   would need a separate provisioning decision; none has been created.
2. Use an encrypted local destination outside every Git repository and sync folder,
   for example a restricted directory under `%LOCALAPPDATA%/BrizBuilderBackups`.
   Restrict Windows ACLs to the operator and SYSTEM, verify disk/archive encryption,
   and keep an independently recoverable encrypted copy in operator-controlled
   storage. An ignored repository folder or filesystem permissions alone are not
   encryption. Do not print dump content or credentials, and do not commit them.
3. Use the existing authenticated CLI and TLS. Do not reset a database password,
   rotate an OAuth credential, or extract/copy Worker encryption keys. Keep
   connection secrets in process memory or a restricted temporary credential file,
   never command arguments, console output, or shell history. Do not use CLI debug
   or dump `--dry-run`, which can reveal connection details.
4. Capture roles, schema, data, and the separate `supabase_migrations` schema/history.
   Supabase's documented logical export uses `db dump --role-only`, a schema dump,
   and `db dump --data-only --use-copy`, each writing directly with `--file`.
   Pin the project ref explicitly. Verify inclusion of `auth` data, application
   tables, constraints, policies, and encrypted credential rows. Do not silently
   accept partial/failed exports. Prefer a single consistent snapshot for related
   schema/data exports; record any concurrent-write limitations and take a fresh
   migration-scoped snapshot immediately before cutover.
5. Record only non-sensitive evidence in the rollout record: capture time,
   project ref, tool versions, artifact hashes/sizes, exit statuses, and aggregate
   validation counts. Store row-level comparisons and manifests with the protected
   backup, not in Git or chat. The current table has one encrypted credential;
   confirm it is included without displaying ciphertext or IVs.

## Restore test and acceptance

Restore **only into the isolated destination**, in roles/schema/data order with
`psql --single-transaction --set ON_ERROR_STOP=1`, following the Supabase restore
procedure and its managed-role/extension requirements. Restore migration history
separately. Do not run this against a nonempty production database. Inspect any
errors locally without logging row values.

Verify expected schema, 42 historical migrations (or the fresh count at capture),
auth/profile membership integrity, foreign keys, indexes, RLS and grants. Compare
credential row count and encrypted bytes internally with the backup; publish only
pass/fail. Run the proposed migration on the restored copy and verify old readers,
the temporary write bridge, new readers, and browser-role denial. Record successful
restore duration, validation results, and the exact backup identifier before
marking recovery confirmed. The fake-data PGlite test is not this restore test.

Database exports do not contain Storage object bytes or external Worker secrets.
Inventory any Storage/Vault dependencies before describing this as full-project
disaster recovery. The scoped migration leaves those resources and the existing
Worker encryption key untouched. Restoring encrypted credential bytes is useful
only while the original key remains available in the existing Worker; do not
copy or regenerate that key as part of this plan.

## Production recovery, if needed

- A failed migration transaction rolls back; confirm the ledger and original
  credential table remain unchanged before resuming traffic.
- Before new-code consent writes or final cleanup, retained old rows allow the
  previous Worker to read its existing credentials. Inspect any writes made by
  either code version before deciding on rollback.
- After new-code consent writes or cleanup, prefer a forward fix. An old-code
  rollback needs a reviewed reverse credential reconciliation and may lose new
  grants if restored blindly from an older snapshot.
- For database recovery, first restore the protected backup into isolation, verify
  it, then prepare a narrowly scoped repair that preserves unrelated post-backup
  CRM changes. A full production restore overwrites newer data and requires a
  separately reviewed outage/cutover decision; it is not authorized by this plan.

No migration or deployment may proceed until the backup and restore evidence
passes this gate, as explicitly requested by the owner.

References checked November 17, 2026:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
