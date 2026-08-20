"use client";

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

function formatLeadDelta(current: number, previous: number | null) {
  if (previous == null) return rangeLabel("all");
  if (previous === 0) return current ? `+${current} vs previous` : "No change";
  const percent = Math.round(((current - previous) / previous) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}% vs previous`;
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

function providerIsCallTracking(connection: CrmProviderConnection) {
  return ["twilio", "callrail"].includes(connection.provider.toLowerCase());
}

function providerIsAdReporting(connection: CrmProviderConnection) {
  const provider = connection.provider.toLowerCase();
  return provider.includes("ads") || provider === "google_ads";
}

function formatProviderSpend(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function relativeTime(value: string, generatedAtTimestamp: number) {
  const eventTimestamp = timestamp(value);
  if (!eventTimestamp || !generatedAtTimestamp) return dateTime(value);
  const delta = generatedAtTimestamp - eventTimestamp;
  const absDelta = Math.abs(delta);
  if (delta < 0) {
    if (absDelta < DAY_MS) {
      const hours = Math.max(1, Math.round(absDelta / 3_600_000));
      return `In ${hours}h`;
    }
    return dateTime(value);
  }
  if (delta < 60_000) return "Now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < DAY_MS) return `${Math.round(delta / 3_600_000)}h ago`;
  if (delta < DAY_MS * 7) return `${Math.round(delta / DAY_MS)}d ago`;
  return dateTime(value);
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

type DashboardActivity = {
  id: string;
  title: string;
  detail: string;
  time: string;
  destination: DashboardDestination;
  tone: "critical" | "neutral" | "success";
  lead?: CrmLead;
};

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
  const previousLeads = previousRangeCount(
    pipelineLeads,
    range,
    generatedAtTimestamp,
  );
  const wonLeads = leads.filter((lead) => lead.status === "WON");
  const bookedLeads = leads.filter((lead) =>
    ["APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON"].includes(lead.status),
  );
  const revenue = wonLeads.reduce(
    (sum, lead) => sum + lead.finalRevenueCents,
    0,
  );
  const bookedRate = leads.length
    ? Math.round((bookedLeads.length / leads.length) * 100)
    : null;
  const conversionRate = leads.length
    ? Math.round((wonLeads.length / leads.length) * 100)
    : null;

  const openTasks = tasks.filter(isOpenTask);
  const overdueFollowUps = pipelineLeads.filter(
    (lead) =>
      isInactiveLead(lead) &&
      lead.nextFollowUpAt &&
      timestamp(lead.nextFollowUpAt) <= generatedAtTimestamp,
  );
  const untouchedLeads = pipelineLeads.filter(
    (lead) => lead.status === "NEW" && !lead.lastContactedAt,
  );
  const appointmentsToConfirm = appointments.filter(
    (appointment) =>
      appointment.status === "SCHEDULED" &&
      timestamp(appointment.startsAt) >= generatedAtTimestamp &&
      timestamp(appointment.startsAt) <= generatedAtTimestamp + DAY_MS,
  );
  const overdueTasks = openTasks.filter(
    (task) => task.dueAt && timestamp(task.dueAt) < generatedAtTimestamp,
  );

  const inboundCalls = phoneCalls.filter(
    (call) => call.direction.toLowerCase() !== "outbound",
  );
  const callsForSummary = inboundCalls.length ? inboundCalls : phoneCalls;
  const missedCalls = callsForSummary.filter(isMissedCall);
  const callTrackingConnected =
    phoneCalls.length > 0 ||
    providerConnections.some(
      (connection) =>
        providerIsCallTracking(connection) &&
        (connection.isActive || connection.isLinked),
    );

  const configuredBudgetCents = clients.reduce(
    (sum, client) => sum + client.monthlyAdBudgetCents,
    0,
  );
  const reportedAdSpend = providerConnections
    .filter(
      (connection) =>
        providerIsAdReporting(connection) &&
        (connection.isActive || connection.isLinked) &&
        connection.monthSpend != null,
    )
    .reduce((sum, connection) => sum + (connection.monthSpend ?? 0), 0);
  const hasReportedAdSpend = reportedAdSpend > 0;
  const roas =
    hasReportedAdSpend && revenue > 0
      ? revenue / 100 / reportedAdSpend
      : null;

  const snapshotCards = [
    {
      label: "Leads",
      value: String(leads.length),
      support:
        previousLeads == null
          ? rangeLabel(range)
          : formatLeadDelta(leads.length, previousLeads),
      tone: "primary",
    },
    {
      label: "Missed Calls",
      value: callTrackingConnected ? String(missedCalls.length) : "-",
      support: callTrackingConnected
        ? missedCalls.length
          ? "Needs response"
          : "No missed calls"
        : "No call tracking connected",
      tone: missedCalls.length ? "alert" : undefined,
    },
    {
      label: "Appointments Booked",
      value: String(bookedLeads.length),
      support: bookedRate == null ? "No leads in range" : `${bookedRate}% of leads`,
    },
    {
      label: "Won Revenue",
      value: money(revenue),
      support: revenue ? `${wonLeads.length} won leads` : "No revenue recorded",
    },
    {
      label: "ROAS",
      value: roas == null ? "-" : `${roas.toFixed(1)}x`,
      support: hasReportedAdSpend
        ? `${formatProviderSpend(reportedAdSpend)} spend`
        : "No ad spend connected",
      tone: roas == null ? "muted" : undefined,
    },
  ];

  const attentionItems: {
    label: string;
    count: number;
    detail: string;
    tone: "warning" | "critical";
    destination: DashboardDestination;
  }[] = [
    {
      label: "Missed calls",
      count: missedCalls.length,
      detail: callTrackingConnected ? "Needs callback" : "Connect call tracking",
      tone: "critical",
      destination: callTrackingConnected ? "conversations" : "phone-system",
    },
    {
      label: "Untouched leads",
      count: untouchedLeads.length,
      detail: "No first contact logged",
      tone: "warning",
      destination: "leads",
    },
    {
      label: "Overdue follow-ups",
      count: overdueFollowUps.length + overdueTasks.length,
      detail: "Leads and tasks past due",
      tone: "critical",
      destination: "tasks",
    },
    {
      label: "Appointments to confirm",
      count: appointmentsToConfirm.length,
      detail: "Scheduled in the next 24h",
      tone: "warning",
      destination: "calendar",
    },
  ];
  const activeAttentionCount = attentionItems.reduce(
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
      statuses: ["APPOINTMENT_BOOKED", "ESTIMATE_SENT"],
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

  const performanceRows = [
    {
      label: "Leads",
      value: String(leads.length),
      support: rangeLabel(range),
    },
    {
      label: "Revenue",
      value: money(revenue, true),
      support: revenue ? "Recorded won value" : "No revenue recorded",
    },
    {
      label: "Ad Spend",
      value: hasReportedAdSpend ? formatProviderSpend(reportedAdSpend) : "-",
      support: hasReportedAdSpend
        ? "Reported this month"
        : configuredBudgetCents
          ? `Budget ${money(configuredBudgetCents, true)} set`
          : "No spend connected",
    },
    {
      label: "ROAS",
      value: roas == null ? "-" : `${roas.toFixed(1)}x`,
      support: roas == null ? "Needs ad spend" : "Revenue / spend",
    },
    {
      label: "Conversion Rate",
      value: conversionRate == null ? "-" : `${conversionRate}%`,
      support:
        conversionRate == null
          ? "No leads in range"
          : `${wonLeads.length} won / ${leads.length} leads`,
    },
  ];

  const leadActivities: DashboardActivity[] = leads.map((lead) => ({
    id: `lead-${lead.id}`,
    title: lead.status === "WON" ? "Lead marked won" : "New lead received",
    detail: `${lead.firstName} ${lead.lastName} - ${lead.serviceRequested || lead.source}`,
    time: lead.status === "WON" ? lead.updatedAt : lead.createdAt,
    destination: "leads" as DashboardDestination,
    lead,
    tone: lead.status === "WON" ? "success" : "neutral",
  }));
  const callActivities: DashboardActivity[] = missedCalls.map((call) => ({
    id: `call-${call.id}`,
    title: "Missed call",
    detail: call.fromNumber,
    time: call.startedAt,
    destination: "conversations" as DashboardDestination,
    tone: "critical",
  }));
  const appointmentActivities: DashboardActivity[] = appointments
    .filter((appointment) => appointment.status !== "CANCELED")
    .map((appointment) => ({
      id: `appointment-${appointment.id}`,
      title: "Appointment booked",
      detail: `${appointment.contactName} - ${appointment.serviceType}`,
      time: appointment.startsAt,
      destination: "calendar" as DashboardDestination,
      tone: "neutral",
    }));
  const recentActivity = [
    ...leadActivities,
    ...callActivities,
    ...appointmentActivities,
  ]
    .sort((first, second) => timestamp(second.time) - timestamp(first.time))
    .slice(0, 5);

  return (
    <div className="crm-view crm-dashboard-view">
      <section
        className="crm-dashboard-business-grid"
        aria-label="Business snapshot"
      >
        {snapshotCards.map(({ label, value, support, tone }) => (
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
            <small>{support}</small>
          </article>
        ))}
      </section>

      <section className="crm-dashboard-main-grid" aria-label="Dashboard panels">
        <article className="crm-panel crm-dashboard-pipeline-panel">
          <header>
            <div>
              <p>PIPELINE</p>
              <h3>Lead stages</h3>
            </div>
            <button type="button" onClick={() => onNavigate("pipeline")}>
              Open
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
                  <small>{item.count}</small>
                </span>
                <i aria-hidden="true">
                  <b
                    style={{
                      backgroundColor: item.color,
                      width: `${Math.max(
                        6,
                        (item.count / maxPipelineCount) * 100,
                      )}%`,
                    }}
                  />
                </i>
              </button>
            ))}
          </div>
        </article>

        <article className="crm-panel crm-dashboard-attention-panel">
          <header>
            <div>
              <p>ACTION NEEDED</p>
              <h3>Needs Attention</h3>
            </div>
            <Badge tone={activeAttentionCount ? "orange" : "green"}>
              {activeAttentionCount ? `${activeAttentionCount} open` : "Clear"}
            </Badge>
          </header>
          <div className="crm-dashboard-attention-list">
            {attentionItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onNavigate(item.destination)}
              >
                <i className={`is-${item.tone}`} aria-hidden="true" />
                <span>
                  <strong>{item.count} {item.label.toLowerCase()}</strong>
                  <small>{item.detail}</small>
                </span>
              </button>
            ))}
          </div>
        </article>

        <article className="crm-panel crm-dashboard-performance-panel">
          <header>
            <div>
              <p>PERFORMANCE</p>
              <h3>Range summary</h3>
            </div>
            <button type="button" onClick={() => onNavigate("connections")}>
              Data
            </button>
          </header>
          <div className="crm-dashboard-performance-summary">
            {performanceRows.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
                <small>{row.support}</small>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="crm-panel crm-dashboard-activity-panel">
        <header>
          <div>
            <p>RECENT ACTIVITY</p>
            <h3>Latest workspace events</h3>
          </div>
          <button type="button" onClick={() => onNavigate("leads")}>
            View leads
          </button>
        </header>
        <div className="crm-dashboard-activity-list">
          {recentActivity.length ? (
            recentActivity.map((activity) => (
              <button
                key={activity.id}
                type="button"
                onClick={() =>
                  activity.lead
                    ? onOpenLead(activity.lead)
                    : onNavigate(activity.destination)
                }
              >
                <i className={`is-${activity.tone}`} aria-hidden="true" />
                <span>
                  <strong>{activity.title}</strong>
                  <small>{activity.detail}</small>
                </span>
                <time>{relativeTime(activity.time, generatedAtTimestamp)}</time>
              </button>
            ))
          ) : (
            <DashboardEmpty
              title="No recent activity"
              detail="New leads, missed calls, appointments, and won leads will appear here."
            />
          )}
        </div>
      </section>
    </div>
  );
}
