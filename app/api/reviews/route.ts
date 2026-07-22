import { getChatGPTUser } from "../../chatgpt-auth";
import { getSupabaseGoogleReviews } from "../../../db/supabase-crm";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Google reviews could not be loaded.";
  const status =
    message === "Forbidden"
      ? 403
      : message === "Unauthorized"
        ? 401
        : message.includes("API access is not active")
          ? 503
          : 400;
  return Response.json({ error: message }, { status, headers: PRIVATE_NO_STORE });
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_NO_STORE },
    );
  }

  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId")?.trim() ?? "";
  const pageToken = url.searchParams.get("pageToken")?.trim() || null;
  if (!clientId || clientId.length > 100) {
    return Response.json(
      { error: "Choose a business before loading reviews." },
      { status: 400, headers: PRIVATE_NO_STORE },
    );
  }

  try {
    const data = await getSupabaseGoogleReviews(user, clientId, pageToken);
    return Response.json({ data }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
