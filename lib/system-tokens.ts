import { readRuntimeValue } from "./supabase/env";

const TOKEN_BYTES = 32;

export const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function generateSystemToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function hashSystemToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export function expiresAt(ttlMs: number): string {
  return new Date(Date.now() + ttlMs).toISOString();
}

export function buildAppLink(
  path: string,
  params: Record<string, string>,
  request?: Request,
): string {
  const configuredBase =
    readRuntimeValue("APP_BASE_URL") ||
    readRuntimeValue("BRIZBUILDER_PUBLIC_ORIGIN");
  const requestBase = request ? new URL(request.url).origin : "";
  const base = configuredBase || requestBase || "https://brizbuilder.brizuelaleads.workers.dev";
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}
