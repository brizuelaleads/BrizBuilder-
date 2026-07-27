"use client";

import type {
  CrmAppointment,
  CrmClient,
  CrmLead,
  CrmTask,
} from "../../db/crm";
import { Badge, money } from "./ui";

type DashboardDestination = "leads" | "calendar" | "tasks" | "reports";

export function DashboardView({
  leads,
  clients,
  appointments,
  tasks,
  generatedAt,
  viewerName,
  workspaceName,
  onOpenLead,
  onNavigate,
  onAddLead,
}: {
  leads: CrmLead[];
  clients: CrmClient[];
  appointments: CrmAppointment[];
  tasks: CrmTask[];
  generatedAt: string;
  viewerName: string;
  workspaceName: string;
  onOpenLead: (lead: CrmLead) => void;
  onNavigate: (view: DashboardDestination) => void;
  onAddLead: () => void;
}) {
  const now = new Date(generatedAt);
  const won = leads.filter((lead) => lead.status === "WON");
  const newLeads = leads.filter((lead) => lead.status === "NEW");
  const activeLeads = leads.filter(
    (lead) => !["WON", "LOST", "SPAM"].includes(lead.status),
  );
  const revenue = won.reduce(
    (sum, lead) => sum + lead.finalRevenueCents,
    0,
  );
  const pipelineValue = activeLeads.reduce(
    (sum, lead) => sum + lead.estimatedValueCents,
    0,
  );
  const spend = clients.reduce(
    (sum, client) => sum + client.monthlyAdBudgetCents,
    0,
  );
  const booked = leads.filter((lead) =>
    ["APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON"].includes(lead.status),
  ).length;
  const closeRate = leads.length
    ? Math.round((won.length / leads.length) * 100)
    : 0;
  const roas = spend ? revenue / spend : 0;
  const costPerLead = leads.length ? Math.round(spend / leads.length) : 0;
  const openTasks = tasks.filter(
    (task) => !["COMPLETED", "CANCELED"].includes(task.status),
  );
  const overdueTasks = openTasks.filter(
    (task) => task.dueAt && new Date(task.dueAt).getTime() < now.getTime(),
  );
  const futureAppointments = appointments.filter(
    (appointment) =>
      appointment.status !== "CANCELED" &&
      new Date(appointment.startsAt).getTime() >= now.getTime() - 86400000,
  );
  const todayAppointments = futureAppointments.filter(
    (appointment) =>
      new Date(appointment.startsAt).toDateString() === now.toDateString(),
  );

  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(generatedAt);
    date.setUTCDate(date.getUTCDate() - 6 + index);
    const iso = date.toISOString().slice(0, 10);
    return {
      label: date.toLocaleDateString("en-US", { weekday: "short" }),
      value: leads.filter((lead) => lead.createdAt.slice(0, 10) === iso).length,
    };
  });
  const maxDaily = Math.max(1, ...daily.map((item) => item.value));

  const sources = Object.entries(
    leads.reduce<Record<string, number>>((acc, lead) => {
      acc[lead.source] = (acc[lead.source] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const maxSource = Math.max(1, ...sources.map(([, count]) => count));

  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = viewerName.trim().split(/\s+/)[0] || "there";
  const formattedDate = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const metrics = [
    {
      label: "New leads",
      value: String(newLeads.length),
      detail: `${leads.length} total in this view`,
      action: () => onNavigate("leads"),
    },
    {
      label: "Open pipeline",
      value: money(pipelineValue, true),
      detail: `${activeLeads.length} active opportunities`,
      action: () => onNavigate("leads"),
    },
    {
      label: "Appointments",
      value: String(booked),
      detail: `${todayAppointments.length} scheduled today`,
      action: () => onNavigate("calendar"),
    },
    {
      label: "Revenue",
      value: money(revenue, true),
      detail: `${closeRate}% close rate`,
      action: () => onNavigate("reports"),
    },
  ];

  const attention = [
    {
      count: newLeads.length,
      title: "New leads need a first response",
      detail: "Open the lead inbox and start the conversation.",
      action: () => onNavigate("leads"),
    },
    {
      count: overdueTasks.length,
      title: "Tasks are past due",
      detail: "Review owners and reset the next action.",
      action: () => onNavigate("tasks"),
    },
    {
      count: todayAppointments.length,
      title: "Appointments are on today’s schedule",
      detail: "Confirm timing, address, and assignment.",
      action: () => onNavigate("calendar"),
    },
  ];

  return (
    <div className="crm-view crm-dashboard-view crm-calm-dashboard">
      <section className="crm-dashboard-hero">
        <div>
          <time dateTime={now.toISOString()}>{formattedDate}</time>
          <h2>
            {greeting}, {firstName}
          </h2>
          <p>
            Here is what needs attention across {workspaceName} today.
          </p>
        </div>
        <div className="crm-dashboard-hero-actions">
          <Badge tone="green">Live workspace</Badge>
          <button className="crm-button-primary" onClick={onAddLead}>
            + New lead
          </button>
        </div>
      </section>

      <section
        className="crm-overview-metrics"
        aria-label="Key performance indicators"
      >
        {metrics.map((metric) => (
          <button key={metric.label} type="button" onClick={metric.action}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </button>
        ))}
      </section>

      <section className="crm-dashboard-primary-grid">
        <article className="crm-panel crm-attention-panel">
          <header>
            <div>
              <p>PRIORITIES</p>
              <h3>Needs attention</h3>
            </div>
            <span>{attention.reduce((sum, item) => sum + item.count, 0)} open</span>
          </header>
          <div className="crm-attention-list">
            {attention.map((item) => (
              <button key={item.title} type="button" onClick={item.action}>
                <span>{item.count}</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <b aria-hidden="true">→</b>
              </button>
            ))}
          </div>
        </article>

        <article className="crm-panel crm-today-panel">
          <header>
            <div>
              <p>SCHEDULE</p>
              <h3>Today</h3>
            </div>
            <button onClick={() => onNavigate("calendar")}>Open calendar</button>
          </header>
          <div className="crm-today-list">
            {todayAppointments.slice(0, 4).map((appointment) => (
              <button
                key={appointment.id}
                type="button"
                onClick={() => onNavigate("calendar")}
              >
                <time>
                  {new Date(appointment.startsAt).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
                <span>
                  <strong>{appointment.contactName}</strong>
                  <small>{appointment.serviceType}</small>
                </span>
                <Badge tone="neutral">{appointment.status}</Badge>
              </button>
            ))}
            {!todayAppointments.length ? (
              <div className="crm-calm-empty">
                <strong>Nothing scheduled today</strong>
                <span>Your upcoming appointments will appear here.</span>
                <button onClick={() => onNavigate("calendar")}>
                  Open the calendar
                </button>
              </div>
            ) : null}
          </div>
        </article>

        <aside className="crm-performance-stack" aria-label="Business performance">
          <article>
            <span>Return on ad spend</span>
            <strong>{roas.toFixed(1)}x</strong>
            <small>{money(spend, true)} monthly client budget</small>
          </article>
          <article>
            <span>Cost per lead</span>
            <strong>{money(costPerLead)}</strong>
            <small>Based on the current lead view</small>
          </article>
          <article>
            <span>Open work</span>
            <strong>{openTasks.length}</strong>
            <small>{overdueTasks.length} overdue tasks</small>
          </article>
        </aside>
      </section>

      <section className="crm-dashboard-grid crm-dashboard-insights">
        <article className="crm-panel crm-chart-panel">
          <header>
            <div>
              <p>LEAD VOLUME</p>
              <h3>New inquiries this week</h3>
            </div>
            <span>Last 7 days</span>
          </header>
          <div
            className="crm-column-chart"
            role="img"
            aria-label={`Lead volume by day: ${daily
              .map((item) => `${item.label} ${item.value}`)
              .join(", ")}`}
          >
            {daily.map((item) => (
              <div key={item.label}>
                <strong>{item.value}</strong>
                <span
                  style={{
                    height: `${Math.max(8, (item.value / maxDaily) * 100)}%`,
                  }}
                />
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="crm-panel crm-source-panel">
          <header>
            <div>
              <p>ATTRIBUTION</p>
              <h3>Leads by source</h3>
            </div>
            <button onClick={() => onNavigate("reports")}>Full report</button>
          </header>
          <div className="crm-bar-list">
            {sources.length ? (
              sources.slice(0, 5).map(([source, count]) => (
                <div key={source}>
                  <div>
                    <span>{source}</span>
                    <strong>{count}</strong>
                  </div>
                  <i>
                    <span style={{ width: `${(count / maxSource) * 100}%` }} />
                  </i>
                </div>
              ))
            ) : (
              <p className="crm-empty-inline">No lead sources yet.</p>
            )}
          </div>
        </article>
      </section>

      <section className="crm-panel crm-recent-panel crm-dashboard-recent">
        <header>
          <div>
            <p>RECENT LEADS</p>
            <h3>Newest opportunities</h3>
          </div>
          <button onClick={() => onNavigate("leads")}>View all</button>
        </header>
        <div className="crm-compact-list">
          {leads.slice(0, 5).map((lead) => (
            <button key={lead.id} onClick={() => onOpenLead(lead)}>
              <span className="crm-avatar">
                {lead.firstName[0]}
                {lead.lastName[0]}
              </span>
              <span>
                <strong>
                  {lead.firstName} {lead.lastName}
                </strong>
                <small>
                  {lead.serviceRequested} · {lead.source}
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
                {lead.status.replaceAll("_", " ")}
              </Badge>
            </button>
          ))}
          {!leads.length ? (
            <div className="crm-calm-empty crm-calm-empty-compact">
              <strong>No leads yet</strong>
              <span>Add the first lead to start your pipeline.</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
