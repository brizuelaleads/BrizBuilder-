// New consent requests only need events on the user's own primary calendar.
export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.owned";
export const LEGACY_GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

// Keep existing connections working until their owners reconnect voluntarily.
export function hasGoogleCalendarScope(scopes: readonly string[]) {
  return scopes.includes(GOOGLE_CALENDAR_SCOPE) ||
    scopes.includes(LEGACY_GOOGLE_CALENDAR_SCOPE);
}

export function googleCalendarAuthorizationScopes(useOwnedScope = true) {
  return [useOwnedScope ? GOOGLE_CALENDAR_SCOPE : LEGACY_GOOGLE_CALENDAR_SCOPE];
}

// A new, unverified scope must not reach unrelated production clients.
export function shouldUseOwnedGoogleCalendarScope(
  clientId: string,
  enabled: string,
  reviewClientIds: string,
) {
  return enabled === "true" || reviewClientIds.split(",").map((id) => id.trim())
    .filter(Boolean).includes(clientId);
}
