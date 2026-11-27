// Calendly: connecting a client business's own Calendly account, and turning
// its bookings into contacts, leads and appointments.
//
// Connect and disconnect run inside the signed-in person's tenant context and
// check access again on the way back from Calendly. Webhooks carry no session:
// the unguessable path id picks the connection, and the app-level signature
// proves the body came from Calendly. Kept apart from db/supabase-crm.ts so the
// webhook path does not depend on the CRM action switch.

import type { ChatGPTUser } from "../app/chatgpt-auth";
import {
  getSupabaseTenantContext,
  requireSupabaseClientAccess,
  supabaseRoleHasPermission,
  writeSupabaseAuditEvent,
} from "./supabase-crm";
import { getSupabaseAdminClient } from "../lib/supabase/server";
import {
  CalendlyApiError,
  buildCalendlyAuthorizationUrl,
  calendlyWebhookSigningKey,
  calendlyWebhookUrl,
  createCalendlyWebhook,
  decryptCalendlyToken,
  deleteCalendlyWebhook,
  encryptCalendlyToken,
  exchangeCalendlyCode,
  getCalendlyCurrentUser,
  getCalendlyRuntimeStatus,
  listCalendlyEvents,
  listCalendlyInvitees,
  refreshCalendlyToken,
  revokeCalendlyToken,
} from "../lib/calendly";
import {
  createCalendlyWebhookPathId,
  isCalendlyWebhookPathId,
  normalizeCalendlyBooking,
  parseCalendlyWebhook,
  verifyCalendlySignature,
  type CalendlyBooking,
} from "../lib/calendly-core";

// Supabase rows are dynamic until generated database types are added.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const PROVIDER = "calendly";
const STATE_LIFETIME_MS = 15 * 60_000;
const REFRESH_EARLY_MS = 5 * 60_000;
const REFRESH_CLAIM_TTL_MS = 60_000;
/** Bookings that started up to a day ago still receive late cancellations. */
const SYNC_LOOKBACK_MS = 24 * 60 * 60_000;
const SYNC_LOOKAHEAD_MS = 180 * 24 * 60 * 60_000;
const SYNC_MAX_PAGES = 5;
const SYNC_MAX_EVENTS_PER_RUN = 40;
const SYNC_MAX_CONNECTIONS_PER_RUN = 50;

function supabase() {
  return getSupabaseAdminClient();
}

async function assertOk<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requireClientId(value: unknown): string {
  if (typeof value === "string" && /^[0-9a-f-]{36}$/iu.test(value)) return value;
  throw new Error("Choose a business first.");
}

async function authorize(user: ChatGPTUser, clientId: string) {
  const context = await getSupabaseTenantContext(user);
  if (!supabaseRoleHasPermission(context, "calendar.connect")) throw new Error("Forbidden");
  await requireSupabaseClientAccess(context, clientId);
  return context;
}

async function connectionFor(organizationId: string, clientId: string) {
  return (await assertOk(
    supabase()
      .from("calendly_connections")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .maybeSingle(),
  )) as Row | null;
}

async function setProviderConnection(organizationId: string, clientId: string, values: Row) {
  await assertOk(
    supabase()
      .from("provider_connections")
      .upsert(
        {
          organization_id: organizationId,
          client_id: clientId,
          provider: PROVIDER,
          billing_owner: "customer",
          updated_at: new Date().toISOString(),
          ...values,
        },
        { onConflict: "organization_id,client_id,provider" },
      ),
  );
}

async function markAttention(connection: Row, message: string) {
  const now = new Date().toISOString();
  await assertOk(
    supabase()
      .from("calendly_connections")
      .update({ status: "attention", last_error: message.slice(0, 500), updated_at: now })
      .eq("id", connection.id),
  );
  await setProviderConnection(String(connection.organization_id), String(connection.client_id), {
    status: "attention",
    last_error: message.slice(0, 500),
    last_health_check_at: now,
  });
}

// ---- Connect ----------------------------------------------------------------

export async function beginCalendlyConnect(user: ChatGPTUser, rawClientId: unknown): Promise<string> {
  const clientId = requireClientId(rawClientId);
  const context = await authorize(user, clientId);
  if (!getCalendlyRuntimeStatus().ready) throw new Error("Calendly is not configured on BrizBuilder yet.");

  const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const now = new Date();
  await assertOk(
    supabase()
      .from("provider_authorization_states")
      .delete()
      .eq("provider", PROVIDER)
      .lt("expires_at", now.toISOString()),
  );
  await assertOk(
    supabase().from("provider_authorization_states").insert({
      organization_id: context.organizationId,
      client_id: clientId,
      provider: PROVIDER,
      state_hash: await sha256Hex(state),
      requested_by_email: context.email,
      expires_at: new Date(now.getTime() + STATE_LIFETIME_MS).toISOString(),
    }),
  );
  return buildCalendlyAuthorizationUrl(state);
}

export async function cancelCalendlyConnect(state: string) {
  if (!state || state.length < 40) return;
  await assertOk(
    supabase()
      .from("provider_authorization_states")
      .delete()
      .eq("provider", PROVIDER)
      .eq("state_hash", await sha256Hex(state)),
  );
}

/**
 * Completes the OAuth round trip. The state is single-use and bound to the
 * person who started it, and their access is checked again before anything is
 * stored, because it may have been removed while they were at Calendly.
 * Returns the client id so the callback can send them back to that business.
 */
export async function finishCalendlyConnect(user: ChatGPTUser, state: string, code: string): Promise<string> {
  if (!state || state.length < 40 || !code) throw new Error("Calendly did not return a valid connection request.");
  const now = new Date().toISOString();
  const authorization = (await assertOk(
    supabase()
      .from("provider_authorization_states")
      .select("*")
      .eq("provider", PROVIDER)
      .eq("state_hash", await sha256Hex(state))
      .is("used_at", null)
      .gt("expires_at", now)
      .maybeSingle(),
  )) as Row | null;
  if (!authorization) throw new Error("This Calendly connection request expired. Start again from BrizBuilder.");

  try {
    if (user.email.trim().toLowerCase() !== String(authorization.requested_by_email).trim().toLowerCase())
      throw new Error("Forbidden");
    const clientId = String(authorization.client_id);
    const context = await authorize(user, clientId);
    if (context.organizationId !== String(authorization.organization_id)) throw new Error("Forbidden");

    const consumed = await assertOk(
      supabase()
        .from("provider_authorization_states")
        .update({ used_at: now })
        .eq("id", authorization.id)
        .is("used_at", null)
        .select("id")
        .maybeSingle(),
    );
    if (!consumed) throw new Error("This Calendly connection request was already used. Start again from BrizBuilder.");

    const tokens = await exchangeCalendlyCode(code, state);
    const calendlyUser = await getCalendlyCurrentUser(tokens.accessToken);

    // One Calendly account, one business: otherwise a booking would land twice.
    const elsewhere = (await assertOk(
      supabase()
        .from("calendly_connections")
        .select("organization_id,client_id")
        .eq("calendly_user_uri", calendlyUser.uri)
        .maybeSingle(),
    )) as Row | null;
    if (elsewhere && (elsewhere.organization_id !== context.organizationId || elsewhere.client_id !== clientId))
      throw new Error("This Calendly account is already connected to another business in BrizBuilder. Disconnect it there first.");

    // A reconnect replaces the old subscription rather than adding a second one.
    const existing = await connectionFor(context.organizationId, clientId);
    if (existing?.webhook_subscription_uri) {
      try {
        const oldToken = await liveAccessToken(existing);
        await deleteCalendlyWebhook(oldToken, String(existing.webhook_subscription_uri));
      } catch {
        // The old account may be gone or revoked; its subscription dies with it.
      }
    }

    const pathId = createCalendlyWebhookPathId();
    let subscriptionUri: string | null = null;
    let delivery: "webhook" | "polling" = "webhook";
    try {
      subscriptionUri = await createCalendlyWebhook(tokens.accessToken, calendlyUser, calendlyWebhookUrl(pathId));
    } catch (error) {
      // Calendly documents booking webhooks on every plan, but if this account
      // refuses one the background check still brings bookings in.
      if (!(error instanceof CalendlyApiError) || error.status === 401) throw error;
      delivery = "polling";
    }

    const [access, refresh] = await Promise.all([
      encryptCalendlyToken(tokens.accessToken, context.organizationId, clientId, "access"),
      encryptCalendlyToken(tokens.refreshToken, context.organizationId, clientId, "refresh"),
    ]);
    const values = {
      calendly_user_uri: calendlyUser.uri,
      calendly_organization_uri: calendlyUser.organizationUri,
      user_name: calendlyUser.name,
      user_email: calendlyUser.email,
      scheduling_url: calendlyUser.schedulingUrl,
      time_zone: calendlyUser.timeZone,
      access_token_ciphertext: access.ciphertext,
      access_token_iv: access.iv,
      refresh_token_ciphertext: refresh.ciphertext,
      refresh_token_iv: refresh.iv,
      access_token_expires_at: tokens.expiresAt,
      refresh_claim_id: null,
      refresh_claimed_at: null,
      webhook_path_id: pathId,
      webhook_subscription_uri: subscriptionUri,
      delivery,
      status: "connected",
      last_error: null,
      connected_by_email: context.email,
      connected_at: now,
      updated_at: now,
    };
    try {
      await assertOk(
        existing
          ? supabase().from("calendly_connections").update(values).eq("id", existing.id)
          : supabase()
              .from("calendly_connections")
              .insert({ organization_id: context.organizationId, client_id: clientId, ...values }),
      );
    } catch (error) {
      // Never leave a subscription at Calendly that nothing here can verify.
      if (subscriptionUri) await deleteCalendlyWebhook(tokens.accessToken, subscriptionUri).catch(() => undefined);
      throw error;
    }

    const label = [calendlyUser.name, calendlyUser.email && `(${calendlyUser.email})`].filter(Boolean).join(" ");
    await setProviderConnection(context.organizationId, clientId, {
      status: "connected",
      external_account_id: calendlyUser.uri,
      external_account_name: label || "Calendly",
      public_config: { accountStatus: "active", delivery, schedulingUrl: calendlyUser.schedulingUrl },
      connected_by_email: context.email,
      connected_at: now,
      disconnected_at: null,
      last_error: null,
      last_health_check_at: now,
    });
    await writeSupabaseAuditEvent(context, "calendly.connected", "provider_connection", null, { delivery }, clientId);
    return clientId;
  } finally {
    await assertOk(supabase().from("provider_authorization_states").delete().eq("id", authorization.id));
  }
}

export async function disconnectCalendly(user: ChatGPTUser, rawClientId: unknown) {
  const clientId = requireClientId(rawClientId);
  const context = await authorize(user, clientId);
  const connection = await connectionFor(context.organizationId, clientId);
  let stoppedAtCalendly = !connection?.webhook_subscription_uri;
  let revoked = false;
  if (connection) {
    // Best effort: the local link is removed whether or not Calendly answers,
    // so an outage can never keep tokens the owner asked to drop. Bookings that
    // still arrive afterwards match no path id and are ignored.
    try {
      const token = await liveAccessToken(connection);
      if (connection.webhook_subscription_uri) {
        await deleteCalendlyWebhook(token, String(connection.webhook_subscription_uri));
        stoppedAtCalendly = true;
      }
      revoked = await revokeCalendlyToken(token);
    } catch {
      // Recorded in the audit metadata below.
    }
    await assertOk(supabase().from("calendly_connections").delete().eq("id", connection.id));
  }
  const now = new Date().toISOString();
  await setProviderConnection(context.organizationId, clientId, {
    status: "disconnected",
    external_account_id: null,
    external_account_name: null,
    public_config: {},
    disconnected_at: now,
    last_error: null,
  });
  await writeSupabaseAuditEvent(
    context,
    "calendly.disconnected",
    "provider_connection",
    null,
    { stoppedAtCalendly, revokedAtCalendly: revoked },
    clientId,
  );
  return { disconnected: true };
}

// ---- Tokens -----------------------------------------------------------------

/**
 * A usable access token, refreshed when close to expiry. Calendly refresh
 * tokens are single-use, so the refresh runs under a row claim: a second
 * worker that finds the claim taken waits briefly and reads the new token.
 */
async function liveAccessToken(connection: Row): Promise<string> {
  const organizationId = String(connection.organization_id);
  const clientId = String(connection.client_id);
  const decryptAccess = (row: Row) =>
    decryptCalendlyToken(
      { ciphertext: row.access_token_ciphertext, iv: row.access_token_iv },
      organizationId,
      clientId,
      "access",
    );
  const fresh = (row: Row) => Date.parse(String(row.access_token_expires_at)) - Date.now() > REFRESH_EARLY_MS;
  if (fresh(connection)) return decryptAccess(connection);

  const claimId = crypto.randomUUID();
  const claimedAt = new Date();
  const staleBefore = new Date(claimedAt.getTime() - REFRESH_CLAIM_TTL_MS).toISOString();
  const claimed = (await assertOk(
    supabase()
      .from("calendly_connections")
      .update({ refresh_claim_id: claimId, refresh_claimed_at: claimedAt.toISOString() })
      .eq("id", connection.id)
      .or(`refresh_claim_id.is.null,refresh_claimed_at.lt.${staleBefore}`)
      .select("*")
      .maybeSingle(),
  )) as Row | null;

  if (!claimed) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const latest = await connectionFor(organizationId, clientId);
    if (latest && fresh(latest)) return decryptAccess(latest);
    throw new Error("Calendly is renewing this connection. Try again in a minute.");
  }
  // Another worker may have refreshed between our read and our claim.
  if (fresh(claimed)) {
    await releaseClaim(claimed.id, claimId);
    return decryptAccess(claimed);
  }

  const refreshToken = await decryptCalendlyToken(
    { ciphertext: claimed.refresh_token_ciphertext, iv: claimed.refresh_token_iv },
    organizationId,
    clientId,
    "refresh",
  );
  let tokens;
  try {
    tokens = await refreshCalendlyToken(refreshToken);
  } catch (error) {
    await releaseClaim(claimed.id, claimId);
    if (error instanceof CalendlyApiError && (error.status === 400 || error.status === 401)) {
      const message = "Calendly no longer accepts this connection. Reconnect Calendly to keep bookings coming in.";
      await markAttention(claimed, message);
      throw new Error(message);
    }
    throw error;
  }
  const [access, refresh] = await Promise.all([
    encryptCalendlyToken(tokens.accessToken, organizationId, clientId, "access"),
    encryptCalendlyToken(tokens.refreshToken, organizationId, clientId, "refresh"),
  ]);
  await assertOk(
    supabase()
      .from("calendly_connections")
      .update({
        access_token_ciphertext: access.ciphertext,
        access_token_iv: access.iv,
        refresh_token_ciphertext: refresh.ciphertext,
        refresh_token_iv: refresh.iv,
        access_token_expires_at: tokens.expiresAt,
        refresh_claim_id: null,
        refresh_claimed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", claimed.id)
      .eq("refresh_claim_id", claimId),
  );
  return tokens.accessToken;
}

async function releaseClaim(connectionId: string, claimId: string) {
  await supabase()
    .from("calendly_connections")
    .update({ refresh_claim_id: null, refresh_claimed_at: null })
    .eq("id", connectionId)
    .eq("refresh_claim_id", claimId);
}

// ---- Bookings ---------------------------------------------------------------

const CONTACT_FIELDS = "id,first_name,last_name,phone,email,field_provenance";
const CLOSED_LEAD_STATUSES = ["WON", "LOST", "SPAM"];

async function findOrCreateContact(connection: Row, booking: CalendlyBooking, now: string): Promise<string> {
  const organizationId = String(connection.organization_id);
  const clientId = String(connection.client_id);
  const find = async (column: "email" | "phone", value: string | null) =>
    value
      ? ((await assertOk(
          supabase()
            .from("contacts")
            .select(CONTACT_FIELDS)
            .eq("organization_id", organizationId)
            .eq("client_id", clientId)
            .eq(column, value)
            .is("archived_at", null)
            .limit(1)
            .maybeSingle(),
        )) as Row | null)
      : null;
  const contact = (await find("email", booking.email)) ?? (await find("phone", booking.phone));
  const provenance = { source: "form", confidence: 1, verified: true, updatedAt: now };

  if (!contact) {
    const values = {
      first_name: booking.firstName,
      last_name: booking.lastName,
      phone: booking.phone,
      email: booking.email,
    };
    const created = (await assertOk(
      supabase()
        .from("contacts")
        .insert({
          organization_id: organizationId,
          client_id: clientId,
          ...values,
          tags: ["calendly"],
          marketing_consent: "unknown",
          last_interaction_at: now,
          field_provenance: Object.fromEntries(
            Object.entries(values)
              .filter(([, value]) => Boolean(value))
              .map(([field]) => [field, provenance]),
          ),
        })
        .select("id")
        .single(),
    )) as Row;
    return String(created.id);
  }

  // Fill gaps only; never overwrite what the business already has on file.
  const patch: Row = { last_interaction_at: now, updated_at: now };
  const fields = contact.field_provenance && typeof contact.field_provenance === "object" ? { ...contact.field_provenance } : {};
  for (const [field, value] of Object.entries({ phone: booking.phone, email: booking.email, last_name: booking.lastName })) {
    if (value && !String(contact[field] ?? "").trim()) {
      patch[field] = value;
      fields[field] = provenance;
    }
  }
  patch.field_provenance = fields;
  await assertOk(supabase().from("contacts").update(patch).eq("id", contact.id).eq("organization_id", organizationId));
  return String(contact.id);
}

async function openLeadFor(organizationId: string, clientId: string, contactId: string) {
  const lead = (await assertOk(
    supabase()
      .from("leads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("contact_id", contactId)
      .is("archived_at", null)
      .not("status", "in", `(${CLOSED_LEAD_STATUSES.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  )) as Row | null;
  return lead ? String(lead.id) : null;
}

async function createLead(connection: Row, contactId: string, booking: CalendlyBooking, now: string): Promise<string> {
  const organizationId = String(connection.organization_id);
  const [pipeline, booked, fresh] = await Promise.all([
    assertOk(supabase().from("pipelines").select("id").eq("organization_id", organizationId).eq("is_default", true).limit(1).maybeSingle()),
    assertOk(supabase().from("pipeline_stages").select("id").eq("organization_id", organizationId).eq("slug", "appointment-booked").limit(1).maybeSingle()),
    assertOk(supabase().from("pipeline_stages").select("id").eq("organization_id", organizationId).eq("slug", "new").limit(1).maybeSingle()),
  ]) as [Row | null, Row | null, Row | null];
  const stage = booked ?? fresh;
  if (!pipeline?.id || !stage?.id) throw new Error("The CRM lead pipeline is not configured.");
  const provenance = { source: "form", confidence: 1, verified: true, updatedAt: now };
  const lead = (await assertOk(
    supabase()
      .from("leads")
      .insert({
        organization_id: organizationId,
        client_id: connection.client_id,
        contact_id: contactId,
        pipeline_id: pipeline.id,
        stage_id: stage.id,
        service_requested: booking.eventName,
        message: booking.message,
        source: `Calendly · ${booking.eventName}`.slice(0, 120),
        campaign: booking.campaign,
        status: booked ? "APPOINTMENT_BOOKED" : "NEW",
        lead_score: 70,
        tags: ["calendly"],
        consent_status: "unknown",
        appointment_date: booking.startsAt,
        first_contacted_at: now,
        last_contacted_at: now,
        field_provenance: { service_requested: provenance, source: provenance },
      })
      .select("id")
      .single(),
  )) as Row;
  return String(lead.id);
}

type IngestResult = "created" | "duplicate" | "canceled" | "ignored";

/**
 * Records one active booking exactly once. The booking row is claimed first
 * (unique per invitee), so a webhook redelivery or the background check
 * arriving at the same time cannot create a second appointment.
 */
async function ingestBooking(connection: Row, booking: CalendlyBooking): Promise<IngestResult> {
  const organizationId = String(connection.organization_id);
  const clientId = String(connection.client_id);
  const now = new Date().toISOString();
  const claim = (await assertOk(
    supabase()
      .from("calendly_bookings")
      .upsert(
        {
          organization_id: organizationId,
          client_id: clientId,
          invitee_uri: booking.inviteeUri,
          event_uri: booking.eventUri,
          status: "active",
          starts_at: booking.startsAt,
        },
        { onConflict: "organization_id,client_id,invitee_uri", ignoreDuplicates: true },
      )
      .select("id"),
  )) as Row[] | null;
  if (!claim?.length) return "duplicate";
  const bookingId = String(claim[0].id);

  try {
    // A reschedule keeps the person and the lead of the booking it replaced.
    const previous = booking.oldInviteeUri
      ? ((await assertOk(
          supabase()
            .from("calendly_bookings")
            .select("lead_id,contact_id")
            .eq("organization_id", organizationId)
            .eq("client_id", clientId)
            .eq("invitee_uri", booking.oldInviteeUri)
            .maybeSingle(),
        )) as Row | null)
      : null;
    const contactId = previous?.contact_id ? String(previous.contact_id) : await findOrCreateContact(connection, booking, now);
    const leadId =
      (previous?.lead_id ? String(previous.lead_id) : null) ??
      (await openLeadFor(organizationId, clientId, contactId)) ??
      (await createLead(connection, contactId, booking, now));

    const appointment = (await assertOk(
      supabase()
        .from("appointments")
        .insert({
          organization_id: organizationId,
          client_id: clientId,
          lead_id: leadId,
          contact_id: contactId,
          service_type: booking.eventName,
          starts_at: booking.startsAt,
          ends_at: booking.endsAt,
          time_zone: booking.timeZone,
          status: "SCHEDULED",
          notes: booking.notes,
          source: "calendly",
          updated_at: now,
        })
        .select("id")
        .single(),
    )) as Row;

    await Promise.all([
      assertOk(
        supabase()
          .from("calendly_bookings")
          .update({ appointment_id: appointment.id, lead_id: leadId, contact_id: contactId, updated_at: now })
          .eq("id", bookingId),
      ),
      assertOk(
        supabase()
          .from("leads")
          .update({
            appointment_date: booking.startsAt,
            appointment_start: booking.startsAt,
            appointment_end: booking.endsAt,
            appointment_timezone: booking.timeZone,
            appointment_status: "confirmed",
            appointment_source: "calendly",
            appointment_confidence: 1,
            appointment_verified_at: now,
            last_contacted_at: now,
            updated_at: now,
          })
          .eq("id", leadId)
          .eq("organization_id", organizationId),
      ),
      assertOk(
        supabase()
          .from("calendly_connections")
          .update({ last_booking_at: now })
          .eq("id", connection.id),
      ),
      assertOk(
        supabase().from("audit_events").insert({
          organization_id: organizationId,
          client_id: clientId,
          actor_email: `calendly:${String(connection.user_email || "booking").slice(0, 120)}`,
          action: "calendly.booking_received",
          record_type: "appointment",
          record_id: appointment.id,
          metadata: { rescheduled: Boolean(booking.oldInviteeUri) },
        }),
      ),
    ]);
    return "created";
  } catch (error) {
    // Release the claim so the next delivery or check can try again.
    await supabase().from("calendly_bookings").delete().eq("id", bookingId).is("appointment_id", null);
    throw error;
  }
}

async function cancelBooking(connection: Row, booking: CalendlyBooking): Promise<IngestResult> {
  const organizationId = String(connection.organization_id);
  const clientId = String(connection.client_id);
  const now = new Date().toISOString();
  const existing = (await assertOk(
    supabase()
      .from("calendly_bookings")
      .select("id,status,appointment_id,lead_id,starts_at")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("invitee_uri", booking.inviteeUri)
      .maybeSingle(),
  )) as Row | null;

  if (!existing) {
    // Never seen as active: remember it so a late "created" is not imported.
    await assertOk(
      supabase()
        .from("calendly_bookings")
        .upsert(
          {
            organization_id: organizationId,
            client_id: clientId,
            invitee_uri: booking.inviteeUri,
            event_uri: booking.eventUri,
            status: "canceled",
            starts_at: booking.startsAt,
          },
          { onConflict: "organization_id,client_id,invitee_uri", ignoreDuplicates: true },
        ),
    );
    return "ignored";
  }
  if (existing.status === "canceled") return "duplicate";

  await assertOk(
    supabase().from("calendly_bookings").update({ status: "canceled", updated_at: now }).eq("id", existing.id),
  );
  if (existing.appointment_id) {
    const appointment = (await assertOk(
      supabase()
        .from("appointments")
        .select("id,status,notes")
        .eq("id", existing.appointment_id)
        .eq("organization_id", organizationId)
        .maybeSingle(),
    )) as Row | null;
    // An appointment the business already closed out stays as they left it.
    if (appointment && !["COMPLETED", "NO_SHOW", "CANCELED"].includes(String(appointment.status))) {
      const note = booking.rescheduled ? "Rescheduled in Calendly." : "Canceled in Calendly.";
      await assertOk(
        supabase()
          .from("appointments")
          .update({
            status: "CANCELED",
            notes: `${String(appointment.notes ?? "")}\n${note}`.trim().slice(0, 1000),
            updated_at: now,
          })
          .eq("id", appointment.id)
          .eq("organization_id", organizationId),
      );
    }
  }
  // Only clear the lead's appointment if it still points at this booking: a
  // reschedule's new booking may already have replaced it.
  if (existing.lead_id && existing.starts_at) {
    await assertOk(
      supabase()
        .from("leads")
        .update({
          appointment_status: booking.rescheduled ? "rescheduled" : "cancelled",
          appointment_date: null,
          appointment_source: "calendly",
          appointment_verified_at: now,
          updated_at: now,
        })
        .eq("id", existing.lead_id)
        .eq("organization_id", organizationId)
        .eq("appointment_source", "calendly")
        .eq("appointment_start", existing.starts_at),
    );
  }
  return "canceled";
}

function applyBooking(connection: Row, booking: CalendlyBooking) {
  return booking.status === "canceled" ? cancelBooking(connection, booking) : ingestBooking(connection, booking);
}

// ---- Webhook ----------------------------------------------------------------

export type CalendlyWebhookOutcome = { status: number; result: string };

/**
 * Public by necessity. The signature is checked before anything is read from
 * the body or the database; the path id then selects the business.
 */
export async function handleCalendlyWebhook(
  pathId: string,
  rawBody: string,
  signature: string | null,
): Promise<CalendlyWebhookOutcome> {
  if (!isCalendlyWebhookPathId(pathId)) return { status: 404, result: "unknown" };
  const signingKey = calendlyWebhookSigningKey();
  if (!signingKey) return { status: 503, result: "not_configured" };
  if (!(await verifyCalendlySignature(rawBody, signature, signingKey))) return { status: 403, result: "invalid_signature" };

  const connection = (await assertOk(
    supabase().from("calendly_connections").select("*").eq("webhook_path_id", pathId).maybeSingle(),
  )) as Row | null;
  // A disconnected business: acknowledge so Calendly stops retrying.
  if (!connection) return { status: 200, result: "ignored" };

  let parsed;
  try {
    parsed = parseCalendlyWebhook(rawBody);
  } catch {
    return { status: 400, result: "invalid_body" };
  }
  if (parsed.kind === "ignored") return { status: 200, result: "ignored" };
  const booking = normalizeCalendlyBooking(parsed.invitee, parsed.event);
  if (!booking) return { status: 200, result: "ignored" };
  if (parsed.kind === "canceled") booking.status = "canceled";
  return { status: 200, result: await applyBooking(connection, booking) };
}

// ---- Background check -------------------------------------------------------

/**
 * Re-reads each connected account's bookings: the only source for accounts
 * without a webhook, and a safety net for missed deliveries on the rest. An
 * event is only re-read when Calendly changed it after BrizBuilder last
 * recorded it, so a quiet account costs one request per tick.
 */
export async function syncCalendlyConnections() {
  if (!getCalendlyRuntimeStatus().ready) return;
  const connections = ((await assertOk(
    supabase()
      .from("calendly_connections")
      .select("*")
      .eq("status", "connected")
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(SYNC_MAX_CONNECTIONS_PER_RUN),
  )) ?? []) as Row[];
  for (const connection of connections) {
    try {
      await syncConnection(connection);
    } catch (error) {
      // Recorded against the connection; never logged with provider detail.
      const message = error instanceof Error ? error.message.slice(0, 300) : "Calendly could not be checked.";
      await supabase()
        .from("calendly_connections")
        .update({ last_error: message, last_synced_at: new Date().toISOString() })
        .eq("id", connection.id);
    }
  }
}

async function syncConnection(connection: Row) {
  const token = await liveAccessToken(connection);
  const now = Date.now();
  const window = {
    minStart: new Date(now - SYNC_LOOKBACK_MS).toISOString(),
    maxStart: new Date(now + SYNC_LOOKAHEAD_MS).toISOString(),
  };
  let processed = 0;
  let pageToken: string | null = null;
  for (let page = 0; page < SYNC_MAX_PAGES && processed < SYNC_MAX_EVENTS_PER_RUN; page += 1) {
    const { events, next } = await listCalendlyEvents(token, String(connection.calendly_user_uri), window, pageToken);
    const uris = events.map((event) => event?.uri).filter((uri): uri is string => typeof uri === "string");
    const known = uris.length
      ? (((await assertOk(
          supabase()
            .from("calendly_bookings")
            .select("event_uri,updated_at")
            .eq("organization_id", connection.organization_id)
            .eq("client_id", connection.client_id)
            .in("event_uri", uris),
        )) ?? []) as Row[])
      : [];
    const recordedAt = new Map<string, number>();
    for (const row of known) {
      const at = Date.parse(String(row.updated_at));
      recordedAt.set(String(row.event_uri), Math.max(recordedAt.get(String(row.event_uri)) ?? 0, at));
    }
    for (const event of events) {
      if (processed >= SYNC_MAX_EVENTS_PER_RUN) break;
      const seen = recordedAt.get(String(event?.uri));
      const changed = Date.parse(String(event?.updated_at ?? ""));
      if (seen !== undefined && Number.isFinite(changed) && changed <= seen) continue;
      processed += 1;
      for (const invitee of await listCalendlyInvitees(token, String(event.uri))) {
        const booking = normalizeCalendlyBooking(invitee, event);
        if (booking) await applyBooking(connection, booking);
      }
      // Mark the event as read even when every invitee was already known.
      await supabase()
        .from("calendly_bookings")
        .update({ updated_at: new Date().toISOString() })
        .eq("organization_id", connection.organization_id)
        .eq("client_id", connection.client_id)
        .eq("event_uri", String(event.uri));
    }
    if (!next) break;
    pageToken = next;
  }
  await assertOk(
    supabase()
      .from("calendly_connections")
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq("id", connection.id),
  );
}
