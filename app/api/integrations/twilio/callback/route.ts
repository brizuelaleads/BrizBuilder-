import { finishSupabaseTwilioConnect } from "../../../../../db/supabase-crm";

export const dynamic = "force-dynamic";

async function finish(request: Request) {
  const url = new URL(request.url);
  const form = request.method === "POST" ? new URLSearchParams(await request.text()) : url.searchParams;
  try {
    if (form.get("error")) throw new Error("Twilio connection was canceled.");
    const clientId = await finishSupabaseTwilioConnect(form.get("state") ?? "", form.get("AccountSid") ?? "");
    const redirect = new URL("/dashboard", request.url); redirect.searchParams.set("view", "connections"); redirect.searchParams.set("client", clientId); redirect.searchParams.set("connected", "twilio");
    return Response.redirect(redirect);
  } catch (error) {
    const redirect = new URL("/dashboard", request.url); redirect.searchParams.set("view", "connections"); redirect.searchParams.set("connection_error", error instanceof Error ? error.message : "Connection failed");
    return Response.redirect(redirect);
  }
}

export async function GET(request: Request) { return finish(request); }
export async function POST(request: Request) { return finish(request); }
