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
import type {
  CrmActivity,
  CrmAppointment,
  CrmLead,
  CrmNote,
  CrmStage,
  CrmTask,
} from "../../db/crm";
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

export function LeadDetail({
  lead,
  stages,
  notes,
  activities,
  tasks,
  appointments,
  mutate,
  onClose,
}: {
  lead: CrmLead;
  stages: CrmStage[];
  notes: CrmNote[];
  activities: CrmActivity[];
  tasks: CrmTask[];
  appointments: CrmAppointment[];
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
    )
      return;
    await mutate(
      { action: "archive_lead", leadId: lead.id },
      "Lead archived",
    );
    onClose();
  }

  return (
    <div
      className="crm-drawer-layer"
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget && onClose()
      }
    >
      <aside
        className="crm-lead-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Lead details for ${lead.firstName} ${lead.lastName}`}
      >
        <header>
          <div>
            <span className="crm-avatar crm-avatar-lg">
              {lead.firstName[0]}
              {lead.lastName[0]}
            </span>
            <div>
              <p>LEAD PROFILE</p>
              <h2>
                {lead.firstName} {lead.lastName}
              </h2>
              <span>
                {lead.serviceRequested} · {lead.clientName}
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close lead details">
            ×
          </button>
        </header>
        <div className="crm-drawer-actions">
          <a
            href={lead.phone ? `tel:${lead.phone}` : undefined}
            aria-disabled={!lead.phone}
          >
            Call customer
          </a>
          <a
            href={lead.email ? `mailto:${lead.email}` : undefined}
            aria-disabled={!lead.email}
          >
            Send email
          </a>
          <button
            type="button"
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
            Mark as won
          </button>
        </div>
        <div className="crm-drawer-scroll">
          <section className="crm-lead-summary">
            <div>
              <span>Pipeline stage</span>
              <select
                value={lead.stageId}
                onChange={(event) =>
                  void mutate(
                    {
                      action: "move_lead",
                      leadId: lead.id,
                      stageId: event.target.value,
                    },
                    "Pipeline stage updated",
                  )
                }
              >
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span>Status</span>
              <select
                value={lead.status}
                onChange={(event) =>
                  void mutate(
                    {
                      action: "update_lead",
                      leadId: lead.id,
                      status: event.target.value,
                    },
                    "Lead status updated",
                  )
                }
              >
                {leadStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </div>
            <div>
              <span>Lead score</span>
              <strong>{lead.leadScore}/100</strong>
            </div>
            <div>
              <span>Estimated value ($)</span>
              <EstimatedValueEditor
                key={`${lead.id}:${lead.estimatedValueCents}`}
                lead={lead}
                mutate={mutate}
              />
            </div>
          </section>

          <section className="crm-detail-grid">
            <article>
              <h3>Contact information</h3>
              <dl>
                <div>
                  <dt>Phone</dt>
                  <dd>{lead.phone ?? "Not provided"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{lead.email ?? "Not provided"}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>
                    {[lead.address, lead.city, lead.state, lead.zip]
                      .filter(Boolean)
                      .join(", ") || "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt>Consent</dt>
                  <dd>{lead.consentStatus}</dd>
                </div>
              </dl>
            </article>
            <article>
              <h3>Attribution</h3>
              <dl>
                <div>
                  <dt>Source</dt>
                  <dd>{lead.source}</dd>
                </div>
                <div>
                  <dt>Campaign</dt>
                  <dd>{lead.campaign ?? "Not captured"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{dateTime(lead.createdAt)}</dd>
                </div>
                <div>
                  <dt>Assigned to</dt>
                  <dd>{lead.assignedUser ?? "Unassigned"}</dd>
                </div>
              </dl>
            </article>
          </section>

          <section className="crm-message-card">
            <h3>Customer message</h3>
            <p>{lead.message || "No message was provided."}</p>
          </section>

          <section className="crm-ai-unavailable">
            <div>
              <span>AI</span>
              <div>
                <strong>AI lead summary</strong>
                <p>
                  Connect an AI provider before generating summaries. Every
                  external action still requires review.
                </p>
              </div>
            </div>
            <button disabled>Generate summary</button>
          </section>

          <section className="crm-related-grid">
            <article>
              <header>
                <h3>Tasks</h3>
                <Badge tone="neutral">{leadTasks.length}</Badge>
              </header>
              {leadTasks.map((task) => (
                <div key={task.id}>
                  <strong>{task.title}</strong>
                  <span>
                    {task.status.replaceAll("_", " ")} · {shortDate(task.dueAt)}
                  </span>
                </div>
              ))}
              {!leadTasks.length ? <p>No tasks for this lead.</p> : null}
            </article>
            <article>
              <header>
                <h3>Appointments</h3>
                <Badge tone="neutral">{leadAppointments.length}</Badge>
              </header>
              {leadAppointments.map((appointment) => (
                <div key={appointment.id}>
                  <strong>{appointment.serviceType}</strong>
                  <span>
                    {dateTime(appointment.startsAt)} · {appointment.status}
                  </span>
                </div>
              ))}
              {!leadAppointments.length ? (
                <p>No appointments for this lead.</p>
              ) : null}
            </article>
          </section>

          <section className="crm-timeline">
            <header>
              <h3>Activity timeline</h3>
              <span>{timeline.length} events</span>
            </header>
            <form onSubmit={(event) => void addNote(event)}>
              <textarea
                name="body"
                rows={3}
                placeholder="Add an internal note..."
                aria-label="Internal note"
                required
              />
              <button className="crm-button-primary">Add note</button>
            </form>
            {timeline.map((item) => (
              <div key={item.id}>
                <i className={item.type === "note" ? "crm-timeline-note" : ""} />
                <span>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  <small>{dateTime(item.time)}</small>
                </span>
              </div>
            ))}
          </section>

          <button
            type="button"
            className="crm-danger-link"
            onClick={() => void archive()}
          >
            Archive lead
          </button>
        </div>
      </aside>
    </div>
  );
}
