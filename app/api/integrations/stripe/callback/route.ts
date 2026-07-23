import {
  cancelSupabaseStripeConnect,
  finishSupabaseStripeConnect,
} from "../../../../../db/supabase-crm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    if (url.searchParams.get("error")) {
      await cancelSupabaseStripeConnect(url.searchParams.get("state") ?? "");
      throw new Error("Stripe connection was canceled.");
    }
    const clientId = await finishSupabaseStripeConnect(
      url.searchParams.get("state") ?? "",
      url.searchParams.get("code") ?? "",
    );
    const redirect = new URL("/dashboard", request.url);
    redirect.searchParams.set("view", "payments");
    redirect.searchParams.set("client", clientId);
    redirect.searchParams.set("connected", "stripe");
    return Response.redirect(redirect);
  } catch (error) {
    const redirect = new URL("/dashboard", request.url);
    redirect.searchParams.set("view", "payments");
    redirect.searchParams.set("connection_error", error instanceof Error ? error.message : "Connection failed");
    return Response.redirect(redirect);
  }
}
