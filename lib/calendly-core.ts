// Calendly pieces with no network or database access: token encryption, the
// PKCE verifier, webhook signature checks, and turning Calendly's invitee and
// event objects into the fields BrizBuilder stores. Kept free of runtime
// imports so tests can load it directly.

export const CALENDLY_AUTH_BASE = "https://auth.calendly.com";
export const CALENDLY_API_BASE = "https://api.calendly.com";
export const CALENDLY_WEBHOOK_PATH = "/api/integrations/calendly/webhook";
/** Calendly's own examples reject signatures older than three minutes. */
export const CALENDLY_SIGNATURE_TOLERANCE_SECONDS = 180;

// ---- Encoding ---------------------------------------------------------------

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function toHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A 32-byte key given as 64 hex characters or base64url. */
export function parseCalendlyKey(configured: string): Uint8Array {
  let bytes: Uint8Array;
  if (/^[0-9a-f]{64}$/iu.test(configured)) {
    bytes = Uint8Array.from(configured.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
  } else {
    try {
      bytes = base64UrlToBytes(configured);
    } catch {
      throw new Error("CALENDLY_TOKEN_ENCRYPTION_KEY must be a 32-byte key.");
    }
  }
  if (bytes.byteLength !== 32) throw new Error("CALENDLY_TOKEN_ENCRYPTION_KEY must be a 32-byte key.");
  return bytes;
}

// ---- Token encryption -------------------------------------------------------

export type CalendlyEncryptedValue = { ciphertext: string; iv: string };
export type CalendlyTokenKind = "access" | "refresh";

/** The tenant is bound into the ciphertext, so a token moved onto another business's row will not decrypt. */
function tokenScope(organizationId: string, clientId: string, kind: CalendlyTokenKind) {
  return new TextEncoder().encode(`brizbuilder:calendly:${organizationId}:${clientId}:${kind}:v1`);
}

function aesKey(keyBytes: Uint8Array) {
  return crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptCalendlySecret(
  keyBytes: Uint8Array,
  plaintext: string,
  organizationId: string,
  clientId: string,
  kind: CalendlyTokenKind,
): Promise<CalendlyEncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: tokenScope(organizationId, clientId, kind) as BufferSource },
    await aesKey(keyBytes),
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

export async function decryptCalendlySecret(
  keyBytes: Uint8Array,
  encrypted: CalendlyEncryptedValue,
  organizationId: string,
  clientId: string,
  kind: CalendlyTokenKind,
): Promise<string> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(encrypted.iv) as BufferSource,
        additionalData: tokenScope(organizationId, clientId, kind) as BufferSource,
      },
      await aesKey(keyBytes),
      base64UrlToBytes(encrypted.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("The stored Calendly connection could not be read. Reconnect Calendly.");
  }
}

// ---- PKCE -------------------------------------------------------------------

async function hmac(keyBytes: Uint8Array, message: string, hash: "SHA-256") {
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/**
 * Calendly requires PKCE. The verifier is derived from the one-time state with
 * a server-only key rather than stored: the state lives only in the person's
 * browser (the database keeps its hash), so nobody holding the database alone
 * can rebuild a verifier, and no extra column is needed.
 */
export async function calendlyPkceVerifier(keyBytes: Uint8Array, state: string) {
  return bytesToBase64Url(await hmac(keyBytes, `brizbuilder:calendly:pkce:${state}`, "SHA-256"));
}

export async function calendlyPkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

// ---- Webhooks ---------------------------------------------------------------

export function isCalendlyWebhookPathId(value: string) {
  return /^[A-Za-z0-9_-]{43}$/u.test(value);
}

export function createCalendlyWebhookPathId() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Checks `Calendly-Webhook-Signature: t=<unix seconds>,v1=<hex>` against
 * HMAC-SHA256(signingKey, `${t}.${rawBody}`). Never throws; any malformed input
 * is simply not verified.
 */
export async function verifyCalendlySignature(
  rawBody: string,
  header: string | null,
  signingKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  try {
    if (!header || !signingKey) return false;
    const parts = new Map(
      header.split(",").map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const;
      }),
    );
    const timestamp = parts.get("t") ?? "";
    const signature = (parts.get("v1") ?? "").toLowerCase();
    if (!/^\d{1,12}$/u.test(timestamp) || !/^[0-9a-f]{64}$/u.test(signature)) return false;
    if (Math.abs(nowSeconds - Number(timestamp)) > CALENDLY_SIGNATURE_TOLERANCE_SECONDS) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(signingKey) as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const expected = Uint8Array.from(signature.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
    // crypto.subtle.verify compares in constant time.
    return await crypto.subtle.verify(
      "HMAC",
      key,
      expected as BufferSource,
      new TextEncoder().encode(`${timestamp}.${rawBody}`),
    );
  } catch {
    return false;
  }
}

/** Test helper and documentation of the scheme: the header Calendly would send. */
export async function signCalendlyWebhook(rawBody: string, signingKey: string, timestamp: number) {
  const key = new TextEncoder().encode(signingKey);
  return `t=${timestamp},v1=${toHex(await hmac(key, `${timestamp}.${rawBody}`, "SHA-256"))}`;
}

// ---- Bookings ---------------------------------------------------------------

// Calendly objects are open-ended JSON; only the fields read below are trusted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

export type CalendlyBooking = {
  inviteeUri: string;
  eventUri: string;
  status: "active" | "canceled";
  rescheduled: boolean;
  oldInviteeUri: string | null;
  email: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  timeZone: string | null;
  eventName: string;
  startsAt: string;
  endsAt: string | null;
  notes: string;
  message: string;
  campaign: string | null;
};

function text(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/gu, " ").trim();
  return cleaned ? cleaned.slice(0, limit) : null;
}

function calendlyUri(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "api.calendly.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isoTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

const PHONE_QUESTION = /phone|mobile|cell|number|tel[eé]fono/iu;

/** The phone the invitee gave: Calendly's text-reminder number first, then a phone-like answer. */
function phoneFrom(invitee: Json): string | null {
  const reminder = text(invitee.text_reminder_number, 40);
  if (reminder) return reminder;
  for (const item of Array.isArray(invitee.questions_and_answers) ? invitee.questions_and_answers : []) {
    const answer = text(item?.answer, 40);
    if (answer && PHONE_QUESTION.test(String(item?.question ?? "")) && /\d{7,}/u.test(answer.replace(/\D/gu, "")))
      return answer;
  }
  return null;
}

function locationText(location: Json | null | undefined): string | null {
  if (!location || typeof location !== "object") return null;
  const join = text(location.join_url, 500);
  const where = text(location.location, 300);
  const kind = text(location.type, 60);
  const label = kind
    ? { physical: "In person", outbound_call: "Phone call", inbound_call: "Phone call", ask_invitee: "Location" }[kind] ??
      kind.replaceAll("_", " ")
    : null;
  if (join) return `${label ?? "Online"}: ${join}`;
  if (where) return `${label ?? "Location"}: ${where}`;
  return label;
}

/**
 * One invitee on one scheduled event, as BrizBuilder stores it. Returns null
 * when the objects lack what a booking needs (ids, a start time, a way to
 * reach the person), so a malformed delivery is dropped rather than stored.
 */
export function normalizeCalendlyBooking(invitee: Json, event: Json): CalendlyBooking | null {
  const inviteeUri = calendlyUri(invitee?.uri);
  const eventUri = calendlyUri(event?.uri) ?? calendlyUri(invitee?.event);
  const startsAt = isoTime(event?.start_time);
  if (!inviteeUri || !eventUri || !startsAt) return null;

  const email = text(invitee.email, 160)?.toLowerCase() ?? null;
  const phone = phoneFrom(invitee);
  const name = text(invitee.name, 160) ?? "";
  const nameParts = name.split(" ").filter(Boolean);
  const firstName = text(invitee.first_name, 80) ?? nameParts.shift() ?? (email ? email.split("@")[0] : "") ?? "";
  const lastName = text(invitee.last_name, 80) ?? nameParts.join(" ").slice(0, 80);
  if (!firstName || (!email && !phone)) return null;

  const eventName = text(event?.name, 160) ?? "Calendly booking";
  const answers = (Array.isArray(invitee.questions_and_answers) ? invitee.questions_and_answers : [])
    .map((item: Json) => {
      const question = text(item?.question, 200);
      const answer = typeof item?.answer === "string" ? item.answer.trim().slice(0, 1000) : "";
      return question && answer ? `${question}: ${answer}` : null;
    })
    .filter((line: string | null): line is string => Boolean(line))
    .slice(0, 20);
  const where = locationText(event?.location);
  const notes = ["Booked through Calendly.", where, ...answers].filter(Boolean).join("\n").slice(0, 1000);
  const tracking = invitee.tracking && typeof invitee.tracking === "object" ? invitee.tracking : {};

  return {
    inviteeUri,
    eventUri,
    status: invitee.status === "canceled" || event?.status === "canceled" ? "canceled" : "active",
    rescheduled: invitee.rescheduled === true,
    oldInviteeUri: calendlyUri(invitee.old_invitee),
    email,
    firstName,
    lastName,
    phone,
    timeZone: text(invitee.timezone, 60),
    eventName,
    startsAt,
    endsAt: isoTime(event?.end_time),
    notes,
    message: answers.join("\n").slice(0, 1200),
    campaign: text(tracking.utm_campaign, 160),
  };
}

export type CalendlyWebhookEvent =
  | { kind: "created" | "canceled"; invitee: Json; event: Json }
  | { kind: "ignored" };

/** Reads a verified webhook body. Only invitee events carry bookings. */
export function parseCalendlyWebhook(rawBody: string): CalendlyWebhookEvent {
  const body = JSON.parse(rawBody) as Json;
  const payload = body?.payload;
  if (!payload || typeof payload !== "object") return { kind: "ignored" };
  if (body.event === "invitee.created") return { kind: "created", invitee: payload, event: payload.scheduled_event ?? {} };
  if (body.event === "invitee.canceled") return { kind: "canceled", invitee: payload, event: payload.scheduled_event ?? {} };
  return { kind: "ignored" };
}
