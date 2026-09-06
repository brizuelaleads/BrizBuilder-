import { handleOutboundVoiceStatus } from "../../../../../lib/twilio-webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return await handleOutboundVoiceStatus(request);
  } catch (error) {
    console.error("Twilio outbound voice status webhook failed", error);
    return new Response("Webhook failed", { status: 500 });
  }
}
