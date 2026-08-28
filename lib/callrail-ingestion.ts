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
  selectNewestLead,
} from "./callrail-reinquiry";
import {
  enrichCallRailTranscript,
  isSystemCallMetadataMessage,
  shouldApplyTranscriptField,
  type ExtractedValue,
  type TranscriptAppointment,
} from "./callrail-enrichment";
import {
  CALLRAIL_TRANSCRIPT_MAX_ATTEMPTS,
  CALLRAIL_TRANSCRIPT_RETRY_DELAYS_MS,
  decideTranscriptRetry,
} from "./callrail-transcript-retry";
import { syncStoredAppointmentToGoogleCalendar } from "./google-calendar-store";
import { getSupabaseAdminClient } from "./supabase/server";
import { runPublishedWorkflowsForEvent } from "./workflow-engine";
import {
  dispatchPushEvent,
  maybeNotifyHotLead,
  missedCallEvent,
  newLeadEvent,
  transcriptReadyEvent,
} from "./push-notifications";

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

function callReference(value: unknown) {
  const clean = text(value, 100) ?? "unknown";
  return clean.length > 10 ? clean.slice(-10) : clean;
}

function callRailLog(event: string, details: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ system: "callrail", event, ...details }));
}

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

async function transcriptSha256(value: string) {
  return sha256Hex(new TextEncoder().encode(value));
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
    // Reprocessing a replay is safe because calls are keyed on CallRail's id
    // and claimed before CRM mutation. It also lets a provider retry rescue a
    // delivery whose original waitUntil was interrupted.
    process: true,
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
  callRailLog("webhook.received", {
    outcome: receipt.outcome,
    accepted: receipt.accepted,
    deliveryId: receipt.deliveryId,
  });
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
      .select("account_id,company_id,ingest_enabled")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .maybeSingle(),
  );
  const data = row as Row | null;
  return {
    accountId: text(data?.account_id, 80),
    companyId: text(data?.company_id, 80),
    enabled: data?.ingest_enabled === true,
  };
}

async function callRowPatch(
  organizationId: string,
  clientId: string,
  call: CallRailCall,
  kind: CallRailWebhookKind,
  existing: Row | null,
) {
  const attemptedAt = new Date();
  const now = attemptedAt.toISOString();
  // A later CallRail response with null conversation fields must never erase
  // historical evidence that was already stored. This also makes a repeated
  // webhook and a reconciliation fetch converge on the same transcript.
  const storedTranscript = call.transcript ?? text(existing?.transcript, 20_000);
  const existingTranscript = text(existing?.transcript, 20_000);
  const storedSummary = call.callSummary ?? text(existing?.call_summary, 2_400);
  const priorAttempts = Number(existing?.transcript_attempt_count ?? 0);
  const attemptCount = storedTranscript
    ? Math.max(1, priorAttempts)
    : Math.min(CALLRAIL_TRANSCRIPT_MAX_ATTEMPTS, priorAttempts + 1);
  const transcriptHash = storedTranscript
    ? await transcriptSha256(storedTranscript)
    : null;
  const retry = decideTranscriptRetry({
    transcriptAvailable: Boolean(storedTranscript),
    attemptCount,
    attemptedAt,
  });
  const existingTranscriptHash = text(existing?.transcript_sha256, 64);
  const transcriptChanged = Boolean(
    transcriptHash &&
      (!existingTranscript ||
        (existingTranscriptHash
          ? transcriptHash !== existingTranscriptHash
          : storedTranscript !== existingTranscript)),
  );
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
    source_name: call.sourceName,
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
    person_id: call.personId,
    call_type: call.callType,
    lead_status: call.leadStatus,
    call_tags: call.tags,
    fbclid: call.fbclid,
    is_session_tracker: call.isSessionTracker,
    recording_url: call.recordingUrl,
    recording_available: call.recordingAvailable,
    recording_duration_seconds: call.recordingDurationSeconds,
    transcript: storedTranscript,
    call_summary: storedSummary,
    transcript_status: retry.status,
    transcript_attempt_count: attemptCount,
    transcript_last_attempt_at: now,
    transcript_next_attempt_at: retry.nextAttemptAt,
    transcript_completed_at: storedTranscript
      ? existing?.transcript_completed_at ?? now
      : null,
    transcript_failure_reason: retry.failureReason,
    transcript_sha256: transcriptHash,
    enrichment_status: storedTranscript
      ? transcriptChanged
        ? "pending"
        : existing?.enrichment_status ?? "not_ready"
      : "not_ready",
    last_webhook_kind: kind,
    refetched_at: now,
    updated_at: now,
  };
}

const CALL_SNAPSHOT_STATE_FIELDS =
  "id,contact_id,lead_id,ingest_status,updated_at,transcript,call_summary," +
  "transcript_status,transcript_attempt_count,transcript_completed_at," +
  "transcript_next_attempt_at,transcript_failure_reason," +
  "transcript_sha256,enrichment_status,enrichment_transcript_sha256";

async function updateExistingCallSnapshot(
  rowId: string,
  patch: Record<string, unknown>,
  providerHasTranscript: boolean,
  providerHasSummary: boolean,
) {
  if (providerHasTranscript) {
    await checked(db().from("callrail_calls").update(patch).eq("id", rowId));
  } else {
    // A stale provider response that still says "no transcript" must not erase
    // a transcript written by a concurrent modified-call webhook. Keep the
    // metadata update independent, then advance the retry state only while the
    // row is still pending and empty.
    const metadataPatch = { ...patch };
    for (const field of [
      "transcript",
      "transcript_status",
      "transcript_attempt_count",
      "transcript_last_attempt_at",
      "transcript_next_attempt_at",
      "transcript_completed_at",
      "transcript_failure_reason",
      "transcript_sha256",
      "enrichment_status",
    ]) {
      delete metadataPatch[field];
    }
    if (!providerHasSummary) delete metadataPatch.call_summary;
    await checked(
      db().from("callrail_calls").update(metadataPatch).eq("id", rowId),
    );
    await checked(
      db()
        .from("callrail_calls")
        .update({
          transcript_status: patch.transcript_status,
          transcript_attempt_count: patch.transcript_attempt_count,
          transcript_last_attempt_at: patch.transcript_last_attempt_at,
          transcript_next_attempt_at: patch.transcript_next_attempt_at,
          transcript_completed_at: patch.transcript_completed_at,
          transcript_failure_reason: patch.transcript_failure_reason,
          updated_at: patch.updated_at,
        })
        .eq("id", rowId)
        .eq("transcript_status", "pending")
        .is("transcript", null),
    );
  }
  return (await checked(
    db()
      .from("callrail_calls")
      .select(CALL_SNAPSHOT_STATE_FIELDS)
      .eq("id", rowId)
      .single(),
  )) as Row;
}

async function saveCallSnapshot(
  organizationId: string,
  clientId: string,
  call: CallRailCall,
  kind: CallRailWebhookKind,
): Promise<Row> {
  const existing = (await checked(
    db()
      .from("callrail_calls")
      .select(CALL_SNAPSHOT_STATE_FIELDS)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("callrail_call_id", call.id)
      .maybeSingle(),
  )) as Row | null;
  const patch = await callRowPatch(organizationId, clientId, call, kind, existing);
  if (existing) {
    return updateExistingCallSnapshot(
      String(existing.id),
      patch,
      Boolean(call.transcript),
      Boolean(call.callSummary),
    );
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
    return { ...(inserted as Row), ...patch } as Row;
  } catch (error) {
    const raced = (await checked(
      db()
        .from("callrail_calls")
        .select(CALL_SNAPSHOT_STATE_FIELDS)
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("callrail_call_id", call.id)
        .maybeSingle(),
    )) as Row | null;
    if (!raced) throw error;
    return updateExistingCallSnapshot(
      String(raced.id),
      patch,
      Boolean(call.transcript),
      Boolean(call.callSummary),
    );
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

/**
 * An inbound call CallRail explicitly reports as unanswered.
 *
 * `answered` is nullable and a null means "CallRail did not say", which must
 * not be read as missed: guessing would alert on every call whose status has
 * not landed yet.
 */
function isMissedCall(call: CallRailCall) {
  const inbound = (call.direction ?? "inbound").toLowerCase() !== "outbound";
  return inbound && call.answered === false;
}

/** A display name for an alert, falling back to the number that rang. */
function callerName(call: CallRailCall): string | null {
  const name = text(call.customerName, 120);
  if (name && name !== call.customerPhoneE164) return name;
  return call.customerPhoneE164 ?? null;
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

  // CallRail's person id is stable across calls. Prefer an existing explicit
  // call/contact relationship before matching by phone, which also handles a
  // customer who calls from a newly structured number or whose number is
  // absent from this one provider response.
  if (call.personId) {
    const related = (await checked(
      db()
        .from("callrail_calls")
        .select("contact_id")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("person_id", call.personId)
        .not("contact_id", "is", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    )) as Row | null;
    if (related?.contact_id) return String(related.contact_id);
  }

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
  const now = callInteractionAt(call);
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
        field_provenance: {
          ...(call.customerName
            ? {
                first_name: sourceMetadata("callrail", 1),
                last_name: sourceMetadata("callrail", 1),
              }
            : {}),
          ...(call.customerPhoneE164
            ? { phone: sourceMetadata("callrail", 1) }
            : {}),
          ...(call.customerCity ? { city: sourceMetadata("callrail", 1) } : {}),
          ...(call.customerState ? { state: sourceMetadata("callrail", 1) } : {}),
        },
      })
      .select("id")
      .single(),
  )) as Row;
  return String(contact.id);
}

async function enrichContactFromCallRail(
  organizationId: string,
  clientId: string,
  contactId: string,
  call: CallRailCall,
) {
  const contact = (await checked(
    db()
      .from("contacts")
      .select(
        "id,first_name,last_name,phone,city,state,last_interaction_at,field_provenance",
      )
      .eq("id", contactId)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .maybeSingle(),
  )) as Row | null;
  if (!contact) return;
  const fields = provenance(contact.field_provenance);
  const patch: Record<string, unknown> = {
    last_interaction_at: latestIso(contact.last_interaction_at, callInteractionAt(call)),
    updated_at: new Date().toISOString(),
  };
  const name = splitName(call.customerName, call.customerPhoneE164);
  if (call.customerName && placeholderName(contact.first_name, contact.last_name)) {
    patch.first_name = name.firstName;
    patch.last_name = name.lastName;
    fields.first_name = sourceMetadata("callrail", 1);
    fields.last_name = sourceMetadata("callrail", 1);
  } else if (call.customerName) {
    if (!fields.first_name) fields.first_name = sourceMetadata("callrail", 1);
    if (!fields.last_name) fields.last_name = sourceMetadata("callrail", 1);
  }
  for (const [column, value] of [
    ["phone", call.customerPhoneE164],
    ["city", call.customerCity],
    ["state", call.customerState],
  ] as const) {
    if (blank(contact[column]) && value) {
      patch[column] = value;
      fields[column] = sourceMetadata("callrail", 1);
    } else if (value && !fields[column] && String(contact[column] ?? "") === value) {
      fields[column] = sourceMetadata("callrail", 1);
    }
  }
  patch.field_provenance = fields;
  await checked(
    db()
      .from("contacts")
      .update(patch)
      .eq("id", contactId)
      .eq("organization_id", organizationId)
      .eq("client_id", clientId),
  );
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
  // Call timestamps, duration, source, tracking number and transcript belong
  // to the call row. The lead message is customer-facing content only.
  return text(call.callSummary, 1200) ?? "";
}

function validIso(value: unknown) {
  const clean = text(value, 50);
  return clean && Number.isFinite(Date.parse(clean)) ? new Date(clean).toISOString() : null;
}

function earliestIso(...values: unknown[]) {
  const dates = values.map(validIso).filter((value): value is string => Boolean(value));
  return dates.sort()[0] ?? null;
}

function latestIso(...values: unknown[]) {
  const dates = values.map(validIso).filter((value): value is string => Boolean(value));
  return dates.sort().at(-1) ?? null;
}

function callInteractionAt(call: CallRailCall) {
  return call.endedAt ?? call.startedAt ?? new Date().toISOString();
}

type FieldProvenance = Record<
  string,
  { source?: string; confidence?: number; verified?: boolean; updatedAt?: string }
>;

function provenance(value: unknown): FieldProvenance {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as FieldProvenance) }
    : {};
}

function blank(value: unknown) {
  return value == null || (typeof value === "string" && !value.trim());
}

function placeholderName(firstName: unknown, lastName: unknown) {
  return /^(?:phone|unknown|caller)$/iu.test(String(firstName ?? "").trim()) &&
    /^(?:caller|contact|unknown)?$/iu.test(String(lastName ?? "").trim());
}

function sourceMetadata(source: "callrail" | "transcript" | "ai_summary", confidence: number) {
  return { source, confidence, verified: false, updatedAt: new Date().toISOString() };
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
) {
  if (callRow.lead_id) {
    return { leadId: String(callRow.lead_id), created: false, reused: false };
  }

  // Somebody ringing three times about the same job should not leave three
  // open leads behind them. The newest lead for this contact is reused when
  // it is still open, at any age; a closed one starts a new lead.
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
      .select("id,status,created_at,first_contacted_at,last_contacted_at")
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
  const decision = decideReInquiry(candidate);
  if (decision.reuse && candidate?.id) {
    const leadId = String(candidate.id);
    // Reused, and touched so the lead surfaces as active — but nothing that
    // describes where it came from is rewritten. The attribution and the Meta
    // eligibility belong to the call that opened it; a later call is more
    // contact with the same enquiry, not a new origin for it. The eligibility
    // trigger would refuse the write in any case; not attempting it is the
    // point.
    const interactionAt = callInteractionAt(call);
    await checked(
      db()
        .from("leads")
        .update({
          first_contacted_at: earliestIso(
            candidate.createdAt,
            (recent?.[0] as Row | undefined)?.first_contacted_at,
            call.startedAt,
          ),
          last_contacted_at: latestIso(
            (recent?.[0] as Row | undefined)?.last_contacted_at,
            interactionAt,
          ),
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .eq("organization_id", organizationId)
        .eq("client_id", clientId),
    );
    return { leadId, created: false, reused: true };
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
        first_contacted_at: call.startedAt ?? callInteractionAt(call),
        last_contacted_at: callInteractionAt(call),
        field_provenance: {
          source: sourceMetadata("callrail", 1),
          ...(call.campaign || call.source
            ? { campaign: sourceMetadata("callrail", 1) }
            : {}),
          ...(call.callSummary
            ? { message: sourceMetadata("ai_summary", 0.9) }
            : {}),
        },
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

function sameValue(left: unknown, right: unknown) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

function appendContactNotes(existing: unknown, lines: string[]) {
  let value = text(existing, 4_000) ?? "";
  for (const line of lines.filter(Boolean)) {
    if (!value.toLowerCase().includes(line.toLowerCase())) {
      value = value ? `${value}\n${line}` : line;
    }
  }
  return value.slice(0, 4_000);
}

async function syncTranscriptAppointment(input: {
  organizationId: string;
  clientId: string;
  callRowId: string;
  callId: string;
  leadId: string;
  contactId: string;
  contactName: string;
  serviceType: string;
  appointment: TranscriptAppointment;
}) {
  const database = db();
  const lead = (await checked(
    database
      .from("leads")
      .select(
        "id,transcript_appointment_id,appointment_status,appointment_start,appointment_end",
      )
      .eq("id", input.leadId)
      .eq("organization_id", input.organizationId)
      .eq("client_id", input.clientId)
      .maybeSingle(),
  )) as Row | null;
  if (!lead) {
    return { appointmentId: null, calendarAction: "not_applicable" };
  }

  let appointment = null as Row | null;
  if (lead.transcript_appointment_id) {
    appointment = (await checked(
      database
        .from("appointments")
        .select("id,starts_at,ends_at,status,source")
        .eq("id", String(lead.transcript_appointment_id))
        .eq("organization_id", input.organizationId)
        .eq("client_id", input.clientId)
        .maybeSingle(),
    )) as Row | null;
  }
  if (!appointment) {
    appointment = (await checked(
      database
        .from("appointments")
        .select("id,starts_at,ends_at,status,source")
        .eq("organization_id", input.organizationId)
        .eq("client_id", input.clientId)
        .eq("lead_id", input.leadId)
        .eq("source", "transcript")
        .limit(1)
        .maybeSingle(),
    )) as Row | null;
  }

  const now = new Date().toISOString();
  const extracted = input.appointment;
  if (extracted.status === "none") {
    return { appointmentId: null, calendarAction: "not_applicable" };
  }

  if (
    extracted.status !== "cancelled" &&
    (extracted.status === "tentative" || !extracted.verified)
  ) {
    // A discussion on a later call cannot displace a verified booking.
    if (!appointment || appointment.status === "CANCELED") {
      await checked(
        database
          .from("leads")
          .update({
            appointment_status: extracted.status,
            appointment_timezone: extracted.timeZone,
            appointment_confidence: extracted.confidence,
            appointment_source: "transcript",
            updated_at: now,
          })
          .eq("id", input.leadId)
          .eq("organization_id", input.organizationId)
          .eq("client_id", input.clientId),
      );
    }
    callRailLog("appointment.not_verified", {
      call: callReference(input.callId),
      status: extracted.status,
      confidence: extracted.confidence,
    });
    return { appointmentId: null, calendarAction: "not_applicable" };
  }

  if (extracted.status === "cancelled") {
    if (appointment && appointment.source === "transcript") {
      const appointmentId = String(appointment.id);
      await checked(
        database
          .from("appointments")
          .update({
            status: "CANCELED",
            source_callrail_call_id: input.callId,
            confidence: extracted.confidence,
            verified_at: now,
            updated_at: now,
          })
          .eq("id", appointmentId)
          .eq("organization_id", input.organizationId)
          .eq("client_id", input.clientId),
      );
      const calendar = await syncStoredAppointmentToGoogleCalendar(
        input.organizationId,
        input.clientId,
        {
          id: appointmentId,
          contactName: input.contactName,
          serviceType: input.serviceType,
          startsAt: String(appointment.starts_at),
          endsAt: String(appointment.ends_at ?? appointment.starts_at),
          notes: "Appointment cancellation confirmed in a call transcript.",
          status: "CANCELED",
        },
      );
      callRailLog("calendar.decision", {
        call: callReference(input.callId),
        decision: calendar.action,
      });
      await checked(
        database
          .from("leads")
          .update({
            appointment_status: "cancelled",
            appointment_date: null,
            appointment_confidence: extracted.confidence,
            appointment_source: "transcript",
            appointment_verified_at: now,
            updated_at: now,
          })
          .eq("id", input.leadId)
          .eq("organization_id", input.organizationId)
          .eq("client_id", input.clientId),
      );
      return { appointmentId, calendarAction: calendar.action };
    }
    await checked(
      database
        .from("leads")
        .update({
          appointment_status: "cancelled",
          appointment_date: null,
          appointment_confidence: extracted.confidence,
          appointment_source: "transcript",
          appointment_verified_at: now,
          updated_at: now,
        })
        .eq("id", input.leadId)
        .eq("organization_id", input.organizationId)
        .eq("client_id", input.clientId),
    );
    return { appointmentId: null, calendarAction: "not_applicable" };
  }

  if (!extracted.start || !extracted.end) {
    return { appointmentId: null, calendarAction: "not_applicable" };
  }
  if (!appointment) {
    // A pre-existing manually/form-created appointment at the exact verified
    // instant is the same booking, not a reason to create a second CRM row or
    // Google event. Adopt its stable id so future reschedules/cancellations
    // continue to target that event.
    appointment = (await checked(
      database
        .from("appointments")
        .select("id,starts_at,ends_at,status,source")
        .eq("organization_id", input.organizationId)
        .eq("client_id", input.clientId)
        .eq("lead_id", input.leadId)
        .eq("starts_at", extracted.start)
        .neq("status", "CANCELED")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    )) as Row | null;
  }
  const changed = Boolean(
    appointment?.starts_at && String(appointment.starts_at) !== extracted.start,
  );
  const finalState = appointment && changed ? "rescheduled" : extracted.status;
  let appointmentId = appointment ? String(appointment.id) : null;
  const appointmentPatch = {
    organization_id: input.organizationId,
    client_id: input.clientId,
    lead_id: input.leadId,
    contact_id: input.contactId,
    service_type: input.serviceType,
    starts_at: extracted.start,
    ends_at: extracted.end,
    status: "CONFIRMED",
    notes: "Appointment verified from the final state of a call transcript.",
    source: "transcript",
    source_callrail_call_id: input.callId,
    time_zone: extracted.timeZone,
    confidence: extracted.confidence,
    verified_at: now,
    updated_at: now,
  };
  if (appointmentId) {
    await checked(
      database
        .from("appointments")
        .update(appointmentPatch)
        .eq("id", appointmentId)
        .eq("organization_id", input.organizationId)
        .eq("client_id", input.clientId),
    );
  } else {
    try {
      const inserted = (await checked(
        database
          .from("appointments")
          .insert(appointmentPatch)
          .select("id")
          .single(),
      )) as Row;
      appointmentId = String(inserted.id);
    } catch (error) {
      // A concurrent webhook/reconciliation pass may have won the partial
      // unique index. Resolve the same row and update it instead of inserting a
      // second calendar appointment.
      const raced = (await checked(
        database
          .from("appointments")
          .select("id")
          .eq("organization_id", input.organizationId)
          .eq("client_id", input.clientId)
          .eq("lead_id", input.leadId)
          .eq("source", "transcript")
          .limit(1)
          .maybeSingle(),
      )) as Row | null;
      if (!raced) throw error;
      appointmentId = String(raced.id);
      await checked(
        database
          .from("appointments")
          .update(appointmentPatch)
          .eq("id", appointmentId),
      );
    }
  }

  await Promise.all([
    checked(
      database
        .from("leads")
        .update({
          transcript_appointment_id: appointmentId,
          appointment_status: finalState,
          appointment_start: extracted.start,
          appointment_end: extracted.end,
          appointment_date: extracted.start,
          appointment_timezone: extracted.timeZone,
          appointment_confidence: extracted.confidence,
          appointment_source: "transcript",
          appointment_verified_at: now,
          updated_at: now,
        })
        .eq("id", input.leadId)
        .eq("organization_id", input.organizationId)
        .eq("client_id", input.clientId),
    ),
    markCall(input.callRowId, { appointment_id: appointmentId }),
  ]);
  const calendar = await syncStoredAppointmentToGoogleCalendar(
    input.organizationId,
    input.clientId,
    {
      id: appointmentId,
      contactName: input.contactName,
      serviceType: input.serviceType,
      startsAt: extracted.start,
      endsAt: extracted.end,
      notes: "Appointment verified from a call transcript.",
      status: "CONFIRMED",
    },
  );
  callRailLog("calendar.decision", {
    call: callReference(input.callId),
    appointment: finalState,
    decision: calendar.action,
  });
  return { appointmentId, calendarAction: calendar.action };
}

async function processTranscriptEnrichment(input: {
  organizationId: string;
  clientId: string;
  callRowId: string;
  callId: string;
  callStartedAt: string | null;
  callInteractionAt: string | null;
  providerSummary: string | null;
  transcript: string;
  transcriptHash: string;
  contactId: string;
  leadId: string;
}) {
  const database = db();
  await markCall(input.callRowId, {
    enrichment_status: "processing",
    enrichment_attempted_at: new Date().toISOString(),
  });
  try {
    const [client, contact, lead] = (await Promise.all([
      checked(
        database
          .from("clients")
          .select("time_zone")
          .eq("organization_id", input.organizationId)
          .eq("id", input.clientId)
          .maybeSingle(),
      ),
      checked(
        database
          .from("contacts")
          .select(
            "id,first_name,last_name,phone,email,address,city,state,zip,company,tags,notes,field_provenance,last_interaction_at",
          )
          .eq("organization_id", input.organizationId)
          .eq("client_id", input.clientId)
          .eq("id", input.contactId)
          .maybeSingle(),
      ),
      checked(
        database
          .from("leads")
          .select(
            "id,service_requested,message,estimated_value_cents,tags,field_provenance," +
              "created_at,first_contacted_at,last_contacted_at",
          )
          .eq("organization_id", input.organizationId)
          .eq("client_id", input.clientId)
          .eq("id", input.leadId)
          .maybeSingle(),
      ),
    ])) as [Row | null, Row | null, Row | null];
    if (!contact || !lead) throw new Error("The call's CRM relationship is missing.");
    const timeZone = text(client?.time_zone, 100) ?? "America/Chicago";
    const enrichment = enrichCallRailTranscript({
      transcript: input.transcript,
      callStartedAt: input.callStartedAt ?? new Date().toISOString(),
      timeZone,
      providerSummary: input.providerSummary,
    });

    const applied: string[] = [];
    const rejected: string[] = [];
    const contactPatch: Record<string, unknown> = {};
    const contactProvenance = provenance(contact.field_provenance);
    const writeContact = (
      column: string,
      field: ExtractedValue<string> | null,
      minimum: number,
      placeholder = false,
    ) => {
      if (!field || sameValue(contact[column], field.value)) return;
      if (shouldApplyTranscriptField(contact[column], field, contactProvenance[column], minimum, placeholder)) {
        contactPatch[column] = field.value;
        contactProvenance[column] = sourceMetadata("transcript", field.confidence);
        applied.push(`contact.${column}`);
      } else {
        rejected.push(`contact.${column}`);
      }
    };

    if (enrichment.customerName) {
      const name = splitName(enrichment.customerName.value, null);
      const placeholder = placeholderName(contact.first_name, contact.last_name);
      if (
        placeholder ||
        shouldApplyTranscriptField(
          `${contact.first_name ?? ""} ${contact.last_name ?? ""}`,
          enrichment.customerName,
          contactProvenance.first_name,
          0.94,
        )
      ) {
        if (!sameValue(`${contact.first_name ?? ""} ${contact.last_name ?? ""}`, enrichment.customerName.value)) {
          contactPatch.first_name = name.firstName;
          contactPatch.last_name = name.lastName;
          contactProvenance.first_name = sourceMetadata("transcript", enrichment.customerName.confidence);
          contactProvenance.last_name = sourceMetadata("transcript", enrichment.customerName.confidence);
          applied.push("contact.name");
        }
      } else {
        rejected.push("contact.name");
      }
    }
    writeContact("phone", enrichment.phone, 0.95);
    writeContact("email", enrichment.email, 0.94);
    writeContact("address", enrichment.address, 0.94);
    writeContact("city", enrichment.city, 0.92);
    writeContact("state", enrichment.state, 0.94);
    writeContact("zip", enrichment.zip, 0.97);
    writeContact("company", enrichment.companyName, 0.94);

    const noteLines = [
      enrichment.customerNeed ? `Customer need: ${enrichment.customerNeed.value}` : "",
      enrichment.propertyType ? `Property type: ${enrichment.propertyType.value}` : "",
      enrichment.preferredContactMethod
        ? `Preferred contact: ${enrichment.preferredContactMethod.value}`
        : "",
      enrichment.additionalContact
        ? `Additional contact: ${enrichment.additionalContact.value}`
        : "",
    ];
    const nextNotes = appendContactNotes(contact.notes, noteLines);
    if (nextNotes !== String(contact.notes ?? "")) {
      contactPatch.notes = nextNotes;
      applied.push("contact.notes");
    }
    const contactTags = Array.isArray(contact.tags) ? contact.tags.map(String) : [];
    const mergedContactTags = [...new Set([...contactTags, ...enrichment.tags])];
    if (mergedContactTags.length !== contactTags.length) contactPatch.tags = mergedContactTags;
    contactPatch.field_provenance = contactProvenance;
    contactPatch.last_interaction_at = latestIso(
      contact.last_interaction_at,
      input.callInteractionAt,
    );
    contactPatch.updated_at = new Date().toISOString();

    const leadPatch: Record<string, unknown> = {};
    const leadProvenance = provenance(lead.field_provenance);
    if (
      enrichment.requestedService &&
      !sameValue(lead.service_requested, enrichment.requestedService.value)
    ) {
      const placeholder = /^(?:phone call|callrail call|unknown|not provided)$/iu.test(
        String(lead.service_requested ?? "").trim(),
      );
      if (
        shouldApplyTranscriptField(
          lead.service_requested,
          enrichment.requestedService,
          leadProvenance.service_requested,
          0.9,
          placeholder,
        )
      ) {
        leadPatch.service_requested = enrichment.requestedService.value;
        leadProvenance.service_requested = sourceMetadata(
          "transcript",
          enrichment.requestedService.confidence,
        );
        applied.push("lead.service_requested");
      } else {
        rejected.push("lead.service_requested");
      }
    }
    if (
      blank(lead.message) ||
      (isSystemCallMetadataMessage(lead.message) &&
        !(
          leadProvenance.message?.source === "manual" &&
          leadProvenance.message.verified === true
        ))
    ) {
      leadPatch.message = enrichment.summary;
      leadProvenance.message = sourceMetadata(
        input.providerSummary ? "ai_summary" : "transcript",
        input.providerSummary ? 0.9 : 0.82,
      );
      applied.push("lead.message");
    }
    if (
      enrichment.estimatedValueCents &&
      Number(lead.estimated_value_cents ?? 0) <= 0 &&
      enrichment.estimatedValueCents.confidence >= 0.97
    ) {
      leadPatch.estimated_value_cents = enrichment.estimatedValueCents.value;
      leadProvenance.estimated_value_cents = sourceMetadata(
        "transcript",
        enrichment.estimatedValueCents.confidence,
      );
      applied.push("lead.estimated_value_cents");
    } else if (enrichment.estimatedValueCents && Number(lead.estimated_value_cents ?? 0) > 0) {
      rejected.push("lead.estimated_value_cents");
    }
    const leadTags = Array.isArray(lead.tags) ? lead.tags.map(String) : [];
    const mergedLeadTags = [...new Set([...leadTags, ...enrichment.tags])];
    if (mergedLeadTags.length !== leadTags.length) leadPatch.tags = mergedLeadTags;
    leadPatch.field_provenance = leadProvenance;
    leadPatch.first_contacted_at = earliestIso(
      lead.first_contacted_at,
      lead.created_at,
      input.callStartedAt,
    );
    leadPatch.last_contacted_at = latestIso(
      lead.last_contacted_at,
      input.callInteractionAt,
    );
    leadPatch.updated_at = new Date().toISOString();

    await Promise.all([
      checked(
        database
          .from("contacts")
          .update(contactPatch)
          .eq("id", input.contactId)
          .eq("organization_id", input.organizationId)
          .eq("client_id", input.clientId),
      ),
      checked(
        database
          .from("leads")
          .update(leadPatch)
          .eq("id", input.leadId)
          .eq("organization_id", input.organizationId)
          .eq("client_id", input.clientId),
      ),
    ]);

    const finalService = String(
      leadPatch.service_requested ?? lead.service_requested ?? "Phone call",
    );
    const finalName =
      `${contactPatch.first_name ?? contact.first_name ?? ""} ${contactPatch.last_name ?? contact.last_name ?? ""}`.trim() ||
      "Customer";
    const appointmentResult = await syncTranscriptAppointment({
      organizationId: input.organizationId,
      clientId: input.clientId,
      callRowId: input.callRowId,
      callId: input.callId,
      leadId: input.leadId,
      contactId: input.contactId,
      contactName: finalName,
      serviceType: finalService,
      appointment: enrichment.appointment,
    });

    const completedAt = new Date().toISOString();
    // A newer modified-call response may save a changed transcript while this
    // run is still working. Never let the older result mark that newer hash as
    // completed; leaving its pending/processing state intact makes the next
    // reconciliation process the new evidence.
    await checked(
      database
        .from("callrail_calls")
        .update({
          call_summary: enrichment.summary,
          extracted_data: {
            ...enrichment,
            processing: {
              appliedFields: applied,
              rejectedFields: rejected,
              appointmentId: appointmentResult.appointmentId,
              calendarAction: appointmentResult.calendarAction,
            },
          },
          appointment_status: enrichment.appointment.status,
          appointment_start: enrichment.appointment.start,
          appointment_end: enrichment.appointment.end,
          appointment_timezone: enrichment.appointment.timeZone,
          appointment_confidence: enrichment.appointment.confidence,
          appointment_verified_at: enrichment.appointment.verified
            ? completedAt
            : null,
          enrichment_status: "completed",
          enrichment_completed_at: completedAt,
          enrichment_transcript_sha256: input.transcriptHash,
          updated_at: completedAt,
        })
        .eq("id", input.callRowId)
        .eq("transcript_sha256", input.transcriptHash),
    );
    callRailLog("enrichment.completed", {
      call: callReference(input.callId),
      applied,
      rejected,
      appointment: enrichment.appointment.status,
    });
    // Sent here rather than when the raw transcript lands: the summary is what
    // makes the alert worth reading, and it only exists once enrichment ran.
    await dispatchPushEvent(
      transcriptReadyEvent({
        organizationId: input.organizationId,
        clientId: input.clientId,
        callId: input.callId,
        summary: enrichment.summary,
        contactName: enrichment.customerName?.value ?? null,
      }),
    );
  } catch (error) {
    await markCall(input.callRowId, { enrichment_status: "failed" });
    callRailLog("enrichment.failed", {
      call: callReference(input.callId),
      reason: classifySyncFailure(error),
    });
    throw error;
  }
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
  callRailLog("transcript.fetch", {
    call: callReference(call.id),
    attempt: snapshot.transcript_attempt_count,
    status: snapshot.transcript_status,
  });
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
    await enrichContactFromCallRail(organizationId, clientId, contactId, call);
    const lead = await ensureLead(
      claim,
      organizationId,
      clientId,
      contactId,
      call,
    );
    callRailLog("lead.matched", {
      call: callReference(call.id),
      created: lead.created,
      reused: lead.reused,
    });
    const transcript = text(snapshot.transcript, 20_000);
    const transcriptHash = text(snapshot.transcript_sha256, 64);
    if (
      transcript &&
      transcriptHash &&
      ["pending", "processing", "failed"].includes(
        String(snapshot.enrichment_status),
      )
    ) {
      await processTranscriptEnrichment({
        organizationId,
        clientId,
        callRowId: String(snapshot.id),
        callId: call.id,
        callStartedAt: call.startedAt,
        callInteractionAt: callInteractionAt(call),
        providerSummary: call.callSummary,
        transcript,
        transcriptHash,
        contactId,
        leadId: lead.leadId,
      }).catch(() => undefined);
    } else if (snapshot.transcript_status === "pending") {
      callRailLog("transcript.pending", {
        call: callReference(call.id),
        attempt: snapshot.transcript_attempt_count,
      });
    } else if (snapshot.transcript_status === "unavailable") {
      callRailLog("transcript.retry_limit", {
        call: callReference(call.id),
        attempts: snapshot.transcript_attempt_count,
      });
    }
    // Keep the per-call claim until transcript enrichment has finished. If a
    // modified-call webhook and the cron overlap, only one may mutate CRM or
    // calendar state; a dead owner remains recoverable after the stale window.
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
      // Never throws, so a push failure cannot fail an ingestion that has
      // already written the lead.
      await dispatchPushEvent(
        newLeadEvent({
          organizationId,
          clientId,
          leadId: String(lead.leadId),
          contactName: callerName(call),
          serviceRequested: "Phone call",
          source: "call",
        }),
      );
      // Mirrors the score written at insert time above, so a tenant whose
      // hot-lead bar sits below it still gets the second alert.
      await maybeNotifyHotLead({
        organizationId,
        clientId,
        leadId: String(lead.leadId),
        score: call.answered ? 65 : 45,
        contactName: callerName(call),
      });
    }
    // A call that rang out is the missed-call alert. It is independent of
    // whether a lead was created: a repeat caller has a lead already.
    if (isMissedCall(call)) {
      await dispatchPushEvent(
        missedCallEvent({
          organizationId,
          clientId,
          callId: String(call.id),
          fromNumber: call.customerPhoneE164,
          contactName: callerName(call),
        }),
      );
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

async function callNeedsRefetch(
  organizationId: string,
  clientId: string,
  callId: string,
) {
  const row = (await checked(
    db()
      .from("callrail_calls")
      .select(
        "contact_id,lead_id,ingest_status,transcript_status,transcript_attempt_count," +
          "transcript_next_attempt_at,enrichment_status",
      )
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("callrail_call_id", callId)
      .maybeSingle(),
  )) as Row | null;
  if (!row) return true;
  // Once the transcript is durable, enrichment recovery is entirely local.
  // An interrupted/failed enrichment must not turn into repeated CallRail API
  // traffic merely because the shared ingest claim is still unfinished.
  if (
    row.contact_id &&
    row.lead_id &&
    row.transcript_status === "available" &&
    ["pending", "processing", "failed"].includes(String(row.enrichment_status))
  ) {
    return false;
  }
  if (["received", "enriching", "failed"].includes(String(row.ingest_status))) return true;
  if (row.transcript_status !== "pending") return false;
  if (Number(row.transcript_attempt_count ?? 0) >= CALLRAIL_TRANSCRIPT_MAX_ATTEMPTS) {
    return false;
  }
  const dueAt = validIso(row.transcript_next_attempt_at);
  return !dueAt || Date.parse(dueAt) <= Date.now();
}

async function recordTranscriptFetchFailure(
  organizationId: string,
  clientId: string,
  callId: string,
) {
  const row = (await checked(
    db()
      .from("callrail_calls")
      .select("id,transcript_status,transcript_attempt_count")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("callrail_call_id", callId)
      .maybeSingle(),
  )) as Row | null;
  if (!row || row.transcript_status !== "pending") return;
  const attemptCount = Math.min(
    CALLRAIL_TRANSCRIPT_MAX_ATTEMPTS,
    Number(row.transcript_attempt_count ?? 0) + 1,
  );
  const attemptedAt = new Date();
  const decision = decideTranscriptRetry({
    transcriptAvailable: false,
    attemptCount,
    attemptedAt,
    failureReason: "provider_unavailable",
  });
  await checked(
    db()
      .from("callrail_calls")
      .update({
        transcript_status: decision.status,
        transcript_attempt_count: attemptCount,
        transcript_last_attempt_at: attemptedAt.toISOString(),
        transcript_next_attempt_at: decision.nextAttemptAt,
        transcript_failure_reason: decision.failureReason,
        updated_at: attemptedAt.toISOString(),
      })
      .eq("id", String(row.id))
      .eq("transcript_status", "pending"),
  );
  callRailLog("transcript.fetch_failed", {
    call: callReference(callId),
    attempt: attemptCount,
    status: decision.status,
  });
}

async function ensureCallPlaceholder(
  organizationId: string,
  clientId: string,
  companyId: string,
  callId: string,
  kind: CallRailWebhookKind,
) {
  const existing = (await checked(
    db()
      .from("callrail_calls")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("callrail_call_id", callId)
      .maybeSingle(),
  )) as Row | null;
  if (existing) return;
  const now = new Date();
  try {
    await checked(
      db().from("callrail_calls").insert({
        organization_id: organizationId,
        client_id: clientId,
        callrail_call_id: callId,
        company_id: companyId,
        ingest_status: "received",
        last_webhook_kind: kind,
        transcript_status: "pending",
        transcript_attempt_count: 0,
        transcript_next_attempt_at: new Date(
          now.getTime() + CALLRAIL_TRANSCRIPT_RETRY_DELAYS_MS[0],
        ).toISOString(),
        enrichment_status: "not_ready",
        updated_at: now.toISOString(),
      }),
    );
    callRailLog("call.placeholder_created", { call: callReference(callId) });
  } catch (error) {
    // The unique call id is the race arbiter. Only suppress the insert error if
    // another worker really did create this exact tenant-scoped call row.
    const raced = await checked(
      db()
        .from("callrail_calls")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("callrail_call_id", callId)
        .maybeSingle(),
    );
    if (!raced) throw error;
  }
}

export async function ingestCallRailCall(
  organizationId: string,
  clientId: string,
  callId: string,
  kind: CallRailWebhookKind,
  force = true,
): Promise<CallRailIngestionResult> {
  const state = await ingestionState(organizationId, clientId);
  if (!state.enabled || !state.accountId || !state.companyId) {
    return { status: "skipped", leadCreated: false, repaired: false };
  }
  const access = await loadCallRailApiAccess(organizationId, clientId);
  if (!access.accountId) {
    return { status: "skipped", leadCreated: false, repaired: false };
  }
  if (!force && !(await callNeedsRefetch(organizationId, clientId, callId))) {
    return { status: "skipped", leadCreated: false, repaired: false };
  }
  await ensureCallPlaceholder(
    organizationId,
    clientId,
    state.companyId,
    callId,
    kind,
  );
  let call: CallRailCall;
  try {
    call = await getCallRailCall(access.accountId, callId, access.apiKey);
  } catch (error) {
    await recordTranscriptFetchFailure(organizationId, clientId, callId).catch(
      () => undefined,
    );
    throw error;
  }
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
    !["accepted", "duplicate"].includes(String(delivery.outcome)) ||
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
      // A replay should rescue an interrupted original, but it must not burn a
      // transcript attempt when the original already fetched and scheduled
      // its next try.
      String(delivery.outcome) === "accepted",
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
  const database = db();
  const [unfinished, transcriptDue] = await Promise.all([
    checked(
      database
        .from("callrail_calls")
        .select("callrail_call_id")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .in("ingest_status", ["received", "enriching", "failed"])
        .order("updated_at", { ascending: true })
        .limit(limit),
    ),
    checked(
      database
        .from("callrail_calls")
        .select("callrail_call_id")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("transcript_status", "pending")
        .lt("transcript_attempt_count", CALLRAIL_TRANSCRIPT_MAX_ATTEMPTS)
        .lte("transcript_next_attempt_at", new Date().toISOString())
        .order("transcript_next_attempt_at", { ascending: true })
        .limit(limit),
    ),
  ]);
  const ids = new Set<string>();
  for (const rows of [unfinished, transcriptDue]) {
    for (const row of Array.isArray(rows) ? (rows as Row[]) : []) {
      if (row.callrail_call_id) ids.add(String(row.callrail_call_id));
      if (ids.size >= limit) break;
    }
  }
  return [...ids].map((callrail_call_id) => ({ callrail_call_id }));
}

async function unfinishedEnrichments(
  organizationId: string,
  clientId: string,
  limit: number,
) {
  return (await checked(
    db()
      .from("callrail_calls")
      .select("callrail_call_id")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .in("enrichment_status", ["pending", "processing", "failed"])
      .order("updated_at", { ascending: true })
      .limit(limit),
  )) as Row[];
}

async function retryStoredTranscriptEnrichment(
  organizationId: string,
  clientId: string,
  callId: string,
): Promise<CallRailIngestionResult> {
  const database = db();
  const row = (await checked(
    database
      .from("callrail_calls")
      .select(
        "id,contact_id,lead_id,ingest_status,updated_at,transcript,transcript_sha256," +
          "enrichment_status,started_at,ended_at,call_summary",
      )
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("callrail_call_id", callId)
      .maybeSingle(),
  )) as Row | null;
  if (
    !row ||
    !["pending", "processing", "failed"].includes(String(row.enrichment_status)) ||
    !text(row.transcript, 20_000) ||
    !text(row.transcript_sha256, 64) ||
    !row.contact_id ||
    !row.lead_id
  ) {
    return { status: "skipped", leadCreated: false, repaired: false };
  }
  const claim = await claimCall(String(row.id));
  if (!claim) return { status: "busy", leadCreated: false, repaired: false };

  // Read again after winning the claim. A modified-call delivery may have
  // replaced the transcript between the eligibility read and this claim.
  const current = (await checked(
    database
      .from("callrail_calls")
      .select(
        "contact_id,lead_id,transcript,transcript_sha256,enrichment_status," +
          "started_at,ended_at,call_summary",
      )
      .eq("id", String(row.id))
      .single(),
  )) as Row;
  const transcript = text(current.transcript, 20_000);
  const transcriptHash = text(current.transcript_sha256, 64);
  if (
    !transcript ||
    !transcriptHash ||
    !["pending", "processing", "failed"].includes(String(current.enrichment_status))
  ) {
    await markCall(String(row.id), { ingest_status: "ingested", ingest_error: null });
    return { status: "skipped", leadCreated: false, repaired: false };
  }
  await processTranscriptEnrichment({
    organizationId,
    clientId,
    callRowId: String(row.id),
    callId,
    callStartedAt: validIso(current.started_at),
    callInteractionAt: latestIso(current.ended_at, current.started_at),
    providerSummary: text(current.call_summary, 2_400),
    transcript,
    transcriptHash,
    contactId: String(current.contact_id ?? claim.contact_id ?? row.contact_id),
    leadId: String(current.lead_id ?? claim.lead_id ?? row.lead_id),
  }).catch(() => undefined);
  await markCall(String(row.id), { ingest_status: "ingested", ingest_error: null });
  return { status: "ingested", leadCreated: false, repaired: true };
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
          false,
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
          false,
        );
        if (result.status === "ingested") ingested += 1;
        if (result.repaired) repaired += 1;
        recovered += 1;
      }
      // Enrichment already has the raw transcript it needs. Retry it from the
      // durable row instead of making another provider request every cron tick
      // when a database or calendar dependency is temporarily unavailable.
      for (const row of await unfinishedEnrichments(organizationId, clientId, 50)) {
        const result = await retryStoredTranscriptEnrichment(
          organizationId,
          clientId,
          String(row.callrail_call_id),
        );
        if (result.status === "ingested") ingested += 1;
        if (result.repaired) repaired += 1;
        if (result.status !== "busy") recovered += 1;
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
