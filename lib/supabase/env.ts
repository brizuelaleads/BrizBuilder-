import { env } from "cloudflare:workers";

export type SupabaseRuntimeEnv = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  jwksUrl: string;
  databaseUrl: string;
};

export function readRuntimeValue(name: string) {
  const value = (env as Record<string, unknown>)[name] ?? process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function getSupabaseRuntimeEnv(): SupabaseRuntimeEnv {
  return {
    url:
      readRuntimeValue("NEXT_PUBLIC_SUPABASE_URL") ||
      readRuntimeValue("SUPABASE_URL"),
    anonKey:
      readRuntimeValue("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
      readRuntimeValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
      readRuntimeValue("SUPABASE_PUBLISHABLE_KEY"),
    serviceRoleKey:
      readRuntimeValue("SUPABASE_SERVICE_ROLE_KEY") ||
      readRuntimeValue("SUPABASE_SECRET_KEY"),
    jwksUrl: readRuntimeValue("SUPABASE_JWKS_URL"),
    databaseUrl:
      readRuntimeValue("SUPABASE_DATABASE_URL") ||
      readRuntimeValue("DATABASE_URL"),
  };
}

export function getSupabaseConfigStatus() {
  const runtime = getSupabaseRuntimeEnv();
  return {
    hasUrl: Boolean(runtime.url),
    hasAnonKey: Boolean(runtime.anonKey),
    hasServiceRoleKey: Boolean(runtime.serviceRoleKey),
    hasJwksUrl: Boolean(runtime.jwksUrl),
    hasDatabaseUrl: Boolean(runtime.databaseUrl),
    publicClientReady: Boolean(runtime.url && runtime.anonKey),
    adminClientReady: Boolean(runtime.url && runtime.serviceRoleKey),
  };
}
