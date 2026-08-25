import {
  CallRailApiError,
  callRailDateParam,
  getCallRailCall,
  listCallRailCallIds,
  type CallRailCall,
} from "./callrail";
import {
  CALLRAIL_SIGNATURE_HEADER,
  readCallRailWebhook,
  readCallRailWebhookRoute,
  verifyCallRailSignature,
  type CallRailWebhookKind,
} from "./callrail-webhook";
import {
  loadCallRailApiAccess,
  loadCallRailWebhookVerifier,
} from "./callrail-store";
import {
  decideCallRailMetaEligibility,
  normalizeAttribution,
} from "./meta-eligibility";
import {
  decideReInquiry,
  normalizeReInquiryWindowDays,
  selectNewestLead,
} from "./callrail-reinquiry";
import { getSupabaseAdminClient } from "./supabase/server";
import { runPublishedWorkflowsForEvent } from "./workflow-engine";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_WEBHOOK_BYTES = 512_000;
const CLAIM_STALE_MS = 10 * 60 * 1000;
const RECONCILE_LOOKBACK_MS = 2 * 60 * 60 * 1000;
const RECONCILE_MAX_CONNECTIONS = 25;
const DEFAULT_PIPELINE_ID = "00000000-0000-4000-8000-000000000101";
const DEFAULT_NEW_STAGE_ID = "00000000-0000-4000-8000-000000000201";

type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type Row = Record<string, unknown>;

type CallRailDeliveryOutcome =
  | "accepted"
  | "duplicate"
  | "rejected_signature"
  // Retained so rows written before the split still read back. Nothing
  // emits it any more: the three below say which of its cases occurred.
  | "rejected_payload"
  | "rejected_unparseable"
  | "rejected_missing_call_id"
  | "rejected_company_mismatch"
  | "rejected_unknown_client"
  | "rejected_ingest_disabled"
  | "failed";

type CallRailDeliveryReceipt = {
  status: number;
  accepted: boolean;
  process: boolean;
  deliveryId: string | null;
  outcome: CallRailDeliveryOutcome;
};

type CallRailIngestionResult = {
  status: "ingested" | "skipped" | "busy";
  leadCreated: boolean;
  repaired: boolean;
};

function db() {
  return getSupabaseAdminClient();
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function text(value: unknown, max = 500): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, max);
}

/**
 * The closed vocabulary a sync run may record.
 *
 * A thrown message carries whatever the thrower put in it — a database error
 * quoting a row, a URL with a query string, a provider payload. A sync run is
 * stored and read back later, so it records which kind of thing went wrong and
 * nothing else. The detail stays in the exception, which is not persisted.
 */
export const CALLRAIL_SYNC_FAILURES = [
  "callrail_unauthorized",
  "callrail_unreachable",
  "callrail_rejected",
  "credential_unreadable",
  "unknown",
] as const;

export type CallRailSyncFailure = (typeof CALLRAIL_SYNC_FAILURES)[number];

export function classifySyncFailure(error: unknown): CallRailSyncFailure {
  if (error instanceof CallRailApiError) {
    if (error.status === "unauthorized") return "callrail_unauthorized";
    if (error.status === "error") return "callrail_unreachable";
    return "callrail_rejected";
  }
  if (
    error instanceof Error &&
    /could not be decrypted/i.test(error.message)
  ) {
    // The one message this codebase raises itself, so the only one safe to
    // recognise by text.
    return "credential_unreadable";
  }
  return "unknown";
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes: Uint8Array) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
}

async function checked<T>(promise: PromiseLike<{ data: T; error: unknown }>) {
  const result = await promise;
  if (result.error) {
    const message =
      result.error instanceof Error
        ? result.error.message
        : "Database request failed.";
    throw new Error(message);
  }
  return result.data;
}

async function recordDelivery(input: {
  organizationId: string | null;
  clientId: string | null;
  kind: CallRailWebhookKind | null;
  callId: string | null;
  companyId: string | null;
  bodySha256: string;
  signatureValid: boolean;
  outcome: CallRailDeliveryOutcome;
}) {
  const row = await checked(
    db()
      .from("callrail_webhook_deliveries")
      .insert({
        organization_id: input.organizationId,
        client_id: input.clientId,
        webhook_kind: input.kind,
        callrail_call_id: input.callId,
        company_id: input.companyId,
        body_sha256: input.bodySha256,
        signature_valid: input.signatureValid,
        outcome: input.outcome,
      })
      .select("id")
      .single(),
  );
  return String((row as Row).id);
}

async function previousDelivery(
  organizationId: string,
  clientId: string,
  bodySha256: string,
) {
  return checked(
    db()
      .from("callrail_webhook_deliveries")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("body_sha256", bodySha256)
      .eq("signature_valid", true)
      .in("outcome", ["accepted", "duplicate"])
      .limit(1)
      .maybeSingle(),
  );
}

async function receiveCallRailWebhook(
  request: Request,
  rawBytes: Uint8Array,
): Promise<CallRailDeliveryReceipt> {
  const route = readCallRailWebhookRoute(request.url);
  const bodySha256 = await sha256Hex(rawBytes);
  if (!route) {
    return {
      status: 404,
      accepted: false,
      process: false,
      deliveryId: null,
      outcome: "rejected_unknown_client",
    };
  }

  const verifier = await loadCallRailWebhookVerifier(route.pathId);
  if (!verifier) {
    await recordDelivery({
      organizationId: null,
      clientId: null,
      kind: route.kind,
      callId: null,
      companyId: null,
      bodySha256,
      signatureValid: false,
      outcome: "rejected_unknown_client",
    });
    return {
      status: 404,
      accepted: false,
      process: false,
      deliveryId: null,
      outcome: "rejected_unknown_client",
    };
  }

  const signatureValid = await verifyCallRailSignature(
    verifier.signingKey,
    rawBytes,
    request.headers.get(CALLRAIL_SIGNATURE_HEADER),
  );
  if (!signatureValid) {
    await recordDelivery({
      organizationId: verifier.organizationId,
      clientId: verifier.clientId,
      kind: route.kind,
      callId: null,
      companyId: verifier.companyId,
      bodySha256,
      signatureValid: false,
      outcome: "rejected_signature",
    });
    return {
      status: 403,
      accepted: false,
      process: false,
      deliveryId: null,
      outcome: "rejected_signature",
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBytes));
  } catch {
    const deliveryId = await recordDelivery({
      organizationId: verifier.organizationId,
      clientId: verifier.clientId,
      kind: route.kind,
      callId: null,
      companyId: verifier.companyId,
      bodySha256,
      signatureValid: true,
      outcome: "rejected_unparseable",
    });
    return {
      status: 400,
      accepted: false,
      process: false,
      deliveryId,
      outcome: "rejected_unparseable",
    };
  }

  const envelope = readCallRailWebhook(route.kind, body);
  if (!envelope) {
    const deliveryId = await recordDelivery({
      organizationId: verifier.organizationId,
      clientId: verifier.clientId,
      kind: route.kind,
      callId: null,
      companyId: verifier.companyId,
      bodySha256,
      signatureValid: true,
      outcome: "rejected_missing_call_id",
    });
    return {
      status: 400,
      accepted: false,
      process: false,
      deliveryId,
      outcome: "rejected_missing_call_id",
    };
  }

  // A body that names a company must name ours. A body that names none is
  // the ordinary case and is not an error — CallRail's post-call payload is
  // the call object's default fields, which exclude company_id. Nothing is
  // lost by proceeding: ingestFetchedCall refetches the call with company_id
  // explicitly requested and refuses it there if it belongs elsewhere.
  if (envelope.companyId && envelope.companyId !== verifier.companyId) {
    const deliveryId = await recordDelivery({
      organizationId: verifier.organizationId,
      clientId: verifier.clientId,
      kind: envelope.kind,
      callId: envelope.callId,
      companyId: envelope.companyId,
      bodySha256,
      signatureValid: true,
      outcome: "rejected_company_mismatch",
    });
    return {
      status: 400,
      accepted: false,
      process: false,
      deliveryId,
      outcome: "rejected_company_mismatch",
    };
  }

  if (!verifier.ingestEnabled) {
    const deliveryId = await recordDelivery({
      organizationId: verifier.organizationId,
      clientId: verifier.clientId,
      kind: envelope.kind,
      callId: envelope.callId,
      companyId: envelope.companyId,
      bodySha256,
      signatureValid: true,
      outcome: "rejected_ingest_disabled",
    });
    return {
      status: 200,
      accepted: true,
      process: false,
      deliveryId,
      outcome: "rejected_ingest_disabled",
    };
  }

  const duplicate = await previousDelivery(
    verifier.organizationId,
    verifier.clientId,
    bodySha256,
  );
  const outcome: CallRailDeliveryOutcome = duplicate ? "duplicate" : "accepted";
  const deliveryId = await recordDelivery({
    organizationId: verifier.organizationId,
    clientId: verifier.clientId,
    kind: envelope.kind,
    callId: envelope.callId,
    companyId: envelope.companyId,
    bodySha256,
    signatureValid: true,
    outcome,
  });
  return {
    status: 200,
    accepted: true,
    process: outcome === "accepted",
    deliveryId,
    outcome,
  };
}

export async function handleCallRailWebhook(
  request: Request,
  ctx: WaitUntilContext,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return json({ error: "Unsupported content type." }, 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) {
    return json({ error: "Webhook is too large." }, 413);
  }

  const rawBytes = new Uint8Array(await request.arrayBuffer());
  if (rawBytes.byteLength > MAX_WEBHOOK_BYTES) {
    return json({ error: "Webhook is too large." }, 413);
  }
  const receipt = await receiveCallRailWebhook(request, rawBytes);
  if (receipt.process && receipt.deliveryId) {
    ctx.waitUntil(
      processCallRailWebhookDelivery(receipt.deliveryId).catch((error) => {
        console.error(
        "CallRail webhook processing failed.",
        classifySyncFailure(error),
      );
      }),
    );
  }
  if (!receipt.accepted) {
    return json({ received: false, outcome: receipt.outcome }, receipt.status);
  }
  return json({ received: true, outcome: receipt.outcome }, receipt.status);
}

async function ingestionState(organizationId: string, clientId: string) {
  const row = await checked(
    db()
      .from("callrail_credentials")
      .select("account_id,company_id,ingest_enabled,re_inquiry_window_days")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .maybeSingle(),
  );
  const data = row as Row | null;
  return {
    accountId: text(data?.account_id, 80),
    companyId: text(data?.company_id, 80),
    enabled: data?.ingest_enabled === true,
    // A misconfigured window falls back to the default rather than
    // stopping a lead from being recorded at all.
    reInquiryWindowDays: normalizeReInquiryWindowDays(
      data?.re_inquiry_window_days,
    ),
  };
}

function callRowPatch(
  organizationId: string,
  clientId: string,
  call: CallRailCall,
  kind: CallRailWebhookKind,
) {
  const now = new Date().toISOString();
  return {
    organization_id: organizationId,
    client_id: clientId,
    callrail_call_id: call.id,
    company_id: call.companyId,
    direction: call.direction,
    answered: call.answered,
    duration_seconds: call.durationSeconds,
    started_at: call.startedAt,
    ended_at: call.endedAt,
    tracking_phone_number: call.trackingPhoneNumber,
    business_phone_number: call.businessPhoneNumber,
    customer_phone_e164: call.customerPhoneE164,
    customer_name: call.customerName,
    customer_city: call.customerCity,
    customer_state: call.customerState,
    customer_country: call.customerCountry,
    source: call.source,
    medium: call.medium,
    campaign: call.campaign,
    keywords: call.keywords,
    referrer_domain: call.referrerDomain,
    landing_page_url: call.landingPageUrl,
    last_requested_url: call.lastRequestedUrl,
    gclid: call.gclid,
    msclkid: call.msclkid,
    session_uuid: call.sessionUuid,
    tracker_id: call.trackerId,
    fbclid: call.fbclid,
    is_session_tracker: call.isSessionTracker,
    recording_url: call.recordingUrl,
    transcript: call.transcript,
    call_summary: call.callSummary,
    last_webhook_kind: kind,
    refetched_at: now,
    updated_at: now,
  };
}

async function saveCallSnapshot(
  organizationId: string,
  clientId: string,
  call: CallRailCall,
  kind: CallRailWebhookKind,
) {
  const existing = (await checked(
    db()
      .from("callrail_calls")
      .select("id,contact_id,lead_id,ingest_status,updated_at")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("callrail_call_id", call.id)
      .maybeSingle(),
  )) as Row | null;
  const patch = callRowPatch(organizationId, clientId, call, kind);
  if (existing) {
    await checked(
      db()
        .from("callrail_calls")
        .update(patch)
        .eq("id", String(existing.id)),
    );
    return existing;
  }
  try {
    const inserted = await checked(
      db()
        .from("callrail_calls")
        .insert({
          ...patch,
          ingest_status: "received",
        })
        .select("id,contact_id,lead_id,ingest_status,updated_at")
        .single(),
    );
    return inserted as Row;
  } catch (error) {
    const raced = (await checked(
      db()
        .from("callrail_calls")
        .select("id,contact_id,lead_id,ingest_status,updated_at")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("callrail_call_id", call.id)
        .maybeSingle(),
    )) as Row | null;
    if (!raced) throw error;
    await checked(
      db()
        .from("callrail_calls")
        .update(patch)
        .eq("id", String(raced.id)),
    );
    return raced;
  }
}

async function claimCall(rowId: string) {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  const rows = await checked(
    db().rpc("claim_callrail_call_for_ingestion", {
      p_call_row_id: rowId,
      p_stale_before: staleBefore,
    }),
  );
  const list = Array.isArray(rows) ? rows : [];
  return (list[0] as Row | undefined) ?? null;
}

function isLeadWorthy(call: CallRailCall) {
  const direction = call.direction?.toLowerCase();
  if (direction && direction !== "inbound") return false;
  if (call.leadStatus?.toLowerCase() === "not_a_lead") return false;
  if (call.tags.some((tag) => /\b(spam|wrong number|wrong-number)\b/iu.test(tag))) {
    return false;
  }
  return true;
}

function classification(call: CallRailCall) {
  if (!isLeadWorthy(call)) return "spam";
  if (call.priorCalls != null && call.priorCalls > 0) return "existing_customer";
  return "new_sales_inquiry";
}

function splitName(name: string | null, phone: string | null) {
  const clean = text(name, 120);
  if (!clean || clean === phone) {
    return { firstName: "Phone", lastName: "Caller" };
  }
  const parts = clean.split(/\s+/u);
  return {
    firstName: parts.shift() ?? "Phone",
    lastName: parts.join(" "),
  };
}

async function ensureContact(
  callRow: Row,
  organizationId: string,
  clientId: string,
  call: CallRailCall,
) {
  if (callRow.contact_id) return String(callRow.contact_id);
  const name = splitName(call.customerName, call.customerPhoneE164);

  if (call.customerPhoneE164) {
    // One database call that finds or creates under a transaction-scoped
    // advisory lock. Select-then-insert from here would let two workers
    // handling different calls from the same new caller both miss and both
    // insert; the lock is keyed on this tenant and this number, so nothing
    // else waits on it and shared numbers stay legal everywhere else.
    const contactId = await checked(
      db().rpc("find_or_create_callrail_contact", {
        p_organization_id: organizationId,
        p_client_id: clientId,
        p_phone_e164: call.customerPhoneE164,
        p_first_name: name.firstName,
        p_last_name: name.lastName,
        p_city: call.customerCity,
        p_state: call.customerState,
      }),
    );
    if (typeof contactId === "string" && contactId) return contactId;
  }

  // No usable number to key on, so there is nothing to collide over.
  const now = new Date().toISOString();
  const contact = (await checked(
    db()
      .from("contacts")
      .insert({
        organization_id: organizationId,
        client_id: clientId,
        first_name: name.firstName,
        last_name: name.lastName,
        phone: call.customerPhoneE164,
        city: call.customerCity,
        state: call.customerState,
        marketing_consent: "unknown",
        tags: ["CallRail"],
        last_interaction_at: now,
      })
      .select("id")
      .single(),
  )) as Row;
  return String(contact.id);
}

function metaDecision(call: CallRailCall) {
  // One rule, defined beside the web one it mirrors and tested against the
  // same vocabulary. A validated session is required as well as a valid click
  // id: see decideCallRailMetaEligibility for why the click id cannot vouch
  // for itself.
  return decideCallRailMetaEligibility({
    sessionUuid: call.sessionUuid,
    fbclid: call.fbclid,
  });
}

function leadMessage(call: CallRailCall) {
  const lines = [
    call.callSummary,
    call.transcript ? "Transcript is available on the CallRail call record." : null,
    call.startedAt ? `Call started: ${call.startedAt}` : null,
    call.durationSeconds != null ? `Duration: ${call.durationSeconds}s` : null,
    call.source ? `Source: ${call.source}` : null,
    call.landingPageUrl ? `Landing page: ${call.landingPageUrl}` : null,
  ].filter(Boolean);
  return lines.join("\n").slice(0, 1200);
}

async function clientName(organizationId: string, clientId: string) {
  const row = (await checked(
    db()
      .from("clients")
      .select("business_name")
      .eq("organization_id", organizationId)
      .eq("id", clientId)
      .maybeSingle(),
  )) as Row | null;
  return text(row?.business_name, 200) ?? "Client";
}

async function ensureLead(
  callRow: Row,
  organizationId: string,
  clientId: string,
  contactId: string,
  call: CallRailCall,
  windowDays: number,
) {
  if (callRow.lead_id) {
    return { leadId: String(callRow.lead_id), created: false, reused: false };
  }

  // Somebody ringing three times about the same job should not leave three
  // open leads behind them. The most recent open lead for this contact is
  // reused when the call still falls inside the client's re-enquiry window;
  // a closed lead, or one raised before the window, starts a new one.
  //
  // The call itself is recorded either way: reuse decides which lead a call
  // attaches to, never whether the call is written down.
  // The newest lead for this contact, whatever its status — not the newest
  // open one. Filtering to open here would step over a more recent closed
  // lead: somebody whose job was won last week, ringing today, would join the
  // open lead from a month ago instead of starting the job they are calling
  // about. The status and the window are both judged against this one lead.
  const recent = (await checked(
    db()
      .from("leads")
      .select("id,status,created_at")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1),
  )) as Row[] | null;

  const candidate = selectNewestLead(
    (Array.isArray(recent) ? recent : []).map((row) => ({
      id: String(row.id),
      status: row.status,
      createdAt: row.created_at,
    })),
  );
  const decision = decideReInquiry(candidate, Date.now(), windowDays);
  if (decision.reuse && candidate?.id) {
    return { leadId: String(candidate.id), created: false, reused: true };
  }

  const decisionMeta = metaDecision(call);
  const lead = (await checked(
    db()
      .from("leads")
      .insert({
        organization_id: organizationId,
        client_id: clientId,
        contact_id: contactId,
        pipeline_id: DEFAULT_PIPELINE_ID,
        stage_id: DEFAULT_NEW_STAGE_ID,
        service_requested: "Phone call",
        message: leadMessage(call),
        source: "CallRail",
        campaign: call.campaign ?? call.source,
        status: "NEW",
        lead_score: call.answered ? 65 : 45,
        tags: ["CallRail"],
        consent_status: "unknown",
        attribution: call.fbclid
          ? normalizeAttribution({ fbclid: call.fbclid })
          : {},
        meta_eligible: decisionMeta.eligible,
        meta_eligibility_reason: decisionMeta.reason,
      })
      .select("id")
      .single(),
  )) as Row;
  return { leadId: String(lead.id), created: true, reused: false };
}

async function markCall(rowId: string, patch: Record<string, unknown>) {
  await checked(
    db()
      .from("callrail_calls")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowId),
  );
}

export async function ingestFetchedCall(
  organizationId: string,
  clientId: string,
  call: CallRailCall,
  kind: CallRailWebhookKind = "post_call",
): Promise<CallRailIngestionResult> {
  const state = await ingestionState(organizationId, clientId);
  if (!state.enabled || !state.companyId) {
    return { status: "skipped", leadCreated: false, repaired: false };
  }
  if (!call.companyId || call.companyId !== state.companyId) {
    throw new Error("CallRail call belongs to a different company.");
  }
  const snapshot = await saveCallSnapshot(organizationId, clientId, call, kind);
  const claim = await claimCall(String(snapshot.id));
  if (!claim) return { status: "busy", leadCreated: false, repaired: false };
  const repaired = String(snapshot.ingest_status ?? "received") === "failed";

  try {
    if (!isLeadWorthy(call)) {
      await markCall(String(snapshot.id), {
        ingest_status: "skipped",
        ingest_error: null,
        classification: classification(call),
      });
      return { status: "skipped", leadCreated: false, repaired };
    }
    const contactId = await ensureContact(claim, organizationId, clientId, call);
    const lead = await ensureLead(
      claim,
      organizationId,
      clientId,
      contactId,
      call,
      state.reInquiryWindowDays,
    );
    await markCall(String(snapshot.id), {
      ingest_status: "ingested",
      ingest_error: null,
      contact_id: contactId,
      lead_id: lead.leadId,
      classification: classification(call),
    });
    if (lead.created) {
      await runPublishedWorkflowsForEvent("lead.created", {
        organizationId,
        clientId,
        eventId: `callrail:${call.id}:lead-created`,
        leadId: lead.leadId,
        contactId,
        businessName: await clientName(organizationId, clientId),
        serviceRequested: "Phone call",
      });
    }
    return { status: "ingested", leadCreated: lead.created, repaired };
  } catch (error) {
    await markCall(String(snapshot.id), {
      ingest_status: "failed",
      ingest_error: classifySyncFailure(error),
    });
    throw error;
  }
}

export async function ingestCallRailCall(
  organizationId: string,
  clientId: string,
  callId: string,
  kind: CallRailWebhookKind,
): Promise<CallRailIngestionResult> {
  const state = await ingestionState(organizationId, clientId);
  if (!state.enabled || !state.accountId || !state.companyId) {
    return { status: "skipped", leadCreated: false, repaired: false };
  }
  const access = await loadCallRailApiAccess(organizationId, clientId);
  if (!access.accountId) {
    return { status: "skipped", leadCreated: false, repaired: false };
  }
  const call = await getCallRailCall(access.accountId, callId, access.apiKey);
  return ingestFetchedCall(organizationId, clientId, call, kind);
}

export async function processCallRailWebhookDelivery(deliveryId: string) {
  const delivery = (await checked(
    db()
      .from("callrail_webhook_deliveries")
      .select("id,organization_id,client_id,webhook_kind,callrail_call_id,outcome,signature_valid")
      .eq("id", deliveryId)
      .maybeSingle(),
  )) as Row | null;
  if (
    !delivery ||
    delivery.signature_valid !== true ||
    delivery.outcome !== "accepted" ||
    !delivery.organization_id ||
    !delivery.client_id ||
    !delivery.callrail_call_id ||
    !delivery.webhook_kind
  ) {
    return { processed: false };
  }
  try {
    const result = await ingestCallRailCall(
      String(delivery.organization_id),
      String(delivery.client_id),
      String(delivery.callrail_call_id),
      delivery.webhook_kind as CallRailWebhookKind,
    );
    await checked(
      db()
        .from("callrail_webhook_deliveries")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", deliveryId),
    );
    return { processed: result.status !== "busy", result };
  } catch (error) {
    await checked(
      db()
        .from("callrail_webhook_deliveries")
        .update({
          outcome: "failed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", deliveryId),
    );
    throw error;
  }
}

/** One connection, or every enabled one when no scope is given. */
export type CallRailReconcileScope = {
  organizationId: string;
  clientId: string;
};

async function enabledConnections(limit: number, scope?: CallRailReconcileScope) {
  let query = db()
    .from("callrail_credentials")
    .select("organization_id,client_id,account_id,company_id")
    .eq("ingest_enabled", true)
    .not("account_id", "is", null)
    .not("company_id", "is", null);
  if (scope) {
    query = query
      .eq("organization_id", scope.organizationId)
      .eq("client_id", scope.clientId);
  }
  const rows = await checked(query.limit(limit));
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

/**
 * Take this connection's reconciliation slot, or return null.
 *
 * Null means another pass is already running for it — the schedule and the
 * button can both fire, and the caller skips rather than racing. A run whose
 * worker died is closed out as abandoned inside the function, so a crash
 * cannot hold the slot indefinitely.
 */
async function claimSyncRun(
  organizationId: string,
  clientId: string,
  windowStart: string,
  windowEnd: string,
): Promise<string | null> {
  const runId = await checked(
    db().rpc("claim_callrail_sync_run", {
      p_organization_id: organizationId,
      p_client_id: clientId,
      p_window_start: windowStart,
      p_window_end: windowEnd,
    }),
  );
  return runId ? String(runId) : null;
}

async function finishSyncRun(
  runId: string,
  patch: Record<string, unknown>,
) {
  await checked(
    db()
      .from("callrail_sync_runs")
      .update({
        ...patch,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId),
  );
}

/**
 * Calls this client has started ingesting and not finished.
 *
 * The window sweep only sees calls CallRail still lists inside the lookback, so
 * a background task that died on an older call would never be retried. These
 * rows are found by state instead of by age, which is what makes a failed
 * waitUntil recoverable rather than merely unlikely.
 */
async function unfinishedCalls(
  organizationId: string,
  clientId: string,
  limit: number,
) {
  const rows = await checked(
    db()
      .from("callrail_calls")
      .select("callrail_call_id")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .in("ingest_status", ["received", "enriching", "failed"])
      .order("updated_at", { ascending: true })
      .limit(limit),
  );
  return (Array.isArray(rows) ? rows : []) as Array<{
    callrail_call_id: string;
  }>;
}

export async function reconcileCallRailIngestion(options: {
  lookbackMs?: number;
  maxConnections?: number;
  maxPagesPerConnection?: number;
  /**
   * Restrict the pass to one connection.
   *
   * The schedule runs unscoped across every enabled connection. Anything a
   * person triggers passes a scope, because the permission that lets them
   * trigger it is held per client and must not reach another one.
   */
  scope?: CallRailReconcileScope;
} = {}) {
  if (options.scope && !(options.scope.organizationId && options.scope.clientId)) {
    throw new Error("A scoped reconciliation needs both an organization and a client.");
  }
  const windowEnd = new Date();
  const windowStart = new Date(
    windowEnd.getTime() - (options.lookbackMs ?? RECONCILE_LOOKBACK_MS),
  );
  const connections = await enabledConnections(
    options.maxConnections ?? RECONCILE_MAX_CONNECTIONS,
    options.scope,
  );
  const summary = {
    connections: connections.length,
    callsSeen: 0,
    callsIngested: 0,
    callsRepaired: 0,
    // Calls rescued by state rather than by falling inside the window.
    callsRecovered: 0,
    // Connections skipped because a pass was already running for them.
    skipped: 0,
    failures: 0,
  };
  for (const connection of connections) {
    const organizationId = String(connection.organization_id);
    const clientId = String(connection.client_id);
    const accountId = String(connection.account_id);
    const companyId = String(connection.company_id);
    const runId = await claimSyncRun(
      organizationId,
      clientId,
      windowStart.toISOString(),
      windowEnd.toISOString(),
    );
    if (!runId) {
      summary.skipped += 1;
      continue;
    }
    let recovered = 0;
    try {
      const access = await loadCallRailApiAccess(organizationId, clientId);
      if (!access.accountId) throw new Error("CallRail account is not selected.");
      // Discovery names the calls; it does not describe them. Each one is
      // then refetched in full, so a reconciled call is built from exactly
      // the same record a webhook-driven one is.
      const discovered = await listCallRailCallIds(
        accountId,
        companyId,
        access.apiKey,
        {
          startDate: callRailDateParam(windowStart),
          endDate: callRailDateParam(windowEnd),
          maxPages: options.maxPagesPerConnection,
        },
      );
      let ingested = 0;
      let repaired = 0;
      for (const callId of discovered.callIds) {
        const result = await ingestCallRailCall(
          organizationId,
          clientId,
          callId,
          "call_modified",
        );
        if (result.status === "ingested") ingested += 1;
        if (result.repaired) repaired += 1;
      }
      // Anything still unfinished, whatever its age. Keyed on CallRail's
      // call id, so a call the window sweep already handled converges here
      // instead of being done twice.
      const seenIds = new Set(discovered.callIds);
      for (const row of await unfinishedCalls(organizationId, clientId, 50)) {
        const callId = String(row.callrail_call_id);
        if (seenIds.has(callId)) continue;
        const result = await ingestCallRailCall(
          organizationId,
          clientId,
          callId,
          "call_modified",
        );
        if (result.status === "ingested") ingested += 1;
        if (result.repaired) repaired += 1;
        recovered += 1;
      }

      summary.callsSeen += discovered.callIds.length;
      summary.callsIngested += ingested;
      summary.callsRepaired += repaired;
      summary.callsRecovered += recovered;
      await finishSyncRun(runId, {
        calls_seen: discovered.callIds.length,
        calls_ingested: ingested,
        calls_repaired: repaired,
        status: discovered.truncated ? "partial" : "ok",
        error: null,
      });
    } catch (error) {
      summary.failures += 1;
      await finishSyncRun(runId, {
        status: "failed",
        error: classifySyncFailure(error),
      });
    }
  }
  return summary;
}
