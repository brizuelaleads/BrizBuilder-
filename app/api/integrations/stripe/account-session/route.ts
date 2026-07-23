import { getChatGPTUser } from "../../../../chatgpt-auth";
import { createSupabaseStripeAccountSession } from "../../../../../db/supabase-crm";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
};

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin && origin !== new URL(request.url).origin) return false;
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  if (message === "Forbidden" || message === "Unauthorized")
    return Response.json(
      { error: message },
      {
        status: message === "Forbidden" ? 403 : 401,
        headers: PRIVATE_NO_STORE,
      },
    );
  if (
    message.includes("Connect this business") ||
    message.includes("Reconnect Stripe")
  )
    return Response.json(
      { error: message },
      { status: 409, headers: PRIVATE_NO_STORE },
    );
  if (
    message.includes("not available yet") ||
    message.includes("not configured") ||
    message.includes("not enabled yet")
  )
    return Response.json(
      {
        error:
          "Stripe's secure tools are not available right now. The connected business can still use its Stripe Dashboard.",
      },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  console.error("Stripe Account Session request failed.");
  return Response.json(
    { error: "Stripe's secure tools could not be opened right now." },
    { status: 502, headers: PRIVATE_NO_STORE },
  );
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: PRIVATE_NO_STORE },
    );
  if (!sameOrigin(request))
    return Response.json(
      { error: "Forbidden" },
      { status: 403, headers: PRIVATE_NO_STORE },
    );
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!contentType.startsWith("application/json"))
    return Response.json(
      { error: "Content-Type must be application/json." },
      { status: 415, headers: PRIVATE_NO_STORE },
    );
  if (contentLength > 4_096)
    return Response.json(
      { error: "Request is too large." },
      { status: 413, headers: PRIVATE_NO_STORE },
    );

  try {
    const body = (await request.json()) as { clientId?: unknown };
    const clientId =
      typeof body.clientId === "string" ? body.clientId.trim() : "";
    if (!/^[0-9a-f-]{20,50}$/i.test(clientId))
      return Response.json(
        { error: "Choose a valid business." },
        { status: 400, headers: PRIVATE_NO_STORE },
      );
    const session = await createSupabaseStripeAccountSession(user, clientId);
    return Response.json(session, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
