// Deciding which unfinished CallRail setups may be cleaned up, and for whom.
//
// Scope is the security property here, not the schedule. `call_tracking.manage`
// is held by client owners as well as agency staff, so a user-triggered cleanup
// runs on behalf of exactly one authorized client and must never reach another
// client's row — not to read it, not to delete it, not to change its status,
// and not to name it in an audit entry. Every filter below therefore carries
// both the organization and the client.
//
// There is deliberately no organization-wide variant. Sweeping a whole
// organization is a trusted operation: it belongs to a scheduled server process
// or an agency-admin-only action, and neither exists yet. Adding one here would
// let the client-facing path inherit a reach it must not have.
//
// Dependency-free so the scoping rules can be exercised directly in tests.

// Long enough that someone who steps away mid-setup and returns the next week
// finds their connection intact; short enough that a dangling encrypted key
// does not live indefinitely for a setup nobody completed.
export const ABANDONED_SETUP_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type AbandonedSetupFilter = {
  organizationId: string;
  clientId: string;
  updatedBefore: string;
};

/**
 * Builds the scope for one cleanup.
 *
 * Both ids are required and neither may be blank. An empty string would widen
 * the delete to every row in the organization once it reached a query builder,
 * so it is refused here rather than relied upon to be non-empty by every
 * caller.
 */
export function abandonedSetupFilter(
  organizationId: string,
  clientId: string,
  now: number = Date.now(),
): AbandonedSetupFilter {
  if (!organizationId)
    throw new Error("An organization is required to clean up CallRail setups.");
  if (!clientId)
    throw new Error("A client is required to clean up CallRail setups.");
  return {
    organizationId,
    clientId,
    updatedBefore: new Date(now - ABANDONED_SETUP_TTL_MS).toISOString(),
  };
}

export type AbandonedSetupCandidate = {
  organization_id: string;
  client_id: string;
  company_id: string | null;
  updated_at: string;
};

/**
 * The same predicate the delete applies, expressed so it can be tested without
 * a database. The store builds its query directly from a filter produced above,
 * so this and the executed statement cannot describe different rows.
 */
export function matchesAbandonedSetup(
  row: AbandonedSetupCandidate,
  filter: AbandonedSetupFilter,
): boolean {
  if (row.organization_id !== filter.organizationId) return false;
  if (row.client_id !== filter.clientId) return false;
  // A selected company means the connection is usable, whatever its age.
  if (row.company_id !== null) return false;
  return row.updated_at < filter.updatedBefore;
}
