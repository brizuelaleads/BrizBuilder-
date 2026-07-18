import { handleIncomingVoice } from "../../../../lib/twilio-webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { return await handleIncomingVoice(request); }
  catch (error) { console.error("Twilio voice webhook failed", error); return new Response("Webhook failed", { status: 500 }); }
}
