"use client";

import type { CrmAppointment, CrmClient, CrmLead, CrmTask } from "../../db/crm";
import { Badge, dateTime, money } from "./ui";

export function DashboardView({ leads, clients, appointments, tasks, generatedAt, onOpenLead, onNavigate }: {
  leads: CrmLead[];
  clients: CrmClient[];
  appointments: CrmAppointment[];
  tasks: CrmTask[];
  generatedAt: string;
  onOpenLead: (lead: CrmLead) => void;
  onNavigate: (view: "leads" | "calendar" | "tasks" | "reports") => void;
}) {
  const won = leads.filter((lead) => lead.status === "WON");
  const newLeads = leads.filter((lead) => lead.status === "NEW");
  const revenue = leads.reduce((sum, lead) => sum + lead.finalRevenueCents, 0);
  const spend = clients.reduce((sum, client) => sum + client.monthlyAdBudgetCents, 0);
  const booked = leads.filter((lead) => ["APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON"].includes(lead.status)).length;
  const closeRate = leads.length ? Math.round((won.length / leads.length) * 100) : 0;
  const roas = spend ? revenue / spend : 0;
  const openTasks = tasks.filter((task) => task.status !== "COMPLETED" && task.status !== "CANCELED");
  const futureAppointments = appointments.filter((appointment) => appointment.status !== "CANCELED" && new Date(appointment.startsAt).getTime() >= new Date(generatedAt).getTime() - 86400000);

  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(generatedAt);
    date.setUTCDate(date.getUTCDate() - 6 + index);
    const iso = date.toISOString().slice(0, 10);
    return { label: date.toLocaleDateString("en-US", { weekday: "short" }), value: leads.filter((lead) => lead.createdAt.slice(0, 10) === iso).length };
  });
  const maxDaily = Math.max(1, ...daily.map((item) => item.value));

  const sources = Object.entries(leads.reduce<Record<string, number>>((acc, lead) => {
    acc[lead.source] = (acc[lead.source] ?? 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  const maxSource = Math.max(1, ...sources.map(([, count]) => count));

  const metrics = [
    ["Total leads", String(leads.length), "All captured inquiries"],
    ["New leads", String(newLeads.length), "Need first response"],
    ["Appointments", String(booked), "Booked or later"],
    ["Jobs won", String(won.length), `${closeRate}% close rate`],
    ["Revenue", money(revenue, true), "Collected demo revenue"],
    ["Ad spend", money(spend, true), "Monthly client budget"],
    ["Cost per lead", money(leads.length ? Math.round(spend / leads.length) : 0), "Budget ÷ leads"],
    ["ROAS", `${roas.toFixed(1)}x`, "Revenue ÷ ad spend"],
  ];

  return <div className="crm-view crm-dashboard-view">
    <section className="crm-welcome-row">
      <div><p>AGENCY COMMAND CENTER</p><h2>Every lead, next step, and dollar in one view.</h2><span>Demo records are clearly labeled until live forms and ad accounts are connected.</span></div>
      <Badge tone="purple">Demo data</Badge>
    </section>

    <section className="crm-metric-grid" aria-label="Key performance indicators">
      {metrics.map(([label, value, detail], index) => <article key={label} className={index === 0 ? "crm-metric-primary" : ""}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>)}
    </section>

    <section className="crm-dashboard-grid">
      <article className="crm-panel crm-chart-panel">
        <header><div><p>LEAD VOLUME</p><h3>New inquiries this week</h3></div><span>7 days</span></header>
        <div className="crm-column-chart" role="img" aria-label={`Lead volume by day: ${daily.map((item) => `${item.label} ${item.value}`).join(", ")}`}>
          {daily.map((item) => <div key={item.label}><strong>{item.value}</strong><span style={{ height: `${Math.max(8, (item.value / maxDaily) * 100)}%` }} /><small>{item.label}</small></div>)}
        </div>
      </article>

      <article className="crm-panel crm-source-panel">
        <header><div><p>ATTRIBUTION</p><h3>Leads by source</h3></div><button onClick={() => onNavigate("reports")}>Full report</button></header>
        <div className="crm-bar-list">
          {sources.map(([source, count]) => <div key={source}><div><span>{source}</span><strong>{count}</strong></div><i><span style={{ width: `${(count / maxSource) * 100}%` }} /></i></div>)}
        </div>
      </article>
    </section>

    <section className="crm-dashboard-grid crm-dashboard-lower">
      <article className="crm-panel crm-recent-panel">
        <header><div><p>RECENT LEADS</p><h3>Newest opportunities</h3></div><button onClick={() => onNavigate("leads")}>View all</button></header>
        <div className="crm-compact-list">
          {leads.slice(0, 5).map((lead) => <button key={lead.id} onClick={() => onOpenLead(lead)}><span className="crm-avatar">{lead.firstName[0]}{lead.lastName[0]}</span><span><strong>{lead.firstName} {lead.lastName}</strong><small>{lead.serviceRequested} · {lead.source}</small></span><Badge tone={lead.status === "NEW" ? "purple" : lead.status === "WON" ? "green" : "neutral"}>{lead.status.replaceAll("_", " ")}</Badge></button>)}
        </div>
      </article>

      <article className="crm-panel crm-next-panel">
        <header><div><p>NEXT UP</p><h3>Appointments and tasks</h3></div></header>
        {futureAppointments.slice(0, 2).map((appointment) => <button key={appointment.id} onClick={() => onNavigate("calendar")}><span className="crm-next-icon">C</span><span><strong>{appointment.contactName}</strong><small>{appointment.serviceType} · {dateTime(appointment.startsAt)}</small></span></button>)}
        {openTasks.slice(0, 3).map((task) => <button key={task.id} onClick={() => onNavigate("tasks")}><span className="crm-next-icon crm-next-task">T</span><span><strong>{task.title}</strong><small>{task.priority} priority · {dateTime(task.dueAt)}</small></span></button>)}
      </article>
    </section>
  </div>;
}
