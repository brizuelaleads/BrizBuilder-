const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_CALENDAR_TIMEOUT_MS = 10_000;

type GoogleCalendarAppointment = {
  id: string;
  contactName: string;
  serviceType: string;
  startsAt: string;
  endsAt: string;
  notes: string;
  status: string;
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
  await googleCalendarRequest(accessToken, url);
}

export async function syncGoogleCalendarAppointment(
  accessToken: string,
  appointment: GoogleCalendarAppointment,
): Promise<GoogleCalendarSyncResult> {
  const existingEventId = await findGoogleCalendarEvent(
    accessToken,
    appointment.id,
  );
  if (appointment.status === "CANCELED") {
    if (!existingEventId) return { action: "unchanged", eventId: null };
    const url = new URL(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(existingEventId)}`,
    );
    url.searchParams.set("sendUpdates", "none");
    await googleCalendarRequest(accessToken, url, { method: "DELETE" });
    return { action: "cancelled", eventId: null };
  }

  const start = new Date(appointment.startsAt);
  const end = new Date(appointment.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("The appointment time is invalid for Google Calendar.");
  }
  const deterministicEventId = await googleCalendarEventId(appointment.id);
  const body = JSON.stringify({
    ...(!existingEventId ? { id: deterministicEventId } : {}),
    summary: `${appointment.serviceType} — ${appointment.contactName}`,
    description: appointment.notes
      ? `${appointment.notes}\n\nSynced from BrizBuilder`
      : "Synced from BrizBuilder",
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: {
      private: { brizbuilderAppointmentId: appointment.id },
    },
  });
  const url = existingEventId
    ? new URL(
        `${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(existingEventId)}`,
      )
    : new URL(`${GOOGLE_CALENDAR_API}/calendars/primary/events`);
  url.searchParams.set("sendUpdates", "none");
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
    const conflictUrl = new URL(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(deterministicEventId)}`,
    );
    conflictUrl.searchParams.set("sendUpdates", "none");
    await googleCalendarRequest(accessToken, conflictUrl, {
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

