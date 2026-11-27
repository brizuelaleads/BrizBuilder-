import { handleCalendlyWebhook } from "../../../../../../db/supabase-calendly";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_WEBHOOK_BYTES = 256_000;

type RouteContext = { params: Promise<{ pathId: string }> };

// Public by necessity: Calendly calls this without a session. Nothing is read
// from the body until its signature has been verified.
export async function POST(request: Request, context: RouteContext) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES)
    return Response.json({ error: "Webhook is too large." }, { status: 413, headers: NO_STORE });
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ error: "Invalid webhook." }, { status: 400, headers: NO_STORE });
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES)
    return Response.json({ error: "Webhook is too large." }, { status: 413, headers: NO_STORE });

  const { pathId } = await context.params;
  try {
    const outcome = await handleCalendlyWebhook(pathId, rawBody, request.headers.get("calendly-webhook-signature"));
    return Response.json(
      outcome.status === 200 ? { received: true } : { error: "Webhook was not accepted." },
      { status: outcome.status, headers: NO_STORE },
    );
  } catch {
    // A 5xx lets Calendly retry, and the background check picks it up anyway.
    console.error("Calendly webhook processing failed.");
    return Response.json({ error: "Webhook processing failed." }, { status: 500, headers: NO_STORE });
  }
}
