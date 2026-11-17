import { getSupabaseAdminClient } from "./supabase/server";
import { decryptGoogleSecret, revokeGoogleRefreshToken } from "./google-business";
import { disconnectGoogleAccess } from "./google-disconnect";

async function checked<T>(promise: PromiseLike<{ data: T; error: unknown }>) {
  const result = await promise;
  if (result.error) throw new Error("Google connection data could not be updated.");
  return result.data;
}

// Call only after the actor's permission and tenant/client access are checked.
export async function disconnectStoredGoogleAccess(organizationId: string, clientId: string) {
  const database = getSupabaseAdminClient();
  const providers = ["google_calendar", "google_business_profile"];
  const credentialTables = ["google_calendar_credentials", "google_business_credentials"];
  const now = new Date().toISOString();
  return disconnectGoogleAccess({
    stopSync: async () => {
      await checked(database.from("provider_connections")
        .update({ status: "disconnected", disconnected_at: now, last_error: null, updated_at: now })
        .eq("organization_id", organizationId).eq("client_id", clientId).in("provider", providers));
      await checked(database.from("provider_authorization_states").delete()
        .eq("organization_id", organizationId).eq("client_id", clientId).in("provider", providers));
    },
    loadRefreshTokens: async () => {
      const credentials = await Promise.all(credentialTables.map((table) =>
        checked(database.from(table).select("refresh_token_ciphertext,refresh_token_iv")
          .eq("organization_id", organizationId).eq("client_id", clientId).maybeSingle())));
      return Promise.all(credentials.filter((credential) => credential !== null).map((credential) =>
        decryptGoogleSecret({ ciphertext: String(credential.refresh_token_ciphertext),
          iv: String(credential.refresh_token_iv) }, organizationId, clientId)));
    },
    revoke: revokeGoogleRefreshToken,
    deleteLocalData: async () => {
      // Attempt every cleanup even if one database request fails.
      const results = await Promise.allSettled([
        ...credentialTables.map((table) => checked(database.from(table).delete()
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
