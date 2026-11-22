import { getChatGPTUser } from "../../../../chatgpt-auth";
import { searchSupabaseGoogleCategories } from "../../../../../db/supabase-crm";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const clientId = params.get("clientId")?.trim();
  const query = params.get("q")?.trim() ?? "";
  if (!clientId || clientId.length > 100 || query.length > 60) {
    return Response.json({ error: "Invalid category search." }, { status: 400, headers });
  }
  try {
    const data = await searchSupabaseGoogleCategories(user, clientId, query, (params.get("region") ?? "US").toUpperCase());
    return Response.json({ data }, { headers });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === "Forbidden";
    return Response.json({ error: forbidden ? "Forbidden" : "Google categories could not be loaded." }, { status: forbidden ? 403 : 502, headers });
  }
}
