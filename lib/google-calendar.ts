const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_CALENDAR_TIMEOUT_MS = 10_000;

export type GoogleCalendarAppointment = {
  id: string;
  contactName: string;
  serviceType: string;
  startsAt: string;
  endsAt: string;
  notes: string;
  status: string;
  leadStatus?: string | null;
};

const APPOINTMENT_APPEARANCE = {
  SCHEDULED: { label: "Scheduled", colorId: "9", googleStatus: "tentative" },
  CONFIRMED: { label: "Confirmed", colorId: "10", googleStatus: "confirmed" },
  COMPLETED: { label: "Completed", colorId: "8", googleStatus: "confirmed" },
  NO_SHOW: { label: "No-show", colorId: "6", googleStatus: "confirmed" },
} satisfies Record<string, { label: string; colorId: string; googleStatus: "tentative" | "confirmed" }>;

// Use the closest colors in Google's fixed palette to the Leads status badges.
const LEAD_APPEARANCE = {
  NEW: { label: "New", colorId: "3" },
  CONTACTED: { label: "Contacted", colorId: "6" },
  QUALIFIED: { label: "Qualified", colorId: "7" },
  APPOINTMENT_BOOKED: { label: "Appointment booked", colorId: "7" },
  ESTIMATE_SENT: { label: "Estimate sent", colorId: "7" },
  WON: { label: "Won", colorId: "10" },
  LOST: { label: "Lost", colorId: "11" },
  SPAM: { label: "Spam", colorId: "11" },
  UNRESPONSIVE: { label: "Unresponsive", colorId: "11" },
};

type GoogleCalendarEvent = {
  id?: string;
};

class GoogleCalendarRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GoogleCalendarRequestError";
    this.status = status;
  }
}

export type GoogleCalendarSyncResult = {
  action: "created" | "updated" | "cancelled" | "unchanged";
  eventId: string | null;
};

async function googleCalendarRequest(
  accessToken: string,
  url: string | URL,
  init: RequestInit = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    GOOGLE_CALENDAR_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new GoogleCalendarRequestError(
        response.status,
        payload?.error?.message
          ? `Google Calendar: ${payload.error.message.slice(0, 240)}`
          : `Google Calendar request failed (${response.status}).`,
      );
    }
    return response;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Google Calendar did not respond in time.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const BASE32HEX = "0123456789abcdefghijklmnopqrstuv";

/** Stable base32hex provider id for one BrizBuilder appointment. */
export async function googleCalendarEventId(
  appointmentId: string,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(appointmentId),
    ),
  );
  let bits = 0;
  let buffer = 0;
  let encoded = "";
  for (const byte of digest) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32HEX[(buffer >>> bits) & 31];
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0) encoded += BASE32HEX[(buffer << (5 - bits)) & 31];
  return `bb${encoded}`;
}

async function findGoogleCalendarEvent(
  accessToken: string,
  appointmentId: string,
) {
  const url = new URL(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events`,
  );
  url.searchParams.set(
    "privateExtendedProperty",
    `brizbuilderAppointmentId=${appointmentId}`,
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("fields", "items(id)");
  const response = await googleCalendarRequest(accessToken, url);
  const payload = (await response.json()) as {
    items?: GoogleCalendarEvent[];
  };
  return payload.items?.[0]?.id ?? null;
}

export async function verifyGoogleCalendarAccess(accessToken: string) {
  const url = new URL(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events`,
  );
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("singleEvents", "true");
  // Verify access without reading unrelated event contents.
  url.searchParams.set("privateExtendedProperty", "brizbuilderConnectionCheck=true");
  url.searchParams.set("fields", "items(id)");
  await googleCalendarRequest(accessToken, url);
}

function googleCalendarWriteUrl(eventId?: string | null, returnsEvent = true) {
  const resource = eventId ? `/${encodeURIComponent(eventId)}` : "";
  const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/primary/events${resource}`);
  url.searchParams.set("sendUpdates", "none");
  if (returnsEvent) url.searchParams.set("fields", "id");
  return url;
}

export async function syncGoogleCalendarAppointment(
  accessToken: string,
  appointment: GoogleCalendarAppointment,
  { leadStatusOnly = false }: { leadStatusOnly?: boolean } = {},
): Promise<GoogleCalendarSyncResult> {
  const existingEventId = await findGoogleCalendarEvent(
    accessToken,
    appointment.id,
  );
  if (appointment.status === "CANCELED") {
    if (!existingEventId) return { action: "unchanged", eventId: null };
    await googleCalendarRequest(accessToken, googleCalendarWriteUrl(existingEventId, false), { method: "DELETE" });
    return { action: "cancelled", eventId: null };
  }

  const appointmentAppearance =
    APPOINTMENT_APPEARANCE[appointment.status as keyof typeof APPOINTMENT_APPEARANCE] ?? APPOINTMENT_APPEARANCE.SCHEDULED;
  const leadAppearance = appointment.leadStatus
    ? LEAD_APPEARANCE[appointment.leadStatus as keyof typeof LEAD_APPEARANCE]
    : undefined;
  const appearance = {
    summary: `${appointmentAppearance.label} · ${appointment.serviceType} — ${appointment.contactName}`,
    description: [
      `Appointment status: ${appointmentAppearance.label}`,
      ...(leadAppearance ? [`Lead status: ${leadAppearance.label}`] : []),
      ...(appointment.notes ? ["", appointment.notes] : []),
      "",
      "Synced from BrizBuilder",
    ].join("\n"),
    colorId: leadAppearance?.colorId ?? appointmentAppearance.colorId,
    status: appointmentAppearance.googleStatus,
  };
  if (leadStatusOnly) {
    if (!existingEventId) return { action: "unchanged", eventId: null };
    await googleCalendarRequest(accessToken, googleCalendarWriteUrl(existingEventId), {
      method: "PATCH",
      body: JSON.stringify(appearance),
    });
    return { action: "updated", eventId: existingEventId };
  }

  const start = new Date(appointment.startsAt);
  const end = new Date(appointment.endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error("The appointment time is invalid for Google Calendar.");
  }
  const deterministicEventId = existingEventId ?? await googleCalendarEventId(appointment.id);
  const body = JSON.stringify({
    ...(!existingEventId ? { id: deterministicEventId } : {}),
    ...appearance,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: {
      private: { brizbuilderAppointmentId: appointment.id },
    },
  });
  const url = googleCalendarWriteUrl(existingEventId);
  let response: Response;
  try {
    response = await googleCalendarRequest(accessToken, url, {
      method: existingEventId ? "PUT" : "POST",
      body,
    });
  } catch (error) {
    if (
      existingEventId ||
      !(error instanceof GoogleCalendarRequestError) ||
      error.status !== 409
    ) {
      throw error;
    }
    // A concurrent creator won after our lookup. PUT converges both workers
    // on the deterministic resource rather than creating a second event.
    await googleCalendarRequest(accessToken, googleCalendarWriteUrl(deterministicEventId), {
      method: "PUT",
      body,
    });
    return { action: "updated", eventId: deterministicEventId };
  }
  if (existingEventId) {
    return { action: "updated", eventId: existingEventId };
  }
  const created = (await response.json()) as GoogleCalendarEvent;
  return {
    action: "created",
    eventId:
      typeof created.id === "string" && created.id
        ? created.id
        : deterministicEventId,
  };
}

