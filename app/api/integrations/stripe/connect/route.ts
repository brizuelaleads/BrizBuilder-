import { getChatGPTUser } from "../../../../chatgpt-auth";
import { beginSupabaseStripeConnect } from "../../../../../db/supabase-crm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.redirect(new URL("/", request.url));
  try {
    const clientId = new URL(request.url).searchParams.get("clientId") ?? "";
    return Response.redirect(await beginSupabaseStripeConnect(user, clientId));
  } catch (error) {
    const url = new URL("/dashboard", request.url);
    url.searchParams.set("view", "payments");
    url.searchParams.set("connection_error", error instanceof Error ? error.message : "Connection failed");
    return Response.redirect(url);
  }
}
