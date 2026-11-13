"use client";

import { type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Funnel,
  Megaphone,
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
  CrmMetaAdInsight,
  CrmPhoneCall,
  CrmProviderConnection,
  CrmStage,
  CrmTask,
} from "../../db/crm";
import { dateTime, initials, money } from "./ui";
import {
  DAY_MS,
  DashboardAreaChart,
  DashboardSparkline,
  bucketSeries,
  ratioTrend,
  seriesTrend,
  timestamp,
  trendLabel,
  type DatedSeries,
  type TrendTone,
} from "./dashboard-charts";

type DashboardDestination =
  | "leads"
  | "pipeline"
  | "calendar"
  | "tasks"
  | "conversations"
  | "connections"
  | "phone-system"
  | "reports";

type KpiTone = "green" | "orange" | "purple";

const SOURCE_COLORS = ["#18b65d", "#ff7a2f", "#6947ff", "#4d8fff", "#9ca3af"];


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

/**
 * Tone for a tile whose caption compares this range with the previous one. The
 * sparkline's own half-over-half tone can disagree with that caption (45 new
 * leads that all arrived early read "+45 vs previous" in red), so when a
 * previous count exists the colour follows the same comparison as the words.
 */
function comparisonTrend(current: number, previous: number): TrendTone {
  if (current === previous) return "neutral";
  return current > previous ? "up" : "down";
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

function DashboardActionButton({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={["button", className]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
    >
      <span className="blob1" aria-hidden="true" />
      <span className="inner">{children}</span>
    </button>
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
  metaAdInsights,
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
  metaAdInsights: CrmMetaAdInsight[];
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
  // Spend comes from the synced daily ad rows rather than a rollup cached on
  // the connection, so it answers for the range the viewer selected and lines
  // up with the leads and revenue it is divided against.
  const reportedAdSpendCents = metaAdInsights.reduce(
    (sum, insight) => sum + insight.spendCents,
    0,
  );
  const reportedAdSpend = reportedAdSpendCents / 100;
  const hasReportedAdSpend = reportedAdSpendCents > 0;
  const adReportingConnected = providerConnections.some(
    (connection) =>
      providerIsAdReporting(connection) &&
      (connection.isActive || connection.isLinked),
  );
  // Only leads carrying a campaign id can be costed. Counting all of them
  // against Meta spend would credit Meta with referrals and organic calls, so
  // the attributed subset is tracked separately and shown as its own number.
  const attributedLeads = leads.filter((lead) => Boolean(lead.metaCampaignId));
  const costPerLeadCents = attributedLeads.length
    ? Math.round(reportedAdSpendCents / attributedLeads.length)
    : null;
  const attributedWonLeads = attributedLeads.filter(
    (lead) => lead.status === "WON",
  );
  const costPerWonCents = attributedWonLeads.length
    ? Math.round(reportedAdSpendCents / attributedWonLeads.length)
    : null;
  // ROAS divides the same attributed subset, never total revenue. A referral,
  // a repeat customer or a job that came off an organic call was not bought
  // with this spend, so counting it would report a return the ads did not
  // earn -- and the busier the rest of the business is, the better the ads
  // would look. Same rule as the Ads tab (lib/meta-ads-report.ts).
  const attributedRevenueCents = attributedWonLeads.reduce(
    (sum, lead) => sum + lead.finalRevenueCents,
    0,
  );
  const roas =
    hasReportedAdSpend && attributedRevenueCents > 0
      ? attributedRevenueCents / reportedAdSpendCents
      : null;
  // The Marketing Snapshot names the revenue the ads actually produced, beside
  // the spend that produced it. Without it the panel shows what was paid and
  // leaves the return to be guessed from the much larger Revenue tile, which is
  // the guess that made ROAS look like a number the ads had earned.
  const attributedRevenueShare =
    revenue > 0 && attributedRevenueCents > 0
      ? Math.round((attributedRevenueCents / revenue) * 100)
      : null;
  const adRevenueSupport = attributedWonLeads.length
    ? [
        `${attributedWonLeads.length} won from ads`,
        attributedRevenueShare == null
          ? null
          : `${attributedRevenueShare}% of revenue`,
      ]
        .filter(Boolean)
        .join(" · ")
    : attributedLeads.length
      ? `${attributedLeads.length} ad ${attributedLeads.length === 1 ? "lead" : "leads"}, none won yet`
      : hasReportedAdSpend
        ? "No leads carried a campaign ID"
        : adReportingConnected
          ? "No spend in this range"
          : "No ad account connected";

  const activeAppointments = appointments.filter(
    (appointment) => !["CANCELED", "CANCELLED"].includes(appointment.status),
  );
  const todaysAppointments = activeAppointments
    .filter(
      (appointment) =>
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
  const appointmentsBooked = activeAppointments.length;
  const appointmentTrend = bucketSeries(
    activeAppointments,
    generatedAtTimestamp,
    range,
    (appointment) => appointment.startsAt,
  );
  const adBudgetCents = configuredBudgetCents;
  const adBudgetUsedPercent =
    adBudgetCents && hasReportedAdSpend
      ? Math.min(100, Math.round((reportedAdSpend / (adBudgetCents / 100)) * 100))
      : 0;
  const adSpendSupport = hasReportedAdSpend
    ? adBudgetCents
      ? `${adBudgetUsedPercent}% of monthly budget`
      : "Connected spend"
    : adBudgetCents
      ? `${money(adBudgetCents, true)} budget set`
      : "No ad spend connected";
  const sourceCounts = leads.reduce((sourceMap, lead) => {
    const label = lead.source.trim() || "Unattributed";
    sourceMap.set(label, (sourceMap.get(label) ?? 0) + 1);
    return sourceMap;
  }, new Map<string, number>());
  const sourceEntries = Array.from(sourceCounts.entries()).sort(
    (first, second) => second[1] - first[1],
  );
  const topSourceEntries = sourceEntries.slice(0, 4);
  const otherSourceCount = sourceEntries
    .slice(4)
    .reduce((sum, [, count]) => sum + count, 0);
  const sourceShareEntries: Array<[string, number]> = otherSourceCount
    ? [...topSourceEntries, ["Other sources", otherSourceCount]]
    : topSourceEntries;
  const totalSourceLeads = sourceShareEntries.reduce(
    (sum, [, count]) => sum + count,
    0,
  );
  const sourceShares = sourceShareEntries.map(([label, count], index) => ({
    label,
    count,
    percent: totalSourceLeads
      ? Math.round((count / totalSourceLeads) * 100)
      : 0,
    color: SOURCE_COLORS[index % SOURCE_COLORS.length],
  }));
  const sourceSegments = sourceShares.reduce<
    Array<{ color: string; start: number; end: number }>
  >((segments, source) => {
    const start = segments.at(-1)?.end ?? 0;
    const end =
      start +
      (totalSourceLeads ? (source.count / totalSourceLeads) * 360 : 0);
    return [...segments, { color: source.color, start, end }];
  }, []);
  const sourceGradient = sourceSegments.length
    ? `conic-gradient(${sourceSegments
        .map(
          (segment) =>
            `${segment.color} ${segment.start.toFixed(1)}deg ${segment.end.toFixed(1)}deg`,
        )
        .join(", ")})`
    : "conic-gradient(#edf1ee 0deg 360deg)";

  const leadSparkline = bucketSeries(
    leads,
    generatedAtTimestamp,
    range,
    (lead) => lead.createdAt,
  );
  const missedCallSparkline = bucketSeries(
    missedCalls,
    generatedAtTimestamp,
    range,
    (call) => call.startedAt,
  );
  const revenueSparkline = bucketSeries(
    wonLeads,
    generatedAtTimestamp,
    range,
    (lead) => lead.updatedAt,
    (lead) => Math.max(0, lead.finalRevenueCents / 100),
  );
  // The tile's ROAS trend divides this, not revenueSparkline, so the arrow
  // moves with the return on the spend rather than with total sales.
  const attributedRevenueSparkline = bucketSeries(
    attributedWonLeads,
    generatedAtTimestamp,
    range,
    (lead) => lead.updatedAt,
    (lead) => Math.max(0, lead.finalRevenueCents / 100),
  );
  const adSpendSparkline = bucketSeries(
    metaAdInsights,
    generatedAtTimestamp,
    range,
    (insight) => insight.date,
    (insight) => insight.spendCents / 100,
  );

  const kpiCards: Array<{
    label: string;
    value: string;
    support: string;
    icon: LucideIcon;
    tone: KpiTone;
    trend: TrendTone;
    trendBasis?: string;
    sparkline: DatedSeries;
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
      trend:
        previousLeads == null
          ? seriesTrend(leadSparkline)
          : comparisonTrend(leads.length, previousLeads),
      trendBasis: previousLeads == null ? undefined : "Compared with the previous range",
      sparkline: leadSparkline,
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
      trend: seriesTrend(missedCallSparkline, true),
      sparkline: missedCallSparkline,
    },
    {
      label: "Revenue",
      value: money(revenue),
      // Cost per won customer only appears once both halves are real: spend
      // that was actually reported, and a win that carried a campaign id.
      support: revenue
        ? costPerWonCents == null
          ? `${wonLeads.length} won leads`
          : `${wonLeads.length} won · ${money(costPerWonCents, true)} to win one`
        : "No revenue recorded",
      icon: CircleDollarSign,
      tone: "green",
      trend: seriesTrend(revenueSparkline),
      sparkline: revenueSparkline,
    },
    {
      label: "Ad spend",
      value: hasReportedAdSpend ? formatProviderSpend(reportedAdSpend) : "-",
      // The headline number is spend, because that is the one this tile can
      // always answer for. ROAS and cost per lead ride underneath, and each
      // appears only once the figures behind it exist -- a ratio with no spend
      // or no revenue is not a zero, it is a question nobody has answered yet.
      support: hasReportedAdSpend
        ? [
            roas == null ? null : `${roas.toFixed(1)}x ROAS`,
            costPerLeadCents == null
              ? null
              : `${money(costPerLeadCents, true)} per lead`,
          ]
            .filter(Boolean)
            .join(" · ") || "No attributed revenue yet"
        : adReportingConnected
          ? "No spend in this range"
          : configuredBudgetCents
            ? `${money(configuredBudgetCents, true)} budget set`
            : "No ad account connected",
      icon: TrendingUp,
      tone: "purple",
      trend: ratioTrend(attributedRevenueSparkline, adSpendSparkline),
      trendBasis: "ROAS",
      sparkline: bucketSeries(
        metaAdInsights,
        generatedAtTimestamp,
        range,
        (insight) => insight.date,
        (insight) => insight.spendCents / 100,
      ),
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
          ({
            label,
            value,
            support,
            icon: Icon,
            tone,
            trend,
            trendBasis,
            sparkline,
          }) => (
            <article
              key={label}
              className={`crm-dashboard-kpi-card is-${tone} is-trend-${trend}`}
              aria-label={`${label}: ${value}. ${support}. ${trendBasis ?? label}: ${trendLabel(trend)}.`}
            >
              <div className="crm-dashboard-card-image">
                <span className="crm-dashboard-icon-box" aria-hidden="true">
                  <Icon />
                </span>
                <DashboardAreaChart
                  values={sparkline}
                  trend={trend}
                  id={label}
                  trendBasis={trendBasis}
                />
              </div>
              <div className="crm-dashboard-card-text">
                <span className="crm-dashboard-kpi-heading">{label}</span>
                <strong>{value}</strong>
                <small>{support}</small>
              </div>
            </article>
          ),
        )}
      </section>

      <section className="crm-panel crm-dashboard-marketing-panel">
        <header>
          <div className="crm-dashboard-widget-heading">
            <Megaphone aria-hidden="true" />
            <h3>Marketing Snapshot</h3>
          </div>
        </header>
        <div className="crm-dashboard-marketing-grid">
          <article className="crm-dashboard-marketing-card">
            <span>Ad Spend</span>
            <strong>
              {hasReportedAdSpend ? formatProviderSpend(reportedAdSpend) : "-"}
            </strong>
            <small>{adSpendSupport}</small>
            <i
              className="crm-dashboard-marketing-progress"
              style={
                {
                  "--marketing-progress": `${adBudgetUsedPercent}%`,
                } as CSSProperties
              }
              aria-hidden="true"
            />
          </article>
          <article className="crm-dashboard-marketing-card">
            <span>Revenue from Ads</span>
            <strong>
              {attributedRevenueCents > 0
                ? formatProviderSpend(attributedRevenueCents / 100)
                : "-"}
            </strong>
            <small>{adRevenueSupport}</small>
          </article>
          <article className="crm-dashboard-marketing-card">
            <span>Appointments Booked</span>
            <strong>{appointmentsBooked}</strong>
            <small>
              {appointmentsBooked
                ? todaysAppointments.length
                  ? `${todaysAppointments.length} today`
                  : "No appointments today"
                : "No appointments booked"}
            </small>
            <DashboardSparkline
              values={appointmentTrend}
              trend={seriesTrend(appointmentTrend)}
              id="appointments-booked"
            />
          </article>
          <article className="crm-dashboard-marketing-card is-sources">
            <span>Lead Sources</span>
            {sourceShares.length ? (
              <div className="crm-dashboard-source-snapshot">
                <div
                  className="crm-dashboard-source-donut"
                  style={
                    {
                      "--source-gradient": sourceGradient,
                    } as CSSProperties
                  }
                  aria-label={`${totalSourceLeads} total leads by source`}
                >
                  <span>Total</span>
                  <strong>{totalSourceLeads}</strong>
                </div>
                <ul>
                  {sourceShares.map((source) => (
                    <li key={source.label}>
                      <i
                        style={{ background: source.color }}
                        aria-hidden="true"
                      />
                      <span>{source.label}</span>
                      <strong>{source.percent}%</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <small>No lead source data yet</small>
            )}
          </article>
        </div>
        <DashboardActionButton
          className="crm-dashboard-marketing-link"
          onClick={() => onNavigate("reports")}
        >
          View full marketing report
        </DashboardActionButton>
      </section>

      <section className="crm-dashboard-duo-grid" aria-label="Action panels">
        <article className="crm-panel crm-dashboard-attention-panel">
          <header>
            <div className="crm-dashboard-widget-heading">
              <AlertTriangle aria-hidden="true" />
              <h3>Needs Attention</h3>
            </div>
            <DashboardActionButton onClick={() => onNavigate("tasks")}>
              View all
            </DashboardActionButton>
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
            <DashboardActionButton onClick={() => onNavigate("calendar")}>
              View calendar
            </DashboardActionButton>
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
          <DashboardActionButton onClick={() => onNavigate("leads")}>
            View all leads
          </DashboardActionButton>
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
