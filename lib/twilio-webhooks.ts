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

async function configForNumber(number: string) {
  const { data, error } = await db()
    .from("phone_system_configs")
    .select("*,clients(business_name)")
    .eq("phone_number", number)
    .eq("provider", "twilio")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Row | null;
}

async function findOrCreateContact(config: Row, from: string) {
  const organizationId = String(config.organization_id);
  const clientId = String(config.client_id);
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
  const config = await configForNumber(to);
  if (
    !config ||
    config.provider_status !== "connected" ||
    !config.forwarding_number
  )
    return xml(
      "<Response><Say>This phone line is not configured yet.</Say></Response>",
    );
  const contact = await findOrCreateContact(config, from);
  const upsert = await db()
    .from("phone_calls")
    .upsert(
      {
        organization_id: config.organization_id,
        client_id: config.client_id,
        contact_id: contact.id,
        provider_call_sid: callSid,
        direction: "inbound",
        from_number: from,
        to_number: to,
        forwarded_to: config.forwarding_number,
        status: "ringing",
        started_at: new Date().toISOString(),
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
  const config = await configForNumber(to);
  if (!config) return xml();
  const contact = await findOrCreateContact(config, from);
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
        provider_call_sid: callSid,
        direction: "inbound",
        from_number: from,
        to_number: to,
        forwarded_to: config.forwarding_number,
        status: callStatus,
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

export async function handleIncomingMessage(request: Request) {
  const form = await verifiedForm(request);
  if (!form) return xml("<Response></Response>", 403);
  const from = form.get("From") ?? "";
  const to = form.get("To") ?? "";
  const body = (form.get("Body") ?? "").slice(0, 1600);
  const messageSid = form.get("MessageSid") || form.get("SmsSid") || "";
  const config = await configForNumber(to);
  if (!config) return xml();
  const contact = await findOrCreateContact(config, from);
  const normalized = body
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (SMS_STOP_WORDS.has(normalized))
    await db()
      .from("contacts")
      .update({
        marketing_consent: "opt_out",
        last_interaction_at: new Date().toISOString(),
      })
      .eq("id", contact.id);
  else
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
  const status =
    form.get("MessageStatus") ?? form.get("SmsStatus") ?? "unknown";
  const update: Row = {
    status,
    error_code: form.get("ErrorCode") || null,
    error_message: form.get("ErrorMessage") || null,
    updated_at: new Date().toISOString(),
  };
  if (status === "delivered") update.delivered_at = new Date().toISOString();
  await db().from("messages").update(update).eq("provider_message_sid", sid);
  return xml();
}
