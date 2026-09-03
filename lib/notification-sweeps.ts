// Scheduled notification sweeps.
//
// Two of the six alert types are not events anybody emits -- they are the
// absence of an event ("this lead has gone quiet") or a future one ("this
// appointment is about to start"). Both are found by scanning on the existing
// */15 cron rather than by scheduling a timer per record, which a Worker
// cannot hold anyway.
//
// Every sweep is bounded and idempotent: the delivery ledger's unique
// (client_id, event_key) means an overlapping run cannot double-send.

import { getSupabaseAdminClient } from "./supabase/server";
import { brandingForClient } from "../db/runtime-branding";
import {
  isRetryableJwtClockSkewError,
  withJwtClockSkewRetry,
} from "./jwt-clock-skew";
import {
  appointmentReminderEvent,
  dispatchPushEvent,
  leadNotContactedEvent,
  pushConfigured,
  recoverPushDeliveries,
} from "./push-notifications";

type AnyRecord = Record<string, unknown>;

/** How far ahead of an appointment the reminder fires. */
const APPOINTMENT_LEAD_MINUTES = 30;
/**
 * The cron runs every 15 minutes, so the window is opened slightly wider than
 * one interval. A reminder that lands twice is deduplicated by the ledger; one
 * that falls between two runs is simply never sent.
 */
const APPOINTMENT_WINDOW_MINUTES = 20;
/** Caps the work a single scheduled run can take on. */
const SWEEP_ROW_LIMIT = 200;

function db() {
  return getSupabaseAdminClient();
}

function contactName(row: AnyRecord): string | null {
  const contact = (Array.isArray(row.contacts) ? row.contacts[0] : row.contacts) as
    | AnyRecord
    | undefined;
  if (!contact) return null;
  const name = `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim();
  return name || null;
}

/**
 * Tenants worth scanning: those with at least one live push subscription.
 *
 * Without this the sweep would read every client's leads on every run to
 * notify nobody.
 */
async function tenantsWithSubscribers(): Promise<
  Array<{ clientId: string; organizationId: string }>
> {
  const { data, error } = await db()
    .from("push_subscriptions")
    .select("client_id,organization_id")
    .is("failed_at", null);
  if (error) throw new Error(error.message);
  const seen = new Map<string, { clientId: string; organizationId: string }>();
  for (const row of (data ?? []) as AnyRecord[]) {
    const clientId = String(row.client_id);
    if (!seen.has(clientId))
      seen.set(clientId, {
        clientId,
        organizationId: String(row.organization_id),
      });
  }
  return [...seen.values()];
}

/**
 * Alerts on leads that have sat untouched past the tenant's own window.
 *
 * "Untouched" is `last_contacted_at is null`: a lead somebody has already rung
 * once is their business, not something to nag about.
 */
export async function sweepStaleLeads(): Promise<number> {
  let sent = 0;
  for (const tenant of await tenantsWithSubscribers()) {
    try {
      const branding = await brandingForClient(tenant.clientId);
      if (!branding.notifications.leadNotContacted) continue;

      const hours = branding.thresholds.staleLeadHours;
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      // Only leads that crossed the line recently: without a lower bound every
      // old abandoned lead would re-alert whenever the window is shortened.
      const floor = new Date(
        Date.now() - (hours + 24) * 60 * 60 * 1000,
      ).toISOString();

      const { data, error } = await db()
        .from("leads")
        .select("id,created_at,status,contacts(first_name,last_name)")
        .eq("client_id", tenant.clientId)
        .is("archived_at", null)
        .is("last_contacted_at", null)
        // NEW is the only lead_status that means "nobody has worked this yet";
        // every other value in the enum implies somebody already has.
        .eq("status", "NEW")
        .lt("created_at", cutoff)
        .gt("created_at", floor)
        .limit(SWEEP_ROW_LIMIT);
      if (error) throw new Error(error.message);

      for (const row of (data ?? []) as AnyRecord[]) {
        await dispatchPushEvent(
          leadNotContactedEvent({
            organizationId: tenant.organizationId,
            clientId: tenant.clientId,
            leadId: String(row.id),
            contactName: contactName(row),
            hours,
          }),
        );
        sent += 1;
      }
    } catch (error) {
      if (isRetryableJwtClockSkewError(error)) throw error;
      // One tenant's failure must not stop the sweep for everybody else.
      console.error(
        "Stale lead sweep failed for a tenant.",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return sent;
}

/** Alerts shortly before an appointment starts. */
export async function sweepAppointmentReminders(): Promise<number> {
  let sent = 0;
  const now = Date.now();
  const windowStart = new Date(
    now + (APPOINTMENT_LEAD_MINUTES - APPOINTMENT_WINDOW_MINUTES) * 60 * 1000,
  ).toISOString();
  const windowEnd = new Date(
    now + APPOINTMENT_LEAD_MINUTES * 60 * 1000,
  ).toISOString();

  for (const tenant of await tenantsWithSubscribers()) {
    try {
      const branding = await brandingForClient(tenant.clientId);
      if (!branding.notifications.appointmentReminder) continue;

      const { data, error } = await db()
        .from("appointments")
        .select("id,starts_at,service_type,status,contacts(first_name,last_name)")
        .eq("client_id", tenant.clientId)
        .in("status", ["SCHEDULED", "CONFIRMED"])
        .gte("starts_at", windowStart)
        .lte("starts_at", windowEnd)
        .limit(SWEEP_ROW_LIMIT);
      if (error) throw new Error(error.message);

      for (const row of (data ?? []) as AnyRecord[]) {
        await dispatchPushEvent(
          appointmentReminderEvent({
            organizationId: tenant.organizationId,
            clientId: tenant.clientId,
            appointmentId: String(row.id),
            contactName: contactName(row),
            startsAt: String(row.starts_at),
            serviceType: row.service_type ? String(row.service_type) : null,
          }),
        );
        sent += 1;
      }
    } catch (error) {
      if (isRetryableJwtClockSkewError(error)) throw error;
      console.error(
        "Appointment reminder sweep failed for a tenant.",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return sent;
}

/**
 * Runs every scheduled notification sweep.
 *
 * Resolves rather than rejects: this shares a cron tick with CallRail
 * reconciliation and must not be able to take it down.
 */
export async function runNotificationSweeps(): Promise<void> {
  if (!pushConfigured()) return;
  try {
    await withJwtClockSkewRetry(async () => {
      // Recover failed work and claims abandoned by an interrupted Worker before
      // emitting this cycle's new events. The claim RPC still arbitrates overlap.
      await recoverPushDeliveries();
      await sweepStaleLeads();
      await sweepAppointmentReminders();
    });
    console.log("Notification sweeps completed.");
  } catch (error) {
    console.error(
      "Notification sweeps failed.",
      error instanceof Error ? error.message : error,
    );
  }
}
