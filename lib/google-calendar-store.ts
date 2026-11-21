import {
  decryptGoogleSecret,
  refreshGoogleAccessToken,
} from "./google-business";
import {
  syncGoogleCalendarAppointment,
  type GoogleCalendarAppointment,
  type GoogleCalendarSyncResult,
} from "./google-calendar";
import { getSupabaseAdminClient } from "./supabase/server";
import { hasGoogleCalendarScope } from "./google-calendar-scopes";

type AppointmentForCalendar = GoogleCalendarAppointment & {
  leadId?: string | null;
  contactId?: string | null;
};

type AppointmentContact = { first_name?: string | null; last_name?: string | null };
type AppointmentRow = {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  service_type: string;
  starts_at: string;
  ends_at: string | null;
  notes: string | null;
  status: string;
  contacts: AppointmentContact | AppointmentContact[] | null;
};

export const GOOGLE_CALENDAR_APPOINTMENT_FIELDS =
  "id,lead_id,contact_id,service_type,starts_at,ends_at,notes,status,contacts(first_name,last_name)";

export function googleCalendarAppointmentFromRow(row: AppointmentRow): AppointmentForCalendar {
  const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
  const start = Date.parse(row.starts_at);
  const end = Date.parse(row.ends_at ?? "");
  return {
    id: row.id,
    leadId: row.lead_id,
    contactId: row.contact_id,
    contactName: `${contact?.first_name ?? ""} ${contact?.last_name ?? ""}`.trim() || "Customer",
    serviceType: row.service_type,
    startsAt: row.starts_at,
    // Older appointments can have no recorded end time.
    endsAt: row.ends_at && end > start ? row.ends_at : new Date(start + 30 * 60_000).toISOString(),
    notes: row.notes ?? "",
    status: row.status,
  };
}

export type StoredGoogleCalendarSyncResult =
  | GoogleCalendarSyncResult
  | { action: "not_connected" | "failed"; eventId: null };

async function checked<T>(promise: PromiseLike<{ data: T; error: unknown }>) {
  const result = await promise;
  if (result.error) throw new Error("Calendar database request failed.");
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

async function calendarCredential(organizationId: string, clientId: string) {
  const database = getSupabaseAdminClient();
  const select = (table: string) => database.from(table)
    .select("refresh_token_ciphertext,refresh_token_iv,scopes")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .maybeSingle();
  const preferred = await select("google_calendar_credentials");
  if (!preferred.error) return preferred.data;
  if (!missingCalendarCredentialTable(preferred.error)) {
    throw new Error("Calendar database request failed.");
  }
  return checked(select("google_business_credentials"));
}

async function appointmentLead(
  organizationId: string,
  clientId: string,
  { leadId, contactId }: Pick<AppointmentForCalendar, "leadId" | "contactId">,
) {
  if (!leadId && !contactId) return null;
  let query = getSupabaseAdminClient()
    .from("leads")
    .select("id,status")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .is("archived_at", null);
  if (leadId) query = query.eq("id", leadId);
  if (contactId) query = query.eq("contact_id", contactId);
  // A legacy contact-only appointment resolves only when the contact has one lead.
  const leads = await checked(query.limit(2));
  return leads?.length === 1 ? leads[0] : null;
}

export async function syncGoogleCalendarWithLead(
  token: string,
  organizationId: string,
  clientId: string,
  appointment: AppointmentForCalendar,
  connectionStartedAt?: string,
) {
  const lead = appointment.status === "CANCELED" ? null : await appointmentLead(organizationId, clientId, appointment);
  return syncGoogleCalendarAppointment(token, {
    ...appointment,
    workspaceId: clientId,
    connectionStartedAt,
    leadStatus: lead?.status,
  });
}

async function calendarAccess(organizationId: string, clientId: string) {
  const database = getSupabaseAdminClient();
  const [connection, credential] = await Promise.all([
    checked(
      database
        .from("provider_connections")
        .select("status,connected_at")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("provider", "google_calendar")
        .maybeSingle(),
    ),
    calendarCredential(organizationId, clientId),
  ]);
  if (!["connected", "attention"].includes(String(connection?.status ?? "")) || !credential) {
    return null;
  }
  const row = credential as Record<string, unknown>;
  const scopes = Array.isArray(row.scopes) ? row.scopes.map(String) : [];
  if (!hasGoogleCalendarScope(scopes)) return null;
  const refreshToken = await decryptGoogleSecret(
    {
      ciphertext: String(row.refresh_token_ciphertext),
      iv: String(row.refresh_token_iv),
    },
    organizationId,
    clientId,
  );
  const { accessToken } = await refreshGoogleAccessToken(refreshToken);
  return {
    token: accessToken,
    connectedAt: connection?.connected_at ? new Date(connection.connected_at).toISOString() : undefined,
  };
}

export async function syncLeadStatusToGoogleCalendar(
  organizationId: string,
  clientId: string,
  leadId: string,
  contactId: string | null,
) {
  try {
    const database = getSupabaseAdminClient();
    const [lead, contactLead] = await Promise.all([
      appointmentLead(organizationId, clientId, { leadId, contactId }),
      contactId ? appointmentLead(organizationId, clientId, { contactId }) : null,
    ]);
    if (!lead) return null;
    const appointments = database.from("appointments")
      .select(GOOGLE_CALENDAR_APPOINTMENT_FIELDS)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .in("status", ["SCHEDULED", "CONFIRMED"])
      .gte("starts_at", new Date().toISOString());
    const rows = await checked(contactLead?.id === leadId && contactId
      ? appointments.or(`lead_id.eq.${leadId},and(lead_id.is.null,contact_id.eq.${contactId})`)
      : appointments.eq("lead_id", leadId));
    if (!rows?.length) return null;

    const access = await calendarAccess(organizationId, clientId);
    if (!access) return null;
    const results = await Promise.allSettled(rows.map((row) => syncGoogleCalendarAppointment(
      access.token,
      { ...googleCalendarAppointmentFromRow(row), leadStatus: lead.status },
      { leadStatusOnly: true },
    )));
    if (results.some((result) => result.status === "rejected")) {
      return "Lead saved. Some Google Calendar events could not be updated.";
    }
    return null;
  } catch {
    return "Lead saved. Google Calendar could not be updated.";
  }
}

/**
 * Creates events idempotently within the current connection. The provider
 * event ID is useful state, but never the key we
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
    const access = await calendarAccess(organizationId, clientId);
    if (!access) return { action: "not_connected", eventId: null };
    const result = await syncGoogleCalendarWithLead(access.token, organizationId, clientId, appointment, access.connectedAt);
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
          .eq("provider", "google_calendar")
          .in("status", ["connected", "attention"]),
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
        .eq("provider", "google_calendar")
        .in("status", ["connected", "attention"]),
    );
    return { action: "failed", eventId: null };
  }
}
