import { handleSupabaseStripeWebhook } from "../../../../../db/supabase-crm";
import { verifyStripeWebhook } from "../../../../../lib/stripe";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_WEBHOOK_BYTES = 1_000_000;

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (!contentType.startsWith("application/json"))
    return Response.json(
      { error: "Unsupported content type." },
      { status: 415, headers: NO_STORE },
    );
  if (declaredLength > MAX_WEBHOOK_BYTES)
    return Response.json(
      { error: "Webhook is too large." },
      { status: 413, headers: NO_STORE },
    );

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES)
      return Response.json(
        { error: "Webhook is too large." },
        { status: 413, headers: NO_STORE },
      );
    const event = await verifyStripeWebhook(
      rawBody,
      request.headers.get("stripe-signature"),
    );
    if (
      event.type !== "account.updated" &&
      event.type !== "account.application.deauthorized"
    )
      return Response.json(
        { error: "Unsupported Stripe event." },
        { status: 400, headers: NO_STORE },
      );
    await handleSupabaseStripeWebhook(event);
    return Response.json({ received: true }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("signature") ||
      message.includes("event is") ||
      message.includes("connected account")
    )
      return Response.json(
        { error: "Invalid Stripe webhook." },
        { status: 400, headers: NO_STORE },
      );
    if (message.includes("not configured"))
      return Response.json(
        { error: "Stripe webhook is not configured." },
        { status: 503, headers: NO_STORE },
      );
    console.error("Stripe webhook processing failed.");
    return Response.json(
      { error: "Webhook processing failed." },
      { status: 500, headers: NO_STORE },
    );
  }
}
