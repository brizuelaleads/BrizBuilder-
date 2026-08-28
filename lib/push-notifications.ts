// Turning a CRM event into a branded push notification on a tenant's phones.
//
// Every entry point is fire-and-forget: a notification failing must never take
// down the lead ingestion, webhook, or cron run that produced it. Callers get
// a resolved promise and a log line, never an exception.

import { readRuntimeValue } from "./supabase/env";
import { sendWebPush, type VapidKeys } from "./web-push";
import {
  claimDelivery,
  markSubscriptionsExpired,
  recordDeliveryOutcome,
  subscriptionsForClient,
  subscriptionsForEmail,
} from "../db/supabase-push";
import { brandingForClient } from "../db/runtime-branding";
import type { NotificationKey, TenantBranding } from "../db/branding";

export type PushEvent = {
  organizationId: string;
  clientId: string;
  /**
   * Stable, caller-supplied idempotency key (e.g. `lead:<id>:created`).
   * A webhook retry or an overlapping cron run reuses it and is ignored.
   */
  eventKey: string;
  type: NotificationKey;
  title: string;
  body: string;
  /** In-app destination when the notification is tapped. */
  url?: string;
};

/** Notifications people act on immediately are worth waking a screen for. */
const HIGH_URGENCY: ReadonlySet<NotificationKey> = new Set([
  "newLead",
  "missedCall",
  "hotLead",
  "leadNotContacted",
]);

export function getVapidKeys(): VapidKeys | null {
  const publicKey = readRuntimeValue("VAPID_PUBLIC_KEY");
  const privateKey = readRuntimeValue("VAPID_PRIVATE_KEY");
  const subject =
    readRuntimeValue("VAPID_SUBJECT") || readRuntimeValue("SYSTEM_EMAIL_FROM");
  if (!publicKey || !privateKey) return null;
  // RFC 8292 requires a mailto: or https: contact; a bare address is a common
  // misconfiguration and push services reject the whole token for it.
  const contact = subject.includes("@")
    ? `mailto:${subject.replace(/^.*<|>.*$/g, "").trim()}`
    : subject;
  return {
    publicKey,
    privateKey,
    subject: contact.startsWith("mailto:") || contact.startsWith("https:")
      ? contact
      : `mailto:${contact}`,
  };
}

export function pushConfigured(): boolean {
  return getVapidKeys() !== null;
}

/** The public key the browser needs to create a subscription. */
export function vapidPublicKey(): string | null {
  return getVapidKeys()?.publicKey ?? null;
}

/**
 * Sends one event to every device registered for a tenant.
 *
 * Order matters: the preference is checked before the ledger is claimed, so a
 * disabled alert type leaves no trace and can be enabled later without the
 * event looking already-delivered.
 */
export async function dispatchPushEvent(event: PushEvent): Promise<void> {
  try {
    const keys = getVapidKeys();
    if (!keys) return;

    const branding: TenantBranding = await brandingForClient(event.clientId);
    if (!branding.notifications[event.type]) return;

    if (
      !(await claimDelivery({
        organizationId: event.organizationId,
        clientId: event.clientId,
        eventKey: event.eventKey,
        notificationType: event.type,
      }))
    )
      return;

    const subscriptions = await subscriptionsForClient(event.clientId);
    if (!subscriptions.length) {
      await recordDeliveryOutcome({
        clientId: event.clientId,
        eventKey: event.eventKey,
        sent: 0,
        failed: 0,
      });
      return;
    }

    // The push service never sees this: it is encrypted to each device.
    const payload = JSON.stringify({
      title: event.title,
      body: event.body,
      // The tenant's own icon, so the alert looks like their app, not ours.
      icon: branding.iconUrl ?? "/brand/brizbuilder-icon.png",
      badge: branding.iconUrl ?? "/brand/brizbuilder-icon.png",
      url: event.url ?? "/dashboard",
      // Collapses repeats of the same alert type on the lock screen.
      tag: `${event.type}:${event.clientId}`,
    });

    const results = await Promise.all(
      subscriptions.map((subscription) =>
        sendWebPush(subscription, payload, keys, {
          urgency: HIGH_URGENCY.has(event.type) ? "high" : "normal",
          ttlSeconds: event.type === "appointmentReminder" ? 900 : 3600,
        }),
      ),
    );

    const expired = results.filter((result) => result.expired).map((r) => r.endpoint);
    if (expired.length) await markSubscriptionsExpired(expired);

    const sent = results.filter((result) => result.status >= 200 && result.status < 300);
    await recordDeliveryOutcome({
      clientId: event.clientId,
      eventKey: event.eventKey,
      sent: sent.length,
      failed: results.length - sent.length,
    });
  } catch (error) {
    // Deliberately swallowed: see the module header.
    console.error(
      "Push notification could not be delivered.",
      error instanceof Error ? error.message : error,
    );
  }
}

export type TestNotificationResult = {
  sent: number;
  failed: number;
  /** Set when nothing could be sent, so the UI can explain why. */
  reason?: string;
};

/**
 * Sends a one-off notification to the caller's own devices.
 *
 * Deliberately different from dispatchPushEvent in three ways, because this is
 * a diagnostic rather than an alert:
 *   - it ignores the tenant's notification preferences, so a switched-off
 *     workspace can still prove delivery works;
 *   - it claims no ledger row, so it can be run repeatedly;
 *   - it goes only to the person who asked, never the whole tenant.
 *
 * Returns a result instead of swallowing failures: somebody is watching a
 * button and needs to know whether it worked.
 */
export async function sendTestNotification(input: {
  clientId: string;
  email: string;
  branding: TenantBranding;
}): Promise<TestNotificationResult> {
  const keys = getVapidKeys();
  if (!keys) return { sent: 0, failed: 0, reason: "Push is not configured." };

  const subscriptions = await subscriptionsForEmail(input.clientId, input.email);
  if (!subscriptions.length)
    return {
      sent: 0,
      failed: 0,
      reason: "No device is registered for alerts yet.",
    };

  const payload = JSON.stringify({
    title: input.branding.appName,
    body: "Test alert — push notifications are working on this device.",
    icon: input.branding.iconUrl ?? "/brand/brizbuilder-icon.png",
    badge: input.branding.iconUrl ?? "/brand/brizbuilder-icon.png",
    url: "/dashboard",
    tag: `test:${input.clientId}`,
  });

  const results = await Promise.all(
    subscriptions.map((subscription) =>
      sendWebPush(subscription, payload, keys, { urgency: "high", ttlSeconds: 60 }),
    ),
  );

  const expired = results.filter((result) => result.expired).map((r) => r.endpoint);
  if (expired.length) await markSubscriptionsExpired(expired);

  const sent = results.filter((r) => r.status >= 200 && r.status < 300).length;
  return {
    sent,
    failed: results.length - sent,
    ...(sent === 0
      ? {
          reason:
            results.find((r) => r.error)?.error ??
            "The push service rejected the message.",
        }
      : {}),
  };
}

/* --------------------------------------------------------------- shortcuts */

/** Trims a value for a lock screen, where roughly two lines are readable. */
function line(value: string | null | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return fallback;
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

export function newLeadEvent(input: {
  organizationId: string;
  clientId: string;
  leadId: string;
  contactName?: string | null;
  serviceRequested?: string | null;
  source?: string | null;
}): PushEvent {
  const who = line(input.contactName, "A new lead");
  const what = line(input.serviceRequested, "New enquiry");
  return {
    organizationId: input.organizationId,
    clientId: input.clientId,
    eventKey: `lead:${input.leadId}:created`,
    type: "newLead",
    title: "New lead",
    body: input.source
      ? `${who} — ${what} (${line(input.source, "web")})`
      : `${who} — ${what}`,
    url: `/dashboard?view=leads&lead=${input.leadId}`,
  };
}

export function missedCallEvent(input: {
  organizationId: string;
  clientId: string;
  callId: string;
  fromNumber?: string | null;
  contactName?: string | null;
}): PushEvent {
  return {
    organizationId: input.organizationId,
    clientId: input.clientId,
    eventKey: `call:${input.callId}:missed`,
    type: "missedCall",
    title: "Missed call",
    body: `${line(input.contactName ?? input.fromNumber, "Unknown caller")} called and nobody picked up.`,
    url: "/dashboard?view=calls",
  };
}

export function transcriptReadyEvent(input: {
  organizationId: string;
  clientId: string;
  callId: string;
  summary?: string | null;
  contactName?: string | null;
}): PushEvent {
  return {
    organizationId: input.organizationId,
    clientId: input.clientId,
    eventKey: `call:${input.callId}:transcript`,
    type: "transcriptReady",
    title: "Call transcript ready",
    body: line(
      input.summary,
      `The recording from ${line(input.contactName, "a recent call")} has been transcribed.`,
    ),
    url: "/dashboard?view=calls",
  };
}

export function leadNotContactedEvent(input: {
  organizationId: string;
  clientId: string;
  leadId: string;
  contactName?: string | null;
  hours: number;
}): PushEvent {
  return {
    organizationId: input.organizationId,
    clientId: input.clientId,
    // The window is part of the key so shortening it re-alerts on a lead that
    // already passed the old threshold, rather than staying silent forever.
    eventKey: `lead:${input.leadId}:stale:${input.hours}`,
    type: "leadNotContacted",
    title: "Lead still waiting",
    body: `${line(input.contactName, "A lead")} has not been contacted in ${input.hours} ${
      input.hours === 1 ? "hour" : "hours"
    }.`,
    url: `/dashboard?view=leads&lead=${input.leadId}`,
  };
}

export function appointmentReminderEvent(input: {
  organizationId: string;
  clientId: string;
  appointmentId: string;
  contactName?: string | null;
  startsAt: string;
  serviceType?: string | null;
}): PushEvent {
  const when = new Date(input.startsAt);
  const time = Number.isNaN(when.getTime())
    ? "soon"
    : when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return {
    organizationId: input.organizationId,
    clientId: input.clientId,
    eventKey: `appointment:${input.appointmentId}:reminder`,
    type: "appointmentReminder",
    title: "Upcoming appointment",
    body: `${line(input.contactName, "An appointment")} at ${time}${
      input.serviceType ? ` — ${line(input.serviceType, "")}` : ""
    }`,
    url: "/dashboard?view=calendar",
  };
}

/**
 * Sends a hot-lead alert only when the score clears the tenant's own bar.
 *
 * The threshold lives with the tenant rather than in a constant because what
 * counts as hot differs per trade: a roofing lead at 70 may deserve a call
 * that a landscaping lead at 70 does not.
 */
export async function maybeNotifyHotLead(input: {
  organizationId: string;
  clientId: string;
  leadId: string;
  score: number;
  contactName?: string | null;
}): Promise<void> {
  try {
    const branding = await brandingForClient(input.clientId);
    if (!Number.isFinite(input.score)) return;
    if (input.score < branding.thresholds.hotLeadScore) return;
    await dispatchPushEvent(hotLeadEvent(input));
  } catch (error) {
    console.error(
      "Hot lead alert could not be evaluated.",
      error instanceof Error ? error.message : error,
    );
  }
}

export function hotLeadEvent(input: {
  organizationId: string;
  clientId: string;
  leadId: string;
  score: number;
  contactName?: string | null;
}): PushEvent {
  return {
    organizationId: input.organizationId,
    clientId: input.clientId,
    // Scored into the key so a lead that climbs further alerts again.
    eventKey: `lead:${input.leadId}:hot:${input.score}`,
    type: "hotLead",
    title: "Hot lead",
    body: `${line(input.contactName, "A lead")} scored ${input.score}. Worth calling now.`,
    url: `/dashboard?view=leads&lead=${input.leadId}`,
  };
}
