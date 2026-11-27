import { getChatGPTUser } from "../../../../chatgpt-auth";
import { cancelCalendlyConnect, finishCalendlyConnect } from "../../../../../db/supabase-calendly";

export const dynamic = "force-dynamic";

function noStoreRedirect(url: URL) {
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  const redirect = new URL("/dashboard", request.url);
  redirect.searchParams.set("view", "connections");

  try {
    // The connection is only ever completed inside the signed-in session of
    // the person who started it.
    const user = await getChatGPTUser();
    if (!user) throw new Error("Sign in to BrizBuilder, then connect Calendly again.");
    if (params.get("error")) {
      await cancelCalendlyConnect(state);
      throw new Error("Calendly connection was canceled.");
    }
    const clientId = await finishCalendlyConnect(user, state, params.get("code") ?? "");
    redirect.searchParams.set("client", clientId);
    redirect.searchParams.set("connected", "calendly");
  } catch (error) {
    redirect.searchParams.set(
      "connection_error",
      error instanceof Error && error.message !== "Forbidden"
        ? error.message
        : "You do not have permission to connect Calendly for this business.",
    );
  }
  return noStoreRedirect(redirect);
}
