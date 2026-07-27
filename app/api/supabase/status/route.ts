import { getChatGPTUser } from "../../../chatgpt-auth";
import { getSupabaseConfigStatus } from "../../../../lib/supabase/env";
import { getSupabaseAdminClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  // This reports which credentials are configured and whether the database is
  // reachable — useful reconnaissance for an attacker. Signed-in users only.
  const user = await getChatGPTUser();
  if (!user)
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_NO_STORE },
    );

  const status = getSupabaseConfigStatus();

  if (!status.adminClientReady) {
    return Response.json({
      ok: false,
      configured: status,
      message:
        "Supabase environment variables are not fully configured yet.",
    });
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { error } = await supabase.from("organizations").select("id").limit(1);
    if (error) throw error;

    return Response.json({
      ok: true,
      configured: status,
      message: "Supabase is connected and the BrizBuilder schema is reachable.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supabase check failed.";
    return Response.json(
      {
        ok: false,
        configured: status,
        message,
      },
      { status: 500 },
    );
  }
}
