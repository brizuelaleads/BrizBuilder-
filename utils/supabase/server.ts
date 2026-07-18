import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseRuntimeEnv } from "../../lib/supabase/env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseRuntimeEnv();

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always write cookies. Middleware refreshes
          // the Supabase auth session when needed.
        }
      },
    },
  });
}
