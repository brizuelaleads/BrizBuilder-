import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getSupabaseGooglePerformance } from "../../../../../db/supabase-crm";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const clientId = params.get("clientId")?.trim();
  if (!clientId || clientId.length > 100) {
    return Response.json({ error: "Choose a business." }, { status: 400, headers });
  }
  const days = Number(params.get("days") ?? 28);
  try {
    return Response.json({ data: await getSupabaseGooglePerformance(user, clientId, days) }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const forbidden = message === "Forbidden";
    return Response.json(
      { error: forbidden ? "Forbidden" : message.startsWith("Turn on ") || message.startsWith("Google ") ? message : "Google performance data could not be loaded." },
      { status: forbidden ? 403 : 502, headers },
    );
  }
}
