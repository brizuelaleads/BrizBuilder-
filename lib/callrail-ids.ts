// Validating CallRail resource identifiers before they reach a URL path.
//
// Account and company ids are interpolated directly into API paths, so a value
// that escapes the expected shape could reach a different endpoint entirely.
// Everything here rejects by default and only admits the two forms CallRail is
// documented to return.
//
// Dependency-free so the rules can be exercised directly in tests.

/**
 * The current v3 form: a three-letter uppercase resource prefix followed by an
 * opaque identifier. CallRail's published examples are 32 hex characters
 * (`ACC8154748ae6bd4e278a7cddd38a662f4f`), but the length is deliberately not
 * pinned to 32 here — an identifier format is the provider's to change, and a
 * hard-coded length would fail closed on every request the day it did. The
 * bounds are wide enough to absorb that and narrow enough to reject junk.
 *
 * Alphanumeric only. That is what makes this a path-safety check as well as a
 * shape check: no dot, slash, backslash, percent or space can survive it, so a
 * traversal sequence cannot be smuggled through an id.
 */
const RESOURCE_ID_BODY = "[A-Za-z0-9]{8,64}";

const ACCOUNT_ID_PATTERN = new RegExp(`^ACC${RESOURCE_ID_BODY}$`, "u");
const COMPANY_ID_PATTERN = new RegExp(`^COM${RESOURCE_ID_BODY}$`, "u");

/**
 * The legacy numeric form.
 *
 * Accepted deliberately, not by oversight. CallRail's current API reference is
 * internally inconsistent: the Accounts endpoint documents prefixed ids, while
 * the Companies listing example on the same page still shows bare numeric ones
 * (`"id": 196207137`). Rejecting numeric would fail closed against whichever of
 * those an account actually returns, and a bare digit string cannot express a
 * traversal sequence, so admitting it costs nothing in safety.
 *
 * Six digits minimum so a stray "0" or "123" is still rejected as junk.
 */
const LEGACY_NUMERIC_PATTERN = /^[0-9]{6,20}$/u;

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isCallRailAccountId(value: unknown): boolean {
  const text = asText(value);
  return ACCOUNT_ID_PATTERN.test(text) || LEGACY_NUMERIC_PATTERN.test(text);
}

export function isCallRailCompanyId(value: unknown): boolean {
  const text = asText(value);
  return COMPANY_ID_PATTERN.test(text) || LEGACY_NUMERIC_PATTERN.test(text);
}

export function assertCallRailAccountId(value: unknown): string {
  const text = asText(value);
  if (!isCallRailAccountId(text)) {
    throw new Error(
      "That is not a valid CallRail account ID. Choose an account from the list rather than entering one by hand.",
    );
  }
  return text;
}

export function assertCallRailCompanyId(value: unknown): string {
  const text = asText(value);
  if (!isCallRailCompanyId(text)) {
    throw new Error(
      "That is not a valid CallRail company ID. Choose a company from the list rather than entering one by hand.",
    );
  }
  return text;
}

/**
 * The Postgres equivalents, kept beside the TypeScript ones so the two cannot
 * drift apart unnoticed. The check constraints in the CallRail connection
 * migration are written from these.
 */
export const CALLRAIL_ID_SQL_PATTERNS = {
  account: "^(ACC[A-Za-z0-9]{8,64}|[0-9]{6,20})$",
  company: "^(COM[A-Za-z0-9]{8,64}|[0-9]{6,20})$",
} as const;
