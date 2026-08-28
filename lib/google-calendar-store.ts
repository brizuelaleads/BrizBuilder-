import {
  decryptGoogleSecret,
  GOOGLE_CALENDAR_SCOPE,
  refreshGoogleAccessToken,
} from "./google-business";
import {
  syncGoogleCalendarAppointment,
  type GoogleCalendarSyncResult,
} from "./google-calendar";
import { getSupabaseAdminClient } from "./supabase/server";

type AppointmentForCalendar = {
  id: string;
  contactName: string;
  serviceType: string;
  startsAt: string;
  endsAt: string;
  notes: string;
  status: string;
};

export type StoredGoogleCalendarSyncResult =
  | GoogleCalendarSyncResult
  | { action: "not_connected" | "failed"; eventId: null };

async function checked<T>(promise: PromiseLike<{ data: T; error: unknown }>) {
  const result = await promise;
  if (result.error) throw new Error("Calendar database request failed.");
  return result.data;
}

async function accessToken(organizationId: string, clientId: string) {
  const database = getSupabaseAdminClient();
  const [connection, credential] = await Promise.all([
    checked(
      database
        .from("provider_connections")
        .select("status")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("provider", "google_calendar")
        .maybeSingle(),
    ),
    checked(
      database
        .from("google_business_credentials")
        .select("refresh_token_ciphertext,refresh_token_iv,scopes")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .maybeSingle(),
    ),
  ]);
  if (String((connection as Record<string, unknown> | null)?.status ?? "") !== "connected" || !credential) {
    return null;
  }
  const row = credential as Record<string, unknown>;
  const scopes = Array.isArray(row.scopes) ? row.scopes.map(String) : [];
  if (!scopes.includes(GOOGLE_CALENDAR_SCOPE)) return null;
  const refreshToken = await decryptGoogleSecret(
    {
      ciphertext: String(row.refresh_token_ciphertext),
      iv: String(row.refresh_token_iv),
    },
    organizationId,
    clientId,
  );
  return (await refreshGoogleAccessToken(refreshToken)).accessToken;
}

/**
 * Syncs one stored appointment using its BrizBuilder id as the Google-side
 * idempotency key. The provider event id is useful state, but never the key we
 * trust for finding an event: a partial database write can therefore be safely
 * retried without creating a second event.
 */
export async function syncStoredAppointmentToGoogleCalendar(
  organizationId: string,
  clientId: string,
  appointment: AppointmentForCalendar,
): Promise<StoredGoogleCalendarSyncResult> {
  const database = getSupabaseAdminClient();
  try {
    const token = await accessToken(organizationId, clientId);
    if (!token) return { action: "not_connected", eventId: null };
    const result = await syncGoogleCalendarAppointment(token, appointment);
    const now = new Date().toISOString();
    await Promise.all([
      checked(
        database
          .from("appointments")
          .update({ calendar_event_id: result.eventId, updated_at: now })
          .eq("id", appointment.id)
          .eq("organization_id", organizationId)
          .eq("client_id", clientId),
      ),
      checked(
        database
          .from("provider_connections")
          .update({
            status: "connected",
            last_error: null,
            last_health_check_at: now,
            updated_at: now,
          })
          .eq("organization_id", organizationId)
          .eq("client_id", clientId)
          .eq("provider", "google_calendar"),
      ),
    ]);
    return result;
  } catch (error) {
    const now = new Date().toISOString();
    await checked(
      database
        .from("provider_connections")
        .update({
          status: "attention",
          last_error:
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Google Calendar sync failed.",
          last_health_check_at: now,
          updated_at: now,
        })
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("provider", "google_calendar"),
    );
    return { action: "failed", eventId: null };
  }
}
