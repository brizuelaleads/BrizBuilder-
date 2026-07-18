"use client";

import { useState } from "react";
import type { CrmAutomationRule, CrmAutomationRun, CrmClient, CrmConversation, CrmMessage, CrmPhoneCall, CrmPhoneConfig } from "../../db/crm";
import { Badge } from "./ui";

type Mutate = (input: Record<string, unknown>, success: string) => Promise<void>;
const DEFAULT_MESSAGE = "Hi, this is {{business_name}}. Sorry we missed your call. How can we help? Reply STOP to unsubscribe.";

function ClientPicker({ clients, value, onChange }: { clients: CrmClient[]; value: string; onChange: (value: string) => void }) {
  return <label className="crm-phone-client-picker"><span>Business</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose a client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.businessName}</option>)}</select></label>;
}

function statusTone(value: string) {
  return value === "connected" || value === "approved" || value === "completed" ? "green" : value === "failed" || value === "rejected" ? "red" : "orange";
}

export function PhoneSystemView({ clients, configs, selectedClientId, mutate, canManage }: { clients: CrmClient[]; configs: CrmPhoneConfig[]; selectedClientId: string; mutate: Mutate; canManage: boolean }) {
  const [localClientId, setLocalClientId] = useState(clients[0]?.id ?? "");
  const clientId = selectedClientId !== "all" ? selectedClientId : localClientId;
  const config = configs.find((item) => item.clientId === clientId);
  const client = clients.find((item) => item.id === clientId);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await mutate({ action: "save_phone_settings", clientId, phoneNumber: form.get("phoneNumber"), forwardingNumber: form.get("forwardingNumber"), ringTimeoutSeconds: Number(form.get("ringTimeoutSeconds")), voicemailEnabled: form.get("voicemailEnabled") === "on", missedCallTextEnabled: form.get("missedCallTextEnabled") === "on", missedCallMessage: form.get("missedCallMessage"), cooldownMinutes: Number(form.get("cooldownMinutes")), a2pStatus: form.get("a2pStatus") }, "Phone system settings saved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save phone settings."); }
  }

  return <div className="crm-view crm-phone-view">
    <section className="crm-page-heading"><div><p>PHONE & TEXTING</p><h2>Phone System</h2><span>Forward calls, capture missed calls, and text customers from one client-owned number.</span></div><ClientPicker clients={clients} value={clientId} onChange={setLocalClientId} /></section>
    {!client ? <section className="crm-empty-state"><h3>Choose a business first</h3><p>Select the client whose phone line you want to connect.</p></section> : <>
      <section className="crm-phone-status-grid">
        <article><span>1</span><div><strong>Twilio account</strong><p>{config?.providerStatus === "connected" ? "Secure Cloudflare credentials found." : "Add secure Twilio credentials in Cloudflare."}</p></div><Badge tone={config?.providerStatus === "connected" ? "green" : "orange"}>{config?.providerStatus === "connected" ? "Connected" : "Setup needed"}</Badge></article>
        <article><span>2</span><div><strong>Business phone number</strong><p>{config?.phoneNumber ?? "Assign a Twilio number to this client."}</p></div><Badge tone={config?.phoneNumber ? "green" : "orange"}>{config?.phoneNumber ? "Ready" : "Needed"}</Badge></article>
        <article><span>3</span><div><strong>Texting registration</strong><p>US business texting requires approved registration.</p></div><Badge tone={statusTone(config?.a2pStatus ?? "not_started")}>{(config?.a2pStatus ?? "not_started").replaceAll("_", " ")}</Badge></article>
        <article><span>4</span><div><strong>Missed-call automation</strong><p>{config?.missedCallTextEnabled ? "Customers receive one safe follow-up text after a missed call." : "No automatic texts will be sent."}</p></div><Badge tone={config?.missedCallTextEnabled ? "green" : "neutral"}>{config?.missedCallTextEnabled ? "On" : "Off"}</Badge></article>
      </section>
      <div className="crm-phone-layout">
        <form className="crm-phone-settings" onSubmit={submit} key={`${clientId}-${config?.id ?? "new"}`}>
          <header><div><p>CLIENT PHONE SETUP</p><h3>{client.businessName}</h3></div><Badge tone="purple">Twilio</Badge></header>
          <div className="crm-form-grid"><label><span>Twilio phone number</span><input name="phoneNumber" defaultValue={config?.phoneNumber ?? ""} placeholder="+13125550123" disabled={!canManage} /><small>Include +1 and the full number.</small></label><label><span>Forward calls to</span><input name="forwardingNumber" defaultValue={config?.forwardingNumber ?? client.phone ?? ""} placeholder="+13125550123" disabled={!canManage} /><small>The business phone that should ring.</small></label><label><span>Ring for</span><select name="ringTimeoutSeconds" defaultValue={String(config?.ringTimeoutSeconds ?? 20)} disabled={!canManage}><option value="15">15 seconds</option><option value="20">20 seconds</option><option value="25">25 seconds</option><option value="30">30 seconds</option></select></label><label><span>A2P registration</span><select name="a2pStatus" defaultValue={config?.a2pStatus ?? "not_started"} disabled={!canManage}><option value="not_started">Not started</option><option value="in_progress">Submitted / in progress</option><option value="approved">Approved</option><option value="rejected">Needs correction</option></select></label></div>
          <label className="crm-switch-row"><span><strong>Voicemail fallback</strong><small>Keep the line ready for a voicemail step when no one answers.</small></span><input type="checkbox" name="voicemailEnabled" defaultChecked={config?.voicemailEnabled ?? true} disabled={!canManage} /></label>
          <label className="crm-switch-row"><span><strong>Missed-call text back</strong><small>Only activates after Twilio and A2P are ready.</small></span><input type="checkbox" name="missedCallTextEnabled" defaultChecked={config?.missedCallTextEnabled ?? false} disabled={!canManage} /></label>
          <label><span>Automatic message</span><textarea name="missedCallMessage" defaultValue={config?.missedCallMessage ?? DEFAULT_MESSAGE} rows={4} disabled={!canManage} /><small>Use {"{{business_name}}"} to insert the client name. Keep the STOP notice.</small></label>
          <label><span>Do not repeat for the same caller for</span><select name="cooldownMinutes" defaultValue={String(config?.cooldownMinutes ?? 20)} disabled={!canManage}><option value="20">20 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">24 hours</option></select></label>
          {error ? <p className="crm-inline-error">{error}</p> : null}<button className="crm-button-primary" disabled={!canManage || !clientId}>Save phone setup</button>
        </form>
        <aside className="crm-phone-help"><p>WHAT THE BUSINESS OWNER DOES</p><h3>Simple setup checklist</h3><ol><li><span>1</span><div><strong>Choose a number</strong><p>Buy a new Twilio number or decide which existing number to move.</p></div></li><li><span>2</span><div><strong>Tell us where calls should ring</strong><p>Enter the owner or office phone in “Forward calls to.”</p></div></li><li><span>3</span><div><strong>Complete texting registration</strong><p>Provide the legal business details and approve the exact opt-in wording.</p></div></li><li><span>4</span><div><strong>Test one call and one text</strong><p>We turn automation on only after both tests pass.</p></div></li></ol><div className="crm-webhook-box"><strong>Twilio webhook URLs</strong><code>.../api/twilio/voice</code><code>.../api/twilio/messages/incoming</code><small>The public gateway fills in the beginning of these URLs.</small></div></aside>
      </div>
    </>}
  </div>;
}

export function ConversationsView({ clients, conversations, messages, calls, selectedClientId, mutate }: { clients: CrmClient[]; conversations: CrmConversation[]; messages: CrmMessage[]; calls: CrmPhoneCall[]; selectedClientId: string; mutate: Mutate }) {
  const visible = conversations.filter((item) => selectedClientId === "all" || item.clientId === selectedClientId);
  const [activeId, setActiveId] = useState(visible[0]?.id ?? "");
  const effectiveActiveId = visible.some((item) => item.id === activeId) ? activeId : visible[0]?.id ?? "";
  const active = visible.find((item) => item.id === effectiveActiveId);
  const thread = messages.filter((item) => item.conversationId === effectiveActiveId);
  const missedCalls = calls.filter((call) => selectedClientId === "all" || call.clientId === selectedClientId).filter((call) => ["no-answer", "busy", "failed", "canceled"].includes(call.status));
  async function send(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!active) return; const form = new FormData(event.currentTarget); await mutate({ action: "send_sms", clientId: active.clientId, contactId: active.contactId, body: form.get("body") }, "Text message sent."); event.currentTarget.reset(); }
  return <div className="crm-view crm-phone-view"><section className="crm-page-heading"><div><p>SHARED INBOX</p><h2>Conversations</h2><span>Real calls and texts are separated by client, so one business never sees another business’s customers.</span></div><Badge tone="green">Live data only</Badge></section><section className="crm-conversation-metrics"><article><span>Open conversations</span><strong>{visible.length}</strong></article><article><span>Unread messages</span><strong>{visible.reduce((sum, item) => sum + item.unreadCount, 0)}</strong></article><article><span>Missed calls</span><strong>{missedCalls.length}</strong></article></section>{!visible.length ? <section className="crm-empty-state"><h3>No conversations yet</h3><p>After a real call or text reaches a connected client number, the conversation will appear here automatically.</p></section> : <div className="crm-live-inbox"><aside>{visible.map((item) => <button className={item.id === activeId ? "active" : ""} key={item.id} onClick={() => setActiveId(item.id)}><span>{item.contactName.slice(0, 2).toUpperCase()}</span><div><strong>{item.contactName}</strong><p>{item.contactPhone ?? "No phone"}</p><small>{clients.find((client) => client.id === item.clientId)?.businessName}</small></div>{item.unreadCount ? <b>{item.unreadCount}</b> : null}</button>)}</aside><section><header><div><strong>{active?.contactName}</strong><small>{active?.contactPhone}</small></div><Badge tone="green">SMS</Badge></header><div className="crm-live-messages">{thread.map((message) => <article className={message.direction} key={message.id}><p>{message.body}</p><small>{new Date(message.createdAt).toLocaleString()} · {message.status}</small></article>)}</div>{active ? <form onSubmit={send}><textarea name="body" required maxLength={1600} placeholder={`Text ${active.contactName}`} /><button className="crm-button-primary">Send</button></form> : null}</section></div>}</div>;
}

export function AutomationsView({ clients, rules, runs, configs, selectedClientId }: { clients: CrmClient[]; rules: CrmAutomationRule[]; runs: CrmAutomationRun[]; configs: CrmPhoneConfig[]; selectedClientId: string }) {
  const visibleRules = rules.filter((item) => selectedClientId === "all" || item.clientId === selectedClientId);
  const visibleRuns = runs.filter((item) => selectedClientId === "all" || item.clientId === selectedClientId);
  const completed = visibleRuns.filter((item) => item.status === "completed").length;
  return <div className="crm-view crm-phone-view"><section className="crm-page-heading"><div><p>FOLLOW-UP ENGINE</p><h2>Automations</h2><span>The first live workflow is missed-call text back. Its settings are controlled from Phone System.</span></div><Badge tone="purple">Run history enabled</Badge></section><section className="crm-conversation-metrics"><article><span>Enabled rules</span><strong>{visibleRules.filter((item) => item.enabled).length}</strong></article><article><span>Completed runs</span><strong>{completed}</strong></article><article><span>Failed runs</span><strong>{visibleRuns.filter((item) => item.status === "failed").length}</strong></article></section><section className="crm-automation-list">{visibleRules.map((rule) => { const config = configs.find((item) => item.clientId === rule.clientId); return <article key={rule.id}><div className="crm-automation-icon">MC</div><div><small>{clients.find((client) => client.id === rule.clientId)?.businessName}</small><h3>{rule.name}</h3><p>When an inbound call is missed, wait for provider confirmation, check opt-out and cooldown rules, then send one text and create a follow-up task.</p><span>{Number(rule.config.cooldownMinutes ?? config?.cooldownMinutes ?? 20)} minute cooldown</span></div><Badge tone={rule.enabled ? "green" : "neutral"}>{rule.enabled ? "Active" : "Off"}</Badge></article>; })}{!visibleRules.length ? <div className="crm-empty-state"><h3>No automation rule yet</h3><p>Save a client in Phone System to create its missed-call workflow.</p></div> : null}</section><section className="crm-run-history"><header><h3>Recent runs</h3><span>Provider events are stored once to prevent duplicate texts.</span></header>{visibleRuns.slice(0, 25).map((run) => <article key={run.id}><span className={`crm-run-dot ${run.status}`} /><div><strong>{clients.find((client) => client.id === run.clientId)?.businessName ?? "Client"}</strong><small>{run.triggerEventId}</small></div><Badge tone={statusTone(run.status)}>{run.status.replaceAll("_", " ")}</Badge><time>{new Date(run.startedAt).toLocaleString()}</time></article>)}{!visibleRuns.length ? <p className="crm-no-runs">No real automation runs yet.</p> : null}</section></div>;
}
