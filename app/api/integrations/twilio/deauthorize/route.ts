import { revokeSupabaseTwilioConnection } from "../../../../../db/supabase-crm";
import { validateTwilioFormRequest } from "../../../../../lib/twilio";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = new URLSearchParams(await request.text());
  if (!await validateTwilioFormRequest(request.url, form, request.headers.get("x-twilio-signature"))) return Response.json({ error: "Invalid signature" }, { status: 403 });
  await revokeSupabaseTwilioConnection(form.get("AccountSid") ?? "");
  return Response.json({ ok: true });
}
