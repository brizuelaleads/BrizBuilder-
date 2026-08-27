"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
} from "react";
import {
  Activity as ActivityIcon,
  Award,
  Check,
  ChevronDown,
  ClipboardList,
  FileText,
  Mail,
  MapPin,
  MessageCircle,
  NotebookPen,
  Pencil,
  Phone,
  ShieldCheck,
  X,
} from "lucide-react";
import type {
  CrmActivity,
  CrmCall,
  CrmAppointment,
  CrmLead,
  CrmNote,
  CrmStage,
  CrmTask,
} from "../../db/crm";
import { parseCallTranscript } from "../../lib/callrail-transcript";
import { Badge, dateTime, EmptyState, money, shortDate } from "./ui";

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

function statusClassName(status: string) {
  return `is-${status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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
          <button className="crm-button-primary" onClick={onAddLead}>
            + Add lead
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
  const lines = parseCallTranscript(call.transcript);

  return (
    <section className="crm-lead-section-card crm-lead-transcript-card">
      <header className="crm-lead-section-heading">
        <div>
          <span>{index === 0 ? "Latest call" : `Earlier call ${index + 1}`}</span>
          <h3>Call transcript</h3>
        </div>
        <p>Read-only transcript view</p>
      </header>

      <div className="crm-lead-call-meta">
        <div>
          <span>Call started</span>
          <strong>{dateTime(call.startedAt)}</strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>{formatCallDuration(call.durationSeconds)}</strong>
        </div>
        <div>
          <span>Recording</span>
          <strong>{call.recordingAvailable ? "Available" : "Unavailable"}</strong>
        </div>
      </div>

      {call.recordingAvailable ? (
        <audio
          className="crm-lead-recording"
          controls
          preload="none"
          src={`/api/callrail/recordings/${encodeURIComponent(
            call.callrailCallId,
          )}?clientId=${encodeURIComponent(lead.clientId)}`}
        >
          Your browser cannot play this recording.
        </audio>
      ) : null}

      {call.callSummary ? (
        <div className="crm-lead-call-summary">
          <strong>Call summary</strong>
          <p>{call.callSummary}</p>
        </div>
      ) : null}

      {lines.length ? (
        <div className="crm-lead-conversation">
          {lines.map((line, lineIndex) => (
            <article
              aria-label={`${line.speaker} message`}
              className={line.role}
              key={`${lineIndex}-${line.role}-${line.text.slice(0, 20)}`}
            >
              {line.role !== "agent" ? (
                <span>{line.role === "caller" ? initials.slice(0, 1) : "T"}</span>
              ) : null}
              <div>
                <strong>{line.speaker}</strong>
                <p>{line.text}</p>
              </div>
              {line.role === "agent" ? <span>A</span> : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="crm-lead-empty-tab compact">
          <MessageCircle aria-hidden="true" />
          <h3>Transcript unavailable</h3>
          <p>This call does not have a transcript yet.</p>
        </div>
      )}
    </section>
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
  const [activeTab, setActiveTab] = useState<LeadDetailTab>("overview");
  const tabListRef = useRef<HTMLElement | null>(null);
  const activeStageIndex = stages.findIndex((stage) => stage.id === lead.stageId);
  const activeStageName =
    stages.find((stage) => stage.id === lead.stageId)?.name ?? "Unassigned";
  const primaryTask =
    leadTasks.find((task) => task.status !== "COMPLETED") ?? leadTasks[0];
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
    const form = new FormData(event.currentTarget);
    const body = String(form.get("body") ?? "").trim();
    if (!body) return;
    await mutate(
      { action: "add_note", leadId: lead.id, body },
      "Note added to the timeline",
    );
    event.currentTarget.reset();
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
    { id: "overview", label: "Overview", icon: ClipboardList },
    { id: "activity", label: "Activity", icon: ActivityIcon },
    { id: "notes", label: "Notes", icon: NotebookPen, count: leadNotes.length },
    { id: "tasks", label: "Tasks", icon: Check, count: leadTasks.length },
    { id: "files", label: "Files", icon: FileText },
    {
      id: "transcript",
      label: "Transcript",
      icon: MessageCircle,
      count: leadCalls.length,
    },
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
    <div
      className="crm-lead-page-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="crm-lead-page"
        role="dialog"
        aria-modal="true"
        aria-label={`Lead details for ${displayName}`}
      >
        <div className="crm-lead-page-shell">
          <header className="crm-lead-page-toolbar">
            <div className="crm-lead-toolbar-title">
              <button
                type="button"
                className="crm-lead-back"
                onClick={onClose}
                aria-label="Close lead"
                title="Close lead"
              >
                <X aria-hidden="true" />
              </button>
              <strong>{lead.serviceRequested || lead.source || "Lead"}</strong>
            </div>
            <div className="crm-lead-toolbar-actions">
              <button
                type="button"
                className="crm-lead-won-button"
                disabled={lead.status === "WON"}
                onClick={() =>
                  void mutate(
                    {
                      action: "update_lead",
                      leadId: lead.id,
                      status: "WON",
                      finalRevenueCents:
                        lead.finalRevenueCents || lead.estimatedValueCents,
                    },
                    "Lead marked as won",
                  )
                }
              >
                <Award aria-hidden="true" />
                <span>Mark as won</span>
              </button>
              <button
                type="button"
                className="crm-lead-edit-button"
                onClick={() => {
                  setActiveTab("overview");
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLInputElement>(
                        ".crm-lead-value-inline input",
                      )
                      ?.focus(),
                  );
                }}
              >
                <Pencil aria-hidden="true" />
                Edit lead
              </button>
              <details className="crm-lead-status-menu">
                <summary>
                  <span>Change status</span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div>
                  {leadStatuses.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={status === lead.status ? "active" : ""}
                      onClick={(event) => {
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        void mutate(
                          {
                            action: "update_lead",
                            leadId: lead.id,
                            status,
                          },
                          "Lead status updated",
                        );
                      }}
                    >
                      <i aria-hidden="true" />
                      {humanizeLeadValue(status)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="danger"
                    onClick={(event) => {
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                      void archive();
                    }}
                  >
                    Archive lead
                  </button>
                </div>
              </details>
            </div>
          </header>

          <section className="crm-lead-identity-card">
            <div className="crm-lead-identity">
              <span className="crm-lead-avatar">{leadInitials}</span>
              <div>
                <div className="crm-lead-title-line">
                  <h2>{displayName}</h2>
                  <span
                    className={`crm-lead-current-status ${statusClassName(lead.status)}`}
                  >
                    <i aria-hidden="true" />
                    {humanizeLeadValue(lead.status)}
                  </span>
                </div>
                <strong>{lead.clientName}</strong>
                <p>Added {dateTime(lead.createdAt)}</p>
              </div>
            </div>
            <div className="crm-lead-contact-actions" aria-label="Contact lead">
              <a
                className="primary"
                href={lead.phone ? `tel:${lead.phone}` : undefined}
                aria-disabled={!lead.phone}
                aria-label="Call lead"
                title="Call lead"
              >
                <Phone aria-hidden="true" />
              </a>
              <a
                className="primary"
                href={lead.phone ? `sms:${lead.phone}` : undefined}
                aria-disabled={!lead.phone}
                aria-label="Text lead"
                title="Text lead"
              >
                <MessageCircle aria-hidden="true" />
              </a>
              <a
                href={lead.email ? `mailto:${lead.email}` : undefined}
                aria-disabled={!lead.email}
                aria-label="Email lead"
                title="Email lead"
              >
                <Mail aria-hidden="true" />
              </a>
            </div>
          </section>

          <section className="crm-lead-fact-bar" aria-label="Lead summary">
            <div>
              <span>Last contact</span>
              <strong>
                {lead.lastContactedAt ? dateTime(lead.lastContactedAt) : "Never"}
              </strong>
            </div>
            <div className="crm-lead-value-inline">
              <span>Est. value</span>
              <strong>
                <span aria-hidden="true">$</span>
                <EstimatedValueEditor
                  key={`${lead.id}:${lead.estimatedValueCents}`}
                  lead={lead}
                  mutate={mutate}
                />
              </strong>
            </div>
            <div className="crm-lead-score-inline">
              <span>Lead score</span>
              <strong>{lead.leadScore}<small>/100</small></strong>
              <i
                aria-hidden="true"
                style={{ "--lead-score": `${lead.leadScore}%` } as CSSProperties}
              />
            </div>
          </section>

          <nav ref={tabListRef} className="crm-lead-tabs" aria-label="Lead details">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? "active" : ""}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon aria-hidden="true" />
                  <span>{tab.label}</span>
                  {"count" in tab && tab.count ? <small>{tab.count}</small> : null}
                </button>
              );
            })}
          </nav>

          <main className="crm-lead-tab-content" role="tabpanel">
            {activeTab === "overview" ? (
              <div className="crm-lead-overview">
                <section className="crm-lead-section-card crm-lead-contact-card">
                  <h3>Contact &amp; attribution</h3>
                  <div className="crm-lead-contact-layout">
                    <div className="crm-lead-contact-list">
                      <div>
                        <Phone aria-hidden="true" />
                        <p>
                          <a href={lead.phone ? `tel:${lead.phone}` : undefined}>
                            {formatLeadPhone(lead.phone)}
                          </a>
                          <span>Phone</span>
                        </p>
                      </div>
                      <div>
                        <Mail aria-hidden="true" />
                        <p>
                          <a href={lead.email ? `mailto:${lead.email}` : undefined}>
                            {lead.email ?? "Not provided"}
                          </a>
                          <span>Email</span>
                        </p>
                      </div>
                      <div>
                        <MapPin aria-hidden="true" />
                        <p>
                          <strong>
                            {[lead.address, lead.city, lead.state, lead.zip]
                              .filter(Boolean)
                              .join(", ") || "Not provided"}
                          </strong>
                          <span>Address</span>
                        </p>
                      </div>
                      <div>
                        <ShieldCheck aria-hidden="true" />
                        <p>
                          <strong>{humanizeLeadValue(lead.consentStatus)}</strong>
                          <span>Consent</span>
                        </p>
                      </div>
                    </div>
                    <dl className="crm-lead-attribution-list">
                      <div><dt>Source</dt><dd>{lead.source}</dd></div>
                      <div><dt>Campaign</dt><dd>{lead.campaign ?? "Not captured"}</dd></div>
                      <div><dt>Created</dt><dd>{dateTime(lead.createdAt)}</dd></div>
                      <div><dt>Assigned to</dt><dd>{lead.assignedUser ?? "Unassigned"}</dd></div>
                    </dl>
                  </div>
                </section>

                <section className="crm-lead-section-card crm-lead-message-card">
                  <MessageCircle aria-hidden="true" />
                  <div>
                    <h3>Customer message</h3>
                    <p>{lead.message || "No message was provided."}</p>
                  </div>
                </section>

                <section className="crm-lead-section-card crm-lead-progress-card">
                  <h3>Lead progress</h3>
                  <div
                    className="crm-lead-progress-track"
                    aria-label={`Pipeline progress: ${activeStageName}`}
                    style={
                      {
                        "--lead-stage-count": Math.max(stages.length, 1),
                      } as CSSProperties
                    }
                  >
                    {stages.map((stage, index) => (
                      <button
                        key={stage.id}
                        type="button"
                        className={
                          index === activeStageIndex
                            ? "active"
                            : index < activeStageIndex
                              ? "complete"
                              : ""
                        }
                        aria-current={index === activeStageIndex ? "step" : undefined}
                        aria-label={`Move lead to ${stage.name}`}
                        onClick={() =>
                          void mutate(
                            {
                              action: "move_lead",
                              leadId: lead.id,
                              stageId: stage.id,
                            },
                            "Pipeline stage updated",
                          )
                        }
                      >
                        <i aria-hidden="true">{index + 1}</i>
                        <span>{stage.name}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="crm-lead-followup-card">
                  <span><Phone aria-hidden="true" /></span>
                  <div>
                    <strong>
                      {primaryTask?.title ?? `Follow up with ${displayName}`}
                    </strong>
                    <p>
                      Outbound call
                      {primaryTask ? ` · Due ${shortDate(primaryTask.dueAt)}` : ""}
                    </p>
                  </div>
                  <div className="crm-lead-followup-actions">
                    <a
                      href={lead.phone ? `tel:${lead.phone}` : undefined}
                      aria-disabled={!lead.phone}
                    >
                      Call now
                    </a>
                    <button
                      type="button"
                      onClick={() => setActiveTab("tasks")}
                      aria-label="View lead tasks"
                      title="View lead tasks"
                    >
                      <ChevronDown aria-hidden="true" />
                    </button>
                  </div>
                </section>

                <section className="crm-lead-related-grid crm-lead-reference-extras">
                  <article className="crm-lead-section-card">
                    <header><h3>Tasks</h3><Badge tone="neutral">{leadTasks.length}</Badge></header>
                    {leadTasks.slice(0, 3).map((task) => (
                      <div key={task.id}>
                        <strong>{task.title}</strong>
                        <span>{humanizeLeadValue(task.status)} · {shortDate(task.dueAt)}</span>
                      </div>
                    ))}
                    {!leadTasks.length ? <p>No tasks for this lead.</p> : null}
                    {leadTasks.length > 3 ? (
                      <button type="button" onClick={() => setActiveTab("tasks")}>View all tasks</button>
                    ) : null}
                  </article>
                  <article className="crm-lead-section-card">
                    <header><h3>Appointments</h3><Badge tone="neutral">{leadAppointments.length}</Badge></header>
                    {leadAppointments.slice(0, 3).map((appointment) => (
                      <div key={appointment.id}>
                        <strong>{appointment.serviceType}</strong>
                        <span>{dateTime(appointment.startsAt)} · {humanizeLeadValue(appointment.status)}</span>
                      </div>
                    ))}
                    {!leadAppointments.length ? <p>No appointments for this lead.</p> : null}
                  </article>
                </section>
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
                    <div className="crm-lead-empty-tab"><Phone /><h3>No tracked calls</h3><p>CallRail calls associated with this lead will appear here.</p></div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </main>

        </div>
      </section>
    </div>
  );
}
