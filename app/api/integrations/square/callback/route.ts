import { getChatGPTUser } from "../../../../chatgpt-auth";
import { cancelSquareConnect, finishSquareConnect } from "../../../../../db/supabase-square";

export const dynamic = "force-dynamic";

function noStoreRedirect(url: URL) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  const redirect = new URL("/dashboard", request.url);
  redirect.searchParams.set("view", "payments");

  try {
    // The connection is only ever completed inside the signed-in session of
    // the person who started it.
    const user = await getChatGPTUser();
    if (!user) throw new Error("Sign in to BrizBuilder, then connect Square again.");

    if (params.get("error")) {
      await cancelSquareConnect(state);
      throw new Error("Square connection was canceled.");
    }
    const scope = await finishSquareConnect(user, state, params.get("code") ?? "");
    if (scope.kind === "client") redirect.searchParams.set("client", scope.clientId);
    else redirect.searchParams.set("payments_scope", "agency");
    redirect.searchParams.set("connected", "square");
  } catch (error) {
    redirect.searchParams.set(
      "connection_error",
      error instanceof Error && error.message !== "Forbidden"
        ? error.message
        : "You do not have permission to connect Square for this business.",
    );
  }
  return noStoreRedirect(redirect);
}
