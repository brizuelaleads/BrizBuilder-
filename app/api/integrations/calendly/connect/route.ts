import { getChatGPTUser } from "../../../../chatgpt-auth";
import { beginCalendlyConnect } from "../../../../../db/supabase-calendly";

export const dynamic = "force-dynamic";

function noStoreRedirect(location: string | URL) {
  return new Response(null, {
    status: 302,
    headers: { Location: location.toString(), "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
  });
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return noStoreRedirect(new URL("/", request.url));
  const clientId = new URL(request.url).searchParams.get("clientId") ?? "";
  try {
    return noStoreRedirect(await beginCalendlyConnect(user, clientId));
  } catch (error) {
    const back = new URL("/dashboard", request.url);
    back.searchParams.set("view", "connections");
    if (clientId) back.searchParams.set("client", clientId);
    back.searchParams.set(
      "connection_error",
      error instanceof Error && error.message !== "Forbidden"
        ? error.message
        : "You do not have permission to connect Calendly for this business.",
    );
    return noStoreRedirect(back);
  }
}
