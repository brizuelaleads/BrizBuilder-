import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getSupabaseGoogleListing } from "../../../../../db/supabase-crm";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const clientId = new URL(request.url).searchParams.get("clientId")?.trim();
  if (!clientId || clientId.length > 100) {
    return Response.json({ error: "Choose a business." }, { status: 400, headers });
  }
  try {
    return Response.json({ data: await getSupabaseGoogleListing(user, clientId) }, { headers });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === "Forbidden";
    return Response.json({ error: forbidden ? "Forbidden" : "Google listing could not be loaded." }, { status: forbidden ? 403 : 502, headers });
  }
}
