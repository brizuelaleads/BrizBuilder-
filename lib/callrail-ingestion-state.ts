/**
 * What state a CallRail connection's ingestion is in, and what a person can do
 * about it.
 *
 * Switching ingestion off is two steps against two systems: a row in this
 * database, and a webhook configuration at CallRail. The local step is made to
 * succeed first, so the pair can rest in a third state — ingestion off, but
 * BrizBuilder's webhook URLs still registered at CallRail because that call
 * did not complete. That state is recoverable on its own and must not be
 * mistaken for either of the other two: offering "Enable ingestion" there
 * would switch calls back on to clear a cleanup, and offering nothing would
 * leave the URLs stranded until somebody disconnected the whole account.
 *
 * The decision lives here, in one dependency-free place, because the server
 * writes it and the browser reads it back and they have to agree.
 */

/** Ingestion is on; completed calls are becoming contacts and leads. */
export const CALLRAIL_INGESTION_ON = "on";
/** Ingestion is off and nothing of BrizBuilder's is left at CallRail. */
export const CALLRAIL_INGESTION_OFF = "off";
/** Ingestion is off, but BrizBuilder's webhook configuration is still there. */
export const CALLRAIL_INGESTION_CLEANUP_PENDING = "cleanup_pending";

export type CallRailIngestionView =
  | typeof CALLRAIL_INGESTION_ON
  | typeof CALLRAIL_INGESTION_OFF
  | typeof CALLRAIL_INGESTION_CLEANUP_PENDING;

export type CallRailIngestionFacts = {
  callIngestionEnabled?: boolean | null;
  callIngestionConfigured?: boolean | null;
  callIngestionCleanupPending?: boolean | null;
};

/**
 * The state to render, from what the server persisted.
 *
 * Enabled is only believed when it is exactly true: a connection made before
 * ingestion existed has no such field, and the absence of a flag is not
 * consent to ingest. Cleanup-pending is believed from either the named flag or
 * the shape it describes — off while still configured — so a connection whose
 * config was written by an older build is still recovered rather than being
 * offered the wrong button.
 */
export function callRailIngestionView(
  facts: CallRailIngestionFacts | null | undefined,
): CallRailIngestionView {
  if (facts?.callIngestionEnabled === true) return CALLRAIL_INGESTION_ON;
  const stranded =
    facts?.callIngestionCleanupPending === true ||
    facts?.callIngestionConfigured === true;
  return stranded ? CALLRAIL_INGESTION_CLEANUP_PENDING : CALLRAIL_INGESTION_OFF;
}

/**
 * The ingestion flags to persist after an attempt to switch ingestion off.
 *
 * `cleanupConfirmed` is whether CallRail confirmed the URLs were withdrawn.
 * Ingestion is off either way — the local write is what stops new calls, and
 * it has already succeeded by the time this is called — so the only thing in
 * question is whether anything is still registered over there.
 */
export function callRailIngestionFlags(cleanupConfirmed: boolean) {
  return {
    callIngestionEnabled: false,
    callIngestionConfigured: !cleanupConfirmed,
    callIngestionCleanupPending: !cleanupConfirmed,
    callIngestionEvents: [] as string[],
  };
}

/**
 * Whether a tenant-scoped single-row update actually touched one row.
 *
 * PostgREST reports an update that matched nothing as a success, so a disable
 * aimed at a business with no CallRail credential — a stale client id, a row
 * removed by a concurrent disconnect — would otherwise read as done and go on
 * to change the configuration at CallRail on the strength of it. Two rows is
 * refused for the same reason: the tenant scope is meant to identify exactly
 * one row, and if it did not, nothing here knows which one was meant.
 */
export function isSingleAffectedRow(rows: unknown): boolean {
  return Array.isArray(rows) && rows.length === 1;
}
