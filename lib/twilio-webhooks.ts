import { getSupabaseAdminClient } from "./supabase/server";
import {
  escapeTwiml,
  getTwilioWebhookBaseUrl,
  renderMessageTemplate,
  sendTwilioMessage,
  SMS_STOP_WORDS,
  validateTwilioFormRequest,
} from "./twilio";
import { runPublishedWorkflowsForEvent } from "./workflow-engine";
import { dispatchPushEvent, missedCallEvent } from "./push-notifications";

type Row = Record<string, unknown>;

function db() {
  return getSupabaseAdminClient();
}

function xml(body = "<Response></Response>", status = 200) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function verifiedForm(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/x-www-form-urlencoded")
  )
    return null;
  const form = new URLSearchParams(await request.text());
  const valid = await validateTwilioFormRequest(
    request.url,
    form,
    request.headers.get("x-twilio-signature"),
  );
  return valid ? form : null;
}

async function configForNumber(number: string, accountSid: string) {
  const normalized = (() => {
    const digits = number.replace(/\D/gu, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return number;
  })();
  const connectionRows = await db()
    .from("provider_connections")
    .select("id")
    .eq("provider", "twilio")
    .eq("external_account_id", accountSid)
    .not("status", "in", '("disconnected","not_connected","revoked")');
  if (connectionRows.error) throw new Error(connectionRows.error.message);
  const connectionIds = (connectionRows.data ?? []).map((row) => String(row.id));
  const registered = connectionIds.length ? await db()
    .from("phone_numbers")
    .select("id,organization_id,client_id,connection_id,phone_number,display_name,purpose,provider_config")
    .eq("provider", "twilio")
    .eq("normalized_phone_number", normalized)
    .eq("is_active", true)
    .in("connection_id", connectionIds)
    .limit(2) : { data: [], error: null };
  if (registered.error) throw new Error(registered.error.message);
  if ((registered.data ?? []).length > 1) return null;
  const registeredNumber = registered.data?.[0];
  if (registeredNumber) {
    const numberConfig =
      registeredNumber.provider_config &&
      typeof registeredNumber.provider_config === "object" &&
      !Array.isArray(registeredNumber.provider_config)
        ? (registeredNumber.provider_config as Row)
        : {};
    const config = await db()
      .from("phone_system_configs")
      .select("*,clients(business_name)")
      .eq("organization_id", registeredNumber.organization_id)
      .eq("client_id", registeredNumber.client_id)
      .eq("provider", "twilio")
      .maybeSingle();
    if (config.error) throw new Error(config.error.message);
    return config.data
      ? ({
          ...config.data,
          phone_number: registeredNumber.phone_number,
          phone_number_registry_id: registeredNumber.id,
          provider_connection_id: registeredNumber.connection_id,
          forwarding_number:
            typeof numberConfig.forwardingNumber === "string"
              ? numberConfig.forwardingNumber
              : config.data.forwarding_number,
          phone_number_display_name:
            registeredNumber.display_name ?? registeredNumber.purpose,
        } as Row)
      : null;
  }
  const { data, error } = await db()
    .from("phone_system_configs")
    .select("*,clients(business_name)")
    .eq("phone_number", number)
    .eq("provider", "twilio")
    .eq("provider_account_sid", accountSid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Row | null;
}

async function findOrCreateContact(config: Row, from: string) {
  const organizationId = String(config.organization_id);
  const clientId = String(config.client_id);
  const canonical = (() => {
    const digits = from.replace(/\D/gu, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return /^\+[1-9]\d{7,14}$/u.test(from) ? from : null;
  })();
  if (canonical) {
    const matched = await db().rpc("find_or_create_phone_contact", {
      p_organization_id: organizationId,
      p_client_id: clientId,
      p_phone_e164: canonical,
      p_first_name: "Phone",
      p_last_name: "Caller",
      p_city: null,
      p_state: null,
      p_provider: "twilio",
    });
    if (matched.error) throw new Error(matched.error.message);
    const contact = await db()
      .from("contacts")
      .select("id,phone,marketing_consent,first_name,last_name")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("id", String(matched.data))
      .single();
    if (contact.error) throw new Error(contact.error.message);
    return contact.data as Row;
  }
  const existing = await db()
    .from("contacts")
    .select("id,phone,marketing_consent,first_name,last_name")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .eq("phone", from)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data as Row;
  const created = await db()
    .from("contacts")
    .insert({
      organization_id: organizationId,
      client_id: clientId,
      first_name: "Phone",
      last_name: "Caller",
      phone: from,
      marketing_consent: "unknown",
      last_interaction_at: new Date().toISOString(),
    })
    .select("id,phone,marketing_consent,first_name,last_name")
    .single();
  if (created.error) throw new Error(created.error.message);
  return created.data as Row;
}

async function findOrCreateLead(config: Row, contactId: string, startedAt: string) {
  const result = await db().rpc("find_or_create_phone_lead", {
    p_organization_id: String(config.organization_id),
    p_client_id: String(config.client_id),
    p_contact_id: contactId,
    p_provider: "twilio",
    p_message: "Incoming phone call",
    p_campaign: null,
    p_lead_score: 50,
    p_attribution: {},
    p_meta_eligible: false,
    p_meta_eligibility_reason: "no_validated_meta_session",
    p_first_contacted_at: startedAt,
    p_last_contacted_at: startedAt,
    p_field_provenance: {
      source: {
        source: "twilio",
        confidence: 1,
        verified: false,
        updatedAt: new Date().toISOString(),
      },
    },
  });
  if (result.error) throw new Error(result.error.message);
  const rows = Array.isArray(result.data) ? result.data : [];
  if (!rows[0]?.lead_id) throw new Error("Phone lead matching returned no lead.");
  return String(rows[0].lead_id);
}

async function contactAndLeadForCall(
  config: Row,
  from: string,
  callSid: string,
  startedAt: string,
) {
  if (callSid) {
    const existing = await db()
      .from("phone_calls")
      .select("contact_id,lead_id")
      .eq("organization_id", String(config.organization_id))
      .eq("client_id", String(config.client_id))
      .eq("provider", "twilio")
      .eq("provider_call_sid", callSid)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.contact_id && existing.data.lead_id) {
      const contact = await db()
        .from("contacts")
        .select("id,phone,marketing_consent,first_name,last_name")
        .eq("organization_id", String(config.organization_id))
        .eq("client_id", String(config.client_id))
        .eq("id", String(existing.data.contact_id))
        .maybeSingle();
      if (contact.error) throw new Error(contact.error.message);
      if (contact.data) {
        return { contact: contact.data as Row, leadId: String(existing.data.lead_id) };
      }
    }
  }

  const contact = await findOrCreateContact(config, from);
  const leadId = await findOrCreateLead(config, String(contact.id), startedAt);
  return { contact, leadId };
}

async function conversationFor(
  config: Row,
  contactId: string,
  inbound = false,
) {
  const existing = await db()
    .from("conversations")
    .select("id,unread_count")
    .eq("client_id", String(config.client_id))
    .eq("contact_id", contactId)
    .eq("channel", "sms")
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const now = new Date().toISOString();
  if (existing.data) {
    const updated = await db()
      .from("conversations")
      .update({
        status: "open",
        last_message_at: now,
        updated_at: now,
        unread_count: inbound
          ? Number(existing.data.unread_count ?? 0) + 1
          : Number(existing.data.unread_count ?? 0),
      })
      .eq("id", existing.data.id)
      .select("id")
      .single();
    if (updated.error) throw new Error(updated.error.message);
    return String(updated.data.id);
  }
  const created = await db()
    .from("conversations")
    .insert({
      organization_id: config.organization_id,
      client_id: config.client_id,
      contact_id: contactId,
      channel: "sms",
      status: "open",
      last_message_at: now,
      unread_count: inbound ? 1 : 0,
    })
    .select("id")
    .single();
  if (created.error) throw new Error(created.error.message);
  return String(created.data.id);
}

function businessName(config: Row) {
  const clients = config.clients as Row | Row[] | null;
  const client = Array.isArray(clients) ? clients[0] : clients;
  return String(client?.business_name ?? "our team");
}

export async function handleIncomingVoice(request: Request) {
  const form = await verifiedForm(request);
  if (!form)
    return xml('<Response><Reject reason="rejected" /></Response>', 403);
  const from = form.get("From") ?? "";
  const to = form.get("To") ?? "";
  const callSid = form.get("CallSid") ?? "";
  const config = await configForNumber(to, form.get("AccountSid") ?? "");
  if (
    !config ||
    config.provider_status !== "connected" ||
    !config.forwarding_number
  )
    return xml(
      "<Response><Say>This phone line is not configured yet.</Say></Response>",
    );
  const startedAt = new Date().toISOString();
  const { contact, leadId } = await contactAndLeadForCall(
    config,
    from,
    callSid,
    startedAt,
  );
  const upsert = await db()
    .from("phone_calls")
    .upsert(
      {
        organization_id: config.organization_id,
        client_id: config.client_id,
        contact_id: contact.id,
        lead_id: leadId,
        provider_call_sid: callSid,
        provider: "twilio",
        provider_connection_id: config.provider_connection_id,
        provider_call_id: callSid,
        business_phone_number_id: config.phone_number_registry_id,
        direction: "inbound",
        from_number: from,
        to_number: to,
        customer_phone: from,
        business_phone: to,
        customer_name: form.get("CallerName"),
        source: "Twilio",
        source_name: config.phone_number_display_name,
        transcript_status: "unavailable",
        forwarded_to: config.forwarding_number,
        status: "ringing",
        answered: null,
        started_at: startedAt,
        raw_event: Object.fromEntries(form.entries()),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider_call_sid" },
    );
  if (upsert.error) throw new Error(upsert.error.message);
  const callback = `${getTwilioWebhookBaseUrl()}/api/twilio/voice/status`;
  return xml(
    `<Response><Dial action="${escapeTwiml(callback)}" method="POST" timeout="${Number(config.ring_timeout_seconds ?? 20)}" answerOnBridge="true"><Number>${escapeTwiml(String(config.forwarding_number))}</Number></Dial></Response>`,
  );
}

export async function handleVoiceStatus(request: Request) {
  const form = await verifiedForm(request);
  if (!form) return xml("<Response></Response>", 403);
  const from = form.get("From") ?? "";
  const to = form.get("To") ?? "";
  const callSid = form.get("CallSid") ?? "";
  const callStatus =
    form.get("DialCallStatus") || form.get("CallStatus") || "completed";
  const config = await configForNumber(to, form.get("AccountSid") ?? "");
  if (!config) return xml();
  const startedAt =
    form.get("Timestamp") && Number.isFinite(Date.parse(String(form.get("Timestamp"))))
      ? new Date(String(form.get("Timestamp"))).toISOString()
      : new Date().toISOString();
  const { contact, leadId } = await contactAndLeadForCall(
    config,
    from,
    callSid,
    startedAt,
  );
  const missed = new Set(["no-answer", "busy", "failed", "canceled"]).has(
    callStatus,
  );
  const update = await db()
    .from("phone_calls")
    .upsert(
      {
        organization_id: config.organization_id,
        client_id: config.client_id,
        contact_id: contact.id,
        lead_id: leadId,
        provider_call_sid: callSid,
        provider: "twilio",
        provider_connection_id: config.provider_connection_id,
        provider_call_id: callSid,
        business_phone_number_id: config.phone_number_registry_id,
        direction: "inbound",
        from_number: from,
        to_number: to,
        customer_phone: from,
        business_phone: to,
        customer_name: form.get("CallerName"),
        source: "Twilio",
        source_name: config.phone_number_display_name,
        transcript_status: "unavailable",
        forwarded_to: config.forwarding_number,
        status: callStatus,
        answered: !missed,
        duration_seconds: Number(
          form.get("DialCallDuration") || form.get("CallDuration") || 0,
        ),
        ended_at: new Date().toISOString(),
        raw_event: Object.fromEntries(form.entries()),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider_call_sid" },
    )
    .select("id,missed_call_text_sent_at")
    .single();
  if (update.error) throw new Error(update.error.message);
  const advancedWorkflowCount = missed
    ? await runPublishedWorkflowsForEvent("call.missed", {
        organizationId: String(config.organization_id),
        clientId: String(config.client_id),
        eventId: `call:${callSid}:missed-workflows`,
        contactId: String(contact.id),
        businessName: businessName(config),
        callStatus,
        fromNumber: from,
      })
    : 0;
  if (missed) {
    // Never throws, so a push problem cannot fail the webhook and make Twilio
    // retry a call we have already recorded.
    await dispatchPushEvent(
      missedCallEvent({
        organizationId: String(config.organization_id),
        clientId: String(config.client_id),
        callId: callSid,
        fromNumber: from,
        // "Phone Caller" is the placeholder findOrCreateContact assigns to an
        // unknown number; showing the number itself is more use on a lock screen.
        contactName:
          `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ===
          "Phone Caller"
            ? null
            : `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim(),
      }),
    );
  }
  // A published visual workflow replaces the legacy missed-call rule so the
  // customer never receives two automatic replies for the same call.
  if (advancedWorkflowCount > 0) return xml();
  if (
    !missed ||
    !config.missed_call_text_enabled ||
    config.provider_status !== "connected" ||
    config.a2p_status !== "approved" ||
    String(contact.marketing_consent).toLowerCase() === "opt_out"
  )
    return xml();

  const ruleResult = await db()
    .from("automation_rules")
    .select("id,enabled")
    .eq("client_id", String(config.client_id))
    .eq("trigger_key", "call.missed")
    .maybeSingle();
  if (ruleResult.error || !ruleResult.data?.enabled) return xml();
  const triggerEventId = `twilio:${callSid}:missed`;
  const run = await db()
    .from("automation_runs")
    .insert({
      organization_id: config.organization_id,
      client_id: config.client_id,
      rule_id: ruleResult.data.id,
      trigger_event_id: triggerEventId,
      status: "started",
      input: { callSid, from, to },
    })
    .select("id")
    .single();
  if (run.error?.code === "23505") return xml();
  if (run.error) throw new Error(run.error.message);

  const cooldownSince = new Date(
    Date.now() - Number(config.cooldown_minutes ?? 20) * 60_000,
  ).toISOString();
  const recent = await db()
    .from("messages")
    .select("id")
    .eq("client_id", String(config.client_id))
    .eq("contact_id", String(contact.id))
    .eq("automation_key", "missed_call_text_back")
    .gte("created_at", cooldownSince)
    .limit(1)
    .maybeSingle();
  if (recent.error) throw new Error(recent.error.message);
  if (recent.data) {
    await db()
      .from("automation_runs")
      .update({
        status: "skipped_cooldown",
        completed_at: new Date().toISOString(),
        output: { cooldownMinutes: config.cooldown_minutes },
      })
      .eq("id", run.data.id);
    return xml();
  }

  try {
    const messageBody = renderMessageTemplate(
      String(config.missed_call_message),
      { business_name: businessName(config) },
    );
    const conversationId = await conversationFor(config, String(contact.id));
    const sent = await sendTwilioMessage({
      accountSid: String(config.provider_account_sid ?? ""),
      fromNumber: String(config.phone_number ?? ""),
      messagingServiceSid: String(config.messaging_service_sid ?? ""),
      to: from,
      body: messageBody,
    });
    const saved = await db()
      .from("messages")
      .insert({
        organization_id: config.organization_id,
        client_id: config.client_id,
        conversation_id: conversationId,
        contact_id: contact.id,
        provider_message_sid: sent.sid,
        direction: "outbound",
        channel: "sms",
        from_number: to,
        to_number: from,
        body: messageBody,
        status: sent.status,
        automation_key: "missed_call_text_back",
        sent_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (saved.error) throw new Error(saved.error.message);
    await Promise.all([
      db()
        .from("phone_calls")
        .update({ missed_call_text_sent_at: new Date().toISOString() })
        .eq("id", update.data.id),
      db()
        .from("automation_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          output: { messageId: saved.data.id, providerMessageSid: sent.sid },
        })
        .eq("id", run.data.id),
      db()
        .from("tasks")
        .insert({
          organization_id: config.organization_id,
          client_id: config.client_id,
          contact_id: contact.id,
          title: `Return missed call from ${from}`,
          description:
            "A missed-call text was sent automatically. Follow up if the customer does not reply.",
          priority: "HIGH",
          status: "TO_DO",
          due_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        }),
    ]);
  } catch (error) {
    await db()
      .from("automation_runs")
      .update({
        status: "failed",
        error:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Message failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.data.id);
  }
  return xml();
}

/** Signed status updates for callbacks initiated by the common call service. */
export async function handleOutboundVoiceStatus(request: Request) {
  const form = await verifiedForm(request);
  if (!form) return xml("<Response></Response>", 403);
  const callSid = form.get("CallSid") ?? "";
  const accountSid = form.get("AccountSid") ?? "";
  if (!callSid || !accountSid) return xml();

  const callResult = await db()
    .from("phone_calls")
    .select("id,organization_id,client_id,provider_connection_id")
    .eq("provider", "twilio")
    .eq("provider_call_id", callSid)
    .maybeSingle();
  if (callResult.error) throw new Error(callResult.error.message);
  const call = callResult.data as Row | null;
  if (!call) return xml();

  const connection = await db()
    .from("provider_connections")
    .select("id")
    .eq("id", String(call.provider_connection_id))
    .eq("organization_id", String(call.organization_id))
    .eq("client_id", String(call.client_id))
    .eq("provider", "twilio")
    .eq("external_account_id", accountSid)
    .maybeSingle();
  if (connection.error) throw new Error(connection.error.message);
  if (!connection.data) return xml("<Response></Response>", 403);

  const status =
    form.get("DialCallStatus") || form.get("CallStatus") || "completed";
  const failed = new Set(["no-answer", "busy", "failed", "canceled"]).has(status);
  const answered = failed
    ? false
    : new Set(["in-progress", "completed", "answered"]).has(status)
      ? true
      : null;
  const durationValue = Number(
    form.get("DialCallDuration") || form.get("CallDuration") || "",
  );
  const patch: Record<string, unknown> = {
    status,
    answered,
    raw_event: Object.fromEntries(form.entries()),
    updated_at: new Date().toISOString(),
  };
  if (Number.isFinite(durationValue)) patch.duration_seconds = durationValue;
  if (answered !== null || failed) patch.ended_at = new Date().toISOString();
  const updated = await db()
    .from("phone_calls")
    .update(patch)
    .eq("id", String(call.id))
    .eq("organization_id", String(call.organization_id))
    .eq("client_id", String(call.client_id))
    .eq("provider", "twilio")
    .eq("provider_call_id", callSid);
  if (updated.error) throw new Error(updated.error.message);
  return xml();
}

export async function handleIncomingMessage(request: Request) {
  const form = await verifiedForm(request);
  if (!form) return xml("<Response></Response>", 403);
  const from = form.get("From") ?? "";
  const to = form.get("To") ?? "";
  const body = (form.get("Body") ?? "").slice(0, 1600);
  const messageSid = form.get("MessageSid") || form.get("SmsSid") || "";
  const config = await configForNumber(to, form.get("AccountSid") ?? "");
  if (!config) return xml();
  const contact = await findOrCreateContact(config, from);
  const normalized = body
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (SMS_STOP_WORDS.has(normalized)) {
    const revokedAt = new Date().toISOString();
    const [contactUpdate, consentEvent] = await Promise.all([
      db()
        .from("contacts")
        .update({
          marketing_consent: "opt_out",
          last_interaction_at: revokedAt,
        })
        .eq("id", contact.id),
      db().from("contact_message_consents").insert({
        organization_id: config.organization_id,
        client_id: config.client_id,
        contact_id: contact.id,
        channel: "sms",
        purpose: "review_request",
        status: "revoked",
        source: "twilio_stop_keyword",
        evidence: { providerMessageSid: messageSid },
        policy_version: "review-request-v1",
        captured_by_email: "twilio-webhook",
        captured_at: revokedAt,
        revoked_at: revokedAt,
        updated_at: revokedAt,
      }),
    ]);
    if (contactUpdate.error) throw new Error(contactUpdate.error.message);
    if (consentEvent.error) throw new Error(consentEvent.error.message);
  } else
    await db()
      .from("contacts")
      .update({ last_interaction_at: new Date().toISOString() })
      .eq("id", contact.id);
  const conversationId = await conversationFor(
    config,
    String(contact.id),
    true,
  );
  const saved = await db()
    .from("messages")
    .upsert(
      {
        organization_id: config.organization_id,
        client_id: config.client_id,
        conversation_id: conversationId,
        contact_id: contact.id,
        provider_message_sid: messageSid,
        direction: "inbound",
        channel: "sms",
        from_number: from,
        to_number: to,
        body,
        status: "received",
        created_at: new Date().toISOString(),
      },
      { onConflict: "provider_message_sid" },
    );
  if (saved.error) throw new Error(saved.error.message);
  await runPublishedWorkflowsForEvent("sms.received", {
    organizationId: String(config.organization_id),
    clientId: String(config.client_id),
    eventId: `sms:${messageSid}:received`,
    contactId: String(contact.id),
    businessName: businessName(config),
    messageBody: body,
  });
  return xml();
}

export async function handleMessageStatus(request: Request) {
  const form = await verifiedForm(request);
  if (!form) return xml("<Response></Response>", 403);
  const sid = form.get("MessageSid") ?? "";
  const status = (
    form.get("MessageStatus") ??
    form.get("SmsStatus") ??
    "unknown"
  ).toLowerCase();
  const currentMessage = await db()
    .from("messages")
    .select("id,status")
    .eq("provider_message_sid", sid)
    .maybeSingle();
  if (currentMessage.error) throw new Error(currentMessage.error.message);
  if (!currentMessage.data?.id) return xml();

  const currentStatus = String(currentMessage.data.status ?? "unknown").toLowerCase();
  const terminalStatuses = new Set([
    "delivered",
    "failed",
    "undelivered",
    "canceled",
  ]);
  const statusRank: Record<string, number> = {
    unknown: 0,
    accepted: 1,
    queued: 1,
    sending: 1,
    sent: 2,
    delivered: 3,
    failed: 3,
    undelivered: 3,
    canceled: 3,
  };
  const shouldAdvance =
    currentStatus === status ||
    (!terminalStatuses.has(currentStatus) &&
      (statusRank[status] ?? 0) >= (statusRank[currentStatus] ?? 0));
  if (!shouldAdvance) return xml();

  const update: Row = {
    status,
    error_code: form.get("ErrorCode") || null,
    error_message: form.get("ErrorMessage") || null,
    updated_at: new Date().toISOString(),
  };
  if (status === "delivered") update.delivered_at = new Date().toISOString();
  const messageUpdate = await db()
    .from("messages")
    .update(update)
    .eq("id", currentMessage.data.id)
    .eq("status", currentMessage.data.status)
    .select("id")
    .maybeSingle();
  if (messageUpdate.error) throw new Error(messageUpdate.error.message);
  if (messageUpdate.data?.id) {
    const reviewUpdate: Row = { updated_at: new Date().toISOString() };
    if (status === "delivered") {
      reviewUpdate.status = "delivered";
      reviewUpdate.delivered_at = new Date().toISOString();
    } else if (status === "sent") {
      reviewUpdate.status = "sent";
    } else if (["failed", "undelivered", "canceled"].includes(status)) {
      reviewUpdate.status = "failed";
      reviewUpdate.failed_at = new Date().toISOString();
      reviewUpdate.error_code = form.get("ErrorCode") || null;
      reviewUpdate.error_message = form.get("ErrorMessage") || null;
    } else if (["accepted", "queued", "sending"].includes(status)) {
      reviewUpdate.status = "queued";
    }
    if (reviewUpdate.status) {
      const allowedReviewStatuses =
        reviewUpdate.status === "queued"
          ? ["sending", "reconciling", "queued"]
          : reviewUpdate.status === "sent"
            ? ["sending", "reconciling", "queued", "sent"]
            : reviewUpdate.status === "delivered"
              ? ["sending", "reconciling", "queued", "sent", "delivered"]
              : ["sending", "reconciling", "queued", "sent", "failed"];
      const reviewRequestUpdate = await db()
        .from("review_requests")
        .update(reviewUpdate)
        .eq("message_id", messageUpdate.data.id)
        .in("status", allowedReviewStatuses);
      if (reviewRequestUpdate.error) {
        console.error(
          "Twilio delivery status was saved, but the linked review request could not be updated.",
          reviewRequestUpdate.error,
        );
      }
    }
  }
  return xml();
}
