import { normalizeAttribution, type MetaAttribution } from "./meta-eligibility";

// Re-exported so callers keep importing attribution handling from one place.
export { normalizeAttribution };
export type { MetaAttribution };
import {
  buildMetaAcceptanceDetail,
  buildMetaErrorDetail,
  formatMetaErrorDetail,
  isSingleEventRecorded,
  type MetaErrorDetail,
} from "./meta-redaction";
import { readRuntimeValue } from "./supabase/env";

// Server-side Meta Conversions API client. Contact details are hashed here and
// never leave the Worker in plain text, and the customer's dataset token is
// decrypted only for the duration of a single send.
const META_GRAPH_VERSION = "v26.0";
const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const META_REQUEST_TIMEOUT_MS = 5_000;


export type MetaEncryptedValue = {
  ciphertext: string;
  iv: string;
};

export type MetaConversionIdentity = {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
};

export type MetaRequestContext = {
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  eventSourceUrl?: string | null;
};

export type MetaConversionSendResult = {
  ok: boolean;
  status: "ok" | "rejected" | "unauthorized" | "error";
  // Populated only when Meta answered and refused. Transient: callers may show
  // it to the authenticated admin who caused the send, and must never persist
  // it or surface it on a public route.
  detail: MetaErrorDetail | null;
};

class MetaRequestTimeoutError extends Error {
  constructor() {
    super("Meta did not respond in time.");
    this.name = "MetaRequestTimeoutError";
  }
}


function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function keyBytes(name: string): Uint8Array {
  const configured = readRuntimeValue(name);
  if (!configured) {
    throw new Error(`Meta security is not configured. Add ${name} in Cloudflare.`);
  }
  let bytes: Uint8Array;
  if (/^[0-9a-f]{64}$/i.test(configured)) {
    bytes = Uint8Array.from(
      configured.match(/.{2}/g) ?? [],
      (pair) => Number.parseInt(pair, 16),
    );
  } else {
    try {
      bytes = base64UrlToBytes(configured);
    } catch {
      throw new Error(`${name} must be a 32-byte key.`);
    }
  }
  if (bytes.byteLength !== 32) {
    throw new Error(`${name} must be a 32-byte key.`);
  }
  return bytes;
}

async function aesKey() {
  return crypto.subtle.importKey(
    "raw",
    keyBytes("META_TOKEN_ENCRYPTION_KEY") as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export function getMetaConversionsRuntimeStatus() {
  const missing = ["META_TOKEN_ENCRYPTION_KEY"].filter(
    (name) => !readRuntimeValue(name),
  );
  return { ready: missing.length === 0, missing };
}

// The tenant is bound into the additional authenticated data, so a token row
// copied to another organization or client cannot be decrypted.
function additionalData(organizationId: string, clientId: string) {
  return new TextEncoder().encode(
    `brizbuilder:meta:${organizationId}:${clientId}:v1`,
  );
}

export async function encryptMetaSecret(
  plaintext: string,
  organizationId: string,
  clientId: string,
): Promise<MetaEncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: additionalData(organizationId, clientId) as BufferSource,
    },
    await aesKey(),
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

export async function decryptMetaSecret(
  encrypted: MetaEncryptedValue,
  organizationId: string,
  clientId: string,
): Promise<string> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(encrypted.iv) as BufferSource,
        additionalData: additionalData(organizationId, clientId) as BufferSource,
      },
      await aesKey(),
      base64UrlToBytes(encrypted.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error(
      "The saved Meta authorization could not be decrypted. Reconnect Meta.",
    );
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Meta requires each identifier normalized a specific way before hashing;
// skipping normalization silently destroys match quality rather than erroring.
function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D+/gu, "");
  if (!digits) return "";
  // Meta wants a country code. A bare 10-digit number is North American here,
  // matching the Twilio A2P market this CRM sends to.
  return digits.length === 10 ? `1${digits}` : digits;
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function normalizeCity(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z]/gu, "");
}

function normalizeState(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z]/gu, "").slice(0, 2);
}

function normalizeZip(value: string) {
  return value.trim().toLowerCase().split("-")[0]?.slice(0, 5) ?? "";
}

function normalizeCountry(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z]/gu, "").slice(0, 2);
}

async function hashed(
  value: string | null | undefined,
  normalize: (input: string) => string,
): Promise<string[] | undefined> {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = normalize(value);
  if (!normalized) return undefined;
  return [await sha256Hex(normalized)];
}

/**
 * Builds the Meta `user_data` block. Every contact identifier is SHA-256 hashed
 * before it leaves this Worker; only the click identifiers (fbc/fbp) and the
 * request context are sent in the clear, which is what Meta expects.
 */
export async function buildMetaUserData(
  identity: MetaConversionIdentity,
  attribution: MetaAttribution,
  context: MetaRequestContext = {},
): Promise<Record<string, unknown>> {
  const userData: Record<string, unknown> = {
    em: await hashed(identity.email, normalizeEmail),
    ph: await hashed(identity.phone, normalizePhone),
    fn: await hashed(identity.firstName, normalizeName),
    ln: await hashed(identity.lastName, normalizeName),
    ct: await hashed(identity.city, normalizeCity),
    st: await hashed(identity.state, normalizeState),
    zp: await hashed(identity.zip, normalizeZip),
    country: await hashed(identity.country, normalizeCountry),
    fbc: attribution.fbc ?? null,
    fbp: attribution.fbp ?? null,
    client_ip_address: context.clientIpAddress ?? null,
    client_user_agent: context.clientUserAgent ?? null,
  };
  for (const [key, value] of Object.entries(userData)) {
    if (value === null || value === undefined) delete userData[key];
  }
  return userData;
}


async function fetchMeta(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), META_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new MetaRequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extracts the six diagnostic fields from a failed response.
 *
 * The parsed body is consumed here and never returned, logged or stored — only
 * the sanitized detail leaves this function. Callers surface that detail to the
 * authenticated admin performing the connection and nowhere else.
 */
async function metaErrorDetail(response: Response): Promise<MetaErrorDetail> {
  const body = await response.json().catch(() => null);
  return buildMetaErrorDetail(response.status, body);
}

function assertDatasetId(datasetId: string) {
  if (!/^[0-9]{5,32}$/u.test(datasetId)) {
    throw new Error("Enter a valid Meta dataset (pixel) ID.");
  }
  return datasetId;
}

/**
 * Best-effort dataset name, purely for display on the Connections card.
 *
 * Reading the dataset node needs ads_read or business_management on the owning
 * business, which a dataset-scoped Conversions API token usually does not have.
 * So this never throws and never blocks a connection — a missing name is not a
 * broken integration.
 */
async function readDatasetName(
  datasetId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const url = new URL(`${META_GRAPH_URL}/${datasetId}`);
    url.searchParams.set("fields", "id,name");
    const response = await fetchMeta(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => ({}))) as { name?: string };
    return body.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Confirms a dataset id and token actually work together, so a bad paste fails
 * at setup instead of silently dropping every future lead.
 *
 * Validates against the *events* endpoint rather than by reading the dataset
 * node. A Conversions API token generated in Events Manager is scoped to post
 * events and frequently cannot read the pixel object at all, so gating the
 * connection on that read rejects credentials that would have worked perfectly.
 *
 * A test event code is required precisely so this check cannot fabricate a
 * conversion: events carrying one are routed to Events Manager's Test Events
 * view and never enter ad optimization or the customer's reporting.
 */
export async function verifyMetaDataset(
  datasetId: string,
  accessToken: string,
  testEventCode: string,
): Promise<{ id: string; name: string | null }> {
  assertDatasetId(datasetId);
  if (!testEventCode.trim()) {
    throw new Error(
      "A test event code is required to verify the connection without creating a real conversion.",
    );
  }
  const response = await fetchMeta(`${META_GRAPH_URL}/${datasetId}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      test_event_code: testEventCode,
      data: [
        {
          event_name: "Lead",
          event_time: Math.floor(Date.now() / 1000),
          event_id: `brizbuilder-connection-check-${crypto.randomUUID()}`,
          action_source: "system_generated",
          user_data: {
            external_id: [
              await sha256Hex(`brizbuilder:connection-check:${datasetId}`),
            ],
          },
        },
      ],
    }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      formatMetaErrorDetail(
        "Meta rejected that access token for this dataset. Check it was generated for this dataset and try again.",
        await metaErrorDetail(response),
      ),
    );
  }
  if (!response.ok) {
    throw new Error(
      formatMetaErrorDetail(
        "Meta could not accept a test event for that dataset. Check the dataset ID and test event code, then try again.",
        await metaErrorDetail(response),
      ),
    );
  }
  // Same rule the sender applies: a 2xx only means the request parsed. Meta
  // answers 200 while recording nothing when the test event code has gone
  // stale, which would let a connection succeed and every later send vanish.
  const body = await response.json().catch(() => null);
  if (!isSingleEventRecorded(body)) {
    throw new Error(
      formatMetaErrorDetail(
        "Meta accepted the request but did not record the test event. Check that the test event code is the one currently shown on this dataset's Test Events tab, then try again.",
        buildMetaAcceptanceDetail(response.status, body),
      ),
    );
  }
  return { id: datasetId, name: await readDatasetName(datasetId, accessToken) };
}

/**
 * Posts a single conversion event.
 *
 * Never throws: callers fire this alongside saving a lead, and a Meta outage
 * must not cost the customer the lead itself. Failures are reported through the
 * returned status so they can be recorded without leaking token material into
 * an error message or log line.
 */
export async function sendMetaConversionEvent(input: {
  datasetId: string;
  accessToken: string;
  eventName: string;
  eventId: string;
  eventTime?: number;
  actionSource: "website" | "system_generated";
  eventSourceUrl?: string | null;
  identity: MetaConversionIdentity;
  attribution: MetaAttribution;
  context?: MetaRequestContext;
  customData?: Record<string, unknown>;
  testEventCode?: string | null;
}): Promise<MetaConversionSendResult> {
  try {
    assertDatasetId(input.datasetId);
    const userData = await buildMetaUserData(
      input.identity,
      input.attribution,
      input.context,
    );
    const event: Record<string, unknown> = {
      event_name: input.eventName,
      // Meta rejects events dated more than seven days back.
      event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
      // Shared with the browser pixel when the landing page supplies one, so a
      // pixel-tracked lead is not counted twice.
      event_id: input.eventId,
      action_source: input.actionSource,
      user_data: userData,
    };
    if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;
    if (input.customData) event.custom_data = input.customData;

    const payload: Record<string, unknown> = { data: [event] };
    if (input.testEventCode) payload.test_event_code = input.testEventCode;

    const response = await fetchMeta(
      `${META_GRAPH_URL}/${input.datasetId}/events`,
      {
        method: "POST",
        headers: {
          // The token travels in the header rather than the query string so it
          // cannot end up in an intermediary's request log.
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (response.ok) {
      // A 2xx is not proof of anything. Meta answers 200 while recording
      // nothing — a stale test event code does exactly this — so the
      // acceptance count is what decides success.
      const body = await response.json().catch(() => null);
      if (isSingleEventRecorded(body)) {
        return { ok: true, status: "ok", detail: null };
      }
      return {
        ok: false,
        status: "rejected",
        detail: buildMetaAcceptanceDetail(response.status, body),
      };
    }
    const detail = await metaErrorDetail(response);
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: "unauthorized", detail };
    }
    return { ok: false, status: "rejected", detail };
  } catch {
    // No response to read — a timeout or transport failure.
    return { ok: false, status: "error", detail: null };
  }
}
