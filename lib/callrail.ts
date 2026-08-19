import {
  assertCallRailAccountId,
  assertCallRailCompanyId,
} from "./callrail-ids";
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

async function callRailRequest(
  path: string,
  apiKey: string,
  searchParams: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`${CALLRAIL_API_URL}${path}`);
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
    response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        // Token auth, not Bearer. CallRail's scheme is
        // `Authorization: Token token="KEY"`, and it travels in the header so
        // it cannot end up in an intermediary's request log.
        Authorization: `Token token="${apiKey}"`,
        "Request-From": CALLRAIL_REQUEST_FROM,
        Accept: "application/json",
      },
      signal: controller.signal,
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
    throw new CallRailApiError(status, messageForStatus(status));
  }
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw new CallRailApiError("rejected", messageForStatus("rejected"));
  }
  return body as Record<string, unknown>;
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
  const body = await callRailRequest("/a.json", apiKey, {
    per_page: String(CALLRAIL_PAGE_SIZE),
  });
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
  const body = await callRailRequest(`/a/${safeAccountId}.json`, apiKey);
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
  );
  const company = mapCompany(body);
  return { ...company, id: company.id || safeCompanyId };
}
