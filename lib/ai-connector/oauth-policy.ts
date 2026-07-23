const PKCE_S256_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const OAUTH_CLIENT_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u;
const OAUTH_CLIENT_NAME_FORMAT_CONTROL_PATTERN = /\p{Cf}/u;

export type OneTimeCredentialState = {
  consumedAt: string | null;
  expiresAt: string;
};

export type RefreshTokenState = {
  rotatedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
};

export type RefreshTokenDecision = "accept" | "reuse" | "invalid";

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function isFutureIsoTimestamp(value: string, nowMs: number): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > nowMs;
}

export function isPkceS256Challenge(value: unknown): value is string {
  return typeof value === "string" && PKCE_S256_CHALLENGE_PATTERN.test(value);
}

export function isPkceVerifier(value: unknown): value is string {
  return typeof value === "string" && PKCE_VERIFIER_PATTERN.test(value);
}

export async function createPkceS256Challenge(verifier: string): Promise<string> {
  if (!isPkceVerifier(verifier)) {
    throw new TypeError("A valid PKCE verifier is required.");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export async function verifyPkceS256(
  verifier: string,
  expectedChallenge: string,
): Promise<boolean> {
  if (!isPkceVerifier(verifier) || !isPkceS256Challenge(expectedChallenge)) {
    return false;
  }
  return constantTimeEqual(
    await createPkceS256Challenge(verifier),
    expectedChallenge,
  );
}

export function isSafeOAuthClientName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 100 &&
    !OAUTH_CLIENT_NAME_CONTROL_PATTERN.test(value) &&
    !OAUTH_CLIENT_NAME_FORMAT_CONTROL_PATTERN.test(value)
  );
}

export function isExactOAuthResource(
  candidate: string | null | undefined,
  expected: string,
): candidate is string {
  return candidate === expected;
}

export function isOneTimeCredentialUsable(
  state: OneTimeCredentialState,
  nowMs = Date.now(),
): boolean {
  return !state.consumedAt && isFutureIsoTimestamp(state.expiresAt, nowMs);
}

export function classifyRefreshTokenUse(
  state: RefreshTokenState,
  nowMs = Date.now(),
): RefreshTokenDecision {
  if (state.rotatedAt) return "reuse";
  if (state.revokedAt || !isFutureIsoTimestamp(state.expiresAt, nowMs)) {
    return "invalid";
  }
  return "accept";
}
