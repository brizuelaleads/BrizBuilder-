import { env } from "cloudflare:workers";

export type SupabaseRuntimeEnv = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

export function readRuntimeValue(name: string) {
  const value = (env as Record<string, unknown>)[name] ?? process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function getSupabaseRuntimeEnv(): SupabaseRuntimeEnv {
  return {
    url: readRuntimeValue("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: readRuntimeValue("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceRoleKey: readRuntimeValue("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function getSupabaseConfigStatus() {
  const runtime = getSupabaseRuntimeEnv();
  return {
    hasUrl: Boolean(runtime.url),
    hasAnonKey: Boolean(runtime.anonKey),
    hasServiceRoleKey: Boolean(runtime.serviceRoleKey),
    publicClientReady: Boolean(runtime.url && runtime.anonKey),
    adminClientReady: Boolean(runtime.url && runtime.serviceRoleKey),
  };
}
