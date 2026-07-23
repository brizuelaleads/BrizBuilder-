import { env } from "cloudflare:workers";
import { getSupabaseConfigStatus } from "../supabase/env";

const DEFAULT_PRODUCTION_ORIGIN =
  "https://brizbuilder.brizuelaleads.workers.dev";

function runtimeValue(name: string): string {
  const value = (env as Record<string, unknown>)[name] ?? process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function normalizedPublicOrigin(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const localDevelopment =
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (
      (!localDevelopment && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

const configuredOrigin = normalizedPublicOrigin(
  runtimeValue("BRIZBUILDER_PUBLIC_ORIGIN"),
);

export const AI_CONNECTOR_ISSUER =
  configuredOrigin ??
  (process.env.NODE_ENV === "production"
    ? DEFAULT_PRODUCTION_ORIGIN
    : "http://localhost:3000");

export const AI_CONNECTOR_ENDPOINT = `${AI_CONNECTOR_ISSUER}/mcp`;
export const AI_CONNECTOR_RESOURCE = AI_CONNECTOR_ENDPOINT;

export const AI_CONNECTOR_SCOPES = [
  "crm:read",
  "crm:tasks.write",
  "crm:opportunities.write",
] as const;

export type AiConnectorScope = (typeof AI_CONNECTOR_SCOPES)[number];

export const AI_CONNECTOR_SCOPE_LABELS: Record<AiConnectorScope, string> = {
  "crm:read": "View CRM records",
  "crm:tasks.write": "Create and update CRM tasks",
  "crm:opportunities.write": "Update opportunities and add notes",
};

export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const OAUTH_AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
export const OAUTH_CONSENT_TTL_SECONDS = 10 * 60;

export function getAiConnectorRuntime(): {
  configured: boolean;
  endpoint: string;
} {
  return {
    configured: getSupabaseConfigStatus().adminClientReady,
    endpoint: AI_CONNECTOR_ENDPOINT,
  };
}
