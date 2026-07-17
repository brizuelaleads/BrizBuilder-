import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseRuntimeEnv } from "./env";

let cachedPublicClient: SupabaseClient | null = null;
let cachedAdminClient: SupabaseClient | null = null;

function buildSupabaseClient(key: string) {
  const { url } = getSupabaseRuntimeEnv();
  if (!url || !key) {
    throw new Error("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        "X-Client-Info": "brizbuilder-server",
      },
    },
  });
}

export function getSupabaseServerClient() {
  if (!cachedPublicClient) {
    const { anonKey } = getSupabaseRuntimeEnv();
    cachedPublicClient = buildSupabaseClient(anonKey);
  }
  return cachedPublicClient;
}

export function getSupabaseAdminClient() {
  if (!cachedAdminClient) {
    const { serviceRoleKey } = getSupabaseRuntimeEnv();
    cachedAdminClient = buildSupabaseClient(serviceRoleKey);
  }
  return cachedAdminClient;
}
