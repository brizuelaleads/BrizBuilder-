import { handleMessageStatus } from "../../../../../lib/twilio-webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { return await handleMessageStatus(request); }
  catch (error) { console.error("Twilio message status webhook failed", error); return new Response("Webhook failed", { status: 500 }); }
}
