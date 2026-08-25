// Dynamic Number Insertion: the snippet CallRail asks a site to load, and the
// credential handling for the diagnostic page used to prove it works.
//
// Depends on WebCrypto and nothing else, so the signing, the tenant binding and
// the expiry can all be exercised directly in tests against a fixed key rather
// than inferred from the code that calls them.

/**
 * A minted link is meant to be opened immediately, and it is spent the moment
 * it is: the exchange trades it for a cookie and redirects to a URL that no
 * longer carries it. Two minutes is enough for a paste into another browser
 * and short enough that the link is worthless by the time it reaches anywhere
 * a link tends to end up.
 */
export const DNI_EXCHANGE_TTL_MS = 2 * 60 * 1000;

/** How long the page stays open once the exchange has happened. */
export const DNI_SESSION_TTL_MS = 15 * 60 * 1000;

/**
 * `__Secure-` binds the cookie to HTTPS at the browser level, so a downgrade
 * cannot present it. Scoped to the diagnostic path rather than the whole
 * origin: the rest of the application has no business receiving it, and
 * CallRail's script — which runs on this page — must never see it either.
 */
export const DNI_COOKIE_NAME = "__Secure-callrail-dni";
export const DNI_COOKIE_PATH = "/api/callrail/dni-test";

/** The one query parameter the exchange accepts. */
export const DNI_EXCHANGE_PARAM = "t";

/**
 * Everything that could carry authorization, in any form this page has used or
 * might use.
 *
 * Two jobs: stripped from the URL before the redirect, and held apart from
 * anything the page displays. A credential shown on screen is a credential in
 * a screenshot.
 */
export const DNI_AUTH_FIELDS = [
  DNI_EXCHANGE_PARAM,
  DNI_COOKIE_NAME,
  "token",
  "sig",
  "signature",
  "auth",
  "key",
] as const;

/**
 * Applied to every response this page can produce — the exchange, the
 * redirect, the rendered page and every refusal.
 *
 * A diagnostic page authorized by a cookie and carrying click identifiers in
 * its address bar must never sit in a shared cache, a browser's back-forward
 * cache, or a corporate proxy. `private` keeps intermediaries out, `no-store`
 * forbids writing it down at all, and the rest is there for the caches old
 * enough to need telling twice.
 */
export const DNI_NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  // Explicit and load-bearing: the page loads a third-party script, and the
  // request for it must not carry this page's URL anywhere.
  "Referrer-Policy": "no-referrer",
};

/** CallRail serves every swap script from this host. */
const CALLRAIL_SCRIPT_HOST = "cdn.callrail.com";

/**
 * Confirms a script URL really points at CallRail before it is written into a
 * page.
 *
 * The value arrives from CallRail's API and is then stored, so by the time it
 * is embedded it is data from the database rather than a constant. Anything
 * reaching a script src has to be checked at the point of use: a stored value
 * that had been tampered with would otherwise execute with the page's full
 * authority.
 */
export function isCallRailScriptUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const candidate = value.trim();
  const absolute = candidate.startsWith("//") ? `https:${candidate}` : candidate;
  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  // Exact host, not a suffix test: "cdn.callrail.com.example.com" must fail.
  return parsed.hostname === CALLRAIL_SCRIPT_HOST;
}

/** Normalizes CallRail's protocol-relative form to an absolute https URL. */
export function normalizeCallRailScriptUrl(value: string): string {
  const candidate = value.trim();
  return candidate.startsWith("//") ? `https:${candidate}` : candidate;
}

/**
 * The snippet a site owner pastes. Deliberately the plain async tag CallRail
 * documents, with nothing added: a site owner should be able to compare it
 * against CallRail's own instructions character for character.
 */
export function buildDniSnippet(scriptUrl: string): string {
  if (!isCallRailScriptUrl(scriptUrl)) {
    throw new Error("That is not a CallRail tracking script URL.");
  }
  return `<script type="text/javascript" src="${normalizeCallRailScriptUrl(scriptUrl)}"></script>`;
}

/**
 * Attribution parameters the diagnostic page reports on.
 *
 * Read in the browser from the address bar and shown there. The server is not
 * given them and does not want them: a click id in a server log is a click id
 * retained, and this page exists to prove capture works, not to collect it.
 */
export const DNI_REPORTED_PARAMS = [
  "fbclid",
  "gclid",
  "msclkid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

/**
 * Fails loudly if an authorization field ever reaches the display allowlist.
 *
 * Called at module load, so the mistake cannot ship: a build that would show a
 * credential on screen does not start.
 */
export function assertNoAuthFieldsReported(): void {
  const auth = new Set<string>(
    DNI_AUTH_FIELDS.map((field) => field.toLowerCase()),
  );
  for (const param of DNI_REPORTED_PARAMS) {
    if (auth.has(param.toLowerCase())) {
      throw new Error(
        `${param} is an authorization field and must never be displayed.`,
      );
    }
  }
}
assertNoAuthFieldsReported();

/**
 * Strips every authorization field from a URL's query, leaving the attribution
 * parameters CallRail needs to see.
 *
 * "Clean" means free of the credential, not free of the query. The click
 * identifiers have to survive the redirect or the swap under test never
 * happens; the credential must not, or it stays in the address bar, the
 * history entry and every referrer the page sends.
 *
 * Returns a path-and-query only, never an absolute URL, so this can never be
 * turned into an open redirect.
 */
export function cleanDniRedirect(requestUrl: string): string {
  const url = new URL(requestUrl);
  for (const field of DNI_AUTH_FIELDS) url.searchParams.delete(field);
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

/** The Set-Cookie for a successful exchange. */
export function buildDniCookie(value: string, maxAgeSeconds: number): string {
  return [
    `${DNI_COOKIE_NAME}=${value}`,
    `Path=${DNI_COOKIE_PATH}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    // Unreadable from JavaScript, so CallRail's script — which runs on this
    // very page — cannot see it.
    "HttpOnly",
    "Secure",
    // Strict, not Lax: nothing off-site should ever be able to cause this
    // cookie to be sent, including a top-level navigation from CallRail.
    "SameSite=Strict",
  ].join("; ");
}

/** The Set-Cookie that clears it. */
export function clearDniCookie(): string {
  return buildDniCookie("", 0);
}

/** Reads the diagnostic cookie out of a request's Cookie header. */
export function readDniCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== DNI_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

/**
 * Who a credential is for.
 *
 * Both halves of the tenant are carried, not just the client. The page reads a
 * connection row, and a credential that named only a client would authorize
 * that read on the strength of an id alone. Binding the organization means the
 * pair has to match what was true when an authorized operator minted it.
 */
export type DniClaim = {
  organizationId: string;
  clientId: string;
  expiresAt: number;
};

const CLAIM_VERSION = "dni2";
const CLAIM_SEPARATOR = ".";

function isClaimSafeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes(CLAIM_SEPARATOR)
  );
}

/** The signed portion of a credential. Opaque, but not secret by itself. */
export function encodeDniClaim(claim: DniClaim): string {
  if (!isClaimSafeId(claim.organizationId))
    throw new Error("A diagnostic credential needs an organization.");
  if (!isClaimSafeId(claim.clientId))
    throw new Error("A diagnostic credential needs a client.");
  if (!Number.isFinite(claim.expiresAt))
    throw new Error("A diagnostic credential needs an expiry.");
  return [
    CLAIM_VERSION,
    claim.organizationId,
    claim.clientId,
    Math.floor(claim.expiresAt),
  ].join(CLAIM_SEPARATOR);
}

export function parseDniClaim(value: unknown): DniClaim | null {
  if (typeof value !== "string") return null;
  const parts = value.split(CLAIM_SEPARATOR);
  if (parts.length !== 4) return null;
  const [version, organizationId, clientId, expiry] = parts;
  if (version !== CLAIM_VERSION) return null;
  if (!organizationId || !clientId) return null;
  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  return { organizationId, clientId, expiresAt };
}

export function isDniClaimExpired(claim: DniClaim, now: number = Date.now()) {
  return claim.expiresAt <= now;
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

/**
 * Derives the signing key from the stored secret rather than using it directly.
 *
 * That secret's job is encrypting credentials. Signing with the same raw bytes
 * would give one key two jobs across two algorithms, so a subkey is derived
 * under a fixed label instead. It costs one HMAC and means a signature can
 * never be confused with ciphertext, without adding a second secret for an
 * operator to configure and rotate.
 */
export async function deriveDniSigningKey(
  rootKey: Uint8Array,
): Promise<CryptoKey> {
  const root = await crypto.subtle.importKey(
    "raw",
    rootKey as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign(
    "HMAC",
    root,
    new TextEncoder().encode("brizbuilder:callrail:dni-test-link:v1"),
  );
  return crypto.subtle.importKey(
    "raw",
    derived,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Signs a claim. The result is `claim.signature`. */
export async function signDniClaim(
  key: CryptoKey,
  claim: DniClaim,
): Promise<string> {
  const encoded = encodeDniClaim(claim);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encoded),
  );
  return `${encoded}${CLAIM_SEPARATOR}${bytesToBase64Url(new Uint8Array(signature))}`;
}

/**
 * Returns the claim a credential carries, or null for anything that is not a
 * live, untampered credential signed by this key.
 *
 * Expiry is checked here, on the server, against the signed value. The cookie's
 * Max-Age is a courtesy to the browser and nothing more: a client that keeps
 * presenting the cookie past fifteen minutes is refused all the same, because
 * the deadline travels inside the signature rather than beside it.
 *
 * Never throws and never explains which check failed: the page it guards
 * answers identically to a forged credential, a tampered one and an expired
 * one.
 */
export async function verifyDniClaim(
  key: CryptoKey,
  token: unknown,
  now: number = Date.now(),
): Promise<DniClaim | null> {
  if (typeof token !== "string" || !token) return null;
  const split = token.lastIndexOf(CLAIM_SEPARATOR);
  if (split <= 0) return null;
  const encoded = token.slice(0, split);
  const signature = token.slice(split + 1);
  const claim = parseDniClaim(encoded);
  if (!claim) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signature) as BufferSource,
      new TextEncoder().encode(encoded),
    );
    if (!valid) return null;
  } catch {
    return null;
  }
  return isDniClaimExpired(claim, now) ? null : claim;
}
