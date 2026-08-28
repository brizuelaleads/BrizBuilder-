import { getChatGPTUser } from "../../../chatgpt-auth";
import { getAccountAccess } from "../../../../db/runtime-access";
import { brandingForClient } from "../../../../db/runtime-branding";
import { sendTestNotification } from "../../../../lib/push-notifications";

export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === new URL(request.url).host;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === "none";
}

/**
 * Sends a test notification to the caller's own registered devices.
 *
 * Exists so push can be proven end to end before it is switched on for real
 * clients: it needs no lead, no call, and no waiting for a cron sweep.
 *
 * Reaches only the caller's devices, so an agency running a check cannot make
 * a client's phones buzz.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });

  try {
    const access = await getAccountAccess(user);
    if (!access?.client?.id)
      return Response.json(
        { error: "Only a client workspace can receive alerts." },
        { status: 403 },
      );

    const branding = await brandingForClient(access.client.id);
    const result = await sendTestNotification({
      clientId: access.client.id,
      email: user.email,
      branding,
    });

    if (!result.sent)
      return Response.json(
        { error: result.reason ?? "The test notification could not be sent." },
        { status: 400 },
      );
    return Response.json({ sent: result.sent, failed: result.failed });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The test notification failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
