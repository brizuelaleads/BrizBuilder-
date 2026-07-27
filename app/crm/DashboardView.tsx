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
  range,
  onNavigate,
  onAddLead,
  onRangeChange,
}: {
  leads: CrmLead[];
  clients: CrmClient[];
  appointments: CrmAppointment[];
  tasks: CrmTask[];
  generatedAt: string;
  viewerName: string;
  workspaceName: string;
  range: string;
  onOpenLead: (lead: CrmLead) => void;
  onNavigate: (view: DashboardDestination) => void;
  onAddLead: () => void;
  onRangeChange: (range: string) => void;
}) {
  const now = new Date(generatedAt);
  const wonLeads = leads.filter((lead) => lead.status === "WON");
  const newLeads = leads.filter((lead) => lead.status === "NEW");
  const activeLeads = leads.filter(
    (lead) => !["WON", "LOST", "SPAM"].includes(lead.status),
  );
  const wonRevenue = wonLeads.reduce(
    (sum, lead) => sum + lead.finalRevenueCents,
    0,
  );
  const pipelineValue = activeLeads.reduce(
    (sum, lead) => sum + lead.estimatedValueCents,
    0,
  );
  const monthlyAdSpend = clients.reduce(
    (sum, client) => sum + client.monthlyAdBudgetCents,
    0,
  );
  const closeRate = leads.length
    ? Math.round((wonLeads.length / leads.length) * 100)
    : 0;
  const roas = monthlyAdSpend ? wonRevenue / monthlyAdSpend : 0;

  const openTasks = tasks.filter(
    (task) => !["COMPLETED", "CANCELED"].includes(task.status),
  );
  const overdueTasks = openTasks.filter(
    (task) => task.dueAt && new Date(task.dueAt).getTime() < now.getTime(),
  );

  const upcomingAppointments = appointments
    .filter(
      (appointment) =>
        appointment.status !== "CANCELED" &&
        new Date(appointment.startsAt).getTime() >= now.getTime(),
    )
    .sort(
      (first, second) =>
        new Date(first.startsAt).getTime() -
        new Date(second.startsAt).getTime(),
    );
  const todayAppointments = upcomingAppointments.filter(
    (appointment) =>
      new Date(appointment.startsAt).toDateString() === now.toDateString(),
  );

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
      label: "Leads",
      value: String(newLeads.length),
      state: "New",
      detail: `${leads.length} total in the selected range`,
      action: () => onNavigate("leads"),
    },
    {
      label: "Pipeline",
      value: money(pipelineValue, true),
      state: "Active value",
      detail: `${activeLeads.length} open opportunities`,
      action: () => onNavigate("leads"),
    },
    {
      label: "Appointments",
      value: String(todayAppointments.length),
      state: "Today",
      detail: `${upcomingAppointments.length} upcoming`,
      action: () => onNavigate("calendar"),
    },
    {
      label: "Tasks",
      value: String(openTasks.length),
      state: "Open",
      detail: `${overdueTasks.length} past due`,
      action: () => onNavigate("tasks"),
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
          <p>{workspaceName}</p>
        </div>
        <div className="crm-dashboard-hero-actions">
          <select
            value={range}
            onChange={(event) => onRangeChange(event.target.value)}
            aria-label="Filter dashboard by date range"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
          <button className="crm-button-primary" onClick={onAddLead}>
            + New lead
          </button>
        </div>
      </section>

      <section
        className="crm-overview-metrics"
        aria-label="Workspace overview"
      >
        {metrics.map((metric) => (
          <button key={metric.label} type="button" onClick={metric.action}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <span className="crm-dashboard-metric-copy">
              <b>{metric.state}</b>
              <small>{metric.detail}</small>
            </span>
          </button>
        ))}
      </section>

      <section
        className="crm-dashboard-grid crm-dashboard-operations"
        aria-label="Today's operations"
      >
        <article className="crm-panel crm-today-panel">
          <header>
            <div>
              <p>SCHEDULE</p>
              <h3>Today&apos;s schedule</h3>
            </div>
            <button type="button" onClick={() => onNavigate("calendar")}>
              Open calendar
            </button>
          </header>

          <div className="crm-today-list">
            {todayAppointments.slice(0, 5).map((appointment) => (
              <button
                key={appointment.id}
                type="button"
                onClick={() => onNavigate("calendar")}
              >
                <time dateTime={appointment.startsAt}>
                  {new Date(appointment.startsAt).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
                <span>
                  <strong>{appointment.contactName}</strong>
                  <small>{appointment.serviceType}</small>
                </span>
                <Badge
                  tone={
                    appointment.status === "COMPLETED" ? "green" : "neutral"
                  }
                >
                  {appointment.status.replaceAll("_", " ")}
                </Badge>
              </button>
            ))}

            {!todayAppointments.length ? (
              <div className="crm-calm-empty">
                <strong>Nothing scheduled today</strong>
                <span>Appointments booked for today will appear here.</span>
                <button type="button" onClick={() => onNavigate("calendar")}>
                  Open the calendar →
                </button>
              </div>
            ) : null}
          </div>
        </article>

        <aside
          className="crm-dashboard-performance"
          aria-labelledby="business-performance-title"
        >
          <h3 id="business-performance-title">Business performance</h3>
          <div className="crm-performance-stack">
            <article>
              <span>Won revenue</span>
              <strong>{money(wonRevenue, true)}</strong>
              <small>{wonLeads.length} closed leads</small>
            </article>
            <article>
              <span>Close rate</span>
              <strong>{closeRate}%</strong>
              <small>Across the selected lead range</small>
            </article>
            <article>
              <span>Return on ad spend</span>
              <strong>{roas.toFixed(1)}x</strong>
              <small>{money(monthlyAdSpend, true)} monthly client budget</small>
            </article>
          </div>
        </aside>
      </section>
    </div>
  );
}
