import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient as createSupabaseServerClient } from "../utils/supabase/server";
import {
  TEST_AUTH_ENABLED,
  TEST_AUTH_HOST,
  TEST_AUTH_SECRET,
} from "./auth-config";

export type ChatGPTUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

const TEST_EMAIL_HEADER = "x-brizbuilder-test-email";
const TEST_NAME_HEADER = "x-brizbuilder-test-name";
const TEST_TIMESTAMP_HEADER = "x-brizbuilder-test-timestamp";
const TEST_SIGNATURE_HEADER = "x-brizbuilder-test-signature";
const TEST_SIGNATURE_VERSION = "brizbuilder-test-auth-v1";
const TEST_MAX_CLOCK_SKEW_SECONDS = 60;
const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  // Supabase is the only production identity source. Cloudflare Access may
  // still sit in front of the Worker temporarily, but its identity headers
  // must never decide which BrizBuilder account is active.
  const sessionUser = await verifySupabaseSession();
  if (sessionUser) return sessionUser;

  const testUser = await verifySignedTestIdentity(requestHeaders);
  if (testUser) return testUser;

  // The shared-admin cookie login was removed: its cookie value was the static
  // server secret itself, so it could not be revoked per-user or rotated
  // without an env change. Everyone now signs in with their own password.
  return null;
}

// The real sign-in path: an email + password session issued by Supabase Auth.
// getUser() re-validates the token with the auth server on every call; never
// use getSession(), which trusts whatever the cookie claims.
async function verifySupabaseSession(): Promise<ChatGPTUser | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return null;
    const email = normalizedEmail(data.user.email);
    if (!email) return null;
    const metadata = (data.user.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
      normalizedName(metadata.display_name) ??
      normalizedName(metadata.name) ??
      email.split("@")[0];
    return { displayName, email, fullName: displayName };
  } catch {
    // A misconfigured or unreachable Supabase must not hard-fail the request;
    // the remaining mechanisms below still get their chance.
    return null;
  }
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export async function signInPathForCurrentRequest(
  returnTo: string,
): Promise<string> {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `/login?return_to=${encodeURIComponent(safeReturnTo)}`;
}

// Signing out is a POST so a stray link or prefetch can never end a session.
export async function signOutPathForCurrentRequest(
  returnTo = "/",
): Promise<string> {
  void returnTo;
  return "/api/auth/logout";
}

export function isLocalDevelopmentHost(requestHeaders: Headers): boolean {
  if (process.env.NODE_ENV === "production") return false;

  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0];
  const host = (forwardedHost ?? requestHeaders.get("host") ?? "")
    .trim()
    .toLowerCase();
  const hostname = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.split(":")[0];

  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function verifySignedTestIdentity(
  requestHeaders: Headers,
): Promise<ChatGPTUser | null> {
  if (
    !TEST_AUTH_ENABLED ||
    TEST_AUTH_SECRET.length < 32 ||
    !TEST_AUTH_HOST
  ) {
    return null;
  }

  const host = requestHost(requestHeaders);
  if (!host || host !== TEST_AUTH_HOST) return null;

  const email = normalizedEmail(requestHeaders.get(TEST_EMAIL_HEADER));
  const encodedName = requestHeaders.get(TEST_NAME_HEADER) ?? "";
  const timestamp = requestHeaders.get(TEST_TIMESTAMP_HEADER) ?? "";
  const signature = requestHeaders.get(TEST_SIGNATURE_HEADER) ?? "";
  if (
    !email ||
    encodedName.length > 512 ||
    !/^\d{10}$/.test(timestamp) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    return null;
  }

  const issuedAt = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - issuedAt) > TEST_MAX_CLOCK_SKEW_SECONDS) return null;

  const canonical = [
    TEST_SIGNATURE_VERSION,
    timestamp,
    host,
    email,
    encodedName,
  ].join("\n");
  const expectedSignature = await hmacSha256(TEST_AUTH_SECRET, canonical);
  if (!constantTimeEqual(signature, expectedSignature)) return null;

  const fullName = encodedName
    ? boundedIdentityName(safeDecodeURIComponent(encodedName))
    : null;
  return {
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

function requestHost(requestHeaders: Headers): string | null {
  // The test harness signs the request's actual Host value. Do not accept a
  // separately supplied forwarding header as authority for this bypass guard.
  const rawHost = (requestHeaders.get("host") ?? "")
    .trim()
    .toLowerCase();
  if (!rawHost || rawHost.length > 255) return null;

  try {
    return new URL(`http://${rawHost}`).hostname;
  } catch {
    return null;
  }
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return null;
  }
  return email;
}

function normalizedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().slice(0, 200);
  return name.length ? name : null;
}

function boundedIdentityName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && name.length <= 200 ? name : null;
}

async function hmacSha256(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

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
