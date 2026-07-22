import { readRuntimeValue } from "./supabase/env";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/business.manage";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const ACCOUNT_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_INFO_API =
  "https://mybusinessbusinessinformation.googleapis.com/v1";
const GOOGLE_REQUEST_TIMEOUT_MS = 10_000;
const GOOGLE_API_ATTEMPTS = 2;
const GOOGLE_MAX_ACCOUNT_PAGES = 2;
const GOOGLE_MAX_ACCOUNTS = 25;
const GOOGLE_MAX_LOCATION_PAGES_PER_ACCOUNT = 2;
const GOOGLE_MAX_LOCATIONS = 250;
const GOOGLE_MAX_API_FETCHES = 64;

type UnknownRecord = Record<string, unknown>;

type GoogleRequestBudget = {
  remainingFetches: number;
};

class GoogleRequestTimeoutError extends Error {
  constructor() {
    super("Google did not respond in time. Try again.");
    this.name = "GoogleRequestTimeoutError";
  }
}

export type GoogleEncryptedValue = {
  ciphertext: string;
  iv: string;
};

export type GoogleTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scopes: string[];
};

export type GoogleBusinessLocation = {
  accountResourceName: string;
  accountName: string;
  locationResourceName: string;
  businessName: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  primaryCategory: string | null;
  reviewUrl: string | null;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function fetchGoogle(
  input: string | URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    GOOGLE_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new GoogleRequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
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
    throw new Error(`Google security is not configured. Add ${name} in Cloudflare.`);
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

function encryptionKeyBytes() {
  return keyBytes("GOOGLE_TOKEN_ENCRYPTION_KEY");
}

function oauthStateKeyBytes() {
  return keyBytes("GOOGLE_OAUTH_STATE_SECRET");
}

async function aesKey() {
  return crypto.subtle.importKey(
    "raw",
    encryptionKeyBytes() as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export function getGoogleBusinessRuntimeStatus() {
  const missing = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "GOOGLE_TOKEN_ENCRYPTION_KEY",
    "GOOGLE_OAUTH_STATE_SECRET",
  ].filter((name) => !readRuntimeValue(name));
  return { ready: missing.length === 0, missing };
}

function googleConfig() {
  const status = getGoogleBusinessRuntimeStatus();
  if (!status.ready) {
    throw new Error(
      `Google Business Profile is not configured. Missing ${status.missing.join(", ")}.`,
    );
  }
  return {
    clientId: readRuntimeValue("GOOGLE_CLIENT_ID"),
    clientSecret: readRuntimeValue("GOOGLE_CLIENT_SECRET"),
    redirectUri: readRuntimeValue("GOOGLE_REDIRECT_URI"),
  };
}

export async function encryptGoogleSecret(
  plaintext: string,
  organizationId: string,
  clientId: string,
): Promise<GoogleEncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(
    `brizbuilder:google:${organizationId}:${clientId}:v1`,
  );
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: additionalData as BufferSource,
    },
    await aesKey(),
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

export async function decryptGoogleSecret(
  encrypted: GoogleEncryptedValue,
  organizationId: string,
  clientId: string,
): Promise<string> {
  try {
    const additionalData = new TextEncoder().encode(
      `brizbuilder:google:${organizationId}:${clientId}:v1`,
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(encrypted.iv) as BufferSource,
        additionalData: additionalData as BufferSource,
      },
      await aesKey(),
      base64UrlToBytes(encrypted.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error(
      "The saved Google authorization could not be decrypted. Reconnect Google.",
    );
  }
}

async function pkceVerifier(state: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    oauthStateKeyBytes() as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`brizbuilder-google-pkce:${state}`),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function buildGoogleAuthorizationUrl(state: string) {
  const config = googleConfig();
  const verifier = await pkceVerifier(state);
  const challenge = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", bytesToBase64Url(new Uint8Array(challenge)));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function tokenRequest(body: URLSearchParams): Promise<GoogleTokenSet> {
  const response = await fetchGoogle(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    const description =
      asString(payload.error_description) ?? asString(payload.error);
    throw new Error(
      description
        ? `Google authorization failed: ${description.slice(0, 240)}`
        : "Google authorization failed. Try connecting again.",
    );
  }
  const accessToken = asString(payload.access_token);
  if (!accessToken) throw new Error("Google did not return an access token.");
  return {
    accessToken,
    refreshToken: asString(payload.refresh_token),
    expiresIn: Number(payload.expires_in ?? 3600),
    scopes: (asString(payload.scope) ?? GOOGLE_SCOPE).split(/\s+/).filter(Boolean),
  };
}

export async function exchangeGoogleAuthorizationCode(
  code: string,
  state: string,
) {
  const config = googleConfig();
  return tokenRequest(
    new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: await pkceVerifier(state),
    }),
  );
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const config = googleConfig();
  return tokenRequest(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
  );
}

export async function revokeGoogleRefreshToken(refreshToken: string) {
  const response = await fetchGoogle(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  });
  if (!response.ok) {
    throw new Error(
      "Google could not confirm revocation. Try disconnecting again, or remove BrizBuilder from your Google Account permissions.",
    );
  }
}

async function googleApiJson(
  url: URL,
  accessToken: string,
  budget: GoogleRequestBudget,
) {
  let response: Response | null = null;
  let requestError: unknown = null;
  for (let attempt = 0; attempt < GOOGLE_API_ATTEMPTS; attempt += 1) {
    if (budget.remainingFetches <= 0) {
      throw new Error(
        "Google returned too much data to load safely. Connect an account with fewer Business Profiles, then try again.",
      );
    }
    budget.remainingFetches -= 1;
    try {
      response = await fetchGoogle(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      requestError = null;
    } catch (error) {
      response = null;
      requestError = error;
      if (attempt === GOOGLE_API_ATTEMPTS - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === GOOGLE_API_ATTEMPTS - 1) break;
    const retryAfterSeconds = Number(response.headers.get("retry-after") ?? 0);
    const delay = Math.min(
      Math.max(retryAfterSeconds * 1000, 250 * 2 ** attempt),
      2_000,
    );
    await response.arrayBuffer().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (!response && requestError) {
    if (requestError instanceof GoogleRequestTimeoutError) throw requestError;
    throw new Error(
      "Google Business Profile could not be reached. Try again.",
    );
  }
  if (!response) throw new Error("Google Business Profile request failed.");
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    const apiError = asRecord(payload.error);
    const message = asString(apiError.message);
    if (response.status === 401) {
      throw new Error("Google authorization expired. Reconnect Google.");
    }
    if (response.status === 403) {
      throw new Error(
        "Google Business Profile API access is not active for BrizBuilder yet. Google may still be reviewing the access request.",
      );
    }
    throw new Error(
      message
        ? `Google Business Profile returned an error: ${message.slice(0, 240)}`
        : `Google Business Profile request failed (${response.status}).`,
    );
  }
  return payload;
}

function formatAddress(value: unknown): string | null {
  const address = asRecord(value);
  const lines = asArray(address.addressLines)
    .map(asString)
    .filter((line): line is string => Boolean(line));
  const locality = [
    asString(address.locality),
    asString(address.administrativeArea),
    asString(address.postalCode),
  ]
    .filter(Boolean)
    .join(" ");
  return [...lines, locality].filter(Boolean).join(", ") || null;
}

function mapLocation(
  raw: unknown,
  accountResourceName: string,
  accountName: string,
): GoogleBusinessLocation | null {
  const location = asRecord(raw);
  const locationResourceName = asString(location.name);
  const businessName = asString(location.title);
  if (!locationResourceName || !businessName) return null;
  const phoneNumbers = asRecord(location.phoneNumbers);
  const categories = asRecord(location.categories);
  const primaryCategory = asRecord(categories.primaryCategory);
  const metadata = asRecord(location.metadata);
  return {
    accountResourceName,
    accountName,
    locationResourceName,
    businessName,
    address: formatAddress(location.storefrontAddress),
    phone:
      asString(phoneNumbers.primaryPhone) ??
      asArray(phoneNumbers.additionalPhones).map(asString).find(Boolean) ??
      null,
    website: asString(location.websiteUri),
    primaryCategory:
      asString(primaryCategory.displayName) ?? asString(primaryCategory.name),
    reviewUrl:
      asString(metadata.newReviewUri) ?? asString(metadata.mapsUri) ?? null,
  };
}

export async function listGoogleBusinessLocations(
  accessToken: string,
): Promise<GoogleBusinessLocation[]> {
  const budget: GoogleRequestBudget = {
    remainingFetches: GOOGLE_MAX_API_FETCHES,
  };
  const accounts: Array<{ resourceName: string; name: string }> = [];
  let accountPageToken = "";
  for (let page = 0; page < GOOGLE_MAX_ACCOUNT_PAGES; page += 1) {
    const url = new URL(`${ACCOUNT_API}/accounts`);
    url.searchParams.set("pageSize", "20");
    if (accountPageToken) url.searchParams.set("pageToken", accountPageToken);
    const payload = await googleApiJson(url, accessToken, budget);
    for (const raw of asArray(payload.accounts)) {
      const account = asRecord(raw);
      const resourceName = asString(account.name);
      if (!resourceName) {
        throw new Error(
          "Google returned a Business Profile account without an identifier. BrizBuilder stopped instead of loading a partial list.",
        );
      }
      if (accounts.length >= GOOGLE_MAX_ACCOUNTS) {
        throw new Error(
          `Google returned more than ${GOOGLE_MAX_ACCOUNTS} Business Profile accounts. Connect a Google account with fewer profiles, then try again.`,
        );
      }
      accounts.push({
        resourceName,
        name: asString(account.accountName) ?? "Google Business account",
      });
    }
    accountPageToken = asString(payload.nextPageToken) ?? "";
    if (!accountPageToken) break;
  }
  if (accountPageToken) {
    throw new Error(
      `Google returned more account pages than BrizBuilder can load safely (maximum ${GOOGLE_MAX_ACCOUNT_PAGES}).`,
    );
  }

  const locations: GoogleBusinessLocation[] = [];
  const readMask = [
    "name",
    "title",
    "websiteUri",
    "phoneNumbers",
    "categories",
    "storefrontAddress",
    "metadata",
  ].join(",");
  for (const account of accounts) {
    let locationPageToken = "";
    for (
      let page = 0;
      page < GOOGLE_MAX_LOCATION_PAGES_PER_ACCOUNT;
      page += 1
    ) {
      const url = new URL(
        `${BUSINESS_INFO_API}/${account.resourceName}/locations`,
      );
      url.searchParams.set("readMask", readMask);
      url.searchParams.set("pageSize", "100");
      if (locationPageToken) url.searchParams.set("pageToken", locationPageToken);
      const payload = await googleApiJson(url, accessToken, budget);
      for (const raw of asArray(payload.locations)) {
        const mapped = mapLocation(raw, account.resourceName, account.name);
        if (!mapped) {
          throw new Error(
            "Google returned a Business Profile location without its required name or identifier. BrizBuilder stopped instead of loading a partial list.",
          );
        }
        if (locations.length >= GOOGLE_MAX_LOCATIONS) {
          throw new Error(
            `Google returned more than ${GOOGLE_MAX_LOCATIONS} Business Profile locations. Connect an account with fewer locations, then try again.`,
          );
        }
        locations.push(mapped);
      }
      locationPageToken = asString(payload.nextPageToken) ?? "";
      if (!locationPageToken) break;
    }
    if (locationPageToken) {
      throw new Error(
        `Google returned more than ${GOOGLE_MAX_LOCATION_PAGES_PER_ACCOUNT} pages of locations for ${account.name}. BrizBuilder stopped instead of loading a partial list.`,
      );
    }
  }
  return locations;
}
