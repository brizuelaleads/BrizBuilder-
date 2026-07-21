import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getSupabaseTwilioVisibleBalance } from "../../../../../db/supabase-crm";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  if (message === "Forbidden" || message === "Unauthorized")
    return Response.json(
      { error: message },
      {
        status: message === "Forbidden" ? 403 : 401,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  console.error("Twilio balance request failed.", error);
  return Response.json(
    { error: "Twilio balance could not be loaded right now." },
    { status: 502, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );

  try {
    const searchParams = new URL(request.url).searchParams;
    const clientId = searchParams.get("clientId") ?? "";
    const data = await getSupabaseTwilioVisibleBalance(
      user,
      clientId,
      searchParams.get("refresh") === "true",
    );
    return Response.json(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
