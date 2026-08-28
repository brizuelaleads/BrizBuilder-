import { getChatGPTUser } from "../../../chatgpt-auth";
import { getAccountAccess } from "../../../../db/runtime-access";
import {
  deleteSubscription,
  organizationForClient,
  parseSubscriptionInput,
  saveSubscription,
} from "../../../../db/supabase-push";
import { pushConfigured } from "../../../../lib/push-notifications";

export const dynamic = "force-dynamic";

// Browsers send Origin on every POST and also send Sec-Fetch-Site, so require
// positive proof from one of them rather than treating a missing Origin as
// same-origin. Mirrors the check in /api/crm.
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
 * Resolves which tenant the caller's devices belong to.
 *
 * Taken from the session, never from the request body: a client user is
 * pinned to their own workspace, and an agency user subscribes against the
 * sub-account they are currently scoped to.
 */
async function resolveTenant(
  user: NonNullable<Awaited<ReturnType<typeof getChatGPTUser>>>,
) {
  const access = await getAccountAccess(user);
  if (!access?.client?.id) return null;
  const organizationId = await organizationForClient(access.client.id);
  if (!organizationId) return null;
  return { organizationId, clientId: access.client.id };
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
  if (!pushConfigured())
    return Response.json(
      { error: "Push notifications are not configured for this deployment." },
      { status: 503 },
    );

  try {
    const tenant = await resolveTenant(user);
    if (!tenant)
      return Response.json(
        { error: "Only a client workspace can register for alerts." },
        { status: 403 },
      );

    const body = (await request.json()) as { subscription?: unknown };
    const subscription = parseSubscriptionInput(body.subscription);

    await saveSubscription({
      organizationId: tenant.organizationId,
      clientId: tenant.clientId,
      email: user.email,
      subscription,
      userAgent: request.headers.get("user-agent") ?? "",
    });

    return Response.json({ subscribed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Subscription failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin." }, { status: 403 });

  try {
    const body = (await request.json()) as { endpoint?: unknown };
    const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint) return Response.json({ error: "An endpoint is required." }, { status: 400 });
    // Scoped to the caller's own email inside deleteSubscription, so knowing
    // another device's endpoint is not enough to unsubscribe it.
    await deleteSubscription(endpoint, user.email);
    return Response.json({ subscribed: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unsubscribe failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
