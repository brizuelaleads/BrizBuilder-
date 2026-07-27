import { env } from "cloudflare:workers";

function readRuntimeEnv(name: string) {
  const value = (env as Record<string, unknown>)[name] ?? process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export const MAIN_ADMIN_EMAIL =
  readRuntimeEnv("MAIN_ADMIN_EMAIL").toLowerCase() || "admin@brizbuilder.local";
export const MAIN_ADMIN_NAME =
  readRuntimeEnv("MAIN_ADMIN_NAME") || "BrizBuilder Administrator";

// The shared-admin session fallback (LOCAL_DEV_ADMIN_PASSWORD /
// LOCAL_DEV_SESSION_TOKEN) was removed: the cookie it set carried the static
// server secret verbatim, so it could not be revoked for one person or rotated
// without an environment change. Everyone signs in with their own password
// now. The Cloudflare secrets can be deleted.

// These bindings exist only so the Worker integration suite can authenticate
// without depending on Cloudflare's remote signing keys. They are deliberately
// disabled unless every setting is explicitly supplied. Never configure them
// on the production Worker.
export const TEST_AUTH_ENABLED =
  readRuntimeEnv("BRIZBUILDER_TEST_AUTH_ENABLED") === "true";
export const TEST_AUTH_SECRET = readRuntimeEnv(
  "BRIZBUILDER_TEST_AUTH_SECRET",
);
export const TEST_AUTH_HOST = readRuntimeEnv(
  "BRIZBUILDER_TEST_AUTH_HOST",
).toLowerCase();
