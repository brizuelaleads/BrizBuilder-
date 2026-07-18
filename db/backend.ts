import { readRuntimeValue } from "../lib/supabase/env";

export type BackendProvider = "d1" | "supabase";

export function getBackendProvider(): BackendProvider {
  const configured = readRuntimeValue("BRIZBUILDER_BACKEND").toLowerCase();
  return configured === "supabase" ? "supabase" : "d1";
}

export function shouldUseSupabaseBackend(): boolean {
  return getBackendProvider() === "supabase";
}
