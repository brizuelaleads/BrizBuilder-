import { abandonedSetupFilter } from "./callrail-cleanup";
import {
  CallRailApiError,
  decryptCallRailSecret,
  getCallRailAccount,
  getCallRailCompany,
  type CallRailAccount,
  type CallRailCompany,
  type CallRailStatus,
} from "./callrail";
import { getSupabaseAdminClient } from "./supabase/server";

// Loading and using a customer's CallRail API key. Kept separate from the
// provider client so the key only ever materializes inside a single call, and
// so nothing that returns to a browser is ever built in the same place the key
// is read.

type CallRailCredentialRow = {
  account_id: string | null;
  account_name: string | null;
  company_id: string | null;
  company_name: string | null;
  api_key_ciphertext: string;
  api_key_iv: string;
};

/** Where a connection is in the account-then-company setup sequence. */
export type CallRailSetupStatus = "needs_account" | "needs_company" | "ready";

export type CallRailConnectionCheck = {
  // False when this client has no CallRail connection, which is the normal
  // case rather than a failure.
  attempted: boolean;
  ok: boolean;
  status: CallRailStatus | null;
  setupStatus: CallRailSetupStatus | null;
  // Present only on a successful check of a fully configured connection.
  account: CallRailAccount | null;
  company: CallRailCompany | null;
  // Transient diagnostic for the authenticated admin who triggered the check.
  // Never persisted — the credentials table stores only the closed-vocabulary
  // status, because a provider response can echo back request material.
  message: string | null;
};

async function loadCredentialRow(
  organizationId: string,
  clientId: string,
): Promise<CallRailCredentialRow | null> {
  const result = await getSupabaseAdminClient()
    .from("callrail_credentials")
    .select(
      "account_id,account_name,company_id,company_name,api_key_ciphertext,api_key_iv",
    )
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as CallRailCredentialRow | null) ?? null;
}

export async function hasCallRailConnection(
  organizationId: string,
  clientId: string,
): Promise<boolean> {
  return Boolean(await loadCredentialRow(organizationId, clientId));
}

export function callRailSetupStatus(row: {
  account_id: string | null;
  company_id: string | null;
}): CallRailSetupStatus {
  if (!row.account_id) return "needs_account";
  if (!row.company_id) return "needs_company";
  return "ready";
}

export type CallRailApiAccess = {
  accountId: string | null;
  accountName: string | null;
  companyId: string | null;
  companyName: string | null;
  apiKey: string;
};

/**
 * Decrypts this client's API key for a single caller.
 *
 * Throws when there is no connection, so callers that genuinely require one
 * fail loudly rather than proceeding with an empty key. The returned value is
 * short-lived by convention: hold it for one request, never store it, and never
 * put it in anything returned to a caller.
 */
export async function loadCallRailApiAccess(
  organizationId: string,
  clientId: string,
): Promise<CallRailApiAccess> {
  const row = await loadCredentialRow(organizationId, clientId);
  if (!row) throw new Error("CallRail is not connected for this business.");
  const apiKey = await decryptCallRailSecret(
    { ciphertext: row.api_key_ciphertext, iv: row.api_key_iv },
    organizationId,
    clientId,
  );
  return {
    accountId: row.account_id ? String(row.account_id) : null,
    accountName: row.account_name ? String(row.account_name) : null,
    companyId: row.company_id ? String(row.company_id) : null,
    companyName: row.company_name ? String(row.company_name) : null,
    apiKey,
  };
}

/**
 * Deletes this client's credential row if its setup was started and never
 * finished.
 *
 * "Never finished" means no company was ever selected, which is the only state
 * the connection cannot be used from. A row with a company is a working
 * connection and is never touched here, however old it is.
 *
 * Scoped to a single authorized (organization, client) pair. The caller must
 * already have proved the actor may act on that client — `call_tracking.manage`
 * is held by client owners too, so a cleanup that reached across the
 * organization would let one business delete another's row, flip its connection
 * status, and appear in its audit trail. Nothing here touches any other client.
 *
 * Driven from the CallRail actions themselves, so cleanup happens without a
 * scheduler. Deliberately never throws: cleanup is hygiene, and a failure to
 * tidy must not fail the operation that triggered it.
 */
export async function purgeAbandonedCallRailSetup(
  organizationId: string,
  clientId: string,
): Promise<boolean> {
  try {
    const filter = abandonedSetupFilter(organizationId, clientId);
    const deleted = await getSupabaseAdminClient()
      .from("callrail_credentials")
      .delete()
      .eq("organization_id", filter.organizationId)
      .eq("client_id", filter.clientId)
      .is("company_id", null)
      .lt("updated_at", filter.updatedBefore)
      .select("client_id");
    if (deleted.error) return false;
    const rows = (deleted.data ?? []) as Array<{ client_id: string }>;
    if (rows.length === 0) return false;

    const now = new Date().toISOString();
    await getSupabaseAdminClient()
      .from("provider_connections")
      .update({
        status: "disconnected",
        external_account_id: null,
        external_account_name: null,
        disconnected_at: now,
        last_error: "Setup was never completed and has been cleared.",
        public_config: {},
        updated_at: now,
      })
      .eq("organization_id", filter.organizationId)
      .eq("client_id", filter.clientId)
      .eq("provider", "callrail");
    return true;
  } catch {
    return false;
  }
}

async function recordCheck(
  organizationId: string,
  clientId: string,
  status: CallRailStatus,
) {
  const now = new Date().toISOString();
  await getSupabaseAdminClient()
    .from("callrail_credentials")
    .update({ last_checked_at: now, last_status: status, updated_at: now })
    .eq("organization_id", organizationId)
    .eq("client_id", clientId);
}

/**
 * Confirms the stored key still works and reports what CallRail currently says
 * about the selected account and company.
 *
 * Both are re-fetched, not just the company. A key can be rotated to one that
 * still reads the company but no longer reaches the account, and a check that
 * only asked about the company would call that healthy.
 *
 * Deliberately never throws. A health check runs from the Connections card and
 * from scheduled work; neither may fail because a provider is down, unreachable
 * or had its key rotated. A client with no CallRail connection is the normal
 * case, not an error.
 */
export async function checkCallRailConnection(
  organizationId: string,
  clientId: string,
): Promise<CallRailConnectionCheck> {
  const quiet: CallRailConnectionCheck = {
    attempted: false,
    ok: false,
    status: null,
    setupStatus: null,
    account: null,
    company: null,
    message: null,
  };
  try {
    const row = await loadCredentialRow(organizationId, clientId);
    if (!row) return quiet;

    const setupStatus = callRailSetupStatus(row);
    // Mid-setup is not a fault. It is reported without calling CallRail and
    // without recording a failure status against the credential.
    if (setupStatus !== "ready") {
      return {
        attempted: true,
        ok: false,
        status: null,
        setupStatus,
        account: null,
        company: null,
        message:
          setupStatus === "needs_account"
            ? "Choose which CallRail account this business uses."
            : "Choose which CallRail company this business uses.",
      };
    }

    const apiKey = await decryptCallRailSecret(
      { ciphertext: row.api_key_ciphertext, iv: row.api_key_iv },
      organizationId,
      clientId,
    );
    const account = await getCallRailAccount(String(row.account_id), apiKey);
    const company = await getCallRailCompany(
      String(row.account_id),
      String(row.company_id),
      apiKey,
    );
    await recordCheck(organizationId, clientId, "ok");
    return {
      attempted: true,
      ok: true,
      status: "ok",
      setupStatus: "ready",
      account,
      company,
      message: null,
    };
  } catch (error) {
    const status: CallRailStatus =
      error instanceof CallRailApiError ? error.status : "error";
    const message =
      error instanceof CallRailApiError
        ? error.message
        : "BrizBuilder could not check the CallRail connection.";
    // Best effort: if the credential row is unreadable the update is a no-op,
    // and a failed health check must not itself throw.
    try {
      await recordCheck(organizationId, clientId, status);
    } catch {
      // Nothing further to do — the outcome is already being returned.
    }
    return {
      attempted: true,
      ok: false,
      status,
      setupStatus: "ready",
      account: null,
      company: null,
      message,
    };
  }
}
