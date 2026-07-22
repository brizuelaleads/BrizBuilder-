import { env } from "cloudflare:workers";

function readRuntimeEnv(name: string) {
  const value = (env as Record<string, unknown>)[name] ?? process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export const MAIN_ADMIN_EMAIL =
  readRuntimeEnv("MAIN_ADMIN_EMAIL").toLowerCase() || "admin@brizbuilder.local";
export const MAIN_ADMIN_NAME =
  readRuntimeEnv("MAIN_ADMIN_NAME") || "BrizBuilder Administrator";

// Cloudflare Access application identity. TEAM_DOMAIN must be the complete
// HTTPS team URL (for example, https://example.cloudflareaccess.com), and
// POLICY_AUD must be the Access application's Audience (AUD) tag.
export const TEAM_DOMAIN = readRuntimeEnv("TEAM_DOMAIN");
export const POLICY_AUD = readRuntimeEnv("POLICY_AUD");

// Independent administrator-session fallback. Keep both values secret and use
// a long, random session token; Cloudflare Access remains the primary hosted
// identity layer.
export const LOCAL_ADMIN_PASSWORD =
  readRuntimeEnv("LOCAL_DEV_ADMIN_PASSWORD");
export const LOCAL_AUTH_COOKIE = "brizbuilder_local_session";
export const LOCAL_AUTH_TOKEN =
  readRuntimeEnv("LOCAL_DEV_SESSION_TOKEN");

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
