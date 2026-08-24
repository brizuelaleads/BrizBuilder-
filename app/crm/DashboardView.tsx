"use client";

import type { CSSProperties } from "react";
import {
  Activity,
  ChevronRight,
  Funnel,
  PhoneCall,
  TrendingUp,
  UsersRound,
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
import { dateTime, money } from "./ui";

type DashboardDestination =
  | "leads"
  | "pipeline"
  | "calendar"
  | "tasks"
  | "conversations"
  | "connections"
  | "phone-system";

type SourceLabel = "Meta" | "Google" | "Website" | "Referral" | "Other";
type ActivityTone = "green" | "orange" | "muted";

const DAY_MS = 86_400_000;
const SOURCE_LABELS: SourceLabel[] = [
  "Meta",
  "Google",
  "Website",
  "Referral",
  "Other",
];

function timestamp(value: string | null) {
  if (!value) return 0;
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function startOfMonth(value: number) {
  const date = new Date(value || Date.now());
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfPreviousMonth(value: number) {
  const date = new Date(value || Date.now());
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
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

function providerIsMeta(connection: CrmProviderConnection) {
  const provider = connection.provider.toLowerCase();
  return provider.includes("meta") || provider.includes("facebook");
}

function providerIsGoogle(connection: CrmProviderConnection) {
  const provider = connection.provider.toLowerCase();
  return provider.includes("google") || provider === "google_ads";
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

function sourceCategory(lead: CrmLead): SourceLabel {
  const value = `${lead.source} ${lead.campaign ?? ""}`.toLowerCase();
  if (
    value.includes("meta") ||
    value.includes("facebook") ||
    value.includes("instagram")
  ) {
    return "Meta";
  }
  if (
    value.includes("google") ||
    value.includes("adwords") ||
    value.includes("gmb") ||
    value.includes("gbp")
  ) {
    return "Google";
  }
  if (
    value.includes("website") ||
    value.includes("form") ||
    value.includes("landing") ||
    value.includes("site")
  ) {
    return "Website";
  }
  if (value.includes("referral") || value.includes("refer")) {
    return "Referral";
  }
  return "Other";
}

function bucketSeries<T>(
  items: T[],
  generatedAtTimestamp: number,
  range: string,
  getTime: (item: T) => string | null,
  getValue: (item: T) => number = () => 1,
) {
  const buckets = Array.from({ length: 10 }, () => 0);
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

function chartPoints(values: number[], width: number, height: number) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const top = 12;
  const bottom = height - 10;
  const drawable = bottom - top;

  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = bottom - ((value - min) / range) * drawable;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function DashboardAreaChart({
  values,
  tone = "green",
}: {
  values: number[];
  tone?: "green" | "orange";
}) {
  const width = 280;
  const height = 124;
  const points = chartPoints(values, width, height);
  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg
      className={`crm-dashboard-premium-chart is-${tone}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={areaPoints} />
      <polyline points={points} />
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
    <div className="crm-dashboard-premium-empty">
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
  const weekStart = generatedAtTimestamp - 7 * DAY_MS;
  const previousWeekStart = weekStart - 7 * DAY_MS;
  const monthStart = startOfMonth(generatedAtTimestamp);
  const previousMonthStart = startOfPreviousMonth(generatedAtTimestamp);

  const openPipelineLeads = pipelineLeads.filter(isInactiveLead);
  const pipelineValue = openPipelineLeads.reduce(
    (sum, lead) => sum + lead.estimatedValueCents,
    0,
  );
  const wonLeads = pipelineLeads.filter((lead) => lead.status === "WON");
  const totalRevenue = wonLeads.reduce(
    (sum, lead) => sum + lead.finalRevenueCents,
    0,
  );
  const revenueThisMonth = wonLeads
    .filter((lead) => timestamp(lead.updatedAt) >= monthStart)
    .reduce((sum, lead) => sum + lead.finalRevenueCents, 0);
  const previousMonthRevenue = wonLeads
    .filter((lead) => {
      const updatedAt = timestamp(lead.updatedAt);
      return updatedAt >= previousMonthStart && updatedAt < monthStart;
    })
    .reduce((sum, lead) => sum + lead.finalRevenueCents, 0);
  const revenueMonthLabel =
    revenueThisMonth > previousMonthRevenue
      ? `Up ${money(revenueThisMonth, true)} this month`
      : revenueThisMonth
        ? `${money(revenueThisMonth, true)} won this month`
        : "No won revenue this month";
  const pipelineTrend = bucketSeries(
    openPipelineLeads,
    generatedAtTimestamp,
    range,
    (lead) => lead.createdAt,
    (lead) => Math.max(0, lead.estimatedValueCents / 100),
  );

  const leadsThisWeek = pipelineLeads.filter(
    (lead) => timestamp(lead.createdAt) >= weekStart,
  );
  const previousWeekLeads = pipelineLeads.filter((lead) => {
    const createdAt = timestamp(lead.createdAt);
    return createdAt >= previousWeekStart && createdAt < weekStart;
  });
  const weeklyLeadGoal = Math.max(
    10,
    Math.ceil(
      (Math.max(leadsThisWeek.length, previousWeekLeads.length, 1) * 1.2) / 5,
    ) * 5,
  );
  const leadGoalPercent = clampPercent(
    (leadsThisWeek.length / weeklyLeadGoal) * 100,
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
  const missedCallTexts = missedCalls.filter(
    (call) => call.missedCallTextSentAt,
  ).length;
  const openFollowUps = tasks.filter(isOpenTask).length;

  const sourceBreakdown = SOURCE_LABELS.map((label) => ({
    label,
    count: leads.filter((lead) => sourceCategory(lead) === label).length,
  }));
  const maxSourceCount = Math.max(
    1,
    ...sourceBreakdown.map((item) => item.count),
  );
  const topSourceBreakdown = [...sourceBreakdown]
    .filter((item) => item.count > 0)
    .sort((first, second) => second.count - first.count)
    .slice(0, 3);

  const configuredBudgetCents = clients.reduce(
    (sum, client) => sum + client.monthlyAdBudgetCents,
    0,
  );
  const adConnections = providerConnections.filter(
    (connection) =>
      providerIsAdReporting(connection) &&
      (connection.isActive || connection.isLinked) &&
      connection.monthSpend != null,
  );
  const reportedAdSpend = adConnections.reduce(
    (sum, connection) => sum + (connection.monthSpend ?? 0),
    0,
  );
  const metaSpend = adConnections
    .filter(providerIsMeta)
    .reduce((sum, connection) => sum + (connection.monthSpend ?? 0), 0);
  const googleSpend = adConnections
    .filter(providerIsGoogle)
    .reduce((sum, connection) => sum + (connection.monthSpend ?? 0), 0);
  const adBudgetDollars = configuredBudgetCents / 100;
  const adBudgetUsedPercent = clampPercent(
    adBudgetDollars ? (reportedAdSpend / adBudgetDollars) * 100 : 0,
  );
  const remainingAdBudgetCents = Math.max(
    0,
    configuredBudgetCents - Math.round(reportedAdSpend * 100),
  );
  const adLeadCount = leads.filter((lead) =>
    ["Meta", "Google"].includes(sourceCategory(lead)),
  ).length;
  const costPerLead = adLeadCount ? reportedAdSpend / adLeadCount : null;
  const roas =
    reportedAdSpend > 0 && totalRevenue > 0
      ? totalRevenue / 100 / reportedAdSpend
      : null;

  const upcomingAppointments = appointments
    .filter(
      (appointment) =>
        !["CANCELED", "CANCELLED"].includes(appointment.status) &&
        timestamp(appointment.startsAt) >= generatedAtTimestamp,
    )
    .sort(
      (first, second) =>
        timestamp(first.startsAt) - timestamp(second.startsAt),
    )
    .slice(0, 4);
  const todaysAppointments = upcomingAppointments.filter(
    (appointment) =>
      dateKey(appointment.startsAt) === dateKey(generatedAtTimestamp),
  );

  const recentActivity: Array<{
    id: string;
    title: string;
    detail: string;
    occurredAt: string;
    tone: ActivityTone;
    destination: DashboardDestination;
    lead?: CrmLead;
  }> = [
    ...missedCalls.map((call) => ({
      id: `missed-${call.id}`,
      title: "Missed call",
      detail: call.missedCallTextSentAt
        ? "Auto text sent"
        : "Needs follow up",
      occurredAt: call.startedAt,
      tone: "orange" as ActivityTone,
      destination: "conversations" as DashboardDestination,
    })),
    ...phoneCalls
      .filter((call) => !isMissedCall(call))
      .map((call) => ({
        id: `call-${call.id}`,
        title:
          call.direction.toLowerCase() === "outbound"
            ? "Outbound call"
            : "Call logged",
        detail:
          call.durationSeconds && call.durationSeconds > 0
            ? `${Math.round(call.durationSeconds / 60)} min call`
            : "Conversation recorded",
        occurredAt: call.startedAt,
        tone: "muted" as ActivityTone,
        destination: "conversations" as DashboardDestination,
      })),
    ...leads.map((lead) => ({
      id: `lead-${lead.id}`,
      title:
        sourceCategory(lead) === "Website"
          ? "Form submission"
          : displayLeadName(lead),
      detail: `${lead.source || "Manual"} - ${lead.serviceRequested}`,
      occurredAt: lead.createdAt,
      tone: "green" as ActivityTone,
      destination: "leads" as DashboardDestination,
      lead,
    })),
    ...wonLeads.map((lead) => ({
      id: `won-${lead.id}`,
      title: "Booked job",
      detail: `${displayLeadName(lead)} - ${money(lead.finalRevenueCents)}`,
      occurredAt: lead.updatedAt,
      tone: "green" as ActivityTone,
      destination: "pipeline" as DashboardDestination,
      lead,
    })),
  ]
    .filter((item) => timestamp(item.occurredAt) > 0)
    .sort(
      (first, second) =>
        timestamp(second.occurredAt) - timestamp(first.occurredAt),
    )
    .slice(0, 5);

  return (
    <div className="crm-view crm-dashboard-view crm-dashboard-premium">
      <section
        className="crm-dashboard-premium-grid"
        aria-label="Business snapshot"
      >
        <article className="crm-dashboard-premium-card is-revenue">
          <header className="crm-dashboard-premium-card-header">
            <div>
              <span className="crm-dashboard-premium-eyebrow">
                Revenue / Pipeline Value
              </span>
              <h3>What is on the table?</h3>
            </div>
            <span className="crm-dashboard-premium-badge is-green">
              {revenueMonthLabel}
            </span>
          </header>
          <div className="crm-dashboard-premium-value">
            {money(pipelineValue)}
          </div>
          <p className="crm-dashboard-premium-muted">
            Open pipeline across {openPipelineLeads.length} active leads.
          </p>
          <DashboardAreaChart values={pipelineTrend} />
          <div className="crm-dashboard-premium-split">
            <span>
              <small>Won revenue</small>
              <strong>{money(totalRevenue)}</strong>
            </span>
            <span>
              <small>View</small>
              <button type="button" onClick={() => onNavigate("pipeline")}>
                Pipeline
              </button>
            </span>
          </div>
        </article>

        <article className="crm-dashboard-premium-card is-leads">
          <header className="crm-dashboard-premium-card-header">
            <div>
              <span className="crm-dashboard-premium-eyebrow">
                Leads This Week
              </span>
              <h3>Are we on pace?</h3>
            </div>
            <span className="crm-dashboard-premium-icon" aria-hidden="true">
              <UsersRound />
            </span>
          </header>
          <div className="crm-dashboard-premium-value">
            {leadsThisWeek.length}
          </div>
          <div className="crm-dashboard-premium-progress-label">
            <span>Goal {weeklyLeadGoal}</span>
            <strong>{Math.round(leadGoalPercent)}%</strong>
          </div>
          <div
            className="crm-dashboard-premium-progress"
            style={
              {
                "--dashboard-progress": `${leadGoalPercent}%`,
              } as CSSProperties
            }
          >
            <span />
          </div>
          <div className="crm-dashboard-premium-source-chips">
            {topSourceBreakdown.length ? (
              topSourceBreakdown.map((source) => (
                <span key={source.label}>
                  <b>{source.label}</b>
                  {source.count}
                </span>
              ))
            ) : (
              <span>
                <b>No leads</b>
                This week
              </span>
            )}
          </div>
        </article>

        <article className="crm-dashboard-premium-card is-missed">
          <header className="crm-dashboard-premium-card-header">
            <div>
              <span className="crm-dashboard-premium-eyebrow">
                Missed Calls
              </span>
              <h3>Who needs follow up?</h3>
            </div>
            <span
              className="crm-dashboard-premium-icon is-alert"
              aria-hidden="true"
            >
              <PhoneCall />
            </span>
          </header>
          <div className="crm-dashboard-premium-value is-alert">
            {callTrackingConnected ? missedCalls.length : "-"}
          </div>
          <p className="crm-dashboard-premium-muted">
            {callTrackingConnected
              ? missedCalls.length
                ? "Needs follow up"
                : "No missed calls"
              : "Call tracking not connected"}
          </p>
          <div className="crm-dashboard-premium-alert-row">
            <span>
              <strong>{missedCallTexts}</strong>
              auto-texts
            </span>
            <span>
              <strong>{openFollowUps}</strong>
              open follow-ups
            </span>
          </div>
          <button
            type="button"
            className="crm-dashboard-premium-action"
            onClick={() =>
              onNavigate(callTrackingConnected ? "conversations" : "phone-system")
            }
          >
            Open calls
            <ChevronRight aria-hidden="true" />
          </button>
        </article>

        <article className="crm-dashboard-premium-card is-sources">
          <header className="crm-dashboard-premium-card-header">
            <div>
              <span className="crm-dashboard-premium-eyebrow">
                Lead Sources
              </span>
              <h3>Where are leads coming from?</h3>
            </div>
            <span className="crm-dashboard-premium-icon" aria-hidden="true">
              <Funnel />
            </span>
          </header>
          <div className="crm-dashboard-source-bars">
            {sourceBreakdown.map((source) => (
              <div className="crm-dashboard-source-row" key={source.label}>
                <span>{source.label}</span>
                <i
                  style={
                    {
                      "--dashboard-source": `${
                        source.count
                          ? Math.max(7, (source.count / maxSourceCount) * 100)
                          : 0
                      }%`,
                    } as CSSProperties
                  }
                  aria-hidden="true"
                >
                  <b />
                </i>
                <strong>{source.count}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="crm-dashboard-premium-card is-ad">
          <header className="crm-dashboard-premium-card-header">
            <div>
              <span className="crm-dashboard-premium-eyebrow">
                Ad Spend / ROAS
              </span>
              <h3>Is spend turning into leads?</h3>
            </div>
            <span className="crm-dashboard-premium-icon" aria-hidden="true">
              <TrendingUp />
            </span>
          </header>
          <div className="crm-dashboard-ad-body">
            <div
              className="crm-dashboard-donut"
              style={
                {
                  "--dashboard-donut": `${adBudgetUsedPercent * 3.6}deg`,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              <span>{Math.round(adBudgetUsedPercent)}%</span>
            </div>
            <div>
              <strong>{formatProviderSpend(reportedAdSpend)}</strong>
              <small>Budget used</small>
              <em>
                {configuredBudgetCents
                  ? `${money(remainingAdBudgetCents, true)} remaining`
                  : "No budget set"}
              </em>
            </div>
          </div>
          <dl className="crm-dashboard-ad-metrics">
            <div>
              <dt>Meta</dt>
              <dd>{formatProviderSpend(metaSpend)}</dd>
            </div>
            <div>
              <dt>Google</dt>
              <dd>{formatProviderSpend(googleSpend)}</dd>
            </div>
            <div>
              <dt>Leads</dt>
              <dd>{adLeadCount}</dd>
            </div>
            <div>
              <dt>CPL</dt>
              <dd>
                {costPerLead == null ? "-" : formatProviderSpend(costPerLead)}
              </dd>
            </div>
          </dl>
          <p className="crm-dashboard-premium-muted">
            {roas == null ? "ROAS unavailable" : `${roas.toFixed(1)}x ROAS`}
          </p>
        </article>

        <article className="crm-dashboard-premium-card is-appointments">
          <header className="crm-dashboard-premium-card-header">
            <div>
              <span className="crm-dashboard-premium-eyebrow">
                Upcoming Appointments
              </span>
              <h3>What is next on the calendar?</h3>
            </div>
            <button type="button" onClick={() => onNavigate("calendar")}>
              View calendar
            </button>
          </header>
          {upcomingAppointments.length ? (
            <div className="crm-dashboard-premium-list">
              {upcomingAppointments.map((appointment) => (
                <button
                  key={appointment.id}
                  type="button"
                  onClick={() => onNavigate("calendar")}
                >
                  <time>{timeOnly(appointment.startsAt)}</time>
                  <span>
                    <strong>{appointment.contactName}</strong>
                    <small>
                      {appointment.serviceType} - {durationLabel(appointment)}
                    </small>
                  </span>
                  <em>
                    {dateKey(appointment.startsAt) === dateKey(generatedAtTimestamp)
                      ? "Today"
                      : dateTime(appointment.startsAt).split(",")[0]}
                  </em>
                </button>
              ))}
            </div>
          ) : (
            <DashboardEmpty
              title="No upcoming appointments"
              detail="Booked appointments will appear here."
            />
          )}
          <p className="crm-dashboard-premium-footnote">
            {todaysAppointments.length
              ? `${todaysAppointments.length} scheduled today`
              : "Calendar is clear today"}
          </p>
        </article>

        <article className="crm-dashboard-premium-card is-activity">
          <header className="crm-dashboard-premium-card-header">
            <div>
              <span className="crm-dashboard-premium-eyebrow">
                Recent Activity
              </span>
              <h3>What just happened?</h3>
            </div>
            <span className="crm-dashboard-premium-icon" aria-hidden="true">
              <Activity />
            </span>
          </header>
          {recentActivity.length ? (
            <div className="crm-dashboard-activity-list">
              {recentActivity.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    item.lead ? onOpenLead(item.lead) : onNavigate(item.destination)
                  }
                >
                  <i className={`is-${item.tone}`} aria-hidden="true" />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <em>{relativeTime(item.occurredAt, generatedAtTimestamp)}</em>
                </button>
              ))}
            </div>
          ) : (
            <DashboardEmpty
              title="No recent activity"
              detail="Calls, forms, and booked jobs will appear here."
            />
          )}
        </article>
      </section>
    </div>
  );
}
