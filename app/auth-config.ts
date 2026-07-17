import { env } from "cloudflare:workers";

function readRuntimeEnv(name: string) {
  const value = (env as Record<string, unknown>)[name] ?? process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export const MAIN_ADMIN_EMAIL =
  readRuntimeEnv("MAIN_ADMIN_EMAIL").toLowerCase() || "admin@brizbuilder.local";
export const MAIN_ADMIN_NAME =
  readRuntimeEnv("MAIN_ADMIN_NAME") || "BrizBuilder Administrator";

// Local preview credentials are compiled out of the production authentication
// path. Hosted BrizBuilder deployments always use ChatGPT sign-in instead.
export const LOCAL_ADMIN_PASSWORD =
  readRuntimeEnv("LOCAL_DEV_ADMIN_PASSWORD");
export const LOCAL_AUTH_COOKIE = "brizbuilder_local_session";
export const LOCAL_AUTH_TOKEN =
  readRuntimeEnv("LOCAL_DEV_SESSION_TOKEN");
