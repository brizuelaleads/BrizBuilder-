"use client";

import type { CSSProperties } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Funnel,
  PhoneCall,
  TrendingUp,
  UserPlus,
  UsersRound,
  type LucideIcon,
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
import { dateTime, initials, money } from "./ui";

type DashboardDestination =
  | "leads"
  | "pipeline"
  | "calendar"
  | "tasks"
  | "conversations"
  | "connections"
  | "phone-system";

type KpiTone = "green" | "orange" | "purple";

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
  return (
    provider.includes("ads") ||
    provider.includes("meta") ||
    provider.includes("facebook") ||
    provider === "google_ads"
  );
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
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} min ago`;
  if (delta < DAY_MS) return `${Math.round(delta / 3_600_000)} hr ago`;
  if (delta < DAY_MS * 7) return `${Math.round(delta / DAY_MS)} d ago`;
  return dateTime(value);
}

function timeOnly(value: string) {
  const eventTimestamp = timestamp(value);
  if (!eventTimestamp) return dateTime(value);
  return new Date(eventTimestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dateKey(value: string | number) {
  const eventTimestamp = typeof value === "number" ? value : timestamp(value);
  if (!eventTimestamp) return "";
  return new Date(eventTimestamp).toDateString();
}

function durationLabel(appointment: CrmAppointment) {
  const start = timestamp(appointment.startsAt);
  const end = timestamp(appointment.endsAt);
  if (!start || !end || end <= start) return "30 min";
  const minutes = Math.max(15, Math.round((end - start) / 60_000));
  return `${minutes} min`;
}

function displayLeadName(lead: CrmLead) {
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  return name || "Unnamed lead";
}

function stageDisplay(lead: CrmLead) {
  if (lead.status === "NEW") return { label: "New", tone: "new" };
  if (["CONTACTED", "QUALIFIED"].includes(lead.status)) {
    return { label: "Contacted", tone: "contacted" };
  }
  if (["APPOINTMENT_BOOKED", "ESTIMATE_SENT"].includes(lead.status)) {
    return { label: "Booked", tone: "booked" };
  }
  if (lead.status === "WON") return { label: "Won", tone: "won" };
  return {
    label:
      lead.stageName ||
      lead.status
        .toLowerCase()
        .split("_")
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" "),
    tone: "neutral",
  };
}

function bucketSeries<T>(
  items: T[],
  generatedAtTimestamp: number,
  range: string,
  getTime: (item: T) => string | null,
  getValue: (item: T) => number = () => 1,
) {
  const buckets = Array.from({ length: 8 }, () => 0);
  const eventTimes = items
    .map((item) => timestamp(getTime(item)))
    .filter((value) => value > 0);
  const fallbackEnd = generatedAtTimestamp || Math.max(...eventTimes, 0);
  if (!fallbackEnd) return buckets;

  const rangeDays = Number(range);
  const end = fallbackEnd;
  const start =
    range === "all" || !Number.isFinite(rangeDays) || rangeDays <= 0
      ? Math.min(...eventTimes, end - 30 * DAY_MS)
      : end - rangeDays * DAY_MS;
  const span = Math.max(DAY_MS, end - start);

  items.forEach((item) => {
    const eventTimestamp = timestamp(getTime(item));
    if (!eventTimestamp || eventTimestamp < start || eventTimestamp > end) {
      return;
    }
    const bucket = Math.min(
      buckets.length - 1,
      Math.max(
        0,
        Math.floor(((eventTimestamp - start) / span) * buckets.length),
      ),
    );
    buckets[bucket] += getValue(item);
  });

  return buckets;
}

function sparklinePoints(values: number[]) {
  const width = 96;
  const height = 32;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - 5 - ((value - min) / range) * 22;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function DashboardSparkline({
  values,
  tone,
}: {
  values: number[];
  tone: KpiTone;
}) {
  return (
    <svg
      className={`crm-dashboard-sparkline is-${tone}`}
      viewBox="0 0 96 32"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={sparklinePoints(values)} />
    </svg>
  );
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
  const revenue = wonLeads.reduce(
    (sum, lead) => sum + lead.finalRevenueCents,
    0,
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
  const overdueTasks = openTasks.filter(
    (task) => task.dueAt && timestamp(task.dueAt) < generatedAtTimestamp,
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

  const todaysAppointments = appointments
    .filter(
      (appointment) =>
        !["CANCELED", "CANCELLED"].includes(appointment.status) &&
        dateKey(appointment.startsAt) === dateKey(generatedAtTimestamp),
    )
    .sort(
      (first, second) =>
        timestamp(first.startsAt) - timestamp(second.startsAt),
    )
    .slice(0, 3);

  const stagesBySlug = new Map(stages.map((stage) => [stage.slug, stage]));
  const pipelineTargets = [
    { label: "New", slugs: ["new"], statuses: ["NEW"] },
    {
      label: "Contacted",
      slugs: ["contacted", "qualified"],
      statuses: ["CONTACTED", "QUALIFIED"],
    },
    {
      label: "Booked",
      slugs: ["appointment-booked", "estimate-sent", "booked"],
      statuses: ["APPOINTMENT_BOOKED", "ESTIMATE_SENT"],
    },
    { label: "Won", slugs: ["won"], statuses: ["WON"] },
  ];
  const pipelineItems = pipelineTargets.map((target) => {
    const stageIds = target.slugs
      .map((slug) => stagesBySlug.get(slug)?.id)
      .filter((id): id is string => Boolean(id));
    const count = pipelineLeads.filter(
      (lead) =>
        target.statuses.includes(lead.status) ||
        stageIds.includes(lead.stageId),
    ).length;
    return { label: target.label, count };
  });
  const maxPipelineCount = Math.max(
    1,
    ...pipelineItems.map((item) => item.count),
  );

  const recentLeads = [...leads]
    .sort(
      (first, second) => timestamp(second.createdAt) - timestamp(first.createdAt),
    )
    .slice(0, 4);

  const kpiCards: Array<{
    label: string;
    value: string;
    support: string;
    icon: LucideIcon;
    tone: KpiTone;
    sparkline: number[];
  }> = [
    {
      label: "Leads",
      value: String(leads.length),
      support:
        previousLeads == null
          ? rangeLabel(range)
          : formatLeadDelta(leads.length, previousLeads),
      icon: UsersRound,
      tone: "green",
      sparkline: bucketSeries(
        leads,
        generatedAtTimestamp,
        range,
        (lead) => lead.createdAt,
      ),
    },
    {
      label: "Missed Calls",
      value: callTrackingConnected ? String(missedCalls.length) : "-",
      support: callTrackingConnected
        ? missedCalls.length
          ? "Needs response"
          : "No missed calls"
        : "No call tracking connected",
      icon: PhoneCall,
      tone: "orange",
      sparkline: bucketSeries(
        missedCalls,
        generatedAtTimestamp,
        range,
        (call) => call.startedAt,
      ),
    },
    {
      label: "Revenue",
      value: money(revenue),
      support: revenue ? `${wonLeads.length} won leads` : "No revenue recorded",
      icon: CircleDollarSign,
      tone: "green",
      sparkline: bucketSeries(
        wonLeads,
        generatedAtTimestamp,
        range,
        (lead) => lead.updatedAt,
        (lead) => Math.max(0, lead.finalRevenueCents / 100),
      ),
    },
    {
      label: "ROAS",
      value: roas == null ? "-" : `${roas.toFixed(1)}x`,
      support: hasReportedAdSpend
        ? `${formatProviderSpend(reportedAdSpend)} spend`
        : configuredBudgetCents
          ? `${money(configuredBudgetCents, true)} budget set`
          : "No ad spend connected",
      icon: TrendingUp,
      tone: "purple",
      sparkline:
        roas == null
          ? [0, 0, 0, 0, 0, 0, 0, 0]
          : [
              roas * 0.72,
              roas * 0.8,
              roas * 0.76,
              roas * 0.9,
              roas,
              roas * 0.94,
              roas * 1.05,
              roas,
            ],
    },
  ];

  const attentionItems: Array<{
    id: string;
    title: string;
    detail: string;
    icon: LucideIcon;
    tone: "orange" | "blue" | "purple";
    destination: DashboardDestination;
  }> = [
    {
      id: "missed-calls",
      title: `${missedCalls.length} missed calls`,
      detail: callTrackingConnected
        ? "Return calls to capture more leads"
        : "Connect call tracking",
      icon: PhoneCall,
      tone: "orange",
      destination: callTrackingConnected ? "conversations" : "phone-system",
    },
    {
      id: "untouched-leads",
      title: `${untouchedLeads.length} new leads need response`,
      detail: "Respond to new inquiries",
      icon: UserPlus,
      tone: "blue",
      destination: "leads",
    },
    {
      id: "overdue-follow-ups",
      title: `${overdueFollowUps.length + overdueTasks.length} follow-ups overdue`,
      detail: "Reach out to keep things moving",
      icon: CalendarDays,
      tone: "purple",
      destination: "tasks",
    },
  ];

  return (
    <div className="crm-view crm-dashboard-view">
      <section
        className="crm-dashboard-kpi-grid"
        aria-label="Business snapshot"
      >
        {kpiCards.map(
          ({ label, value, support, icon: Icon, tone, sparkline }) => (
            <article
              key={label}
              className={`crm-dashboard-kpi-card is-${tone}`}
            >
              <div className="crm-dashboard-kpi-heading">
                <span className="crm-dashboard-icon-box" aria-hidden="true">
                  <Icon />
                </span>
                <span>{label}</span>
              </div>
              <strong>{value}</strong>
              <small>{support}</small>
              <DashboardSparkline values={sparkline} tone={tone} />
            </article>
          ),
        )}
      </section>

      <section className="crm-dashboard-duo-grid" aria-label="Action panels">
        <article className="crm-panel crm-dashboard-attention-panel">
          <header>
            <div className="crm-dashboard-widget-heading">
              <AlertTriangle aria-hidden="true" />
              <h3>Needs Attention</h3>
            </div>
            <button type="button" onClick={() => onNavigate("tasks")}>
              View all
            </button>
          </header>
          <div className="crm-dashboard-attention-list">
            {attentionItems.map(
              ({ id, title, detail, icon: Icon, tone, destination }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onNavigate(destination)}
                >
                  <span
                    className={`crm-dashboard-row-icon is-${tone}`}
                    aria-hidden="true"
                  >
                    <Icon />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </button>
              ),
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
              View calendar
            </button>
          </header>
          <div className="crm-dashboard-today-list">
            {todaysAppointments.length ? (
              todaysAppointments.map((appointment) => (
                <button
                  key={appointment.id}
                  type="button"
                  onClick={() => onNavigate("calendar")}
                >
                  <time>{timeOnly(appointment.startsAt)}</time>
                  <span>
                    <strong>{appointment.contactName}</strong>
                    <small>{appointment.serviceType}</small>
                  </span>
                  <em>{durationLabel(appointment)}</em>
                </button>
              ))
            ) : (
              <DashboardEmpty
                title="No appointments today"
                detail="Booked appointments for this date will appear here."
              />
            )}
          </div>
        </article>
      </section>

      <section className="crm-panel crm-dashboard-pipeline-overview">
        <header>
          <div className="crm-dashboard-widget-heading">
            <Funnel aria-hidden="true" />
            <h3>Pipeline Overview</h3>
          </div>
        </header>
        <div className="crm-dashboard-pipeline-strip">
          {pipelineItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className="crm-dashboard-pipeline-stage"
              onClick={() => onNavigate("pipeline")}
              style={
                {
                  "--pipeline-progress": `${
                    item.count
                      ? Math.max(10, (item.count / maxPipelineCount) * 100)
                      : 0
                  }%`,
                } as CSSProperties
              }
            >
              <span>{item.label}</span>
              <strong>{item.count}</strong>
              <i aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <section className="crm-panel crm-dashboard-recent-panel">
        <header>
          <div className="crm-dashboard-widget-heading">
            <UserPlus aria-hidden="true" />
            <h3>Recent Leads</h3>
          </div>
          <button type="button" onClick={() => onNavigate("leads")}>
            View all leads
          </button>
        </header>
        {recentLeads.length ? (
          <div className="crm-dashboard-recent-table" role="table">
            <div className="crm-dashboard-recent-head" role="row">
              <span>Name</span>
              <span>Source</span>
              <span>Stage</span>
              <span>Time</span>
              <span aria-hidden="true" />
            </div>
            {recentLeads.map((lead) => {
              const stage = stageDisplay(lead);
              return (
                <button
                  key={lead.id}
                  type="button"
                  className="crm-dashboard-recent-row"
                  onClick={() => onOpenLead(lead)}
                >
                  <span className="crm-dashboard-lead-identity">
                    <span className="crm-avatar">
                      {initials(displayLeadName(lead))}
                    </span>
                    <strong>{displayLeadName(lead)}</strong>
                  </span>
                  <span className="crm-dashboard-source">
                    {lead.source || lead.serviceRequested || "Unknown"}
                  </span>
                  <span
                    className={`crm-dashboard-stage-badge is-${stage.tone}`}
                  >
                    {stage.label}
                  </span>
                  <time>{relativeTime(lead.createdAt, generatedAtTimestamp)}</time>
                  <ChevronRight aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ) : (
          <DashboardEmpty
            title="No recent leads"
            detail="New inquiries will appear here as soon as they are recorded."
          />
        )}
      </section>
    </div>
  );
}
