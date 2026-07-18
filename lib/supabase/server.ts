import { createAdminClient, createContextClient } from "@supabase/server/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseEnv } from "@supabase/server";
import { getSupabaseRuntimeEnv } from "./env";

let cachedPublicClient: SupabaseClient | null = null;
let cachedAdminClient: SupabaseClient | null = null;

function supabaseEnvOverrides(): Partial<SupabaseEnv> {
  const runtime = getSupabaseRuntimeEnv();
  return {
    url: runtime.url || undefined,
    publishableKeys: runtime.anonKey ? { default: runtime.anonKey } : {},
    secretKeys: runtime.serviceRoleKey ? { default: runtime.serviceRoleKey } : {},
    jwks: runtime.jwksUrl ? new URL(runtime.jwksUrl) : null,
  };
}

function assertPublicConfig() {
  const runtime = getSupabaseRuntimeEnv();
  if (!runtime.url || !runtime.anonKey) {
    throw new Error(
      "Supabase is not configured. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.",
    );
  }
}

export function getSupabaseServerClient() {
  if (!cachedPublicClient) {
    assertPublicConfig();
    cachedPublicClient = createContextClient({
      env: supabaseEnvOverrides(),
      supabaseOptions: {
        global: { headers: { "X-Client-Info": "brizbuilder-server" } },
      },
    });
  }
  return cachedPublicClient;
}

export function getSupabaseAdminClient() {
  if (!cachedAdminClient) {
    const runtime = getSupabaseRuntimeEnv();
    if (!runtime.url || !runtime.serviceRoleKey) {
      throw new Error(
        "Supabase admin is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY.",
      );
    }
    cachedAdminClient = createAdminClient({
      env: supabaseEnvOverrides(),
      supabaseOptions: {
        global: { headers: { "X-Client-Info": "brizbuilder-admin" } },
      },
    });
  }
  return cachedAdminClient;
}
