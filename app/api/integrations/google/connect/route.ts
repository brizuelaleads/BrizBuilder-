import { getChatGPTUser } from "../../../../chatgpt-auth";
import { beginSupabaseGoogleConnect } from "../../../../../db/supabase-crm";

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
  try {
    const clientId = new URL(request.url).searchParams.get("clientId") ?? "";
    return noStoreRedirect(await beginSupabaseGoogleConnect(user, clientId));
  } catch (error) {
    const url = new URL("/dashboard", request.url);
    url.searchParams.set("view", "profiles");
    const clientId = new URL(request.url).searchParams.get("clientId") ?? "";
    if (clientId) url.searchParams.set("client", clientId);
    url.searchParams.set(
      "connection_error",
      error instanceof Error ? error.message : "Google connection failed.",
    );
    return noStoreRedirect(url);
  }
}
