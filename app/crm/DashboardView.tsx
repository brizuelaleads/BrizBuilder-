"use client";

import {
  CalendarDays,
  Columns3,
  ListChecks,
  Megaphone,
  PhoneCall,
  UserRoundSearch,
} from "lucide-react";
import type {
  CrmAppointment,
  CrmClient,
  CrmLead,
  CrmPhoneCall,
  CrmProviderConnection,
  CrmStage,
  CrmTask,
} from "../../db/crm";
import { Badge, dateTime, money } from "./ui";

type DashboardDestination =
  | "leads"
  | "pipeline"
  | "calendar"
  | "tasks"
  | "conversations"
  | "connections"
  | "phone-system";

const DAY_MS = 86_400_000;

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

function rangeLabel(range: string) {
  if (range === "all") return "All time";
  return `Last ${range} days`;
}

function previousRangeCount(
  leads: CrmLead[],
  range: string,
  generatedAtTimestamp: number,
) {
  const days = Number(range);
  if (!Number.isFinite(days) || days <= 0) return null;
  const currentStart = generatedAtTimestamp - days * DAY_MS;
  const previousStart = currentStart - days * DAY_MS;
  return leads.filter((lead) => {
    const createdAt = timestamp(lead.createdAt);
    return createdAt >= previousStart && createdAt < currentStart;
  }).length;
}

function formatDelta(current: number, previous: number | null) {
  if (previous == null) return null;
  const difference = current - previous;
  return `${difference >= 0 ? "+" : ""}${difference} vs previous`;
}

function isOpenTask(task: CrmTask) {
  return !["COMPLETED", "CANCELED", "CANCELLED"].includes(task.status);
}

function isInactiveLead(lead: CrmLead) {
  return !["WON", "LOST", "SPAM", "UNRESPONSIVE"].includes(lead.status);
}

function isMissedCall(call: CrmPhoneCall) {
  const status = call.status.toLowerCase().replaceAll("_", "-");
  return (
    status.includes("missed") ||
    status === "no-answer" ||
    status === "busy" ||
    status === "failed" ||
    status === "canceled" ||
    status === "cancelled"
  );
}

function isAnsweredCall(call: CrmPhoneCall) {
  const status = call.status.toLowerCase();
  return (
    status === "completed" ||
    status === "answered" ||
    status === "connected" ||
    Boolean(call.durationSeconds && call.durationSeconds > 0 && !isMissedCall(call))
  );
}

function formatDuration(seconds: number | null) {
  if (!seconds || seconds < 1) return "-";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (!minutes) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
}

function providerIsCallTracking(connection: CrmProviderConnection) {
  return ["twilio", "callrail"].includes(connection.provider.toLowerCase());
}

function providerIsAdReporting(connection: CrmProviderConnection) {
  const provider = connection.provider.toLowerCase();
  return provider.includes("ads") || provider === "google_ads";
}

function DashboardEmpty({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="crm-dashboard-calm-empty">
      <strong>{title}</strong>
      <span>{detail}</span>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function DashboardView({
  leads,
  pipelineLeads,
  appointments,
  tasks,
  clients,
  phoneCalls,
  providerConnections,
  stages,
  range,
  generatedAt,
  onOpenLead,
  onNavigate,
}: {
  leads: CrmLead[];
  pipelineLeads: CrmLead[];
  appointments: CrmAppointment[];
  tasks: CrmTask[];
  clients: CrmClient[];
  phoneCalls: CrmPhoneCall[];
  providerConnections: CrmProviderConnection[];
  stages: CrmStage[];
  range: string;
  generatedAt: string;
  onOpenLead: (lead: CrmLead) => void;
  onNavigate: (view: DashboardDestination) => void;
}) {
  const generatedAtTimestamp = timestamp(generatedAt);
  const currentDateKey = dateKey(generatedAt);
  const previousLeads = previousRangeCount(
    pipelineLeads,
    range,
    generatedAtTimestamp,
  );
  const won = leads.filter((lead) => lead.status === "WON");
  const revenue = won.reduce(
    (sum, lead) => sum + lead.finalRevenueCents,
    0,
  );
  const bookedLeads = leads.filter((lead) =>
    ["APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON"].includes(lead.status),
  );
  const openTasks = tasks
    .filter(isOpenTask)
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
  const todaysTasks = openTasks.filter(
    (task) => task.dueAt && dateKey(task.dueAt) === currentDateKey,
  );
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
  const appointmentsToConfirm = upcomingAppointments.filter(
    (appointment) =>
      appointment.status === "SCHEDULED" &&
      timestamp(appointment.startsAt) <= generatedAtTimestamp + DAY_MS,
  );
  const followUpsDue = pipelineLeads.filter(
    (lead) =>
      isInactiveLead(lead) &&
      lead.nextFollowUpAt &&
      timestamp(lead.nextFollowUpAt) <= generatedAtTimestamp,
  );
  const todaysFollowUps = followUpsDue.filter(
    (lead) =>
      lead.nextFollowUpAt && dateKey(lead.nextFollowUpAt) === currentDateKey,
  );
  const workspaceNewLeads = pipelineLeads.filter(
    (lead) => lead.status === "NEW",
  );
  const estimatesAwaitingFollowUp = pipelineLeads.filter(
    (lead) => lead.status === "ESTIMATE_SENT",
  );

  const inboundCalls = phoneCalls.filter(
    (call) => call.direction.toLowerCase() !== "outbound",
  );
  const callsForSummary = inboundCalls.length ? inboundCalls : phoneCalls;
  const missedCalls = callsForSummary.filter(isMissedCall);
  const answeredCalls = callsForSummary.filter(isAnsweredCall);
  const answerRate = callsForSummary.length
    ? Math.round((answeredCalls.length / callsForSummary.length) * 100)
    : 0;
  const averageDurationSeconds = answeredCalls.length
    ? Math.round(
        answeredCalls.reduce(
          (sum, call) => sum + (call.durationSeconds ?? 0),
          0,
        ) / answeredCalls.length,
      )
    : null;
  const recentCalls = [...phoneCalls].sort(
    (first, second) => timestamp(second.startedAt) - timestamp(first.startedAt),
  );
  const callTrackingConnected =
    phoneCalls.length > 0 ||
    providerConnections.some(
      (connection) =>
        providerIsCallTracking(connection) &&
        (connection.isActive || connection.isLinked),
    );
  const adReportingConnected = providerConnections.some(
    (connection) =>
      providerIsAdReporting(connection) &&
      (connection.isActive || connection.isLinked),
  );
  const configuredBudgetCents = clients.reduce(
    (sum, client) => sum + client.monthlyAdBudgetCents,
    0,
  );

  const snapshotCards: Array<{
    label: string;
    value: string;
    detail: string;
    trend?: string | null;
    tone?: "primary" | "alert" | "muted";
  }> = [
    {
      label: "Leads",
      value: String(leads.length),
      detail: rangeLabel(range),
      trend: formatDelta(leads.length, previousLeads),
      tone: "primary",
    },
    {
      label: "Missed calls",
      value: callTrackingConnected ? String(missedCalls.length) : "Not connected",
      detail: callTrackingConnected
        ? "Inbound calls needing callback"
        : "No call tracking connected",
      tone: missedCalls.length ? "alert" : undefined,
    },
    {
      label: "Booked",
      value: String(bookedLeads.length),
      detail: "Appointments or later",
    },
    {
      label: "Won revenue",
      value: money(revenue, true),
      detail: revenue ? `${won.length} won opportunities` : "No revenue recorded",
    },
    {
      label: "Ad spend",
      value: adReportingConnected
        ? "-"
        : configuredBudgetCents
          ? money(configuredBudgetCents, true)
          : "Connect ads",
      detail: adReportingConnected
        ? "No spend reported"
        : configuredBudgetCents
          ? "Budget set, spend not connected"
          : "No ad platform connected",
      tone: adReportingConnected || configuredBudgetCents ? undefined : "muted",
    },
    {
      label: "ROAS",
      value: "-",
      detail: "Needs actual ad spend",
      tone: "muted",
    },
  ];

  const attentionItems: {
    label: string;
    count: number;
    tone: "warning" | "critical";
    destination: DashboardDestination;
  }[] = [
    {
      label: "Missed calls to return",
      count: missedCalls.length,
      tone: "critical",
      destination: "conversations",
    },
    {
      label: "Leads awaiting first response",
      count: workspaceNewLeads.length,
      tone: "warning",
      destination: "leads",
    },
    {
      label: "Overdue tasks",
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
      label: "Appointments soon",
      count: appointmentsToConfirm.length,
      tone: "warning",
      destination: "calendar",
    },
    {
      label: "Estimates awaiting follow-up",
      count: estimatesAwaitingFollowUp.length,
      tone: "warning",
      destination: "pipeline",
    },
  ];
  const activeAttentionItems = attentionItems.filter((item) => item.count > 0);
  const totalAttentionCount = attentionItems.reduce(
    (sum, item) => sum + item.count,
    0,
  );

  const pipelineTargets = [
    { label: "New", slug: "new", statuses: ["NEW"] },
    { label: "Contacted", slug: "contacted", statuses: ["CONTACTED"] },
    { label: "Qualified", slug: "qualified", statuses: ["QUALIFIED"] },
    {
      label: "Booked",
      slug: "appointment-booked",
      statuses: ["APPOINTMENT_BOOKED"],
    },
    { label: "Won", slug: "won", statuses: ["WON"] },
  ];
  const stagesBySlug = new Map(stages.map((stage) => [stage.slug, stage]));
  const pipelineItems = pipelineTargets.map((target) => {
    const stage = stagesBySlug.get(target.slug);
    const count = pipelineLeads.filter(
      (lead) =>
        target.statuses.includes(lead.status) ||
        (stage ? lead.stageId === stage.id : false),
    ).length;
    return {
      label: stage?.name ?? target.label,
      count,
      color: stage?.color ?? "#2f8a61",
    };
  });
  const maxPipelineCount = Math.max(
    1,
    ...pipelineItems.map((item) => item.count),
  );

  const sourceMap = new Map<
    string,
    { leads: number; revenueCents: number }
  >();
  leads.forEach((lead) => {
    const source = lead.source || "Unknown";
    const row = sourceMap.get(source) ?? { leads: 0, revenueCents: 0 };
    row.leads += 1;
    row.revenueCents += lead.finalRevenueCents;
    sourceMap.set(source, row);
  });
  const sourceRows = Array.from(sourceMap.entries())
    .map(([source, row]) => ({ source, ...row }))
    .sort((first, second) => second.leads - first.leads)
    .slice(0, 5);

  const recentLeads = [...leads]
    .sort((first, second) => timestamp(second.createdAt) - timestamp(first.createdAt))
    .slice(0, 6);

  const todayItems = [
    ...todayAppointments.slice(0, 3).map((appointment) => ({
      id: `appointment-${appointment.id}`,
      time: timeOnly(appointment.startsAt),
      title: appointment.contactName || "Appointment",
      detail: appointment.serviceType || appointment.clientName,
      destination: "calendar" as DashboardDestination,
    })),
    ...todaysTasks.slice(0, 2).map((task) => ({
      id: `task-${task.id}`,
      time: task.dueAt ? timeOnly(task.dueAt) : "Today",
      title: task.title,
      detail: `${displayStatus(task.priority)} priority`,
      destination: "tasks" as DashboardDestination,
    })),
    ...todaysFollowUps.slice(0, 2).map((lead) => ({
      id: `followup-${lead.id}`,
      time: lead.nextFollowUpAt ? timeOnly(lead.nextFollowUpAt) : "Today",
      title: `${lead.firstName} ${lead.lastName}`,
      detail: "Follow-up due",
      destination: "pipeline" as DashboardDestination,
    })),
  ].slice(0, 6);

  return (
    <div className="crm-view crm-dashboard-view">
      <section
        className="crm-dashboard-business-grid"
        aria-label="Business snapshot"
      >
        {snapshotCards.map(({ label, value, detail, trend, tone }) => (
          <article
            key={label}
            className={
              tone
                ? `crm-dashboard-kpi-card is-${tone}`
                : "crm-dashboard-kpi-card"
            }
          >
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
            {trend ? <em>{trend}</em> : null}
          </article>
        ))}
      </section>

      <section
        className="crm-dashboard-action-grid"
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
              activeAttentionItems.slice(0, 6).map((item) => (
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
                detail="No missed calls, overdue tasks, or stale follow-ups need action."
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
            {todayItems.length ? (
              todayItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.destination)}
                >
                  <time>{item.time}</time>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                </button>
              ))
            ) : (
              <DashboardEmpty
                title="Nothing scheduled"
                detail="Appointments, due tasks, and follow-ups for today will appear here."
              />
            )}
          </div>
        </article>
      </section>

      <section
        className="crm-dashboard-performance-grid"
        aria-label="Pipeline and marketing"
      >
        <article className="crm-panel crm-dashboard-pipeline-panel">
          <header>
            <div className="crm-dashboard-widget-heading">
              <Columns3 aria-hidden="true" />
              <h3>Lead Pipeline</h3>
            </div>
            <button type="button" onClick={() => onNavigate("pipeline")}>
              Pipeline
            </button>
          </header>
          <div className="crm-dashboard-pipeline-list">
            {pipelineItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onNavigate("pipeline")}
              >
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.count} leads</small>
                </span>
                <i aria-hidden="true">
                  <b
                    style={{
                      backgroundColor: item.color,
                      width: `${Math.max(6, (item.count / maxPipelineCount) * 100)}%`,
                    }}
                  />
                </i>
              </button>
            ))}
          </div>
        </article>

        <article className="crm-panel crm-dashboard-marketing-panel">
          <header>
            <div className="crm-dashboard-widget-heading">
              <Megaphone aria-hidden="true" />
              <h3>Marketing Performance</h3>
            </div>
            <button type="button" onClick={() => onNavigate("connections")}>
              Connections
            </button>
          </header>
          {sourceRows.length ? (
            <>
              <div className="crm-dashboard-table-wrap">
                <table className="crm-dashboard-source-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Leads</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceRows.map((row) => (
                      <tr key={row.source}>
                        <td>{row.source}</td>
                        <td>{row.leads}</td>
                        <td>{money(row.revenueCents, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="crm-dashboard-connect-note">
                <span>
                  Spend, CPL, and ROAS will appear when ad reporting is connected.
                </span>
                <button type="button" onClick={() => onNavigate("connections")}>
                  Connect ads
                </button>
              </div>
            </>
          ) : (
            <DashboardEmpty
              title="No source data yet"
              detail="Lead source rows will appear when opportunities are created."
              actionLabel="Connect ads"
              onAction={() => onNavigate("connections")}
            />
          )}
        </article>
      </section>

      <section className="crm-dashboard-records-grid" aria-label="Leads and calls">
        <article className="crm-panel crm-dashboard-leads-panel">
          <header>
            <div className="crm-dashboard-widget-heading">
              <UserRoundSearch aria-hidden="true" />
              <h3>Recent Leads</h3>
            </div>
            <button type="button" onClick={() => onNavigate("leads")}>
              View all
            </button>
          </header>
          <div className="crm-dashboard-lead-list">
            {recentLeads.length ? (
              recentLeads.map((lead) => (
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
                    <small>{lead.serviceRequested || lead.source}</small>
                  </span>
                  <span>{lead.source}</span>
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
                detail="New opportunities from the selected range will appear here."
              />
            )}
          </div>
        </article>

        <article className="crm-panel crm-dashboard-calls-panel">
          <header>
            <div className="crm-dashboard-widget-heading">
              <PhoneCall aria-hidden="true" />
              <h3>Call Overview</h3>
            </div>
            <button type="button" onClick={() => onNavigate("phone-system")}>
              Phone
            </button>
          </header>
          <div className="crm-dashboard-call-stats">
            <div>
              <span>Total</span>
              <strong>{callTrackingConnected ? callsForSummary.length : "-"}</strong>
            </div>
            <div>
              <span>Answered</span>
              <strong>{callTrackingConnected ? answeredCalls.length : "-"}</strong>
            </div>
            <div>
              <span>Missed</span>
              <strong>{callTrackingConnected ? missedCalls.length : "-"}</strong>
            </div>
            <div>
              <span>Answer rate</span>
              <strong>{callTrackingConnected ? `${answerRate}%` : "-"}</strong>
            </div>
          </div>
          {callTrackingConnected && recentCalls.length ? (
            <div className="crm-dashboard-call-list">
              {recentCalls.slice(0, 4).map((call) => (
                <button
                  key={call.id}
                  type="button"
                  onClick={() => onNavigate("conversations")}
                >
                  <span>
                    <strong>
                      {call.direction.toLowerCase() === "outbound"
                        ? "Outbound call"
                        : "Inbound call"}
                    </strong>
                    <small>
                      {call.fromNumber} / {dateTime(call.startedAt)}
                    </small>
                  </span>
                  <span>
                    <Badge tone={isMissedCall(call) ? "red" : "green"}>
                      {displayStatus(call.status)}
                    </Badge>
                    <small>{formatDuration(call.durationSeconds)}</small>
                  </span>
                </button>
              ))}
              {averageDurationSeconds ? (
                <p>Average answered call: {formatDuration(averageDurationSeconds)}</p>
              ) : null}
            </div>
          ) : (
            <DashboardEmpty
              title={
                callTrackingConnected
                  ? "No calls in range"
                  : "No call tracking connected"
              }
              detail={
                callTrackingConnected
                  ? "Recent calls will appear here when they are recorded."
                  : "Connect CallRail or Twilio to see missed calls and answer rate."
              }
              actionLabel="Phone setup"
              onAction={() => onNavigate("phone-system")}
            />
          )}
        </article>
      </section>
    </div>
  );
}
