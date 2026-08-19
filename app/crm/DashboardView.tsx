"use client";

import { CalendarDays, ListChecks } from "lucide-react";
import type { CrmAppointment, CrmLead, CrmTask } from "../../db/crm";
import { Badge, dateTime, money } from "./ui";

type DashboardDestination =
  | "leads"
  | "pipeline"
  | "calendar"
  | "tasks";

function timestamp(value: string | null) {
  if (!value) return 0;
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function displayStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateKey(value: string) {
  const parsed = timestamp(value);
  return parsed
    ? new Date(parsed).toISOString().slice(0, 10)
    : value.slice(0, 10);
}

function timeOnly(value: string) {
  const parsed = timestamp(value);
  if (!parsed) return value;
  return new Date(parsed).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function leadInitials(lead: CrmLead) {
  return `${lead.firstName[0] ?? ""}${lead.lastName[0] ?? ""}` || "L";
}

function DashboardEmpty({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="crm-dashboard-calm-empty">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function DashboardView({
  leads,
  pipelineLeads,
  appointments,
  tasks,
  generatedAt,
  onOpenLead,
  onNavigate,
}: {
  leads: CrmLead[];
  pipelineLeads: CrmLead[];
  appointments: CrmAppointment[];
  tasks: CrmTask[];
  generatedAt: string;
  onOpenLead: (lead: CrmLead) => void;
  onNavigate: (view: DashboardDestination) => void;
}) {
  const won = leads.filter((lead) => lead.status === "WON");
  const newLeads = leads.filter((lead) => lead.status === "NEW");
  const revenue = won.reduce(
    (sum, lead) => sum + lead.finalRevenueCents,
    0,
  );
  const booked = leads.filter((lead) =>
    ["APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON"].includes(lead.status),
  ).length;
  const closeRate = leads.length
    ? Math.round((won.length / leads.length) * 100)
    : 0;

  const generatedAtTimestamp = timestamp(generatedAt);
  const currentDateKey = dateKey(generatedAt);
  const todayAppointments = appointments
    .filter(
      (appointment) =>
        appointment.status !== "CANCELED" &&
        dateKey(appointment.startsAt) === currentDateKey,
    )
    .sort(
      (first, second) =>
        timestamp(first.startsAt) - timestamp(second.startsAt),
    );
  const upcomingAppointments = appointments
    .filter(
      (appointment) =>
        appointment.status !== "CANCELED" &&
        dateKey(appointment.startsAt) > currentDateKey,
    )
    .sort(
      (first, second) =>
        timestamp(first.startsAt) - timestamp(second.startsAt),
    );

  const openTasks = tasks
    .filter((task) => !["COMPLETED", "CANCELED"].includes(task.status))
    .sort((first, second) => {
      if (!first.dueAt && !second.dueAt) return 0;
      if (!first.dueAt) return 1;
      if (!second.dueAt) return -1;
      return timestamp(first.dueAt) - timestamp(second.dueAt);
    });
  const pastDueTasks = openTasks.filter(
    (task) =>
      task.dueAt && timestamp(task.dueAt) < generatedAtTimestamp,
  );
  const followUpsDue = pipelineLeads.filter(
    (lead) =>
      !["WON", "LOST", "SPAM", "UNRESPONSIVE"].includes(lead.status) &&
      lead.nextFollowUpAt &&
      timestamp(lead.nextFollowUpAt) <= generatedAtTimestamp,
  );
  const workspaceNewLeads = pipelineLeads.filter(
    (lead) => lead.status === "NEW",
  );
  const quotes = pipelineLeads.filter(
    (lead) => lead.status === "ESTIMATE_SENT",
  );

  const attentionItems: {
    label: string;
    count: number;
    tone: "warning" | "critical";
    destination: DashboardDestination;
  }[] = [
    {
      label: "Leads awaiting response",
      count: workspaceNewLeads.length,
      tone: "warning",
      destination: "leads",
    },
    {
      label: "Past-due tasks",
      count: pastDueTasks.length,
      tone: "critical",
      destination: "tasks",
    },
    {
      label: "Follow-ups due",
      count: followUpsDue.length,
      tone: "critical",
      destination: "pipeline",
    },
    {
      label: "Estimates to check",
      count: quotes.length,
      tone: "warning",
      destination: "pipeline",
    },
  ];
  const activeAttentionItems = attentionItems.filter((item) => item.count > 0);
  const totalAttentionCount = attentionItems.reduce(
    (sum, item) => sum + item.count,
    0,
  );

  const metrics = [
    {
      label: "Leads",
      value: String(leads.length),
      detail: "Selected range",
    },
    {
      label: "New",
      value: String(newLeads.length),
      detail: "Need first response",
    },
    {
      label: "Booked",
      value: String(booked),
      detail: "Appointments or later",
    },
    {
      label: "Won value",
      value: money(revenue, true),
      detail: leads.length
        ? `${won.length} won / ${closeRate}% close`
        : "No wins yet",
    },
  ];

  return (
    <div className="crm-view crm-dashboard-view">
      <section
        className="crm-metric-grid"
        aria-label="Essential performance indicators"
      >
        {metrics.map(({ label, value, detail }, index) => (
          <article
            key={label}
            className={index === 0 ? "crm-metric-primary" : ""}
          >
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>

      <section
        className="crm-dashboard-essential-grid"
        aria-label="Immediate work"
      >
        <article className="crm-panel crm-dashboard-attention-panel">
          <header>
            <div className="crm-dashboard-widget-heading">
              <ListChecks aria-hidden="true" />
              <h3>Needs Attention</h3>
            </div>
            <Badge tone={totalAttentionCount ? "orange" : "green"}>
              {totalAttentionCount ? `${totalAttentionCount} open` : "Clear"}
            </Badge>
          </header>
          <div className="crm-dashboard-attention-list">
            {activeAttentionItems.length ? (
              activeAttentionItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onNavigate(item.destination)}
                >
                  <i className={`is-${item.tone}`} aria-hidden="true" />
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </button>
              ))
            ) : (
              <DashboardEmpty
                title="All clear"
                detail="No urgent leads, tasks, or follow-ups need action."
              />
            )}
          </div>
        </article>

        <article className="crm-panel crm-dashboard-today-panel">
          <header>
            <div className="crm-dashboard-widget-heading">
              <CalendarDays aria-hidden="true" />
              <h3>Today</h3>
            </div>
            <button type="button" onClick={() => onNavigate("calendar")}>
              Calendar
            </button>
          </header>
          <div className="crm-dashboard-simple-list is-schedule">
            {todayAppointments.length ? (
              todayAppointments.slice(0, 4).map((appointment) => (
                <button
                  key={appointment.id}
                  type="button"
                  onClick={() => onNavigate("calendar")}
                >
                  <time dateTime={appointment.startsAt}>
                    {timeOnly(appointment.startsAt)}
                  </time>
                  <span>
                    <strong>{appointment.serviceType || "Appointment"}</strong>
                    <small>
                      {appointment.clientName || appointment.contactName}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <DashboardEmpty
                title="Nothing scheduled"
                detail="Appointments for today will appear here."
              />
            )}
          </div>
        </article>
      </section>

      <section
        className="crm-dashboard-essential-grid is-secondary"
        aria-label="Recent and upcoming work"
      >
        <article className="crm-panel crm-recent-panel">
          <header>
            <div>
              <p>RECENT LEADS</p>
              <h3>Newest opportunities</h3>
            </div>
            <button type="button" onClick={() => onNavigate("leads")}>
              View all
            </button>
          </header>
          <div className="crm-compact-list">
            {leads.length ? (
              leads.slice(0, 4).map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => onOpenLead(lead)}
                >
                  <span className="crm-avatar" aria-hidden="true">
                    {leadInitials(lead)}
                  </span>
                  <span>
                    <strong>
                      {lead.firstName} {lead.lastName}
                    </strong>
                    <small>
                      {lead.serviceRequested}
                      {" / "}
                      {lead.source}
                    </small>
                  </span>
                  <Badge
                    tone={
                      lead.status === "NEW"
                        ? "purple"
                        : lead.status === "WON"
                          ? "green"
                          : "neutral"
                    }
                  >
                    {displayStatus(lead.status)}
                  </Badge>
                </button>
              ))
            ) : (
              <DashboardEmpty
                title="No recent leads"
                detail="New opportunities will appear here as they arrive."
              />
            )}
          </div>
        </article>

        <article className="crm-panel crm-next-panel">
          <header>
            <div>
              <p>NEXT UP</p>
              <h3>Appointments and tasks</h3>
            </div>
          </header>
          <div className="crm-dashboard-simple-list">
            {upcomingAppointments.slice(0, 2).map((appointment) => (
              <button
                key={appointment.id}
                type="button"
                onClick={() => onNavigate("calendar")}
              >
                <span className="crm-next-icon" aria-hidden="true">
                  <CalendarDays />
                </span>
                <span>
                  <strong>{appointment.contactName}</strong>
                  <small>
                    {appointment.serviceType} / {dateTime(appointment.startsAt)}
                  </small>
                </span>
              </button>
            ))}
            {openTasks.slice(0, 2).map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onNavigate("tasks")}
              >
                <span
                  className="crm-next-icon crm-next-task"
                  aria-hidden="true"
                >
                  <ListChecks />
                </span>
                <span>
                  <strong>{task.title}</strong>
                  <small>
                    {displayStatus(task.priority)} priority /{" "}
                    {dateTime(task.dueAt)}
                  </small>
                </span>
              </button>
            ))}
            {!upcomingAppointments.length && !openTasks.length ? (
              <DashboardEmpty
                title="No next steps"
                detail="Upcoming appointments and open tasks will appear here."
              />
            ) : null}
          </div>
        </article>
      </section>
    </div>
  );
}
