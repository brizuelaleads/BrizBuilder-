// Calendly API client: OAuth, the current user, webhook subscriptions and the
// booking reads the background sync uses. Every token passed in belongs to the
// customer's own Calendly account; nothing here is billed to BrizBuilder.

import { readRuntimeValue } from "./supabase/env";
import {
  CALENDLY_API_BASE,
  CALENDLY_AUTH_BASE,
  CALENDLY_WEBHOOK_PATH,
  calendlyPkceChallenge,
  calendlyPkceVerifier,
  decryptCalendlySecret,
  encryptCalendlySecret,
  parseCalendlyKey,
  type CalendlyEncryptedValue,
  type CalendlyTokenKind,
} from "./calendly-core";

const REQUEST_TIMEOUT_MS = 15_000;

const REQUIRED_SETTINGS = [
  "CALENDLY_CLIENT_ID",
  "CALENDLY_CLIENT_SECRET",
  "CALENDLY_REDIRECT_URI",
  "CALENDLY_WEBHOOK_SIGNING_KEY",
  "CALENDLY_TOKEN_ENCRYPTION_KEY",
] as const;

export function getCalendlyRuntimeStatus() {
  const missing = REQUIRED_SETTINGS.filter((name) => !readRuntimeValue(name));
  return { ready: missing.length === 0, missing: [...missing] as string[] };
}

function config() {
  if (!getCalendlyRuntimeStatus().ready) throw new Error("Calendly is not configured on BrizBuilder yet.");
  const redirectUri = readRuntimeValue("CALENDLY_REDIRECT_URI");
  if (new URL(redirectUri).protocol !== "https:" && !/^http:\/\/localhost[:/]/u.test(redirectUri))
    throw new Error("CALENDLY_REDIRECT_URI must use HTTPS.");
  return {
    clientId: readRuntimeValue("CALENDLY_CLIENT_ID"),
    clientSecret: readRuntimeValue("CALENDLY_CLIENT_SECRET"),
    redirectUri,
    signingKey: readRuntimeValue("CALENDLY_WEBHOOK_SIGNING_KEY"),
    encryptionKey: parseCalendlyKey(readRuntimeValue("CALENDLY_TOKEN_ENCRYPTION_KEY")),
  };
}

export function calendlyWebhookSigningKey() {
  return readRuntimeValue("CALENDLY_WEBHOOK_SIGNING_KEY");
}

/**
 * Webhooks land on the host Calendly redirects people back to, unless
 * CALENDLY_WEBHOOK_BASE_URL points them elsewhere (for example the public
 * lead gateway, once it allows this path).
 */
export function calendlyWebhookUrl(pathId: string) {
  const base = new URL(readRuntimeValue("CALENDLY_WEBHOOK_BASE_URL") || config().redirectUri);
  if (base.protocol !== "https:") throw new Error("Calendly webhooks must use HTTPS.");
  return `${base.origin}${CALENDLY_WEBHOOK_PATH}/${pathId}`;
}

export function encryptCalendlyToken(value: string, organizationId: string, clientId: string, kind: CalendlyTokenKind) {
  return encryptCalendlySecret(config().encryptionKey, value, organizationId, clientId, kind);
}

export function decryptCalendlyToken(
  value: CalendlyEncryptedValue,
  organizationId: string,
  clientId: string,
  kind: CalendlyTokenKind,
) {
  return decryptCalendlySecret(config().encryptionKey, value, organizationId, clientId, kind);
}

// ---- Errors -----------------------------------------------------------------

/** A Calendly refusal with a message safe to show the person who connected. */
export class CalendlyApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CalendlyApiError";
    this.status = status;
  }
  get unauthorized() {
    return this.status === 401;
  }
}

async function request<T>(url: string, init: RequestInit, action: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new CalendlyApiError(0, `Calendly did not respond while ${action}. Try again.`);
  }
  if (response.status === 204) return undefined as T;
  // Calendly error bodies hold only a title/message, never token material, but
  // only those two fields are kept.
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail = [body?.title, body?.message, body?.error_description]
      .filter((value): value is string => typeof value === "string" && value.length < 300)
      .join(": ");
    throw new CalendlyApiError(
      response.status,
      response.status === 401
        ? "Calendly no longer accepts this connection. Reconnect Calendly."
        : `Calendly refused ${action}${detail ? ` (${detail})` : ""}.`,
    );
  }
  return body as T;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

// ---- OAuth ------------------------------------------------------------------

export async function buildCalendlyAuthorizationUrl(state: string) {
  const { clientId, redirectUri, encryptionKey } = config();
  const url = new URL("/oauth/authorize", CALENDLY_AUTH_BASE);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", await calendlyPkceChallenge(await calendlyPkceVerifier(encryptionKey, state)));
  return url.toString();
}

export type CalendlyTokens = { accessToken: string; refreshToken: string; expiresAt: string };

async function tokenRequest(params: Record<string, string>, action: string): Promise<CalendlyTokens> {
  const { clientId, clientSecret } = config();
  const body = await request<Record<string, unknown>>(
    new URL("/oauth/token", CALENDLY_AUTH_BASE).toString(),
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ client_id: clientId, ...params }),
    },
    action,
  );
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
  if (!accessToken || !refreshToken) throw new CalendlyApiError(502, "Calendly returned an incomplete sign-in. Try again.");
  // Calendly access tokens last about two hours; refresh a little early.
  const seconds = Number(body.expires_in);
  const lifetime = Number.isFinite(seconds) && seconds > 120 ? seconds : 7200;
  return { accessToken, refreshToken, expiresAt: new Date(Date.now() + (lifetime - 60) * 1000).toISOString() };
}

export async function exchangeCalendlyCode(code: string, state: string) {
  const { redirectUri, encryptionKey } = config();
  return tokenRequest(
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: await calendlyPkceVerifier(encryptionKey, state),
    },
    "the sign-in",
  );
}

/** Calendly refresh tokens are single-use: the returned pair replaces the old one. */
export function refreshCalendlyToken(refreshToken: string) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, "to renew the connection");
}

/** Best effort; a failure here never blocks a local disconnect. */
export async function revokeCalendlyToken(token: string) {
  const { clientId, clientSecret } = config();
  try {
    await request(
      new URL("/oauth/revoke", CALENDLY_AUTH_BASE).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token }),
      },
      "to revoke access",
    );
    return true;
  } catch {
    return false;
  }
}

// ---- API --------------------------------------------------------------------

export type CalendlyUser = {
  uri: string;
  name: string;
  email: string;
  schedulingUrl: string | null;
  timeZone: string | null;
  organizationUri: string;
};

export async function getCalendlyCurrentUser(token: string): Promise<CalendlyUser> {
  const body = await request<{ resource?: Record<string, unknown> }>(
    `${CALENDLY_API_BASE}/users/me`,
    { headers: bearer(token) },
    "to share the account details",
  );
  const user = body.resource ?? {};
  const uri = typeof user.uri === "string" ? user.uri : "";
  const organizationUri = typeof user.current_organization === "string" ? user.current_organization : "";
  if (!uri.startsWith(`${CALENDLY_API_BASE}/users/`) || !organizationUri)
    throw new CalendlyApiError(502, "Calendly returned an unexpected account. Try again.");
  return {
    uri,
    name: typeof user.name === "string" ? user.name.slice(0, 160) : "",
    email: typeof user.email === "string" ? user.email.slice(0, 200) : "",
    schedulingUrl: typeof user.scheduling_url === "string" ? user.scheduling_url.slice(0, 500) : null,
    timeZone: typeof user.timezone === "string" ? user.timezone.slice(0, 60) : null,
    organizationUri,
  };
}

/** Subscribes to this user's bookings and cancellations. Signed with the app's signing key. */
export async function createCalendlyWebhook(token: string, user: CalendlyUser, url: string) {
  const body = await request<{ resource?: { uri?: unknown } }>(
    `${CALENDLY_API_BASE}/webhook_subscriptions`,
    {
      method: "POST",
      headers: { ...bearer(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        events: ["invitee.created", "invitee.canceled"],
        organization: user.organizationUri,
        user: user.uri,
        scope: "user",
      }),
    },
    "to send booking updates",
  );
  const uri = typeof body.resource?.uri === "string" ? body.resource.uri : "";
  if (!uri.startsWith(`${CALENDLY_API_BASE}/webhook_subscriptions/`))
    throw new CalendlyApiError(502, "Calendly did not confirm the booking subscription.");
  return uri;
}

export async function deleteCalendlyWebhook(token: string, subscriptionUri: string) {
  if (!subscriptionUri.startsWith(`${CALENDLY_API_BASE}/webhook_subscriptions/`)) return;
  try {
    await request(subscriptionUri, { method: "DELETE", headers: bearer(token) }, "to stop booking updates");
  } catch (error) {
    // Already gone at Calendly is the outcome we wanted.
    if (!(error instanceof CalendlyApiError && error.status === 404)) throw error;
  }
}

type Page<T> = { collection?: T[]; pagination?: { next_page_token?: string | null } };
// Calendly objects are open-ended JSON; callers normalize what they read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

export async function listCalendlyEvents(
  token: string,
  userUri: string,
  window: { minStart: string; maxStart: string },
  pageToken?: string | null,
) {
  const url = new URL(`${CALENDLY_API_BASE}/scheduled_events`);
  url.searchParams.set("user", userUri);
  url.searchParams.set("min_start_time", window.minStart);
  url.searchParams.set("max_start_time", window.maxStart);
  url.searchParams.set("sort", "start_time:asc");
  url.searchParams.set("count", "100");
  if (pageToken) url.searchParams.set("page_token", pageToken);
  const body = await request<Page<Json>>(url.toString(), { headers: bearer(token) }, "to list bookings");
  return { events: body.collection ?? [], next: body.pagination?.next_page_token ?? null };
}

export async function listCalendlyInvitees(token: string, eventUri: string) {
  if (!eventUri.startsWith(`${CALENDLY_API_BASE}/scheduled_events/`)) return [];
  const url = new URL(`${eventUri}/invitees`);
  url.searchParams.set("count", "100");
  const body = await request<Page<Json>>(url.toString(), { headers: bearer(token) }, "to list invitees");
  return body.collection ?? [];
}
