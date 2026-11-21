import { getSupabaseAdminClient } from "./supabase/server";
import { decryptGoogleSecret, refreshGoogleAccessToken, revokeGoogleRefreshToken } from "./google-business";
import { removeWorkspaceGoogleCalendarAppointments } from "./google-calendar";
import { hasGoogleCalendarScope } from "./google-calendar-scopes";
import { disconnectGoogleAccess } from "./google-disconnect";

async function checked<T>(promise: PromiseLike<{ data: T; error: unknown }>) {
  const result = await promise;
  if (result.error) throw new Error("Google connection data could not be updated.");
  return result.data;
}

function missingCalendarCredentialTable(error: unknown) {
  const value = error as { code?: unknown; message?: unknown } | null;
  const code = String(value?.code ?? "");
  const message = String(value?.message ?? "");
  return code === "42P01" || code === "PGRST205" ||
    (message.includes("google_calendar_credentials") &&
      (message.includes("does not exist") || message.includes("schema cache")));
}

async function optionalCalendarTable<T>(
  table: string,
  request: PromiseLike<{ data: T; error: unknown }>,
) {
  const result = await request;
  if (!result.error) return result.data;
  if (table === "google_calendar_credentials" && missingCalendarCredentialTable(result.error)) {
    return null;
  }
  throw new Error("Google connection data could not be updated.");
}

// Call only after the actor's permission and tenant/client access are checked.
export async function disconnectStoredGoogleAccess(
  organizationId: string,
  clientId: string,
  source: "calendar" | "profile",
) {
  const database = getSupabaseAdminClient();
  const providers = ["google_calendar", "google_business_profile"];
  const credentialTables = ["google_calendar_credentials", "google_business_credentials"];
  const now = new Date().toISOString();
  const loadCredentials = () => Promise.all(credentialTables.map((table) =>
    optionalCalendarTable(table, database.from(table).select("refresh_token_ciphertext,refresh_token_iv,scopes")
      .eq("organization_id", organizationId).eq("client_id", clientId).maybeSingle())));
  let credentials: ReturnType<typeof loadCredentials> | undefined;
  const getCredentials = () => credentials ??= loadCredentials();

  async function* appointmentIds() {
    let cursor: string | null = null;
    const pageSize = 250;
    for (;;) {
      let query = database.from("appointments").select("id")
        .eq("organization_id", organizationId).eq("client_id", clientId)
        .order("id", { ascending: true }).limit(pageSize);
      if (cursor) query = query.gt("id", cursor);
      const rows = await checked(query);
      if (!rows?.length) return;
      yield rows.map((row) => String(row.id));
      if (rows.length < pageSize) return;
      cursor = String(rows[rows.length - 1].id);
    }
  }

  return disconnectGoogleAccess({
    stopSync: async () => {
      await checked(database.from("provider_connections")
        .update({ status: "disconnected", disconnected_at: now, last_error: null, updated_at: now })
        .eq("organization_id", organizationId).eq("client_id", clientId).in("provider", providers));
      await checked(database.from("provider_authorization_states").delete()
        .eq("organization_id", organizationId).eq("client_id", clientId).in("provider", providers));
    },
    removeCalendarAppointments: source === "calendar" ? async () => {
      const [calendar, legacy] = await getCredentials();
      const credential = calendar ?? legacy;
      const scopes = Array.isArray(credential?.scopes) ? credential.scopes.map(String) : [];
      if (!credential || !hasGoogleCalendarScope(scopes)) {
        throw new Error("Calendar permission is unavailable for unlink cleanup.");
      }
      const refreshToken = await decryptGoogleSecret({
        ciphertext: String(credential.refresh_token_ciphertext),
        iv: String(credential.refresh_token_iv),
      }, organizationId, clientId);
      const { accessToken } = await refreshGoogleAccessToken(refreshToken);
      return removeWorkspaceGoogleCalendarAppointments(accessToken, clientId, appointmentIds());
    } : undefined,
    loadRefreshTokens: async () => {
      const rows = await getCredentials();
      return Promise.all(rows.filter((credential) => credential !== null).map((credential) =>
        decryptGoogleSecret({ ciphertext: String(credential.refresh_token_ciphertext),
          iv: String(credential.refresh_token_iv) }, organizationId, clientId)));
    },
    revoke: revokeGoogleRefreshToken,
    deleteLocalData: async () => {
      // Attempt every cleanup even if one database request fails.
      const results = await Promise.allSettled([
        ...credentialTables.map((table) => optionalCalendarTable(table, database.from(table).delete()
          .eq("organization_id", organizationId).eq("client_id", clientId))),
        checked(database.from("appointments").update({ calendar_event_id: null })
          .eq("organization_id", organizationId).eq("client_id", clientId)),
        checked(database.from("google_business_profiles").update({
          status: "disconnected", account_id: null, account_name: null,
          location_name: null, location_id: null, business_name: null,
          address: null, phone: null, website: null, primary_category: null,
          last_synced_at: null, connected_at: null, last_error: null, updated_at: now,
        }).eq("organization_id", organizationId).eq("client_id", clientId)),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("Google syncing stopped, but some connection data could not be removed. Retry disconnect or contact support.");
      }
    },
  });
}
