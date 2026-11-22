import { readRuntimeValue } from "./supabase/env";
import {
  GOOGLE_PERFORMANCE_RANGES,
  PERFORMANCE_METRICS_LIST,
  buildGooglePerformance,
  googleDate,
  googleLocationPatch,
  googleTimeOfDay,
  isoDay,
  type GoogleBusinessPerformance,
  type GoogleLocationUpdate,
} from "./google-business-edits";

export {
  GOOGLE_PERFORMANCE_RANGES,
  parseGoogleLocationUpdate,
  sumGooglePerformance,
  type GoogleBusinessPerformance,
  type GoogleLocationUpdate,
  type GooglePerformanceDay,
  type GooglePerformanceTotals,
} from "./google-business-edits";

export const GOOGLE_BUSINESS_SCOPE =
  "https://www.googleapis.com/auth/business.manage";
export { GOOGLE_CALENDAR_SCOPE } from "./google-calendar-scopes";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const ACCOUNT_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_INFO_API =
  "https://mybusinessbusinessinformation.googleapis.com/v1";
const GOOGLE_MY_BUSINESS_API = "https://mybusiness.googleapis.com/v4";
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

export type GoogleBusinessReview = {
  reviewId: string;
  reviewerName: string;
  starRating: number;
  comment: string | null;
  createTime: string | null;
  updateTime: string | null;
  reply: {
    comment: string;
    updateTime: string | null;
    status: string | null;
    policyViolation: string | null;
  } | null;
};

export type GoogleBusinessReviewsPage = {
  reviews: GoogleBusinessReview[];
  averageRating: number | null;
  totalReviewCount: number;
  nextPageToken: string | null;
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

export async function buildGoogleAuthorizationUrl(
  state: string,
  scopes = [GOOGLE_BUSINESS_SCOPE],
  includeGrantedScopes = true,
) {
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
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", String(includeGrantedScopes));
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
    scopes: (asString(payload.scope) ?? GOOGLE_BUSINESS_SCOPE)
      .split(/\s+/)
      .filter(Boolean),
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
  init: { method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; body?: UnknownRecord } = {},
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
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
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
      if (message && /has not been used|is disabled|SERVICE_DISABLED/i.test(message)) {
        const api = /([a-z]+\.googleapis\.com)/i.exec(message)?.[1] ?? "this Google API";
        throw new Error(`Turn on ${api} in the Google Cloud project, then try again.`);
      }
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

function googleResourceName(value: string, prefix: "accounts" | "locations") {
  const normalized = value.trim();
  if (!new RegExp(`^${prefix}/[A-Za-z0-9_-]{1,160}$`).test(normalized)) {
    throw new Error(`Google returned an invalid ${prefix.slice(0, -1)} identifier.`);
  }
  return normalized;
}

function googleReviewId(value: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{1,300}$/.test(normalized)) {
    throw new Error("Google returned an invalid review identifier.");
  }
  return normalized;
}

function ratingNumber(value: unknown) {
  const ratings: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
  };
  return ratings[String(value ?? "").toUpperCase()] ?? 0;
}

function mapGoogleReview(value: unknown): GoogleBusinessReview | null {
  const review = asRecord(value);
  const reviewId = asString(review.reviewId);
  const rating = ratingNumber(review.starRating);
  if (!reviewId || !rating) return null;
  const reviewer = asRecord(review.reviewer);
  const reply = asRecord(review.reviewReply);
  const replyComment = asString(reply.comment);
  const policyViolation = asRecord(review.policyViolation);
  return {
    reviewId: googleReviewId(reviewId),
    reviewerName: (asString(reviewer.displayName) ?? "Google user").slice(0, 300),
    starRating: rating,
    comment: asString(review.comment)?.slice(0, 20_000) ?? null,
    createTime: asString(review.createTime),
    updateTime: asString(review.updateTime),
    reply: replyComment
      ? {
          comment: replyComment.slice(0, 20_000),
          updateTime: asString(reply.updateTime),
          status:
            asString(review.reviewReplyState) ??
            asString(reply.reviewReplyState),
          policyViolation:
            asString(policyViolation.type) ??
            asString(policyViolation.policyTopic),
        }
      : null,
  };
}

export async function listGoogleBusinessReviews(
  accessToken: string,
  accountResourceName: string,
  locationResourceName: string,
  pageToken?: string | null,
): Promise<GoogleBusinessReviewsPage> {
  const account = googleResourceName(accountResourceName, "accounts");
  const location = googleResourceName(locationResourceName, "locations");
  const token = pageToken?.trim() ?? "";
  if (token.length > 2048) throw new Error("Google review page token is invalid.");
  const url = new URL(
    `${GOOGLE_MY_BUSINESS_API}/${account}/${location}/reviews`,
  );
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("orderBy", "updateTime desc");
  if (token) url.searchParams.set("pageToken", token);
  const payload = await googleApiJson(url, accessToken, {
    remainingFetches: 2,
  });
  const averageRating = Number(payload.averageRating);
  const totalReviewCount = Number(payload.totalReviewCount);
  return {
    reviews: asArray(payload.reviews)
      .map(mapGoogleReview)
      .filter((review): review is GoogleBusinessReview => Boolean(review)),
    averageRating: Number.isFinite(averageRating) ? averageRating : null,
    totalReviewCount:
      Number.isFinite(totalReviewCount) && totalReviewCount >= 0
        ? Math.floor(totalReviewCount)
        : 0,
    nextPageToken: asString(payload.nextPageToken),
  };
}

export type GoogleServiceItem = { kind: "free" | "structured"; serviceTypeId: string; label: string; description: string; category: string };

export async function getGoogleBusinessListing(accessToken: string, accountName: string, locationName: string) {
  const account = googleResourceName(accountName, "accounts");
  const location = googleResourceName(locationName, "locations");
  const infoUrl = new URL(`${BUSINESS_INFO_API}/${location}`);
  infoUrl.searchParams.set(
    "readMask",
    "title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,serviceArea,openInfo,metadata,profile,serviceItems",
  );
  const mediaUrl = new URL(`${GOOGLE_MY_BUSINESS_API}/${account}/${location}/media`);
  mediaUrl.searchParams.set("pageSize", "60");
  const [info, media] = await Promise.allSettled([
    googleApiJson(infoUrl, accessToken, { remainingFetches: 2 }),
    googleApiJson(mediaUrl, accessToken, { remainingFetches: 2 }),
  ]);
  const details = info.status === "fulfilled" ? info.value : {};
  const categories = asRecord(details.categories);
  const address = asRecord(details.storefrontAddress);
  const addressLines = asArray(address.addressLines).map(asString).filter((line): line is string => Boolean(line));
  const cityLine = [
    asString(address.locality),
    [asString(address.administrativeArea), asString(address.postalCode)].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  const formattedAddress = [...addressLines, cityLine].filter(Boolean).join(", ") || null;
  const serviceArea = asRecord(details.serviceArea);
  const metadata = asRecord(details.metadata);
  const phones = asRecord(details.phoneNumbers);
  const primaryCategory = asRecord(categories.primaryCategory);
  return {
    editable: {
      title: asString(details.title) ?? "",
      description: asString(asRecord(details.profile).description) ?? "",
      website: asString(details.websiteUri) ?? "",
      primaryPhone: asString(phones.primaryPhone) ?? "",
      additionalPhones: asArray(phones.additionalPhones).map(asString).filter((phone): phone is string => Boolean(phone)),
      primaryCategory: asString(primaryCategory.name)
        ? { name: String(primaryCategory.name), displayName: asString(primaryCategory.displayName) ?? String(primaryCategory.name) }
        : null,
      additionalCategories: asArray(categories.additionalCategories).map(asRecord)
        .filter((category) => asString(category.name))
        .map((category) => ({ name: String(category.name), displayName: asString(category.displayName) ?? String(category.name) })),
      address: {
        addressLines,
        locality: asString(address.locality) ?? "",
        administrativeArea: asString(address.administrativeArea) ?? "",
        postalCode: asString(address.postalCode) ?? "",
        regionCode: asString(address.regionCode) ?? "US",
      },
      hasStorefront: addressLines.length > 0,
      serviceItems: asArray(details.serviceItems).map(asRecord).flatMap((item): GoogleServiceItem[] => {
        const structured = asRecord(item.structuredServiceItem);
        const free = asRecord(item.freeFormServiceItem);
        const freeLabel = asRecord(free.label);
        if (asString(structured.serviceTypeId)) {
          const id = String(structured.serviceTypeId);
          return [{
            kind: "structured",
            serviceTypeId: id,
            label: id.replace(/^job_type_id:/, "").replace(/_/g, " "),
            description: asString(structured.description) ?? "",
            category: "",
          }];
        }
        if (asString(freeLabel.displayName)) {
          return [{
            kind: "free",
            serviceTypeId: "",
            label: String(freeLabel.displayName),
            description: asString(freeLabel.description) ?? "",
            category: asString(free.category) ?? "",
          }];
        }
        return [];
      }),
      openStatus: asString(asRecord(details.openInfo).status) ?? "OPEN",
    },
    hasPendingEdits: metadata.hasPendingEdits === true,
    hasGoogleUpdated: metadata.hasGoogleUpdated === true,
    title: asString(details.title),
    phone: asString(phones.primaryPhone),
    primaryCategory: asString(asRecord(categories.primaryCategory).displayName),
    additionalCategories: asArray(categories.additionalCategories)
      .map((category) => asString(asRecord(category).displayName))
      .filter((name): name is string => Boolean(name)),
    address: formattedAddress,
    serviceAreas: asArray(asRecord(serviceArea.places).placeInfos)
      .map((place) => asString(asRecord(place).placeName))
      .filter((name): name is string => Boolean(name)),
    openStatus: asString(asRecord(details.openInfo).status),
    mapsUrl: asString(metadata.mapsUri),
    reviewUrl: asString(metadata.newReviewUri),
    description: asString(asRecord(details.profile).description),
    website: asString(details.websiteUri),
    hours: asArray(asRecord(details.regularHours).periods).map(asRecord).map((period) => ({
      openDay: asString(period.openDay),
      closeDay: asString(period.closeDay),
      openTime: googleTimeOfDay(period.openTime),
      closeTime: googleTimeOfDay(period.closeTime),
    })),
    specialHours: asArray(asRecord(details.specialHours).specialHourPeriods).map(asRecord).map((period) => ({
      date: googleDate(period.startDate),
      closed: period.closed === true,
      openTime: googleTimeOfDay(period.openTime),
      closeTime: googleTimeOfDay(period.closeTime),
    })).filter((period) => period.date),
    services: asArray(details.serviceItems).map(asRecord).map((item) =>
      asString(asRecord(asRecord(item.freeFormServiceItem).label).displayName) ??
      asString(asRecord(item.structuredServiceItem).serviceTypeId)?.replace(/^job_type_id:/, "").replace(/_/g, " ") ??
      null,
    ).filter((name): name is string => Boolean(name)),
    detailsAvailable: info.status === "fulfilled",
    mediaAvailable: media.status === "fulfilled",
    hasMoreMedia: media.status === "fulfilled" && Boolean(media.value.nextPageToken),
    media: media.status === "fulfilled" ? asArray(media.value.mediaItems).map(asRecord).map((item) => ({
      name: asString(item.name),
      url: asString(item.googleUrl),
      thumbnail: asString(item.thumbnailUrl),
      kind: asString(item.mediaFormat),
      category: asString(asRecord(item.locationAssociation).category),
      description: asString(item.description),
      createTime: asString(item.createTime),
      views: Number.isFinite(Number(asRecord(item.insights).viewCount)) ? Number(asRecord(item.insights).viewCount) : null,
    })) : [],
  };
}

export async function updateGoogleBusinessListing(accessToken: string, locationName: string, website: string, description: string) {
  const location = googleResourceName(locationName, "locations");
  const url = new URL(`${BUSINESS_INFO_API}/${location}`);
  url.searchParams.set("updateMask", "websiteUri,profile.description");
  await googleApiJson(url, accessToken, { remainingFetches: 2 }, {
    method: "PATCH",
    body: { websiteUri: website, profile: { description } },
  });
}

const PERFORMANCE_API = "https://businessprofileperformance.googleapis.com/v1";
/** Views, calls, clicks and direction requests from the Business Profile Performance API. */
export async function getGoogleBusinessPerformance(
  accessToken: string,
  locationName: string,
  rangeDays: number,
  now = new Date(),
): Promise<GoogleBusinessPerformance> {
  const location = googleResourceName(locationName, "locations");
  const days = (GOOGLE_PERFORMANCE_RANGES as readonly number[]).includes(rangeDays) ? rangeDays : 28;
  // Google's insights lag a few days; ending yesterday keeps today's zeros out.
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end.getTime() - (days * 2 - 1) * 86_400_000);
  const url = new URL(`${PERFORMANCE_API}/${location}:fetchMultiDailyMetricsTimeSeries`);
  for (const metric of PERFORMANCE_METRICS_LIST()) url.searchParams.append("dailyMetrics", metric);
  url.searchParams.set("dailyRange.startDate.year", String(start.getUTCFullYear()));
  url.searchParams.set("dailyRange.startDate.month", String(start.getUTCMonth() + 1));
  url.searchParams.set("dailyRange.startDate.day", String(start.getUTCDate()));
  url.searchParams.set("dailyRange.endDate.year", String(end.getUTCFullYear()));
  url.searchParams.set("dailyRange.endDate.month", String(end.getUTCMonth() + 1));
  url.searchParams.set("dailyRange.endDate.day", String(end.getUTCDate()));

  const keywordEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const keywordStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (days > 28 ? 5 : 2), 1));
  const keywordUrl = new URL(`${PERFORMANCE_API}/${location}/searchkeywords/impressions/monthly`);
  keywordUrl.searchParams.set("monthlyRange.startMonth.year", String(keywordStart.getUTCFullYear()));
  keywordUrl.searchParams.set("monthlyRange.startMonth.month", String(keywordStart.getUTCMonth() + 1));
  keywordUrl.searchParams.set("monthlyRange.endMonth.year", String(keywordEnd.getUTCFullYear()));
  keywordUrl.searchParams.set("monthlyRange.endMonth.month", String(keywordEnd.getUTCMonth() + 1));
  keywordUrl.searchParams.set("pageSize", "50");

  const [series, keywordPayload] = await Promise.allSettled([
    googleApiJson(url, accessToken, { remainingFetches: 2 }),
    googleApiJson(keywordUrl, accessToken, { remainingFetches: 2 }),
  ]);
  if (series.status === "rejected") throw series.reason;

  return buildGooglePerformance(
    series.value,
    keywordPayload.status === "fulfilled" ? keywordPayload.value : null,
    start,
    end,
    days,
    { start: isoDay(keywordStart).slice(0, 7), end: isoDay(keywordEnd).slice(0, 7) },
  );
}

export async function searchGoogleBusinessCategories(accessToken: string, query: string, regionCode = "US") {
  const term = query.replace(/["\\]/g, "").trim().slice(0, 60);
  if (term.length < 2) return [];
  const url = new URL(`${BUSINESS_INFO_API}/categories`);
  url.searchParams.set("regionCode", /^[A-Z]{2}$/.test(regionCode) ? regionCode : "US");
  url.searchParams.set("languageCode", "en");
  url.searchParams.set("view", "BASIC");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("filter", `displayName=${term}`);
  const payload = await googleApiJson(url, accessToken, { remainingFetches: 2 });
  return asArray(payload.categories).map(asRecord).flatMap((category) => {
    const name = asString(category.name);
    return name && /^categories\/gcid:[a-z0-9_]{1,120}$/.test(name)
      ? [{ name, displayName: asString(category.displayName) ?? name }]
      : [];
  });
}

export async function updateGoogleBusinessLocation(accessToken: string, locationName: string, update: GoogleLocationUpdate) {
  const location = googleResourceName(locationName, "locations");
  const { body, updateMask } = googleLocationPatch(update);
  const url = new URL(`${BUSINESS_INFO_API}/${location}`);
  url.searchParams.set("updateMask", updateMask);
  await googleApiJson(url, accessToken, { remainingFetches: 2 }, { method: "PATCH", body });
}

export const GOOGLE_MEDIA_CATEGORIES = ["COVER", "PROFILE", "EXTERIOR", "INTERIOR", "PRODUCT", "AT_WORK", "TEAMS", "ADDITIONAL"] as const;
export const GOOGLE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const GOOGLE_VIDEO_MAX_BYTES = 30 * 1024 * 1024;

/** Google's three-step upload: reserve a media slot, send the bytes, then attach it to the location. */
export async function uploadGoogleBusinessMedia(
  accessToken: string,
  accountName: string,
  locationName: string,
  file: { bytes: ArrayBuffer; type: string },
  category: string,
) {
  const account = googleResourceName(accountName, "accounts");
  const location = googleResourceName(locationName, "locations");
  const isVideo = file.type.startsWith("video/");
  if (!/^(image\/(jpeg|png)|video\/(mp4|quicktime))$/.test(file.type)) throw new Error("Upload a JPG or PNG photo, or an MP4 or MOV video.");
  if (file.bytes.byteLength < 10 * 1024) throw new Error("Google needs photos and videos of at least 10 KB.");
  if (file.bytes.byteLength > (isVideo ? GOOGLE_VIDEO_MAX_BYTES : GOOGLE_PHOTO_MAX_BYTES)) {
    throw new Error(isVideo ? "Videos must be 30 MB or smaller." : "Photos must be 5 MB or smaller.");
  }
  const mediaCategory = (GOOGLE_MEDIA_CATEGORIES as readonly string[]).includes(category) ? category : "ADDITIONAL";
  if (isVideo && ["COVER", "PROFILE"].includes(mediaCategory)) throw new Error("Cover and logo must be photos.");

  const start = await googleApiJson(
    new URL(`${GOOGLE_MY_BUSINESS_API}/${account}/${location}/media:startUpload`),
    accessToken,
    { remainingFetches: 2 },
    { method: "POST", body: {} },
  );
  const resourceName = asString(start.resourceName);
  if (!resourceName || !/^[A-Za-z0-9_\-=/.]{1,500}$/.test(resourceName)) throw new Error("Google did not accept the upload. Try again.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const upload = await fetch(`https://mybusiness.googleapis.com/upload/v1/media/${resourceName}?upload_type=media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": file.type },
      body: file.bytes,
      signal: controller.signal,
    });
    if (!upload.ok) throw new Error(`Google could not store the file (${upload.status}). Try again.`);
    await upload.arrayBuffer().catch(() => undefined);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The upload to Google timed out. Try a smaller file.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const created = await googleApiJson(
    new URL(`${GOOGLE_MY_BUSINESS_API}/${account}/${location}/media`),
    accessToken,
    { remainingFetches: 2 },
    {
      method: "POST",
      body: { mediaFormat: isVideo ? "VIDEO" : "PHOTO", locationAssociation: { category: mediaCategory }, dataRef: { resourceName } },
    },
  );
  return { name: asString(created.name), url: asString(created.googleUrl), thumbnail: asString(created.thumbnailUrl) };
}

export async function deleteGoogleBusinessMedia(accessToken: string, accountName: string, locationName: string, mediaName: string) {
  const account = googleResourceName(accountName, "accounts");
  const location = googleResourceName(locationName, "locations");
  const prefix = `${account}/${location}/media/`;
  if (!mediaName.startsWith(prefix) || !/^[A-Za-z0-9_-]{1,300}$/.test(mediaName.slice(prefix.length))) {
    throw new Error("That photo does not belong to this business.");
  }
  await googleApiJson(new URL(`${GOOGLE_MY_BUSINESS_API}/${mediaName}`), accessToken, { remainingFetches: 2 }, { method: "DELETE" });
}

export async function updateGoogleBusinessReviewReply(
  accessToken: string,
  accountResourceName: string,
  locationResourceName: string,
  reviewIdValue: string,
  comment: string,
) {
  const account = googleResourceName(accountResourceName, "accounts");
  const location = googleResourceName(locationResourceName, "locations");
  const reviewId = googleReviewId(reviewIdValue);
  const reply = comment.trim();
  if (!reply) throw new Error("Reply text is required.");
  if (new TextEncoder().encode(reply).byteLength > 4096) {
    throw new Error("Google review replies must be 4,096 bytes or less.");
  }
  const url = new URL(
    `${GOOGLE_MY_BUSINESS_API}/${account}/${location}/reviews/${encodeURIComponent(reviewId)}/reply`,
  );
  return googleApiJson(
    url,
    accessToken,
    { remainingFetches: 2 },
    { method: "PUT", body: { comment: reply } },
  );
}

export async function deleteGoogleBusinessReviewReply(
  accessToken: string,
  accountResourceName: string,
  locationResourceName: string,
  reviewIdValue: string,
) {
  const account = googleResourceName(accountResourceName, "accounts");
  const location = googleResourceName(locationResourceName, "locations");
  const reviewId = googleReviewId(reviewIdValue);
  const url = new URL(
    `${GOOGLE_MY_BUSINESS_API}/${account}/${location}/reviews/${encodeURIComponent(reviewId)}/reply`,
  );
  await googleApiJson(
    url,
    accessToken,
    { remainingFetches: 2 },
    { method: "DELETE" },
  );
}
