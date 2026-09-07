"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  PhoneCall,
  PhoneMissed,
  X,
} from "lucide-react";
import type {
  CrmCall,
  CrmClient,
  CrmLead,
  CrmPhoneNumber,
} from "../../db/crm";
import {
  callNeedsFollowUp,
  isAnsweredCall,
  isInboundCall,
  isMissedCall,
} from "../../lib/call-attention";
import { CallTranscriptCard } from "./CallTranscriptCard";

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;
type CallFilter = "all" | "follow-up" | "missed" | "answered" | "inbound" | "outbound";

function phone(value: string | null) {
  if (!value) return "Not available";
  const digits = value.replace(/\D/gu, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10
    ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
    : value;
}

function when(value: string | null) {
  if (!value) return "Unknown time";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Unknown time"
    : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function duration(seconds: number | null) {
  if (seconds == null || seconds < 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function initials(value: string) {
  return value
    .split(/\s+/u)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "C";
}

export function CallsView({
  calls,
  allCalls,
  leads,
  clients,
  phoneNumbers,
  mutate,
  onOpenLead,
  initialFollowUpOnly = false,
  onExitFollowUps,
}: {
  calls: CrmCall[];
  allCalls: CrmCall[];
  leads: CrmLead[];
  clients: CrmClient[];
  phoneNumbers: CrmPhoneNumber[];
  mutate: Mutate;
  onOpenLead: (lead: CrmLead) => void;
  initialFollowUpOnly?: boolean;
  onExitFollowUps?: () => void;
}) {
  const [filter, setFilter] = useState<CallFilter>(initialFollowUpOnly ? "follow-up" : "all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const ordered = useMemo(
    () => [...calls].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")),
    [calls],
  );
  const missed = ordered.filter(isMissedCall);
  const answered = ordered.filter(isAnsweredCall);
  const needingFollowUp = missed.filter((call) => callNeedsFollowUp(call, allCalls));
  const durations = answered
    .map((call) => call.durationSeconds)
    .filter((value): value is number => value != null && value >= 0);
  const averageDuration = durations.length
    ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
    : null;
  const visible = ordered.filter((call) => {
    if (filter === "follow-up") return callNeedsFollowUp(call, allCalls);
    if (filter === "missed") return isMissedCall(call);
    if (filter === "answered") return isAnsweredCall(call);
    if (filter === "inbound") return isInboundCall(call);
    if (filter === "outbound") return !isInboundCall(call);
    return true;
  });
  const selected = ordered.find((call) => call.id === selectedId) ?? null;

  const leadFor = (call: CrmCall) =>
    call.leadId ? leads.find((lead) => lead.id === call.leadId) ?? null : null;
  const customerFor = (call: CrmCall) => {
    const lead = leadFor(call);
    return call.customerName?.trim() ||
      (lead ? `${lead.firstName} ${lead.lastName}`.trim() : "") ||
      "Unknown caller";
  };
  const numberFor = (call: CrmCall) =>
    phoneNumbers.find((number) => number.id === call.businessPhoneNumberId);

  async function callBack(call: CrmCall) {
    setBusyId(call.id);
    setError("");
    try {
      await mutate(
        { action: "place_outbound_call", callId: call.id },
        `Calling ${customerFor(call)} from the number they contacted.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The callback could not be started.");
    } finally {
      setBusyId(null);
    }
  }

  async function markHandled(call: CrmCall) {
    setBusyId(call.id);
    setError("");
    try {
      await mutate(
        { action: "mark_call_handled", callId: call.id },
        "Missed call marked handled.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The call could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="crm-view crm-calls-view">
      <section className="crm-page-heading">
        <div>
          <p>UNIFIED PHONE HISTORY</p>
          <h2>Calls</h2>
          <span>Every connected business number, organized in one place.</span>
        </div>
        {needingFollowUp.length ? (
          <div className="crm-calls-attention"><PhoneMissed /><strong>{needingFollowUp.length}</strong><span>need follow-up</span></div>
        ) : null}
      </section>

      <section className="crm-call-metrics" aria-label="Call summary">
        <article><PhoneCall /><span>Total calls</span><strong>{ordered.length}</strong><small>Selected period</small></article>
        <article className="missed"><PhoneMissed /><span>Missed calls</span><strong>{missed.length}</strong><small>Inbound calls not answered</small></article>
        <article><CheckCircle2 /><span>Answered calls</span><strong>{answered.length}</strong><small>{ordered.length ? `${Math.round((answered.length / ordered.length) * 100)}% answer rate` : "No calls yet"}</small></article>
        <article className={needingFollowUp.length ? "attention" : ""}><Clock3 /><span>Need follow-up</span><strong>{needingFollowUp.length}</strong><small>{averageDuration == null ? "No average yet" : `${duration(averageDuration)} average call`}</small></article>
      </section>

      <section className="crm-calls-history">
        {initialFollowUpOnly ? <div className="crm-report-note"><p>Follow-ups include all loaded history for this workspace, regardless of the dashboard date filter.</p><button type="button" className="crm-button-secondary" onClick={onExitFollowUps}>Back to selected period</button></div> : null}
        <header>
          <div><p>CALL HISTORY</p><h3>All connected numbers</h3></div>
          <div className="crm-calls-filters" role="group" aria-label="Filter calls">
            {(["all", "follow-up", "missed", "answered", "inbound", "outbound"] as CallFilter[]).map((item) => (
              <button key={item} type="button" className={filter === item ? "active" : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item === "follow-up" ? "Needs follow-up" : item}</button>
            ))}
          </div>
        </header>
        {error ? <p className="crm-inline-error">{error}</p> : null}
        {visible.length ? (
          <div className="crm-calls-table-wrap">
            <table className="crm-calls-table">
              <thead><tr><th>Caller</th><th>Direction</th><th>Status</th><th>Business number</th><th>Time</th><th>Duration</th><th>Lead</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {visible.map((call) => {
                  const lead = leadFor(call);
                  const businessNumber = numberFor(call);
                  const missedAttention = callNeedsFollowUp(call, allCalls);
                  return (
                    <tr key={call.id} className={missedAttention ? "needs-attention" : ""}>
                      <td><button className="crm-call-open" type="button" onClick={() => setSelectedId(call.id)}><span>{initials(customerFor(call))}</span><strong>{customerFor(call)}</strong><small>{phone(call.customerPhone)}</small></button></td>
                      <td><span className="crm-call-direction">{isInboundCall(call) ? <ArrowDownLeft /> : <ArrowUpRight />}{isInboundCall(call) ? "Inbound" : "Outbound"}</span></td>
                      <td><span className={`crm-call-list-status ${isMissedCall(call) ? "missed" : isAnsweredCall(call) ? "answered" : "pending"}`}>{isMissedCall(call) ? "Missed" : isAnsweredCall(call) ? "Answered" : call.status.replaceAll("-", " ")}</span></td>
                      <td><strong>{businessNumber?.displayName ?? phone(call.trackingPhoneNumber)}</strong><small>{businessNumber ? phone(businessNumber.phoneNumber) : ""}</small></td>
                      <td>{when(call.startedAt)}</td>
                      <td>{duration(call.durationSeconds)}</td>
                      <td>{lead ? <button className="crm-call-lead-link" type="button" onClick={() => onOpenLead(lead)}>{lead.firstName} {lead.lastName}</button> : "—"}</td>
                      <td><button className="crm-call-back" type="button" disabled={!call.customerPhone || busyId === call.id} onClick={() => void callBack(call)}>{busyId === call.id ? "Starting…" : "Call back"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="crm-calls-empty"><PhoneCall /><h3>No calls in this view</h3><p>Calls from connected phone numbers will appear here automatically.</p></div>
        )}
      </section>

      {selected ? (
        <div className="crm-call-detail-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}>
          <aside className="crm-call-detail" role="dialog" aria-modal="true" aria-label="Call details">
            <header><div><p>CALL DETAIL</p><h2>{customerFor(selected)}</h2><span>{phone(selected.customerPhone)}</span></div><button type="button" onClick={() => setSelectedId(null)} aria-label="Close call details"><X /></button></header>
            <div className="crm-call-detail-actions"><button className="crm-button-primary" type="button" disabled={!selected.customerPhone || busyId === selected.id} onClick={() => void callBack(selected)}><PhoneCall />{busyId === selected.id ? "Starting call…" : "Call back"}</button>{callNeedsFollowUp(selected, allCalls) ? <button className="crm-button-secondary" type="button" disabled={busyId === selected.id} onClick={() => void markHandled(selected)}>Mark handled</button> : null}</div>
            <dl className="crm-call-detail-facts">
              <div><dt>Direction</dt><dd>{isInboundCall(selected) ? "Inbound" : "Outbound"}</dd></div>
              <div><dt>Status</dt><dd>{isMissedCall(selected) ? "Missed" : isAnsweredCall(selected) ? "Answered" : selected.status}</dd></div>
              <div><dt>Business number</dt><dd>{numberFor(selected)?.displayName ?? phone(selected.trackingPhoneNumber)}<small>{phone(numberFor(selected)?.phoneNumber ?? selected.trackingPhoneNumber)}</small></dd></div>
              <div><dt>Call time</dt><dd>{when(selected.startedAt)}</dd></div>
              <div><dt>Duration</dt><dd>{duration(selected.durationSeconds)}</dd></div>
              <div><dt>Associated lead</dt><dd>{leadFor(selected) ? <button type="button" onClick={() => onOpenLead(leadFor(selected)!)}>{leadFor(selected)!.firstName} {leadFor(selected)!.lastName}</button> : "No lead linked"}</dd></div>
            </dl>
            <CallTranscriptCard call={selected} clientId={selected.clientId} customerInitials={initials(customerFor(selected))} eyebrow="Selected call" />
          </aside>
        </div>
      ) : null}
      <span className="sr-only">{clients.length} businesses in this workspace</span>
    </div>
  );
}
