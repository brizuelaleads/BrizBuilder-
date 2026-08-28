// Storage for Web Push subscriptions and the delivery ledger.
//
// Kept separate from db/supabase-crm.ts so the webhook and cron paths that
// fire notifications do not have to load the whole CRM module.

import { getSupabaseAdminClient } from "../lib/supabase/server";
import type { PushSubscriptionKeys } from "../lib/web-push";

type AnyRecord = Record<string, unknown>;

export type StoredSubscription = PushSubscriptionKeys & {
  id: string;
  email: string;
};

function supabase() {
  return getSupabaseAdminClient();
}

async function assertOk<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

/** base64url, and long enough to be the real thing rather than a stub. */
function isBase64Url(value: unknown, minLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= minLength &&
    value.length <= 512 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

/**
 * Validates a browser-supplied subscription.
 *
 * The endpoint is fetched by the server later, so it is checked here rather
 * than trusted: only https, and no credentials embedded in the URL.
 */
export function parseSubscriptionInput(input: unknown): PushSubscriptionKeys {
  const source = (input ?? {}) as AnyRecord;
  const endpoint = typeof source.endpoint === "string" ? source.endpoint.trim() : "";
  if (!endpoint || endpoint.length > 2000)
    throw new Error("A push endpoint is required.");

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("The push endpoint is not a valid URL.");
  }
  if (parsed.protocol !== "https:")
    throw new Error("The push endpoint must be an https address.");
  if (parsed.username || parsed.password)
    throw new Error("The push endpoint must not carry credentials.");

  const keys = (source.keys ?? source) as AnyRecord;
  // 65 raw bytes base64url-encode to 87 characters; 16 bytes to 22.
  if (!isBase64Url(keys.p256dh, 80))
    throw new Error("The subscription is missing a valid p256dh key.");
  if (!isBase64Url(keys.auth, 16))
    throw new Error("The subscription is missing a valid auth secret.");

  return { endpoint: parsed.toString(), p256dh: keys.p256dh, auth: keys.auth };
}

/**
 * The organization a tenant belongs to.
 *
 * A deliberately narrow lookup: the subscribe endpoint only needs the owning
 * organization id, and loading the full CRM tenant context for that would pull
 * the whole bootstrap module into a route that runs on every app launch.
 */
export async function organizationForClient(
  clientId: string,
): Promise<string | null> {
  const row = await assertOk(
    supabase()
      .from("clients")
      .select("organization_id,status")
      .eq("id", clientId)
      .neq("status", "archived")
      .maybeSingle(),
  );
  return row?.organization_id ? String(row.organization_id) : null;
}

/**
 * Records a device's subscription against one tenant.
 *
 * Conflicts on the endpoint rather than inserting: a browser that re-subscribes
 * (after a permission reset, or a key rotation) reuses its endpoint, and a
 * second row would deliver every alert to that device twice.
 */
export async function saveSubscription(input: {
  organizationId: string;
  clientId: string;
  email: string;
  subscription: PushSubscriptionKeys;
  userAgent?: string;
}): Promise<void> {
  await assertOk(
    supabase()
      .from("push_subscriptions")
      .upsert(
        {
          organization_id: input.organizationId,
          client_id: input.clientId,
          email: input.email.trim().toLowerCase(),
          endpoint: input.subscription.endpoint,
          p256dh: input.subscription.p256dh,
          auth: input.subscription.auth,
          user_agent: (input.userAgent ?? "").slice(0, 300),
          last_used_at: new Date().toISOString(),
          // A re-subscribe clears any earlier expiry: the device is back.
          failed_at: null,
        },
        { onConflict: "endpoint" },
      ),
  );
}

/**
 * Removes one device's subscription.
 *
 * Scoped by email so a signed-in user can only ever unsubscribe their own
 * device, never someone else's by guessing an endpoint.
 */
export async function deleteSubscription(
  endpoint: string,
  email: string,
): Promise<void> {
  await assertOk(
    supabase()
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("email", email.trim().toLowerCase()),
  );
}

/** Live subscriptions for a tenant. Expired rows are excluded. */
export async function subscriptionsForClient(
  clientId: string,
): Promise<StoredSubscription[]> {
  const rows = (await assertOk(
    supabase()
      .from("push_subscriptions")
      .select("id,email,endpoint,p256dh,auth")
      .eq("client_id", clientId)
      .is("failed_at", null),
  )) as AnyRecord[] | null;

  return (rows ?? []).map((row) => ({
    id: String(row.id),
    email: String(row.email),
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    auth: String(row.auth),
  }));
}

/**
 * One person's own devices within a tenant.
 *
 * Used by the test notification so trying it out reaches only the tester,
 * never the client's whole staff.
 */
export async function subscriptionsForEmail(
  clientId: string,
  email: string,
): Promise<StoredSubscription[]> {
  const rows = (await assertOk(
    supabase()
      .from("push_subscriptions")
      .select("id,email,endpoint,p256dh,auth")
      .eq("client_id", clientId)
      .eq("email", email.trim().toLowerCase())
      .is("failed_at", null),
  )) as AnyRecord[] | null;

  return (rows ?? []).map((row) => ({
    id: String(row.id),
    email: String(row.email),
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    auth: String(row.auth),
  }));
}

/** How many devices a user has registered, for the settings UI. */
export async function subscriptionCountForEmail(
  clientId: string,
  email: string,
): Promise<number> {
  const { count, error } = await supabase()
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("email", email.trim().toLowerCase())
    .is("failed_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Marks endpoints the push service reported as permanently gone.
 *
 * Flagged rather than deleted so a later "why did this device stop getting
 * alerts" question still has a record to point at.
 */
export async function markSubscriptionsExpired(
  endpoints: string[],
): Promise<void> {
  if (!endpoints.length) return;
  await assertOk(
    supabase()
      .from("push_subscriptions")
      .update({ failed_at: new Date().toISOString() })
      .in("endpoint", endpoints),
  );
}

/**
 * Claims an event for delivery.
 *
 * Returns false when this event was already sent for this tenant. The unique
 * (client_id, event_key) index is what enforces it, so two workers racing on
 * the same webhook retry cannot both win.
 */
export async function claimDelivery(input: {
  organizationId: string;
  clientId: string;
  eventKey: string;
  notificationType: string;
}): Promise<boolean> {
  const { error } = await supabase().from("push_deliveries").insert({
    organization_id: input.organizationId,
    client_id: input.clientId,
    event_key: input.eventKey,
    notification_type: input.notificationType,
  });
  if (!error) return true;
  // A duplicate key means somebody else already claimed this event.
  if (/duplicate key|push_deliveries_client_id_event_key_key/i.test(error.message))
    return false;
  throw new Error(error.message);
}

/** Records the outcome of a fan-out against its already-claimed ledger row. */
export async function recordDeliveryOutcome(input: {
  clientId: string;
  eventKey: string;
  sent: number;
  failed: number;
}): Promise<void> {
  const { error } = await supabase()
    .from("push_deliveries")
    .update({ sent_count: input.sent, failed_count: input.failed })
    .eq("client_id", input.clientId)
    .eq("event_key", input.eventKey);
  // A ledger update failing must not fail the notification that already went
  // out; the alert is the product, the bookkeeping is not.
  if (error) console.error("Push delivery outcome could not be recorded.", error.message);
}
