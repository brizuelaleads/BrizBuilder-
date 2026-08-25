import { collectCallRailPages } from "./callrail-pagination";
import {
  MAX_CALLRAIL_MEDIA_REDIRECTS,
  allowedCallRailMediaUrl,
  callRailMediaRequestHeaders,
  decideCallRailMediaResponse,
  readCallRailRecordingLocation,
} from "./callrail-media";
import {
  assertCallRailAccountId,
  assertCallRailCompanyId,
} from "./callrail-ids";
import {
  DNI_EXCHANGE_TTL_MS,
  deriveDniSigningKey,
  signDniClaim,
  verifyDniClaim,
  type DniClaim,
} from "./callrail-dni";
import {
  appendCallRailWebhookUrls,
  callRailWebhookConfigsEqual,
  isCallRailSigningKey,
  removeCallRailWebhookUrls,
  type CallRailWebhookUrlSet,
} from "./callrail-webhook";
import { readRuntimeValue } from "./supabase/env";

// Server-side CallRail API client. The customer's API key is decrypted only for
// the duration of a single request and never appears in a thrown message, a log
// line, a stored row, or any response that reaches a browser.
//
// CallRail keys are scoped to the user who created them and can read every
// account and company that user can see, so the key is treated as strictly more
// sensitive than the ids it accompanies. Every error path below returns a fixed
// message chosen by us rather than anything echoed back from the provider.
const CALLRAIL_API_URL = "https://api.callrail.com/v3";
const CALLRAIL_REQUEST_TIMEOUT_MS = 10_000;
// CallRail asks third-party integrations to identify themselves so their
// support team can attribute traffic. Customers using the API for their own
// reporting do not send this; we are a platform, so we do.
const CALLRAIL_REQUEST_FROM = "brizbuilder";
// A key normally reaches one account and a handful of companies. Anything
// beyond a page is reported as truncated rather than silently dropped.
const CALLRAIL_PAGE_SIZE = 100;
const CALLRAIL_CALL_PAGE_SIZE = 100;
/**
 * Exactly the field names CallRail documents as selectable.
 *
 * `fields` is validated by CallRail, so one name it does not recognise takes
 * the whole request down with a 400 — which is what happened to the first
 * reconciliation. utm_content and utm_medium were asked for and are not in the
 * documented "Additional User Requested Response Fields" list; `medium` is,
 * and stays. Anything added here has to be checked against the docs first.
 */
const CALLRAIL_CALL_FIELDS = [
  "agent_email",
  "call_summary",
  "call_type",
  "campaign",
  "company_id",
  "company_name",
  "conversational_transcript",
  "created_at",
  "custom",
  "fbclid",
  "gclid",
  "keywords",
  "landing_page_url",
  "last_requested_url",
  "lead_status",
  "medium",
  "milestones",
  "msclkid",
  "person_id",
  "prior_calls",
  "referrer_domain",
  "referring_url",
  "session_uuid",
  "source",
  "source_name",
  "tags",
  "tracker_id",
  "transcription",
  "utm_campaign",
] as const;

export { assertCallRailAccountId, assertCallRailCompanyId };

export type CallRailEncryptedValue = {
  ciphertext: string;
  iv: string;
};

/** Closed vocabulary. Mirrors the check constraint on callrail_credentials. */
export type CallRailStatus =
  | "ok"
  | "unauthorized"
  | "not_found"
  | "rejected"
  | "error";

export type CallRailAccount = {
  id: string;
  name: string;
  hipaaAccount: boolean;
};

export type CallRailCompany = {
  id: string;
  name: string;
  status: string;
  timeZone: string | null;
  // Whether the CallRail JavaScript snippet has ever been seen on the site.
  // Null means never installed, which is different from installed-and-inactive.
  dniActive: boolean | null;
  // The exact snippet URL for this company. Returned by CallRail so BrizBuilder
  // can generate the install instructions rather than asking anyone to copy the
  // snippet out of the CallRail dashboard.
  scriptUrl: string | null;
  // CallRail's `callscribe_enabled`. This says the CallScribe feature is turned
  // on for the company. It does NOT establish that the account's subscription
  // permits retrieving transcripts through the API — that is a separate plan
  // entitlement, and an account can show CallScribe enabled while the API
  // returns a null transcription. Anything shown to a user from this field must
  // be worded as "enabled on this company", never as "transcripts available".
  callScribeEnabled: boolean;
  formCaptureEnabled: boolean;
};

export type CallRailIntegration = {
  id: string;
  type: string;
  state: string;
  config: Record<string, unknown>;
  signingKey: string | null;
};

export type CallRailIntegrationPage = {
  integrations: CallRailIntegration[];
  truncated: boolean;
};

export type CallRailWebhookIntegrationResult = {
  integration: CallRailIntegration;
  created: boolean;
  changed: boolean;
  signingKey: string;
  /**
   * The configuration as it was before this call touched it.
   *
   * Carried back so the caller can put CallRail exactly as it found it if the
   * work that follows fails. Enabling ingestion writes to CallRail and then to
   * the database, and a failure between the two would otherwise leave a
   * customer's CallRail pointing at an integration BrizBuilder has no record
   * of.
   */
  previousConfig: Record<string, unknown> | null;
};

export type CallRailCall = {
  id: string;
  companyId: string;
  direction: string | null;
  answered: boolean | null;
  durationSeconds: number | null;
  startedAt: string | null;
  endedAt: string | null;
  trackingPhoneNumber: string | null;
  businessPhoneNumber: string | null;
  customerPhoneE164: string | null;
  customerName: string | null;
  customerCity: string | null;
  customerState: string | null;
  customerCountry: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  keywords: string | null;
  referrerDomain: string | null;
  landingPageUrl: string | null;
  lastRequestedUrl: string | null;
  gclid: string | null;
  msclkid: string | null;
  sessionUuid: string | null;
  trackerId: string | null;
  fbclid: string | null;
  isSessionTracker: boolean;
  personId: string | null;
  priorCalls: number | null;
  leadStatus: string | null;
  callType: string | null;
  tags: string[];
  /** Always null. See mapCall. */
  recordingUrl: string | null;
  /** Whether CallRail reported a recording, without saying where it is. */
  recordingAvailable: boolean;
  recordingDurationSeconds: number | null;
  transcript: string | null;
  callSummary: string | null;
};

export type CallRailCallIdPage = {
  /** CallRail's own call ids, de-duplicated, in the order discovered. */
  callIds: string[];
  /** True when the page cap was reached with pages still unread. */
  truncated: boolean;
};

export class CallRailApiError extends Error {
  readonly status: CallRailStatus;
  constructor(status: CallRailStatus, message: string) {
    super(message);
    this.name = "CallRailApiError";
    this.status = status;
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
    throw new Error(
      `CallRail security is not configured. Add ${name} in Cloudflare.`,
    );
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
    keyBytes("CALLRAIL_CREDENTIAL_ENCRYPTION_KEY") as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export function getCallRailRuntimeStatus() {
  const missing = ["CALLRAIL_CREDENTIAL_ENCRYPTION_KEY"].filter(
    (name) => !readRuntimeValue(name),
  );
  return { ready: missing.length === 0, missing };
}

export function getCallRailWebhookBaseUrl() {
  const value =
    readRuntimeValue("CALLRAIL_WEBHOOK_BASE_URL") ||
    readRuntimeValue("NEXT_PUBLIC_LEAD_CAPTURE_BASE_URL") ||
    readRuntimeValue("TWILIO_WEBHOOK_BASE_URL");
  if (!value) {
    throw new Error(
      "CallRail webhook ingress is not configured. Add CALLRAIL_WEBHOOK_BASE_URL.",
    );
  }
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("CallRail webhook ingress must use HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/+$/g, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/g, "");
}

// The tenant is bound into the additional authenticated data, so a key row
// copied to another organization or client cannot be decrypted.
function additionalData(organizationId: string, clientId: string) {
  return new TextEncoder().encode(
    `brizbuilder:callrail:${organizationId}:${clientId}:v1`,
  );
}

export async function encryptCallRailSecret(
  plaintext: string,
  organizationId: string,
  clientId: string,
): Promise<CallRailEncryptedValue> {
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

export async function decryptCallRailSecret(
  encrypted: CallRailEncryptedValue,
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
      "The saved CallRail authorization could not be decrypted. Reconnect CallRail.",
    );
  }
}

/**
 * Maps a response to our closed status vocabulary.
 *
 * Deliberately ignores the response body. CallRail error payloads are not
 * documented as secret-bearing, but the request carried a bearer credential and
 * echoing any part of that exchange into a message that may reach a UI or a log
 * is not a risk worth taking for a diagnostic string.
 */
/**
 * Closed set of endpoint labels for diagnostics.
 *
 * A label, not a path. The real path contains the account id, and an
 * identifier is exactly what these logs must not carry.
 */
type CallRailEndpoint =
  | "accounts.list"
  | "accounts.get"
  | "companies.list"
  | "companies.get"
  | "calls.list"
  | "calls.get"
  | "calls.recording"
  | "integrations.list"
  | "integrations.write"
  | "unknown";

type CallRailRequestOptions = {
  method?: "GET" | "POST" | "PUT";
  searchParams?: Record<string, string>;
  body?: Record<string, unknown>;
};

function statusForResponse(response: Response): CallRailStatus {
  if (response.status === 401 || response.status === 403) return "unauthorized";
  if (response.status === 404) return "not_found";
  return "rejected";
}

function messageForStatus(status: CallRailStatus): string {
  switch (status) {
    case "unauthorized":
      return "CallRail rejected that API key. Check it was created by a user with access to this account, then try again.";
    case "not_found":
      return "CallRail could not find that account or company. It may have been removed, or this API key may no longer reach it.";
    case "rejected":
      return "CallRail could not complete that request. Check the API key and try again.";
    default:
      return "BrizBuilder could not reach CallRail. Try again in a moment.";
  }
}

function requestOptions(
  options: CallRailRequestOptions | Record<string, string>,
): Required<CallRailRequestOptions> {
  if (
    Object.prototype.hasOwnProperty.call(options, "method") ||
    Object.prototype.hasOwnProperty.call(options, "searchParams") ||
    Object.prototype.hasOwnProperty.call(options, "body")
  ) {
    const typed = options as CallRailRequestOptions;
    return {
      method: typed.method ?? "GET",
      searchParams: typed.searchParams ?? {},
      body: typed.body ?? {},
    };
  }
  return {
    method: "GET",
    searchParams: options as Record<string, string>,
    body: {},
  };
}

async function callRailUrlRequest(
  url: URL,
  apiKey: string,
  options: CallRailRequestOptions | Record<string, string> = {},
  /** A fixed label, never a path: a real path carries the account id. */
  endpoint: CallRailEndpoint = "unknown",
): Promise<Record<string, unknown>> {
  const { method, searchParams, body: requestBody } = requestOptions(options);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CALLRAIL_REQUEST_TIMEOUT_MS,
  );
  let response: Response;
  try {
    const headers: Record<string, string> = {
      // Token auth, not Bearer. CallRail's scheme is
      // `Authorization: Token token="KEY"`, and it travels in the header so
      // it cannot end up in an intermediary's request log.
      Authorization: `Token token="${apiKey}"`,
      "Request-From": CALLRAIL_REQUEST_FROM,
      Accept: "application/json",
    };
    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };
    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(requestBody);
    }
    response = await fetch(url.toString(), {
      ...init,
    });
  } catch {
    // A timeout and a transport failure are the same thing to a caller: no
    // answer arrived, so nothing is known and the attempt is retryable.
    throw new CallRailApiError(
      "error",
      controller.signal.aborted
        ? "CallRail did not respond in time."
        : messageForStatus("error"),
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const status = statusForResponse(response);
    // Temporary, and deliberately two facts: which endpoint, and the number
    // CallRail answered with. No parameters, no response body, no account,
    // company or call id, no credential, nothing about a caller. A 400 here
    // says the request was malformed and the endpoint says which one to read.
    console.error("CallRail request rejected.", {
      endpoint,
      httpStatus: response.status,
    });
    throw new CallRailApiError(status, messageForStatus(status));
  }
  const responseBody = await response.json().catch(() => null);
  if (!responseBody || typeof responseBody !== "object") {
    throw new CallRailApiError("rejected", messageForStatus("rejected"));
  }
  return responseBody as Record<string, unknown>;
}

async function callRailRequest(
  path: string,
  apiKey: string,
  options: CallRailRequestOptions | Record<string, string> = {},
  endpoint: CallRailEndpoint = "unknown",
): Promise<Record<string, unknown>> {
  return callRailUrlRequest(
    new URL(`${CALLRAIL_API_URL}${path}`),
    apiKey,
    options,
    endpoint,
  );
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  // CallRail's legacy numeric ids arrive as JSON numbers, not strings.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asOptionalText(value: unknown): string | null {
  const text = asText(value);
  return text ? text : null;
}

function asOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function mapAccount(row: Record<string, unknown>): CallRailAccount {
  return {
    id: asText(row.id),
    name: asText(row.name) || "Untitled account",
    // HIPAA accounts return expiring recording URLs that must never be stored.
    // Captured now so later phases cannot forget to ask.
    hipaaAccount: row.hipaa_account === true,
  };
}

function mapCompany(row: Record<string, unknown>): CallRailCompany {
  return {
    id: asText(row.id),
    name: asText(row.name) || "Untitled company",
    status: asText(row.status) || "unknown",
    timeZone: asOptionalText(row.time_zone),
    dniActive: asOptionalBoolean(row.dni_active),
    scriptUrl: asOptionalText(row.script_url),
    callScribeEnabled: row.callscribe_enabled === true,
    formCaptureEnabled: row.form_capture === true,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asOptionalNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];
}

function mapIntegration(row: Record<string, unknown>): CallRailIntegration {
  return {
    id: asText(row.id),
    type: asText(row.type),
    state: asText(row.state) || "unknown",
    config: asRecord(row.config),
    signingKey: asOptionalText(row.signing_key),
  };
}

function safeIso(value: unknown): string | null {
  const text = asOptionalText(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function endTime(startedAt: string | null, durationSeconds: number | null) {
  if (!startedAt || durationSeconds == null) return null;
  return new Date(Date.parse(startedAt) + durationSeconds * 1000).toISOString();
}

function mapCallSummary(value: unknown): string | null {
  if (typeof value === "string") return value.trim().slice(0, 2400) || null;
  if (!Array.isArray(value)) return null;
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .join("\n")
    .slice(0, 2400) || null;
}

function mapTranscript(value: unknown): string | null {
  if (typeof value === "string") return value.trim().slice(0, 20_000) || null;
  if (!Array.isArray(value)) return null;
  const lines = value
    .map((item) => {
      const row = asRecord(item);
      const phrase = asText(row.phrase);
      if (!phrase) return "";
      const speaker = asText(row.speaker) || "speaker";
      return `${speaker}: ${phrase}`;
    })
    .filter(Boolean);
  return lines.join("\n").slice(0, 20_000) || null;
}

function mapCall(row: Record<string, unknown>): CallRailCall {
  const durationSeconds = asOptionalNumber(row.duration);
  const startedAt = safeIso(row.start_time);
  const landingPageUrl = asOptionalText(row.landing_page_url);
  const lastRequestedUrl = asOptionalText(row.last_requested_url);
  const gclid = asOptionalText(row.gclid);
  const msclkid = asOptionalText(row.msclkid);
  const sessionUuid = asOptionalText(row.session_uuid);
  const fbclid = asOptionalText(row.fbclid);
  return {
    id: asText(row.id),
    companyId: asText(row.company_id),
    direction: asOptionalText(row.direction),
    answered: asOptionalBoolean(row.answered),
    durationSeconds,
    startedAt,
    endedAt: safeIso(row.end_time) ?? endTime(startedAt, durationSeconds),
    trackingPhoneNumber: asOptionalText(row.tracking_phone_number),
    businessPhoneNumber: asOptionalText(row.business_phone_number),
    customerPhoneE164: asOptionalText(row.customer_phone_number),
    customerName:
      asOptionalText(row.customer_name) ??
      asOptionalText(row.formatted_customer_name_or_phone_number),
    customerCity: asOptionalText(row.customer_city),
    customerState: asOptionalText(row.customer_state),
    customerCountry: asOptionalText(row.customer_country),
    source: asOptionalText(row.source),
    medium: asOptionalText(row.medium) ?? asOptionalText(row.utm_medium),
    campaign: asOptionalText(row.campaign) ?? asOptionalText(row.utm_campaign),
    keywords: asOptionalText(row.keywords),
    referrerDomain: asOptionalText(row.referrer_domain),
    landingPageUrl,
    lastRequestedUrl,
    gclid,
    msclkid,
    sessionUuid,
    trackerId: asOptionalText(row.tracker_id),
    fbclid,
    isSessionTracker: Boolean(
      sessionUuid || landingPageUrl || lastRequestedUrl || fbclid || gclid || msclkid,
    ),
    personId: asOptionalText(row.person_id),
    priorCalls: asOptionalNumber(row.prior_calls),
    leadStatus: asOptionalText(row.lead_status),
    callType: asOptionalText(row.call_type),
    tags: asStringArray(row.tags),
    // The URL is still never kept. What is kept is whether there is one and
    // how long it runs, which is all the interface needs to decide between
    // offering a player and saying there is nothing to play. The audio is
    // fetched per request, by a route that checks who is asking.
    recordingUrl: null,
    recordingAvailable: asText(row.recording) !== "",
    recordingDurationSeconds: asOptionalNumber(row.recording_duration),
    transcript: mapTranscript(row.transcription ?? row.conversational_transcript),
    callSummary: mapCallSummary(row.call_summary),
  };
}

export type CallRailAccountPage = {
  accounts: CallRailAccount[];
  truncated: boolean;
};

export type CallRailCompanyPage = {
  companies: CallRailCompany[];
  truncated: boolean;
};

/**
 * Lists every account the supplied key can reach.
 *
 * This is what replaces asking the operator to type an account id. A key is
 * already scoped to the accounts its user can see, so the key itself is the
 * authoritative source for that list — a hand-typed id can only ever agree with
 * it or be wrong.
 *
 * Doubles as the credential check: a key that cannot list accounts is not a
 * working key, and that failure surfaces at setup rather than on the first call
 * weeks later.
 */
export async function listCallRailAccounts(
  apiKey: string,
): Promise<CallRailAccountPage> {
  const body = await callRailRequest(
    "/a.json",
    apiKey,
    { per_page: String(CALLRAIL_PAGE_SIZE) },
    "accounts.list",
  );
  const rows = Array.isArray(body.accounts) ? body.accounts : [];
  const total = Number(body.total_records ?? rows.length);
  return {
    accounts: rows
      .map((row) => mapAccount(row as Record<string, unknown>))
      .filter((account) => account.id !== ""),
    truncated: Number.isFinite(total) && total > rows.length,
  };
}

/** Reads one account back, to confirm the stored key still reaches it. */
export async function getCallRailAccount(
  accountId: string,
  apiKey: string,
): Promise<CallRailAccount> {
  const safeAccountId = assertCallRailAccountId(accountId);
  const body = await callRailRequest(
    `/a/${safeAccountId}.json`,
    apiKey,
    {},
    "accounts.get",
  );
  const account = mapAccount(body);
  return { ...account, id: account.id || safeAccountId };
}

export async function listCallRailCompanies(
  accountId: string,
  apiKey: string,
): Promise<CallRailCompanyPage> {
  const safeAccountId = assertCallRailAccountId(accountId);
  const body = await callRailRequest(
    `/a/${safeAccountId}/companies.json`,
    apiKey,
    { per_page: String(CALLRAIL_PAGE_SIZE) },
    "companies.list",
  );
  const rows = Array.isArray(body.companies) ? body.companies : [];
  const total = Number(body.total_records ?? rows.length);
  return {
    companies: rows
      .map((row) => mapCompany(row as Record<string, unknown>))
      .filter((company) => company.id !== ""),
    truncated: Number.isFinite(total) && total > rows.length,
  };
}

export async function getCallRailCompany(
  accountId: string,
  companyId: string,
  apiKey: string,
): Promise<CallRailCompany> {
  const safeAccountId = assertCallRailAccountId(accountId);
  const safeCompanyId = assertCallRailCompanyId(companyId);
  const body = await callRailRequest(
    `/a/${safeAccountId}/companies/${safeCompanyId}.json`,
    apiKey,
    {},
    "companies.get",
  );
  const company = mapCompany(body);
  return { ...company, id: company.id || safeCompanyId };
}

export async function listCallRailIntegrations(
  accountId: string,
  companyId: string,
  apiKey: string,
): Promise<CallRailIntegrationPage> {
  const safeAccountId = assertCallRailAccountId(accountId);
  const safeCompanyId = assertCallRailCompanyId(companyId);
  const body = await callRailRequest(
    `/a/${safeAccountId}/integrations.json`,
    apiKey,
    {
      company_id: safeCompanyId,
      fields: "signing_key",
      per_page: String(CALLRAIL_PAGE_SIZE),
    },
    "integrations.list",
  );
  const rows = Array.isArray(body.integrations) ? body.integrations : [];
  const total = Number(body.total_records ?? rows.length);
  return {
    integrations: rows
      .map((row) => mapIntegration(row as Record<string, unknown>))
      .filter((integration) => integration.id !== ""),
    truncated: Number.isFinite(total) && total > rows.length,
  };
}

export async function getCallRailIntegration(
  accountId: string,
  integrationId: string,
  apiKey: string,
): Promise<CallRailIntegration> {
  const safeAccountId = assertCallRailAccountId(accountId);
  const safeIntegrationId = asText(integrationId);
  if (!/^[A-Za-z0-9_-]{1,80}$/u.test(safeIntegrationId)) {
    throw new Error("That is not a valid CallRail integration ID.");
  }
  const body = await callRailRequest(
    `/a/${safeAccountId}/integrations/${safeIntegrationId}.json`,
    apiKey,
    { fields: "signing_key" },
    "integrations.list",
  );
  const integration = mapIntegration(body);
  return { ...integration, id: integration.id || safeIntegrationId };
}

export async function createCallRailWebhookIntegration(
  accountId: string,
  companyId: string,
  apiKey: string,
  config: Record<string, unknown>,
): Promise<CallRailIntegration> {
  const safeAccountId = assertCallRailAccountId(accountId);
  const safeCompanyId = assertCallRailCompanyId(companyId);
  const body = await callRailRequest(
    `/a/${safeAccountId}/integrations.json`,
    apiKey,
    {
      method: "POST",
      body: {
        type: "Webhooks",
        company_id: safeCompanyId,
        config,
      },
    },
    "integrations.write",
  );
  return mapIntegration(body);
}

export async function updateCallRailWebhookIntegration(
  accountId: string,
  integrationId: string,
  apiKey: string,
  config: Record<string, unknown>,
): Promise<CallRailIntegration> {
  const safeAccountId = assertCallRailAccountId(accountId);
  const safeIntegrationId = asText(integrationId);
  if (!/^[A-Za-z0-9_-]{1,80}$/u.test(safeIntegrationId)) {
    throw new Error("That is not a valid CallRail integration ID.");
  }
  const body = await callRailRequest(
    `/a/${safeAccountId}/integrations/${safeIntegrationId}.json`,
    apiKey,
    {
      method: "PUT",
      body: {
        state: "active",
        config,
      },
    },
    "integrations.write",
  );
  const integration = mapIntegration(body);
  return { ...integration, id: integration.id || safeIntegrationId };
}

export async function ensureCallRailWebhookIntegration(
  accountId: string,
  companyId: string,
  apiKey: string,
  urls: CallRailWebhookUrlSet,
): Promise<CallRailWebhookIntegrationResult> {
  const page = await listCallRailIntegrations(accountId, companyId, apiKey);
  const existing =
    page.integrations.find((integration) => integration.type === "Webhooks") ??
    null;
  if (!existing) {
    const config = appendCallRailWebhookUrls({}, urls);
    const integration = await createCallRailWebhookIntegration(
      accountId,
      companyId,
      apiKey,
      config,
    );
    const signingKey = integration.signingKey;
    if (!isCallRailSigningKey(signingKey)) {
      throw new CallRailApiError("rejected", messageForStatus("rejected"));
    }
    return {
      integration,
      created: true,
      changed: true,
      signingKey,
      // Nothing existed before, so undoing means withdrawing what was added.
      previousConfig: null,
    };
  }

  const current = existing.signingKey
    ? existing
    : await getCallRailIntegration(accountId, existing.id, apiKey);
  const signingKey = current.signingKey;
  if (!isCallRailSigningKey(signingKey)) {
    throw new CallRailApiError("rejected", messageForStatus("rejected"));
  }

  const config = appendCallRailWebhookUrls(current.config, urls);
  const changed =
    current.state !== "active" || !callRailWebhookConfigsEqual(config, current.config);
  const integration = changed
    ? await updateCallRailWebhookIntegration(accountId, current.id, apiKey, config)
    : current;
  return {
    integration,
    created: false,
    changed,
    signingKey,
    previousConfig: (current.config ?? {}) as Record<string, unknown>,
  };
}

/**
 * Puts a webhook integration back the way it was.
 *
 * Used when enabling ingestion succeeded at CallRail and then failed at the
 * database. Best effort by design: it already runs on a failure path, so it
 * reports whether it worked rather than throwing a second error over the
 * first. A caller that cannot restore says so, because a silent half-state in
 * someone else's CallRail account is worse than a loud one.
 */
export async function restoreCallRailWebhookIntegration(
  accountId: string,
  integrationId: string,
  apiKey: string,
  previousConfig: Record<string, unknown> | null,
  addedUrls: CallRailWebhookUrlSet,
): Promise<boolean> {
  try {
    if (previousConfig) {
      await updateCallRailWebhookIntegration(
        accountId,
        integrationId,
        apiKey,
        previousConfig,
      );
      return true;
    }
    // The integration did not exist before, so the closest thing to undoing is
    // withdrawing the URLs that were added to it.
    const result = await removeCallRailWebhookIntegrationUrls(
      accountId,
      integrationId,
      apiKey,
      addedUrls,
    );
    return result.changed;
  } catch {
    return false;
  }
}

export async function removeCallRailWebhookIntegrationUrls(
  accountId: string,
  integrationId: string,
  apiKey: string,
  urls: CallRailWebhookUrlSet,
): Promise<{ changed: boolean; integration: CallRailIntegration }> {
  const current = await getCallRailIntegration(accountId, integrationId, apiKey);
  if (current.type !== "Webhooks") return { changed: false, integration: current };
  const config = removeCallRailWebhookUrls(current.config, urls);
  if (callRailWebhookConfigsEqual(config, current.config)) {
    return { changed: false, integration: current };
  }
  return {
    changed: true,
    integration: await updateCallRailWebhookIntegration(
      accountId,
      current.id,
      apiKey,
      config,
    ),
  };
}

export async function getCallRailCall(
  accountId: string,
  callId: string,
  apiKey: string,
): Promise<CallRailCall> {
  const safeAccountId = assertCallRailAccountId(accountId);
  const safeCallId = asText(callId);
  if (!/^(CAL[A-Za-z0-9]{8,80}|[0-9]{6,24})$/u.test(safeCallId)) {
    throw new Error("That is not a valid CallRail call ID.");
  }
  const body = await callRailRequest(
    `/a/${safeAccountId}/calls/${safeCallId}.json`,
    apiKey,
    { fields: CALLRAIL_CALL_FIELDS.join(",") },
    "calls.get",
  );
  const call = mapCall(body);
  return { ...call, id: call.id || safeCallId };
}

/**
 * The calendar day of an instant, in UTC.
 *
 * CallRail documents start_date and end_date as ISO 8601 and shows two shapes:
 * a plain date, and a date with minutes. A full timestamp carrying
 * milliseconds and a zone suffix is neither, and was rejected. A plain date is
 * the shape with no ambiguity left in it, and both bounds are inclusive, so
 * the window can only widen — never miss the call it was opened for.
 */
export function callRailDateParam(instant: Date): string {
  if (Number.isNaN(instant.getTime())) {
    throw new Error("A CallRail date filter needs a real date.");
  }
  return instant.toISOString().slice(0, 10);
}

/**
 * Which calls exist in a window. Nothing about them.
 *
 * This is a discovery request and only a discovery request: it names the
 * company, the window and the page, and reads exactly one thing back out of
 * each row — CallRail's own call id. Every detail an ingested call is built
 * from comes from getCallRailCall afterwards, where the full documented field
 * list lives, so nothing here is ever treated as the source of truth.
 *
 * It is this narrow on purpose. Asking the list endpoint for sorting, relative
 * pagination and a field selection was answered with a 400, and none of those
 * three affected which calls came back — only their order and packaging. What
 * is left is the documented default: offset pagination over a filtered window.
 */
/**
 * The audio for one call.
 *
 * Two steps, because CallRail's recording endpoint answers with JSON rather
 * than audio. The first asks where the recording currently is; the second
 * fetches that, following redirects by hand so every hop is judged before it
 * is taken. Only a response that actually claims to be audio is handed back —
 * a JSON body forwarded as media is exactly what this replaced.
 *
 * Nothing about the exchange escapes: the location is read, used and dropped.
 * CallRail's own documentation says never to store it, because the file moves
 * and the endpoint is the only permanent reference to a recording.
 *
 * Every decision here lives in lib/callrail-media, where it can be tested
 * without a network.
 */
export async function getCallRailRecording(
  accountId: string,
  callId: string,
  apiKey: string,
  range?: string | null,
): Promise<Response | null> {
  const safeAccountId = assertCallRailAccountId(accountId);
  const safeCallId = asText(callId);
  if (!/^(CAL[A-Za-z0-9]{8,80}|[0-9]{6,24})$/u.test(safeCallId)) {
    throw new Error("That is not a valid CallRail call ID.");
  }

  let body: Record<string, unknown>;
  try {
    body = await callRailRequest(
      `/a/${safeAccountId}/calls/${safeCallId}/recording.json`,
      apiKey,
      {},
      "calls.recording",
    );
  } catch (error) {
    // No recording is an ordinary answer here, not a failure.
    if (error instanceof CallRailApiError && error.status === "not_found") {
      return null;
    }
    throw error;
  }

  const location = readCallRailRecordingLocation(body);
  if (!location) return null;

  let target = allowedCallRailMediaUrl(location);
  if (!target) {
    refuseMedia(0);
  }

  for (let hop = 0; hop <= MAX_CALLRAIL_MEDIA_REDIRECTS; hop += 1) {
    const current: string = target as string;
    const response = await fetch(current, {
      // No credential on this hop, or any hop. The key was spent on the
      // authenticated request above; the location it returned carries its
      // own signed access.
      headers: callRailMediaRequestHeaders({ range }),
      redirect: "manual",
    });

    const decision = decideCallRailMediaResponse({
      status: response.status,
      contentType: response.headers.get("Content-Type"),
      location: response.headers.get("Location"),
      currentUrl: current,
      hop,
    });

    if (decision.action === "follow") {
      target = decision.url;
      continue;
    }
    if (decision.action === "absent") return null;
    if (decision.action === "refuse") refuseMedia(response.status);
    return response;
  }

  refuseMedia(0);
}

/**
 * Refuse a recording without saying anything about why to the caller.
 *
 * The status is logged as a number beside a fixed endpoint label, and the
 * error carries this codebase's own message. Nothing from CallRail's response
 * — no URL, no body, no header — travels any further.
 */
function refuseMedia(httpStatus: number): never {
  console.error("CallRail request rejected.", {
    endpoint: "calls.recording",
    httpStatus,
  });
  throw new CallRailApiError("rejected", messageForStatus("rejected"));
}

export async function listCallRailCallIds(
  accountId: string,
  companyId: string,
  apiKey: string,
  options: {
    startDate: string;
    endDate: string;
    maxPages?: number;
  },
): Promise<CallRailCallIdPage> {
  const safeAccountId = assertCallRailAccountId(accountId);
  const safeCompanyId = assertCallRailCompanyId(companyId);
  const walk = await collectCallRailPages(
    async (pageNumber) => {
      const body = await callRailRequest(
        `/a/${safeAccountId}/calls.json`,
        apiKey,
        {
          company_id: safeCompanyId,
          start_date: options.startDate,
          end_date: options.endDate,
          page: String(pageNumber),
          per_page: String(CALLRAIL_CALL_PAGE_SIZE),
        },
        "calls.list",
      );
      const reported = Number(body.total_pages);
      return {
        rows: Array.isArray(body.calls) ? body.calls : [],
        totalPages: Number.isFinite(reported) ? reported : null,
      };
    },
    // The one value a discovery walk keeps. A row here is a pointer to a
    // call, never a description of one.
    (row) => asText((row as Record<string, unknown>).id),
    {
      perPage: CALLRAIL_CALL_PAGE_SIZE,
      maxPages: Math.max(1, Math.min(10, options.maxPages ?? 4)),
    },
  );
  return { callIds: walk.ids, truncated: walk.truncated };
}

/**
 * Diagnostic-page credentials.
 *
 * The signing, the tenant binding and the expiry all live in callrail-dni.ts,
 * which depends on nothing but WebCrypto so those rules can be tested directly
 * against a fixed key. This file's only job is supplying the runtime secret.
 */
async function dniKey(): Promise<CryptoKey> {
  return deriveDniSigningKey(keyBytes("CALLRAIL_CREDENTIAL_ENCRYPTION_KEY"));
}

export async function signDniCredential(
  organizationId: string,
  clientId: string,
  ttlMs: number = DNI_EXCHANGE_TTL_MS,
  now: number = Date.now(),
): Promise<string> {
  return signDniClaim(await dniKey(), {
    organizationId,
    clientId,
    expiresAt: now + ttlMs,
  });
}

export async function verifyDniCredential(
  token: unknown,
  now: number = Date.now(),
): Promise<DniClaim | null> {
  return verifyDniClaim(await dniKey(), token, now);
}
