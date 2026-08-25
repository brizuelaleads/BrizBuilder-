// Deciding whether a webhook really came from CallRail.
//
// CallRail signs each delivery with HMAC-SHA1 over the raw request body, using
// the signing key issued when the Webhooks integration is created, and sends
// the base64 digest in a `Signature` header. Their documentation publishes a
// test vector, and `tests/callrail-webhook.test.mjs` runs the real one through
// this code rather than trusting the description.
//
// Two things this file is careful about:
//
//   * The signature covers the bytes as sent. Parsing the body and
//     re-serializing it changes whitespace and key order and produces a
//     different digest, so the raw text has to be verified before anything
//     looks inside it.
//   * A wrong signature and a malformed one are the same answer. Comparison
//     goes through crypto.subtle.verify, which does not leak how much of the
//     digest matched through timing.
//
// Depends on WebCrypto and nothing else, so the rules can be exercised
// directly in tests.

/** The header CallRail sends the digest in. */
export const CALLRAIL_SIGNATURE_HEADER = "Signature";
export const CALLRAIL_WEBHOOK_BASE_PATH = "/api/callrail/webhook";
const WEBHOOK_PATH_BYTES = 32;

export const CALLRAIL_WEBHOOK_ROUTES = {
  post_call: "post-call",
  call_modified: "updated-call",
} as const;

export const CALLRAIL_WEBHOOK_CONFIG_KEYS = {
  post_call: "post_call_webhook",
  call_modified: "updated_call_webhook",
} as const;

/**
 * A signing key is a 32-character hex token issued per integration. Shape is
 * checked before use so an empty or truncated key cannot silently produce a
 * digest that nothing will ever match.
 */
export function isCallRailSigningKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/iu.test(value.trim());
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function bodyBytes(value: unknown): Uint8Array | null {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

async function signingKeyFor(signingKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey) as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign", "verify"],
  );
}

/**
 * The signature CallRail would send for this body.
 *
 * Exported so a test can reproduce their published vector, and so the
 * reconciliation tooling can explain a mismatch without re-implementing this.
 */
export async function callRailSignature(
  signingKey: string,
  rawBody: string | Uint8Array | ArrayBuffer,
): Promise<string> {
  const bytes = bodyBytes(rawBody);
  if (!bytes) throw new Error("CallRail signature body must be bytes or text.");
  const digest = await crypto.subtle.sign(
    "HMAC",
    await signingKeyFor(signingKey),
    bytes as BufferSource,
  );
  return bytesToBase64(new Uint8Array(digest));
}

/**
 * Whether a delivery is authentic.
 *
 * Never throws. A malformed header, a bad key, a body that is not what was
 * signed — all of them are the same false, because a caller that could tell
 * them apart could learn something about the key.
 */
export async function verifyCallRailSignature(
  signingKey: unknown,
  rawBody: unknown,
  headerValue: unknown,
): Promise<boolean> {
  if (!isCallRailSigningKey(signingKey)) return false;
  const bytes = bodyBytes(rawBody);
  if (!bytes) return false;
  if (typeof headerValue !== "string" || !headerValue.trim()) return false;
  let expected: Uint8Array;
  try {
    expected = base64ToBytes(headerValue.trim());
  } catch {
    return false;
  }
  // HMAC-SHA1 is 20 bytes. A different length cannot be a valid digest, and
  // checking here keeps verify from being handed something odd.
  if (expected.byteLength !== 20) return false;
  try {
    // Constant-time by construction: the comparison happens inside WebCrypto
    // rather than in a loop we wrote.
    return await crypto.subtle.verify(
      "HMAC",
      await signingKeyFor(String(signingKey).trim()),
      expected as BufferSource,
      bytes as BufferSource,
    );
  } catch {
    return false;
  }
}

/**
 * The webhook kinds CallRail can send, and the only ones this integration
 * accepts.
 *
 * Kept as a closed set because the kind decides how far a delivery is allowed
 * to move a lead: a pre-call may only ever record that the phone rang, while a
 * post-call carries the outcome. An unrecognized kind is refused rather than
 * treated as the most permissive one.
 */
export const CALLRAIL_WEBHOOK_KINDS = [
  "post_call",
  "call_modified",
] as const;

export type CallRailWebhookKind = (typeof CALLRAIL_WEBHOOK_KINDS)[number];

export function isCallRailWebhookKind(
  value: unknown,
): value is CallRailWebhookKind {
  return (
    typeof value === "string" &&
    (CALLRAIL_WEBHOOK_KINDS as readonly string[]).includes(value)
  );
}

export type CallRailWebhookEnvelope = {
  kind: CallRailWebhookKind;
  /** CallRail's own call id. The idempotency key for everything downstream. */
  callId: string;
  /** The company the call belongs to, checked against the connection. */
  companyId: string;
  /** The resource id, when the payload carries one. */
  resourceId: string | null;
};

export type CallRailWebhookUrlSet = Record<
  CallRailWebhookKind,
  {
    configKey: (typeof CALLRAIL_WEBHOOK_CONFIG_KEYS)[CallRailWebhookKind];
    url: string;
  }
>;

export type CallRailWebhookRoute = {
  pathId: string;
  kind: CallRailWebhookKind;
};

function asIdentifier(value: unknown): string {
  if (typeof value === "string") return value.trim();
  // CallRail's legacy payloads carry numeric ids as JSON numbers.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * Reads the few fields a delivery is trusted for.
 *
 * Deliberately minimal. The body is a notification, not a source of truth —
 * everything that matters is refetched from the API afterwards — so only the
 * identifiers needed to decide *which* call to refetch are taken from it, and
 * a payload missing them is rejected rather than half-processed.
 */
export function readCallRailWebhook(
  kind: unknown,
  body: unknown,
): CallRailWebhookEnvelope | null {
  if (!isCallRailWebhookKind(kind)) return null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const payload = body as Record<string, unknown>;
  const callId = asIdentifier(payload.id ?? payload.call_id);
  const companyId = asIdentifier(payload.company_id);
  if (!callId || !companyId) return null;
  return {
    kind,
    callId,
    companyId,
    resourceId: asIdentifier(payload.resource_id) || null,
  };
}

export function isCallRailWebhookPathId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,96}$/u.test(value);
}

export function createCallRailWebhookPathId(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(WEBHOOK_PATH_BYTES)));
}

export function callRailWebhookKindFromRoute(
  segment: unknown,
): CallRailWebhookKind | null {
  if (typeof segment !== "string") return null;
  for (const [kind, route] of Object.entries(CALLRAIL_WEBHOOK_ROUTES)) {
    if (route === segment) return kind as CallRailWebhookKind;
  }
  return null;
}

export function readCallRailWebhookRoute(url: string): CallRailWebhookRoute | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const prefix = `${CALLRAIL_WEBHOOK_BASE_PATH}/`;
  if (!parsed.pathname.startsWith(prefix)) return null;
  const parts = parsed.pathname.slice(prefix.length).split("/");
  if (parts.length !== 2) return null;
  const [pathId, eventSegment] = parts;
  const kind = callRailWebhookKindFromRoute(eventSegment);
  if (!isCallRailWebhookPathId(pathId) || !kind) return null;
  return { pathId, kind };
}

function cleanBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error("CallRail webhook base URL must be HTTPS.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/g, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/g, "");
}

export function buildCallRailWebhookUrls(
  baseUrl: string,
  pathId: string,
): CallRailWebhookUrlSet {
  if (!isCallRailWebhookPathId(pathId)) {
    throw new Error("CallRail webhook path id is invalid.");
  }
  const base = cleanBaseUrl(baseUrl);
  return {
    post_call: {
      configKey: CALLRAIL_WEBHOOK_CONFIG_KEYS.post_call,
      url: `${base}${CALLRAIL_WEBHOOK_BASE_PATH}/${pathId}/${CALLRAIL_WEBHOOK_ROUTES.post_call}`,
    },
    call_modified: {
      configKey: CALLRAIL_WEBHOOK_CONFIG_KEYS.call_modified,
      url: `${base}${CALLRAIL_WEBHOOK_BASE_PATH}/${pathId}/${CALLRAIL_WEBHOOK_ROUTES.call_modified}`,
    },
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueAppend(existing: string[], next: string) {
  return existing.includes(next) ? existing : [...existing, next];
}

/**
 * Whether a webhook config entry is a URL CallRail could actually deliver to.
 *
 * Applied to entries this integration did not write as well as the ones it
 * did. A third-party URL is somebody else's configuration and is preserved
 * exactly, but it is still written back as part of the same object, so it has
 * to be something a URL parser accepts and something CallRail would POST to.
 */
export function isCallRailWebhookUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  // HTTPS only: a webhook carries a caller's name and number, and CallRail
  // signs it rather than encrypting it.
  return parsed.protocol === "https:";
}

/**
 * Refuses a webhook configuration containing an entry that is not a usable
 * URL.
 *
 * Fails rather than repairs. Dropping a malformed entry would silently edit
 * configuration this integration does not own, and writing it back unchanged
 * would propagate it; refusing leaves the customer's CallRail exactly as it
 * was and says which key is at fault.
 */
export function assertCallRailWebhookConfigUrls(
  config: unknown,
): Record<string, unknown> {
  const next =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  for (const configKey of Object.values(CALLRAIL_WEBHOOK_CONFIG_KEYS)) {
    const entries = next[configKey];
    if (entries === undefined || entries === null) continue;
    if (!Array.isArray(entries)) {
      throw new Error(
        `CallRail's ${configKey} is not a list of URLs. Fix it in CallRail, then try again.`,
      );
    }
    for (const entry of entries) {
      if (!isCallRailWebhookUrl(entry)) {
        throw new Error(
          `CallRail's ${configKey} contains an address BrizBuilder cannot verify as an HTTPS URL. Fix it in CallRail, then try again.`,
        );
      }
    }
  }
  return next;
}

export function appendCallRailWebhookUrls(
  config: unknown,
  urls: CallRailWebhookUrlSet,
): Record<string, unknown> {
  const next =
    config && typeof config === "object" && !Array.isArray(config)
      ? { ...(config as Record<string, unknown>) }
      : {};
  // Everything already there is checked before anything is added, so a
  // pre-existing problem is reported instead of being written back.
  assertCallRailWebhookConfigUrls(next);
  for (const { configKey, url } of Object.values(urls)) {
    if (!isCallRailWebhookUrl(url)) {
      throw new Error("BrizBuilder built an invalid CallRail webhook URL.");
    }
    next[configKey] = uniqueAppend(stringArray(next[configKey]), url);
  }
  return assertCallRailWebhookConfigUrls(next);
}

export function removeCallRailWebhookUrls(
  config: unknown,
  urls: CallRailWebhookUrlSet,
): Record<string, unknown> {
  const next =
    config && typeof config === "object" && !Array.isArray(config)
      ? { ...(config as Record<string, unknown>) }
      : {};
  for (const { configKey, url } of Object.values(urls)) {
    next[configKey] = stringArray(next[configKey]).filter(
      (existing) => existing !== url,
    );
  }
  return next;
}

export function callRailWebhookConfigsEqual(
  left: unknown,
  right: unknown,
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}
