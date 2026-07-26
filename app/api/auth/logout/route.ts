import { createClient } from "../../../../utils/supabase/server";

export const dynamic = "force-dynamic";

// POST only: a GET logout can be triggered by any link, image, or prefetch.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Already signed out, or Supabase is unreachable. Either way, send the
    // person to the sign-in page rather than failing the request.
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/login", request.url).toString(),
      "Cache-Control": "no-store",
    },
  });
}
