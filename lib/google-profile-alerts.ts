// Hourly Google Business Profile alerts: Google-applied edits, new low-star
// reviews, and reviews left unanswered. Rides the existing cron tick and the
// push delivery ledger, whose unique (client_id, event_key) makes every alert
// send at most once even when runs overlap.

import { getSupabaseAdminClient } from "./supabase/server";
import { brandingForClient } from "../db/runtime-branding";
import {
  decryptGoogleSecret,
  getGoogleBusinessAlertState,
  refreshGoogleAccessToken,
} from "./google-business";
import { dispatchPushEvent, pushConfigured } from "./push-notifications";
import { googleProfilePushAlerts } from "./google-profile-health";
import { isRetryableJwtClockSkewError } from "./jwt-clock-skew";

type AnyRecord = Record<string, unknown>;

/** Caps Google calls per run; each business costs two requests. */
const MAX_BUSINESSES_PER_RUN = 60;

export async function sweepGoogleProfileAlerts(now = new Date()): Promise<number> {
  if (!pushConfigured()) return 0;
  const db = getSupabaseAdminClient();

  // Only businesses with someone to notify are worth a Google call.
  const { data: subscribers, error: subscriberError } = await db
    .from("push_subscriptions")
    .select("client_id")
    .is("failed_at", null);
  if (subscriberError) throw new Error(subscriberError.message);
  const clientIds = [...new Set(((subscribers ?? []) as AnyRecord[]).map((row) => String(row.client_id)))];
  if (!clientIds.length) return 0;

  const { data: profiles, error: profileError } = await db
    .from("google_business_profiles")
    .select("organization_id,client_id,account_id,location_id,business_name")
    .eq("status", "connected")
    .in("client_id", clientIds)
    .limit(MAX_BUSINESSES_PER_RUN);
  if (profileError) throw new Error(profileError.message);

  let sent = 0;
  for (const profile of (profiles ?? []) as AnyRecord[]) {
    const organizationId = String(profile.organization_id);
    const clientId = String(profile.client_id);
    try {
      if (!profile.account_id || !profile.location_id) continue;
      const branding = await brandingForClient(clientId);
      if (!branding.notifications.googleProfile) continue;

      const { data: credential, error: credentialError } = await db
        .from("google_business_credentials")
        .select("refresh_token_ciphertext,refresh_token_iv")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .maybeSingle();
      if (credentialError) throw new Error(credentialError.message);
      if (!credential) continue;

      const refreshToken = await decryptGoogleSecret(
        { ciphertext: String(credential.refresh_token_ciphertext), iv: String(credential.refresh_token_iv) },
        organizationId,
        clientId,
      );
      const { accessToken } = await refreshGoogleAccessToken(refreshToken);
      const state = await getGoogleBusinessAlertState(accessToken, String(profile.account_id), String(profile.location_id));

      const alerts = googleProfilePushAlerts({
        clientId,
        businessName: state.title ?? String(profile.business_name ?? ""),
        hasGoogleUpdated: state.hasGoogleUpdated,
        reviews: state.reviews,
        now,
      });
      for (const alert of alerts) {
        await dispatchPushEvent({ organizationId, clientId, type: "googleProfile", ...alert });
        sent += 1;
      }
    } catch (error) {
      if (isRetryableJwtClockSkewError(error)) throw error;
      // One business's Google trouble must not stop alerts for the rest. The
      // message is generic: provider errors can carry request details.
      console.error("Google profile alert sweep failed for a business.");
    }
  }
  return sent;
}
