import { getChatGPTUser } from "../../../../chatgpt-auth";
import { beginSquareConnect, parseSquareScope } from "../../../../../db/supabase-square";

export const dynamic = "force-dynamic";

function noStoreRedirect(location: string | URL) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location.toString(),
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return noStoreRedirect(new URL("/", request.url));

  const params = new URL(request.url).searchParams;
  const back = new URL("/dashboard", request.url);
  back.searchParams.set("view", "payments");
  try {
    const scope = parseSquareScope(params.get("scope"), params.get("clientId"));
    if (scope.kind === "client") back.searchParams.set("client", scope.clientId);
    else back.searchParams.set("payments_scope", "agency");
    return noStoreRedirect(await beginSquareConnect(user, scope));
  } catch (error) {
    back.searchParams.set(
      "connection_error",
      error instanceof Error && error.message !== "Forbidden"
        ? error.message
        : "You do not have permission to connect Square for this business.",
    );
    return noStoreRedirect(back);
  }
}
