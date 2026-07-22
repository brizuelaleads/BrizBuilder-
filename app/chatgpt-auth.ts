import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import {
  LOCAL_AUTH_COOKIE,
  LOCAL_AUTH_TOKEN,
  MAIN_ADMIN_EMAIL,
  MAIN_ADMIN_NAME,
  POLICY_AUD,
  TEAM_DOMAIN,
  TEST_AUTH_ENABLED,
  TEST_AUTH_HOST,
  TEST_AUTH_SECRET,
} from "./auth-config";

export type ChatGPTUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

const CLOUDFLARE_ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
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
  const accessToken = requestHeaders.get(CLOUDFLARE_ACCESS_JWT_HEADER);

  if (accessToken) {
    const accessUser = await verifyCloudflareAccessIdentity(accessToken);
    if (accessUser) return accessUser;
  }

  const testUser = await verifySignedTestIdentity(requestHeaders);
  if (testUser) return testUser;

  const cookieStore = await cookies();
  const localSession = cookieStore.get(LOCAL_AUTH_COOKIE)?.value;
  if (
    LOCAL_AUTH_TOKEN &&
    localSession &&
    constantTimeEqual(localSession, LOCAL_AUTH_TOKEN)
  ) {
    return {
      displayName: MAIN_ADMIN_NAME,
      email: MAIN_ADMIN_EMAIL,
      fullName: MAIN_ADMIN_NAME,
    };
  }

  return null;
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
  return `/local-login?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export async function signOutPathForCurrentRequest(
  returnTo = "/",
): Promise<string> {
  void returnTo;
  return "/api/local-auth/logout";
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

let accessJwks:
  | {
      url: string;
      keySet: ReturnType<typeof createRemoteJWKSet>;
    }
  | undefined;

async function verifyCloudflareAccessIdentity(
  token: string,
): Promise<ChatGPTUser | null> {
  const issuer = normalizedCloudflareTeamDomain(TEAM_DOMAIN);
  if (!issuer || !POLICY_AUD || token.length > 16_384) return null;

  const jwksUrl = `${issuer}/cdn-cgi/access/certs`;
  if (!accessJwks || accessJwks.url !== jwksUrl) {
    accessJwks = {
      url: jwksUrl,
      keySet: createRemoteJWKSet(new URL(jwksUrl)),
    };
  }

  try {
    const { payload } = await jwtVerify(token, accessJwks.keySet, {
      algorithms: ["RS256"],
      audience: POLICY_AUD,
      issuer,
      requiredClaims: ["email", "exp", "iat", "sub", "type"],
    });

    return cloudflareIdentityFromPayload(payload);
  } catch {
    return null;
  }
}

function cloudflareIdentityFromPayload(
  payload: JWTPayload,
): ChatGPTUser | null {
  // Cloudflare service tokens do not represent a person and do not carry an
  // email. Accept only application tokens with a stable user subject.
  if (payload.type !== "app" || typeof payload.sub !== "string" || !payload.sub) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.iat !== "number" || payload.iat > now + 60) return null;

  const email = normalizedEmail(payload.email);
  if (!email) return null;

  const fullName = firstBoundedStringClaim(payload, [
    "name",
    "full_name",
    "preferred_username",
  ]);

  return {
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

function normalizedCloudflareTeamDomain(value: string): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !url.hostname.endsWith(".cloudflareaccess.com")
    ) {
      return null;
    }
    return url.origin;
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

function firstBoundedStringClaim(
  payload: JWTPayload,
  names: string[],
): string | null {
  for (const name of names) {
    const value = boundedIdentityName(payload[name]);
    if (value) return value;
  }
  return null;
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
