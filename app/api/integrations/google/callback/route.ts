import { finishSupabaseGoogleConnect } from "../../../../../db/supabase-crm";

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
  const requestUrl = new URL(request.url);
  const redirect = new URL("/dashboard", request.url);
  redirect.searchParams.set("view", "profiles");
  try {
    if (requestUrl.searchParams.get("error")) {
      throw new Error("Google connection was canceled.");
    }
    const result = await finishSupabaseGoogleConnect(
      requestUrl.searchParams.get("state") ?? "",
      requestUrl.searchParams.get("code") ?? "",
    );
    redirect.searchParams.set("client", result.clientId);
    if (result.status === "connected") {
      redirect.searchParams.set("connected", "google");
    } else if (result.status === "select") {
      redirect.searchParams.set("google_select", "1");
    }
    if (result.message) {
      redirect.searchParams.set("connection_error", result.message);
    }
  } catch (error) {
    redirect.searchParams.set(
      "connection_error",
      error instanceof Error ? error.message : "Google connection failed.",
    );
  }
  return noStoreRedirect(redirect);
}
