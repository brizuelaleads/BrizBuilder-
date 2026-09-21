"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
} from "react";
import {
  Activity as ActivityIcon,
  Award,
  ChevronDown,
  CalendarDays,
  Check,
  FileText,
  Mail,
  MessageCircle,
  NotebookPen,
  Phone,
  X,
} from "lucide-react";
import type {
  CrmActivity,
  CrmCall,
  CrmAppointment,
  CrmLead,
  CrmMetaAdInsight,
  CrmNote,
  CrmStage,
  CrmTask,
} from "../../db/crm";
import { Badge, dateTime, EmptyState, money, shortDate } from "./ui";
import { CallTranscriptCard } from "./CallTranscriptCard";

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;

const leadStatuses = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "APPOINTMENT_BOOKED",
  "ESTIMATE_SENT",
  "WON",
  "LOST",
  "SPAM",
  "UNRESPONSIVE",
];

function statusTone(
  status: string,
): "neutral" | "purple" | "green" | "orange" | "red" | "blue" {
  if (status === "WON") return "green";
  if (["LOST", "SPAM", "UNRESPONSIVE"].includes(status)) return "red";
  if (status === "NEW") return "purple";
  if (
    ["QUALIFIED", "APPOINTMENT_BOOKED", "ESTIMATE_SENT"].includes(status)
  )
    return "blue";
  return "orange";
}

function LeadsViewSwitcher({
  active,
  onShowList,
  onShowPipeline,
}: {
  active: "list" | "pipeline";
  onShowList: () => void;
  onShowPipeline: () => void;
}) {
  return (
    <div className="crm-view-switcher" aria-label="Lead workspace view">
      <button
        type="button"
        className={active === "list" ? "active" : ""}
        aria-pressed={active === "list"}
        onClick={onShowList}
      >
        List
      </button>
      <button
        type="button"
        className={active === "pipeline" ? "active" : ""}
        aria-pressed={active === "pipeline"}
        onClick={onShowPipeline}
      >
        Pipeline
      </button>
    </div>
  );
}

export function LeadsView({
  leads,
  onOpenLead,
  onAddLead,
  onShowPipeline,
  mutate,
}: {
  leads: CrmLead[];
  onOpenLead: (lead: CrmLead) => void;
  onAddLead: () => void;
  onShowPipeline: () => void;
  mutate: Mutate;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [source, setSource] = useState("ALL");
  const sources = Array.from(new Set(leads.map((lead) => lead.source))).sort();
  const filtered = useMemo(
    () =>
      leads.filter((lead) => {
        const haystack =
          `${lead.firstName} ${lead.lastName} ${lead.phone ?? ""} ${
            lead.email ?? ""
          } ${lead.serviceRequested} ${lead.clientName}`.toLowerCase();
        return (
          haystack.includes(query.toLowerCase()) &&
          (status === "ALL" || lead.status === status) &&
          (source === "ALL" || lead.source === source)
        );
      }),
    [leads, query, status, source],
  );
  const pipelineValue = leads
    .filter((lead) => !["WON", "LOST", "SPAM"].includes(lead.status))
    .reduce((sum, lead) => sum + lead.estimatedValueCents, 0);
  const wonValue = leads
    .filter((lead) => lead.status === "WON")
    .reduce((sum, lead) => sum + lead.finalRevenueCents, 0);

  async function deleteLead(event: MouseEvent, lead: CrmLead) {
    event.stopPropagation();
    if (
      !window.confirm(
        `Delete this lead for ${lead.firstName} ${lead.lastName}? This permanently removes the lead. The contact stays in Contacts.`,
      )
    )
      return;
    await mutate(
      { action: "delete_lead", leadId: lead.id },
      "Lead deleted",
    );
  }

  function exportCsv() {
    const header = [
      "First name",
      "Last name",
      "Phone",
      "Email",
      "Client",
      "Service",
      "Source",
      "Status",
      "Stage",
      "Estimated value",
      "Revenue",
      "Created",
    ];
    const rows = filtered.map((lead) => [
      lead.firstName,
      lead.lastName,
      lead.phone ?? "",
      lead.email ?? "",
      lead.clientName,
      lead.serviceRequested,
      lead.source,
      lead.status,
      lead.stageName,
      String(lead.estimatedValueCents / 100),
      String(lead.finalRevenueCents / 100),
      lead.createdAt,
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "brizbuilder-leads-export.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="crm-view crm-leads-workspace">
      <section className="crm-page-heading crm-leads-heading">
        <div>
          <p>CRM</p>
          <h2>Leads</h2>
          <span>
            Qualify every inquiry and keep the next action visible.
          </span>
        </div>
        <div>
          <button className="crm-button-secondary" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </section>

      <LeadsViewSwitcher
        active="list"
        onShowList={() => undefined}
        onShowPipeline={onShowPipeline}
      />

      <section className="crm-lead-summary-strip" aria-label="Lead summary">
        <article>
          <span>Total leads</span>
          <strong>{leads.length}</strong>
        </article>
        <article>
          <span>New</span>
          <strong>{leads.filter((lead) => lead.status === "NEW").length}</strong>
        </article>
        <article>
          <span>Open pipeline</span>
          <strong>{money(pipelineValue, true)}</strong>
        </article>
        <article>
          <span>Won revenue</span>
          <strong>{money(wonValue, true)}</strong>
        </article>
      </section>

      <section className="crm-filterbar crm-leads-toolbar">
        <label className="crm-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, phone, email, or service"
            aria-label="Search leads"
          />
        </label>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Filter leads by status"
        >
          <option value="ALL">All statuses</option>
          {leadStatuses.map((item) => (
            <option key={item}>{item.replaceAll("_", " ")}</option>
          ))}
        </select>
        <select
          value={source}
          onChange={(event) => setSource(event.target.value)}
          aria-label="Filter leads by source"
        >
          <option value="ALL">All sources</option>
          {sources.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <span>{filtered.length} results</span>
      </section>

      {filtered.length ? (
        <section className="crm-table-panel">
          <table className="crm-table crm-leads-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Client</th>
                <th>Service</th>
                <th>Source</th>
                <th>Status</th>
                <th>Value</th>
                <th>Created</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr key={lead.id}>
                  <td data-label="Lead">
                    <button
                      type="button"
                      className="crm-lead-open"
                      onClick={() => onOpenLead(lead)}
                    >
                      <span className="crm-table-person">
                        <i>
                          {lead.firstName[0]}
                          {lead.lastName[0]}
                        </i>
                        <span>
                          <strong>
                            {lead.firstName} {lead.lastName}
                          </strong>
                          <small>
                            {lead.phone ??
                              lead.email ??
                              "No contact method"}
                          </small>
                        </span>
                      </span>
                    </button>
                  </td>
                  <td data-label="Client">{lead.clientName}</td>
                  <td data-label="Service">{lead.serviceRequested}</td>
                  <td data-label="Source">{lead.source}</td>
                  <td data-label="Status">
                    <Badge tone={statusTone(lead.status)}>
                      {lead.status.replaceAll("_", " ")}
                    </Badge>
                  </td>
                  <td data-label="Value">{money(lead.estimatedValueCents)}</td>
                  <td data-label="Created">{shortDate(lead.createdAt)}</td>
                  <td data-label="Actions" className="crm-lead-actions">
                    <button
                      type="button"
                      className="crm-row-action"
                      onClick={(event) => void deleteLead(event, lead)}
                      aria-label={`Delete ${lead.firstName} ${lead.lastName}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <EmptyState
          title="No leads match these filters"
          description="Clear a filter or add a new lead to get started."
          action={
            <button className="crm-button-primary" onClick={onAddLead}>
              Add lead
            </button>
          }
        />
      )}
    </div>
  );
}

export function PipelineView({
  leads,
  stages,
  mutate,
  onOpenLead,
  onShowList,
}: {
  leads: CrmLead[];
  stages: CrmStage[];
  mutate: Mutate;
  onOpenLead: (lead: CrmLead) => void;
  onShowList: () => void;
}) {
  const [moving, setMoving] = useState("");
  const totalValue = leads.reduce(
    (sum, lead) => sum + lead.estimatedValueCents,
    0,
  );

  async function move(leadId: string, stageId: string) {
    setMoving(leadId);
    try {
      await mutate(
        { action: "move_lead", leadId, stageId },
        "Lead moved to the new stage",
      );
    } finally {
      setMoving("");
    }
  }

  function drop(event: DragEvent<HTMLDivElement>, stageId: string) {
    event.preventDefault();
    const leadId = event.dataTransfer.getData("text/lead-id");
    if (leadId) void move(leadId, stageId);
  }

  return (
    <div className="crm-view crm-pipeline-view crm-leads-workspace">
      <section className="crm-page-heading crm-leads-heading">
        <div>
          <p>CRM</p>
          <h2>Leads</h2>
          <span>
            Move opportunities forward without losing the next action.
          </span>
        </div>
        <Badge tone="purple">
          {leads.length} leads · {money(totalValue, true)}
        </Badge>
      </section>

      <LeadsViewSwitcher
        active="pipeline"
        onShowList={onShowList}
        onShowPipeline={() => undefined}
      />

      <p className="crm-pipeline-hint">Swipe to view every pipeline stage.</p>
      <section className="crm-kanban" aria-label="Sales pipeline">
        {stages.map((stage) => {
          const stageLeads = leads.filter(
            (lead) => lead.stageId === stage.id,
          );
          const total = stageLeads.reduce(
            (sum, lead) => sum + lead.estimatedValueCents,
            0,
          );
          return (
            <div
              className="crm-kanban-column"
              key={stage.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => drop(event, stage.id)}
            >
              <header>
                <div>
                  <strong>
                    <i
                      className="crm-stage-dot"
                      style={{ backgroundColor: stage.color }}
                    />
                    {stage.name}
                  </strong>
                  <span>{stageLeads.length}</span>
                </div>
                <small>{money(total)} estimated</small>
              </header>
              <div className="crm-kanban-cards">
                {stageLeads.map((lead) => (
                  <article
                    key={lead.id}
                    draggable
                    aria-busy={moving === lead.id}
                    onDragStart={(event) =>
                      event.dataTransfer.setData("text/lead-id", lead.id)
                    }
                    className={
                      moving === lead.id ? "crm-card-moving" : ""
                    }
                  >
                    <button
                      type="button"
                      className="crm-kanban-card-main"
                      onClick={() => onOpenLead(lead)}
                    >
                      <span>
                        <strong>
                          {lead.firstName} {lead.lastName}
                        </strong>
                        <small>{lead.serviceRequested}</small>
                      </span>
                      <b>{money(lead.estimatedValueCents)}</b>
                    </button>
                    <div>
                      <Badge tone={statusTone(lead.status)}>
                        {lead.source}
                      </Badge>
                      <span>Score {lead.leadScore}</span>
                    </div>
                    <label>
                      <span className="sr-only">
                        Move {lead.firstName} {lead.lastName}
                      </span>
                      <select
                        value={lead.stageId}
                        disabled={moving === lead.id}
                        onChange={(event) =>
                          void move(lead.id, event.target.value)
                        }
                      >
                        {stages.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </article>
                ))}
                {!stageLeads.length ? (
                  <p className="crm-kanban-empty">Drop a lead here</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function parseDollarsToCents(raw: string): number | null {
  const dollars = Number(raw);
  if (
    raw.trim() === "" ||
    !Number.isFinite(dollars) ||
    dollars < 0 ||
    dollars > 1_000_000
  ) {
    return null;
  }
  return Math.round(dollars * 100);
}

function EstimatedValueEditor({
  lead,
  mutate,
}: {
  lead: CrmLead;
  mutate: Mutate;
}) {
  const initialDollars =
    lead.estimatedValueCents % 100 === 0
      ? String(lead.estimatedValueCents / 100)
      : (lead.estimatedValueCents / 100).toFixed(2);
  const [value, setValue] = useState(initialDollars);
  const [busy, setBusy] = useState(false);
  // Closing the drawer (backdrop mousedown, ×, Escape) can unmount this input
  // before the browser fires blur, which would silently drop the edit. Track
  // the live edit in a ref so the unmount cleanup below can still commit it.
  const pending = useRef({
    value: initialDollars,
    savedCents: lead.estimatedValueCents,
    mutate,
  });
  useEffect(() => {
    pending.current.value = value;
    pending.current.mutate = mutate;
  });

  async function save() {
    const nextCents = parseDollarsToCents(value);
    if (nextCents === null || nextCents === pending.current.savedCents) {
      setValue(initialDollars);
      return;
    }
    pending.current.savedCents = nextCents;
    setBusy(true);
    try {
      await mutate(
        {
          action: "update_lead",
          leadId: lead.id,
          estimatedValueCents: nextCents,
        },
        "Estimated value updated",
      );
    } catch {
      // mutate already surfaced the error banner; allow a retry.
      pending.current.savedCents = lead.estimatedValueCents;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const leadId = lead.id;
    const pendingRef = pending;
    return () => {
      const { value: raw, savedCents, mutate: commit } = pendingRef.current;
      const nextCents = parseDollarsToCents(raw);
      if (nextCents !== null && nextCents !== savedCents) {
        void commit(
          { action: "update_lead", leadId, estimatedValueCents: nextCents },
          "Estimated value updated",
        ).catch(() => undefined);
      }
    };
  }, [lead.id]);

  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      max={1_000_000}
      step="0.01"
      value={value}
      disabled={busy}
      aria-label="Estimated value in dollars"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setValue(initialDollars);
      }}
    />
  );
}

type LeadDetailTab =
  | "overview"
  | "activity"
  | "notes"
  | "tasks"
  | "files"
  | "transcript";

function formatLeadPhone(value: string | null) {
  if (!value) return "Not provided";
  const digits = value.replace(/\D/gu, "");
  const local =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length === 10) {
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return value;
}

function humanizeLeadValue(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^\w/u, (letter) => letter.toUpperCase());
}

function formatCallDuration(seconds: number | null) {
  if (seconds == null || seconds < 0) return "Unknown";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function LeadTranscriptCard({
  call,
  lead,
  initials,
  index,
}: {
  call: CrmCall;
  lead: CrmLead;
  initials: string;
  index: number;
}) {
  const transcriptScope = {
    recordingCallId: call.callrailCallId,
    clientId: lead.clientId,
  };
  return (
    <CallTranscriptCard
      call={call}
      clientId={transcriptScope.clientId}
      customerInitials={initials}
      eyebrow={index === 0 ? "Latest call" : `Earlier call ${index + 1}`}
    />
  );
}

export function LeadDetail({
  lead,
  stages,
  notes,
  activities,
  tasks,
  appointments,
  calls,
  metaAdInsights,
  mutate,
  onClose,
}: {
  lead: CrmLead;
  stages: CrmStage[];
  notes: CrmNote[];
  activities: CrmActivity[];
  tasks: CrmTask[];
  appointments: CrmAppointment[];
  calls: CrmCall[];
  metaAdInsights: CrmMetaAdInsight[];
  mutate: Mutate;
  onClose: () => void;
}) {
  const leadNotes = notes.filter((note) => note.leadId === lead.id);
  const leadActivities = activities.filter(
    (activity) => activity.leadId === lead.id,
  );
  const leadTasks = tasks.filter((task) => task.leadId === lead.id);
  const leadAppointments = appointments.filter(
    (appointment) => appointment.leadId === lead.id,
  );
  const leadCalls = calls.filter((call) => call.leadId === lead.id)
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  // The ad this lead came from, resolved from the campaign id its click
  // carried. The newest row wins so a campaign renamed in Ads Manager shows its
  // current name rather than whatever it was called on the day of the click.
  const metaAd = lead.metaCampaignId
    ? metaAdInsights
        .filter((insight) => insight.campaignId === lead.metaCampaignId)
        .sort((first, second) => second.date.localeCompare(first.date))[0] ??
      null
    : null;
  const latestCall = leadCalls[0] ?? null;
  const [activeTab, setActiveTab] = useState<LeadDetailTab>("overview");
  const tabListRef = useRef<HTMLElement | null>(null);
  const primaryTask =
    leadTasks.find((task) => task.status !== "COMPLETED");
  const timeline = [
    ...leadActivities.map((item) => ({
      id: item.id,
      time: item.occurredAt,
      title: item.title,
      detail: item.detail ?? item.type,
      type: "activity",
    })),
    ...leadNotes.map((item) => ({
      id: item.id,
      time: item.createdAt,
      title: "Note added",
      detail: item.body,
      type: "note",
    })),
  ].sort((a, b) => b.time.localeCompare(a.time));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  useEffect(() => {
    const list = tabListRef.current;
    const active = list?.querySelector<HTMLElement>("button.active");
    if (!list || !active) return;
    list.scrollLeft = active.offsetLeft - (list.clientWidth - active.clientWidth) / 2;
  }, [activeTab]);

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = String(form.get("body") ?? "").trim();
    if (!body) return;
    await mutate(
      { action: "add_note", leadId: lead.id, body },
      "Note added to the timeline",
    );
    formElement.reset();
  }

  async function archive() {
    if (
      !window.confirm(
        `Archive ${lead.firstName} ${lead.lastName}? The record will be removed from active views but retained for audit history.`,
      )
    ) {
      return;
    }
    await mutate(
      { action: "archive_lead", leadId: lead.id },
      "Lead archived",
    );
    onClose();
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "notes", label: "Notes", count: leadNotes.length },
    { id: "transcript", label: "Calls", count: leadCalls.length },
    { id: "tasks", label: "Tasks", count: leadTasks.length },
    { id: "activity", label: "Activity" },
    { id: "files", label: "Files" },
  ] as const;
  const displayName =
    [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown lead";
  const leadInitials =
    [lead.firstName, lead.lastName]
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase())
      .join("")
      .slice(0, 2) || "L";

  return (
    <div className="lead-record-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="lead-record" role="dialog" aria-modal="true" aria-label={`Lead details for ${displayName}`}>
        <header className="lead-record-header">
          <div className="lead-record-heading">
            <p>{lead.clientName} <span aria-hidden="true">/</span> Lead</p>
            <h2>{displayName}</h2>
            <span className="lead-record-status">{humanizeLeadValue(lead.status)}</span>
          </div>
          <button type="button" className="lead-record-close" onClick={onClose} aria-label="Close lead"><X aria-hidden="true" /></button>
        </header>
        <div className="lead-record-contact-bar">
          <span>{lead.phone ? formatLeadPhone(lead.phone) : lead.email || "No contact information"}</span>
          <div>
            <a className="lead-record-call" href={lead.phone ? `tel:${lead.phone}` : undefined} aria-disabled={!lead.phone}><Phone aria-hidden="true" />Call</a>
            <a href={lead.phone ? `sms:${lead.phone}` : undefined} aria-disabled={!lead.phone}><MessageCircle aria-hidden="true" />Text</a>
            {lead.email ? <a href={`mailto:${lead.email}`}><Mail aria-hidden="true" />Email</a> : null}
          </div>
        </div>
        <nav ref={tabListRef} className="lead-record-nav" aria-label="Lead sections">
          {tabs.map((tab) => <button type="button" key={tab.id} className={activeTab === tab.id ? "active" : ""} aria-current={activeTab === tab.id ? "page" : undefined} onClick={() => setActiveTab(tab.id)}>{tab.label}{"count" in tab && tab.count ? <span>{tab.count}</span> : null}</button>)}
        </nav>
        <main className="lead-record-content" aria-label={activeTab === "transcript" ? "Calls" : activeTab}>
          {activeTab === "overview" ? (
            <div className="lead-record-overview">
              <section className="lead-record-section lead-record-request">
                <header><h3>Customer request</h3>{lead.serviceRequested ? <span>{lead.serviceRequested}</span> : null}</header>
                <p>{lead.message || "No customer message recorded yet."}</p>
                {leadCalls.length ? <button className="lead-record-link" type="button" onClick={() => setActiveTab("transcript")}>Read call transcripts <span aria-hidden="true">&rarr;</span></button> : null}
              </section>

              <section className="lead-record-section">
                <header><h3>Contact details</h3></header>
                <dl className="lead-record-facts">
                  <div><dt>Phone</dt><dd>{lead.phone ? <a href={`tel:${lead.phone}`}>{formatLeadPhone(lead.phone)}</a> : <span className="lead-record-missing">Not provided</span>}</dd></div>
                  <div><dt>Email</dt><dd>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : <span className="lead-record-missing">Not provided</span>}</dd></div>
                  <div><dt>Address</dt><dd>{[lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ") || <span className="lead-record-missing">Not provided</span>}</dd></div>
                  <div><dt>Last contact</dt><dd>{lead.lastContactedAt ? dateTime(lead.lastContactedAt) : <span className="lead-record-missing">No contact recorded</span>}</dd></div>
                </dl>
              </section>

              <section className="lead-record-section">
                <header><h3>Appointment &amp; follow-up</h3></header>
                {lead.appointmentStart ? <div className="lead-record-appointment"><CalendarDays aria-hidden="true" /><div><strong>{dateTime(lead.appointmentStart)}</strong><span>{humanizeLeadValue(lead.appointmentStatus) || "Scheduled"}</span></div></div> : <p className="lead-record-missing">No appointment scheduled.</p>}
                {primaryTask ? <div className="lead-record-followup"><div><span>Next task &middot; {shortDate(primaryTask.dueAt)}</span><strong>{primaryTask.title}</strong></div><button type="button" className="lead-record-secondary" onClick={() => setActiveTab("tasks")}>View task</button></div> : null}
                {leadAppointments.length ? <details className="lead-record-disclosure"><summary>Appointment history <span>{leadAppointments.length}</span><ChevronDown aria-hidden="true" /></summary><div className="lead-record-appointment-history">{leadAppointments.map((appointment) => <div key={appointment.id}><strong>{appointment.serviceType}</strong><span>{dateTime(appointment.startsAt)} &middot; {humanizeLeadValue(appointment.status)}</span></div>)}</div></details> : null}
              </section>

              <section className="lead-record-section">
                <header><h3>Lead management</h3><span>Keep this opportunity up to date</span></header>
                <div className="lead-record-fields">
                  <label>Status<select value={lead.status} onChange={(event) => void mutate({ action: "update_lead", leadId: lead.id, status: event.target.value, ...(event.target.value === "WON" ? { finalRevenueCents: lead.finalRevenueCents || lead.estimatedValueCents } : {}) }, "Lead status updated")}>
                    {leadStatuses.map((status) => <option key={status} value={status}>{humanizeLeadValue(status)}</option>)}
                  </select></label>
                  <label>Pipeline stage<select value={lead.stageId ?? ""} onChange={(event) => void mutate({ action: "move_lead", leadId: lead.id, stageId: event.target.value }, "Pipeline stage updated")}>
                    {!stages.some((stage) => stage.id === lead.stageId) ? <option value={lead.stageId ?? ""} disabled>Unassigned</option> : null}
                    {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                  </select></label>
                  <label>Estimated value<span className="lead-record-money"><span aria-hidden="true">$</span><EstimatedValueEditor key={`${lead.id}:${lead.estimatedValueCents}`} lead={lead} mutate={mutate} /></span></label>
                  <div className="lead-record-assignee"><span>Assigned to</span><strong>{lead.assignedUser?.trim() || "Unassigned"}</strong></div>
                </div>
                <div className="lead-record-management-footer"><span>Lead score <strong>{lead.leadScore}<span> / 100</span></strong></span><button type="button" className="lead-record-secondary" disabled={lead.status === "WON"} onClick={() => void mutate({ action: "update_lead", leadId: lead.id, status: "WON", finalRevenueCents: lead.finalRevenueCents || lead.estimatedValueCents }, "Lead marked as won")}><Award aria-hidden="true" />{lead.status === "WON" ? "Won" : "Mark as won"}</button></div>
              </section>

              <details className="lead-record-section lead-record-disclosure">
                <summary>Source &amp; tracking <span>{lead.source}</span><ChevronDown aria-hidden="true" /></summary>
                <dl className="lead-record-facts">
                  <div><dt>Source</dt><dd>{lead.source}</dd></div>
                  <div><dt>Campaign</dt><dd>{metaAd?.campaignName || lead.campaign || "Not captured"}</dd></div>
                  {lead.metaCampaignId ? <div><dt>Meta ad</dt><dd>{metaAd?.adName || "Awaiting next ad sync"}</dd></div> : null}
                  <div><dt>Tracking number</dt><dd>{latestCall ? formatLeadPhone(latestCall.trackingPhoneNumber) : "Not provided"}</dd></div>
                  <div><dt>Number called</dt><dd>{latestCall ? formatLeadPhone(latestCall.businessPhoneNumber) : "Not provided"}</dd></div>
                  <div><dt>Latest call</dt><dd>{latestCall ? `${latestCall.answered === true ? "Answered" : latestCall.answered === false ? "Missed" : "Unknown"} - ${formatCallDuration(latestCall.durationSeconds)}` : "No tracked calls"}</dd></div>
                  <div><dt>Consent</dt><dd>{humanizeLeadValue(lead.consentStatus)}</dd></div>
                  <div><dt>First contact</dt><dd>{dateTime(lead.firstContactedAt ?? lead.createdAt)}</dd></div>
                  <div><dt>Added</dt><dd>{dateTime(lead.createdAt)}</dd></div>
                  {!lead.appointmentStart ? <div><dt>Appointment status</dt><dd>{humanizeLeadValue(lead.appointmentStatus) || "Not set"}</dd></div> : null}
                </dl>
              </details>
              <footer className="lead-record-footer"><span>Added {dateTime(lead.createdAt)}</span><button type="button" className="lead-record-link lead-record-archive" onClick={() => void archive()}>Archive lead</button></footer>
            </div>
          ) : null}
            {activeTab === "activity" ? (
              <section className="crm-lead-section-card crm-lead-activity-panel">
                <header className="crm-lead-section-heading">
                  <div><span>History</span><h3>Activity timeline</h3></div>
                  <p>{timeline.length} event{timeline.length === 1 ? "" : "s"}</p>
                </header>
                {timeline.length ? (
                  <div className="crm-lead-timeline-list">
                    {timeline.map((item) => (
                      <article key={item.id}>
                        <i className={item.type === "note" ? "note" : ""} />
                        <div>
                          <strong>{item.title}</strong>
                          <p>{item.detail}</p>
                          <time>{dateTime(item.time)}</time>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="crm-lead-empty-tab"><ActivityIcon /><h3>No activity yet</h3><p>Lead events will appear here as your team works this opportunity.</p></div>
                )}
              </section>
            ) : null}

            {activeTab === "notes" ? (
              <section className="crm-lead-section-card crm-lead-notes-panel">
                <header className="crm-lead-section-heading">
                  <div><span>Internal only</span><h3>Notes</h3></div>
                  <p>{leadNotes.length} note{leadNotes.length === 1 ? "" : "s"}</p>
                </header>
                <form onSubmit={(event) => void addNote(event)}>
                  <textarea name="body" rows={4} placeholder="Add an internal note…" aria-label="Internal note" required />
                  <button className="crm-button-primary">Add note</button>
                </form>
                <div className="crm-lead-note-list">
                  {leadNotes.map((note) => (
                    <article key={note.id}>
                      <NotebookPen aria-hidden="true" />
                      <div><p>{note.body}</p><time>{dateTime(note.createdAt)}</time></div>
                    </article>
                  ))}
                  {!leadNotes.length ? (
                    <div className="crm-lead-empty-tab compact"><NotebookPen /><h3>No notes yet</h3><p>Add context your team should know about this lead.</p></div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {activeTab === "tasks" ? (
              <section className="crm-lead-section-card">
                <header className="crm-lead-section-heading">
                  <div><span>Follow-up</span><h3>Tasks</h3></div>
                  <p>{leadTasks.length} task{leadTasks.length === 1 ? "" : "s"}</p>
                </header>
                {leadTasks.length ? (
                  <div className="crm-lead-task-list">
                    {leadTasks.map((task) => (
                      <article key={task.id}>
                        <button
                          type="button"
                          className={task.status === "COMPLETED" ? "complete" : ""}
                          onClick={() =>
                            void mutate(
                              { action: "toggle_task", taskId: task.id },
                              task.status === "COMPLETED" ? "Task reopened" : "Task completed",
                            )
                          }
                          aria-label={task.status === "COMPLETED" ? `Reopen ${task.title}` : `Complete ${task.title}`}
                        ><Check aria-hidden="true" /></button>
                        <div><strong>{task.title}</strong><p>Due {shortDate(task.dueAt)}</p></div>
                        <Badge tone={task.status === "COMPLETED" ? "green" : "neutral"}>{humanizeLeadValue(task.status)}</Badge>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="crm-lead-empty-tab"><Check /><h3>No tasks yet</h3><p>Tasks connected to this lead will appear here.</p></div>
                )}
              </section>
            ) : null}

            {activeTab === "files" ? (
              <section className="crm-lead-section-card">
                <div className="crm-lead-empty-tab"><FileText /><h3>No files attached</h3><p>Quotes, photos, and signed documents will appear here when file storage is connected.</p></div>
              </section>
            ) : null}

            {activeTab === "transcript" ? (
              <div className="crm-lead-transcripts">
                {leadCalls.map((call, index) => (
                  <LeadTranscriptCard
                    key={call.id}
                    call={call}
                    lead={lead}
                    initials={leadInitials}
                    index={index}
                  />
                ))}
                {!leadCalls.length ? (
                  <section className="crm-lead-section-card">
                    <div className="crm-lead-empty-tab"><Phone /><h3>No tracked calls</h3><p>Calls associated with this lead will appear here.</p></div>
                  </section>
                ) : null}
              </div>
            ) : null}
        </main>
      </section>
    </div>
  );
}
