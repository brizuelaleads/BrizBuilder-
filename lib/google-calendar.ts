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
      throw new Error(
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
) {
  const eventId = await findGoogleCalendarEvent(
    accessToken,
    appointment.id,
  );
  if (appointment.status === "CANCELED") {
    if (!eventId) return;
    const url = new URL(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    );
    url.searchParams.set("sendUpdates", "none");
    await googleCalendarRequest(accessToken, url, { method: "DELETE" });
    return;
  }

  const start = new Date(appointment.startsAt);
  const end = new Date(appointment.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("The appointment time is invalid for Google Calendar.");
  }
  const body = JSON.stringify({
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
  const url = eventId
    ? new URL(
        `${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
      )
    : new URL(`${GOOGLE_CALENDAR_API}/calendars/primary/events`);
  url.searchParams.set("sendUpdates", "none");
  await googleCalendarRequest(accessToken, url, {
    method: eventId ? "PUT" : "POST",
    body,
  });
}

