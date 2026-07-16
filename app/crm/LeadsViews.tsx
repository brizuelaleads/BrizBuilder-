"use client";

import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import type { CrmActivity, CrmLead, CrmNote, CrmStage, CrmTask, CrmAppointment } from "../../db/crm";
import { Badge, dateTime, EmptyState, money, shortDate } from "./ui";

type Mutate = (input: Record<string, unknown>, success: string) => Promise<void>;

function statusTone(status: string): "neutral" | "purple" | "green" | "orange" | "red" | "blue" {
  if (status === "WON") return "green";
  if (["LOST", "SPAM", "UNRESPONSIVE"].includes(status)) return "red";
  if (status === "NEW") return "purple";
  if (["QUALIFIED", "APPOINTMENT_BOOKED", "ESTIMATE_SENT"].includes(status)) return "blue";
  return "orange";
}

export function LeadsView({ leads, onOpenLead, onAddLead }: { leads: CrmLead[]; onOpenLead: (lead: CrmLead) => void; onAddLead: () => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [source, setSource] = useState("ALL");
  const sources = Array.from(new Set(leads.map((lead) => lead.source))).sort();
  const filtered = useMemo(() => leads.filter((lead) => {
    const haystack = `${lead.firstName} ${lead.lastName} ${lead.phone ?? ""} ${lead.email ?? ""} ${lead.serviceRequested} ${lead.clientName}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (status === "ALL" || lead.status === status) && (source === "ALL" || lead.source === source);
  }), [leads, query, status, source]);

  function exportCsv() {
    const header = ["First name", "Last name", "Phone", "Email", "Client", "Service", "Source", "Status", "Stage", "Estimated value", "Revenue", "Created"];
    const rows = filtered.map((lead) => [lead.firstName, lead.lastName, lead.phone ?? "", lead.email ?? "", lead.clientName, lead.serviceRequested, lead.source, lead.status, lead.stageName, String(lead.estimatedValueCents / 100), String(lead.finalRevenueCents / 100), lead.createdAt]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "brizuela-leads-export.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className="crm-view">
    <section className="crm-page-heading"><div><p>LEAD INBOX</p><h2>Leads</h2><span>Search, qualify, assign, and move every inquiry toward a booked job.</span></div><div><button className="crm-button-secondary" onClick={exportCsv}>Export CSV</button><button className="crm-button-primary" onClick={onAddLead}>+ Add Lead</button></div></section>
    <section className="crm-filterbar">
      <label className="crm-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone, email, or service" aria-label="Search leads" /></label>
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter leads by status"><option value="ALL">All statuses</option>{["NEW", "CONTACTED", "QUALIFIED", "APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON", "LOST", "SPAM", "UNRESPONSIVE"].map((item) => <option key={item}>{item}</option>)}</select>
      <select value={source} onChange={(event) => setSource(event.target.value)} aria-label="Filter leads by source"><option value="ALL">All sources</option>{sources.map((item) => <option key={item}>{item}</option>)}</select>
      <span>{filtered.length} results</span>
    </section>
    {filtered.length ? <section className="crm-table-panel"><table className="crm-table"><thead><tr><th>Lead</th><th>Client</th><th>Service</th><th>Source</th><th>Status</th><th>Value</th><th>Created</th></tr></thead><tbody>{filtered.map((lead) => <tr key={lead.id} onClick={() => onOpenLead(lead)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpenLead(lead)}><td><span className="crm-table-person"><i>{lead.firstName[0]}{lead.lastName[0]}</i><span><strong>{lead.firstName} {lead.lastName}</strong><small>{lead.phone ?? lead.email ?? "No contact method"}</small></span></span></td><td>{lead.clientName}</td><td>{lead.serviceRequested}</td><td>{lead.source}</td><td><Badge tone={statusTone(lead.status)}>{lead.status.replaceAll("_", " ")}</Badge></td><td>{money(lead.estimatedValueCents)}</td><td>{shortDate(lead.createdAt)}</td></tr>)}</tbody></table></section> : <EmptyState title="No leads match these filters" description="Clear a filter or add a new lead to get started." action={<button className="crm-button-primary" onClick={onAddLead}>Add Lead</button>} />}
  </div>;
}

export function PipelineView({ leads, stages, mutate, onOpenLead }: { leads: CrmLead[]; stages: CrmStage[]; mutate: Mutate; onOpenLead: (lead: CrmLead) => void }) {
  const [moving, setMoving] = useState("");

  async function move(leadId: string, stageId: string) {
    setMoving(leadId);
    try { await mutate({ action: "move_lead", leadId, stageId }, "Lead moved to the new stage"); } finally { setMoving(""); }
  }

  function drop(event: DragEvent<HTMLDivElement>, stageId: string) {
    event.preventDefault();
    const leadId = event.dataTransfer.getData("text/lead-id");
    if (leadId) void move(leadId, stageId);
  }

  return <div className="crm-view crm-pipeline-view">
    <section className="crm-page-heading"><div><p>SALES PIPELINE</p><h2>Pipeline</h2><span>Drag cards or use the stage selector. Every move is recorded in the lead timeline.</span></div><Badge tone="purple">{leads.length} active leads</Badge></section>
    <section className="crm-kanban" aria-label="Sales pipeline">
      {stages.map((stage) => {
        const stageLeads = leads.filter((lead) => lead.stageId === stage.id);
        const total = stageLeads.reduce((sum, lead) => sum + lead.estimatedValueCents, 0);
        return <div className="crm-kanban-column" key={stage.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, stage.id)}>
          <header style={{ borderTopColor: stage.color }}><div><strong>{stage.name}</strong><span>{stageLeads.length}</span></div><small>{money(total)} estimated</small></header>
          <div className="crm-kanban-cards">
            {stageLeads.map((lead) => <article key={lead.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/lead-id", lead.id)} className={moving === lead.id ? "crm-card-moving" : ""}>
              <button className="crm-kanban-card-main" onClick={() => onOpenLead(lead)}><span><strong>{lead.firstName} {lead.lastName}</strong><small>{lead.serviceRequested}</small></span><b>{money(lead.estimatedValueCents)}</b></button>
              <div><Badge tone={statusTone(lead.status)}>{lead.source}</Badge><span>Score {lead.leadScore}</span></div>
              <label><span className="sr-only">Move {lead.firstName} {lead.lastName}</span><select value={lead.stageId} disabled={moving === lead.id} onChange={(event) => void move(lead.id, event.target.value)}>{stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
            </article>)}
            {!stageLeads.length ? <p className="crm-kanban-empty">Drop a lead here</p> : null}
          </div>
        </div>;
      })}
    </section>
  </div>;
}

export function LeadDetail({ lead, stages, notes, activities, tasks, appointments, mutate, onClose }: { lead: CrmLead; stages: CrmStage[]; notes: CrmNote[]; activities: CrmActivity[]; tasks: CrmTask[]; appointments: CrmAppointment[]; mutate: Mutate; onClose: () => void }) {
  const leadNotes = notes.filter((note) => note.leadId === lead.id);
  const leadActivities = activities.filter((activity) => activity.leadId === lead.id);
  const leadTasks = tasks.filter((task) => task.leadId === lead.id);
  const leadAppointments = appointments.filter((appointment) => appointment.leadId === lead.id);
  const timeline = [
    ...leadActivities.map((item) => ({ id: item.id, time: item.occurredAt, title: item.title, detail: item.detail ?? item.type, type: "activity" })),
    ...leadNotes.map((item) => ({ id: item.id, time: item.createdAt, title: "Note added", detail: item.body, type: "note" })),
  ].sort((a, b) => b.time.localeCompare(a.time));

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = String(form.get("body") ?? "").trim();
    if (!body) return;
    await mutate({ action: "add_note", leadId: lead.id, body }, "Note added to the timeline");
    event.currentTarget.reset();
  }

  async function archive() {
    if (!window.confirm(`Archive ${lead.firstName} ${lead.lastName}? The record will be removed from active views but retained for audit history.`)) return;
    await mutate({ action: "archive_lead", leadId: lead.id }, "Lead archived");
    onClose();
  }

  return <div className="crm-drawer-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="crm-lead-drawer" role="dialog" aria-modal="true" aria-label={`Lead details for ${lead.firstName} ${lead.lastName}`}>
      <header><div><span className="crm-avatar crm-avatar-lg">{lead.firstName[0]}{lead.lastName[0]}</span><div><p>LEAD PROFILE</p><h2>{lead.firstName} {lead.lastName}</h2><span>{lead.serviceRequested} · {lead.clientName}</span></div></div><button onClick={onClose} aria-label="Close lead details">×</button></header>
      <div className="crm-drawer-actions"><a href={lead.phone ? `tel:${lead.phone}` : undefined} aria-disabled={!lead.phone}>Call Customer</a><a href={lead.email ? `mailto:${lead.email}` : undefined} aria-disabled={!lead.email}>Send Email</a><button onClick={() => void mutate({ action: "update_lead", leadId: lead.id, status: "WON", finalRevenueCents: lead.finalRevenueCents || lead.estimatedValueCents }, "Lead marked as won")}>Mark as Won</button></div>
      <div className="crm-drawer-scroll">
        <section className="crm-lead-summary"><div><span>Pipeline stage</span><select value={lead.stageId} onChange={(event) => void mutate({ action: "move_lead", leadId: lead.id, stageId: event.target.value }, "Pipeline stage updated")}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div><div><span>Status</span><select value={lead.status} onChange={(event) => void mutate({ action: "update_lead", leadId: lead.id, status: event.target.value }, "Lead status updated")}>{["NEW", "CONTACTED", "QUALIFIED", "APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON", "LOST", "SPAM", "UNRESPONSIVE"].map((status) => <option key={status}>{status}</option>)}</select></div><div><span>Lead score</span><strong>{lead.leadScore}/100</strong></div><div><span>Estimated value</span><strong>{money(lead.estimatedValueCents)}</strong></div></section>
        <section className="crm-detail-grid"><article><h3>Contact information</h3><dl><div><dt>Phone</dt><dd>{lead.phone ?? "Not provided"}</dd></div><div><dt>Email</dt><dd>{lead.email ?? "Not provided"}</dd></div><div><dt>Address</dt><dd>{[lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ") || "Not provided"}</dd></div><div><dt>Consent</dt><dd>{lead.consentStatus}</dd></div></dl></article><article><h3>Attribution</h3><dl><div><dt>Source</dt><dd>{lead.source}</dd></div><div><dt>Campaign</dt><dd>{lead.campaign ?? "Not captured"}</dd></div><div><dt>Created</dt><dd>{dateTime(lead.createdAt)}</dd></div><div><dt>Assigned to</dt><dd>{lead.assignedUser ?? "Unassigned"}</dd></div></dl></article></section>
        <section className="crm-message-card"><h3>Customer message</h3><p>{lead.message || "No message was provided."}</p></section>
        <section className="crm-ai-unavailable"><div><span>AI</span><div><strong>AI lead summary</strong><p>Unavailable until an AI provider is connected. No automatic decision will be made without review.</p></div></div><button disabled>Generate summary</button></section>
        <section className="crm-related-grid"><article><header><h3>Tasks</h3><Badge tone="neutral">{leadTasks.length}</Badge></header>{leadTasks.map((task) => <div key={task.id}><strong>{task.title}</strong><span>{task.status.replaceAll("_", " ")} · {shortDate(task.dueAt)}</span></div>)}{!leadTasks.length ? <p>No tasks for this lead.</p> : null}</article><article><header><h3>Appointments</h3><Badge tone="neutral">{leadAppointments.length}</Badge></header>{leadAppointments.map((appointment) => <div key={appointment.id}><strong>{appointment.serviceType}</strong><span>{dateTime(appointment.startsAt)} · {appointment.status}</span></div>)}{!leadAppointments.length ? <p>No appointments for this lead.</p> : null}</article></section>
        <section className="crm-timeline"><header><h3>Activity timeline</h3><span>{timeline.length} events</span></header><form onSubmit={(event) => void addNote(event)}><textarea name="body" rows={3} placeholder="Add an internal note..." aria-label="Internal note" required /><button className="crm-button-primary">Add Note</button></form>{timeline.map((item) => <div key={item.id}><i className={item.type === "note" ? "crm-timeline-note" : ""} /><span><strong>{item.title}</strong><p>{item.detail}</p><small>{dateTime(item.time)}</small></span></div>)}</section>
        <button className="crm-danger-link" onClick={() => void archive()}>Archive lead</button>
      </div>
    </aside>
  </div>;
}
