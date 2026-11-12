import { handleSquareWebhook } from "../../../../../db/supabase-square";
import { verifySquareWebhook } from "../../../../../lib/square";
import { parseSquareWebhook } from "../../../../../lib/square-core";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_WEBHOOK_BYTES = 1_000_000;

// Public by necessity: Square calls this without a session. Nothing is read
// from the body until its HMAC signature has been verified.
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES)
    return Response.json({ error: "Webhook is too large." }, { status: 413, headers: NO_STORE });

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ error: "Invalid Square webhook." }, { status: 400, headers: NO_STORE });
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES)
    return Response.json({ error: "Webhook is too large." }, { status: 413, headers: NO_STORE });

  let verified: boolean;
  try {
    verified = await verifySquareWebhook(
      rawBody,
      request.headers.get("x-square-hmacsha256-signature"),
    );
  } catch {
    return Response.json(
      { error: "Square webhook is not configured." },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!verified)
    return Response.json({ error: "Invalid Square webhook." }, { status: 403, headers: NO_STORE });

  let event;
  try {
    event = parseSquareWebhook(rawBody);
  } catch {
    return Response.json({ error: "Invalid Square webhook." }, { status: 400, headers: NO_STORE });
  }

  try {
    await handleSquareWebhook(event);
    return Response.json({ received: true }, { headers: NO_STORE });
  } catch {
    // A 5xx makes Square retry; the event id can be claimed again once it has
    // been marked failed.
    console.error("Square webhook processing failed.");
    return Response.json(
      { error: "Webhook processing failed." },
      { status: 500, headers: NO_STORE },
    );
  }
}
