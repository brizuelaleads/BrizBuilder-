"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  CircleCheck,
  CircleDollarSign,
  CircleMinus,
  Funnel,
  Megaphone,
  PlugZap,
  TrendingUp,
  TriangleAlert,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  CrmAppointment,
  CrmClient,
  CrmLead,
  CrmMetaAdInsight,
  CrmMetaAdsBackfill,
  CrmProviderConnection,
} from "../../db/crm";
import {
  buildAdsReport,
  type AdsReportAd,
  type AdsReportCampaign,
} from "../../lib/meta-ads-report";
import {
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
import { Badge, EmptyState } from "./ui";

// The URL parameters an ad must carry for a click to be traceable. Written out
// here rather than assembled, so what the operator copies is the literal text
// in the source.
const URL_PARAMETERS =
  "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}" +
  "&utm_term={{adset.id}}&utm_content={{ad.id}}";

const RANGE_LABELS: Record<string, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  all: "All time",
};

// The Dashboard's lead-source colours, so a source reads the same on both tabs.
const SOURCE_COLORS = ["#18b65d", "#ff7a2f", "#6947ff", "#4d8fff", "#9ca3af"];

const LEAD_STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  APPOINTMENT_BOOKED: "Booked",
  ESTIMATE_SENT: "Estimate sent",
  WON: "Won",
  LOST: "Lost",
  SPAM: "Spam",
  UNRESPONSIVE: "No response",
};

function ratio(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1)}x`;
}

function percent(value: number | null) {
  return value == null ? "—" : `${(value * 100).toFixed(2)}%`;
}

/** A share of a step; null when there is nothing to take a share of. */
function share(part: number, whole: number) {
  if (whole <= 0) return null;
  const value = (part / whole) * 100;
  return `${value >= 10 || value === 0 ? Math.round(value) : value.toFixed(1)}%`;
}

/**
 * Exact dollars: ad decisions turn on the difference between $1,213 and
 * $1,000, which a compact "$1K" hides. Under $10 keeps its cents, so a cost
 * per click reads $1.27 rather than $1.
 */
function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(cents) < 1000 ? 2 : 0,
  }).format(cents / 100);
}

/** A cost with no denominator reads as unknown, never as zero. */
function cost(value: number | null) {
  return value == null ? "—" : dollars(value);
}

function count(value: number) {
  return value.toLocaleString();
}

function plural(value: number, one: string, many = `${one}s`) {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/** Ad set names are not synced, so an ad set is told apart by its id's tail. */
function adsetLabel(adsetId: string) {
  return `Ad set ···${adsetId.slice(-4)}`;
}

type ReturnTone = "green" | "red" | "neutral";

/**
 * Whether the revenue traced to the ads exceeded what they cost. A plain
 * statement of the two numbers, not a judgement of the campaign: below 1x
 * means the recorded revenue has not yet covered the spend.
 */
function returnVerdict(roas: number | null): {
  tone: ReturnTone;
  label: string;
  icon: LucideIcon;
} {
  if (roas == null)
    return { tone: "neutral", label: "Not enough results yet", icon: CircleMinus };
  if (roas >= 1)
    return { tone: "green", label: "Earning more than it costs", icon: CircleCheck };
  return { tone: "red", label: "Costing more than it has earned", icon: TriangleAlert };
}

function Verdict({ roas }: { roas: number | null }) {
  const verdict = returnVerdict(roas);
  const Icon = verdict.icon;
  return (
    <span className={`crm-ads-verdict is-${verdict.tone}`}>
      <Icon aria-hidden="true" />
      {verdict.label}
    </span>
  );
}

function SnippetBox() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="crm-ads-snippet">
      <code>{URL_PARAMETERS}</code>
      <button
        type="button"
        className="crm-button-secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(URL_PARAMETERS);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard access can be refused. The text is selectable, so this
            // is a convenience rather than the only way to get it.
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

type KpiCard = {
  label: string;
  value: string;
  support: string;
  icon: LucideIcon;
  tone: "green" | "orange" | "purple";
  trend: TrendTone;
  trendBasis?: string;
  series: DatedSeries;
  money?: boolean;
};

/** The Dashboard's stat card, unchanged, so the two tabs read as one product. */
function AdsKpiCard({ card }: { card: KpiCard }) {
  const Icon = card.icon;
  return (
    <article
      className={`crm-dashboard-kpi-card is-${card.tone} is-trend-${card.trend}`}
      aria-label={`${card.label}: ${card.value}. ${card.support}. ${card.trendBasis ?? card.label}: ${trendLabel(card.trend)}.`}
    >
      <div className="crm-dashboard-card-image">
        <span className="crm-dashboard-icon-box" aria-hidden="true">
          <Icon />
        </span>
        <DashboardAreaChart
          values={card.series}
          trend={card.trend}
          id={card.label}
          trendBasis={card.trendBasis}
          money={card.money}
        />
      </div>
      <div className="crm-dashboard-card-text">
        <span className="crm-dashboard-kpi-heading">{card.label}</span>
        <strong>{card.value}</strong>
        <small>{card.support}</small>
      </div>
    </article>
  );
}

/** One step from click to customer: how many, what each cost, how many moved on. */
function FunnelStep({
  label,
  value,
  each,
  rate,
  rateLabel,
}: {
  label: string;
  value: number;
  each: number | null;
  rate?: string | null;
  rateLabel?: string;
}) {
  return (
    <li className="crm-ads-step">
      {rateLabel ? (
        <span className="crm-ads-step-rate">
          <ArrowRight aria-hidden="true" />
          <strong>{rate ?? "—"}</strong> {rateLabel}
        </span>
      ) : null}
      <span className="crm-ads-step-label">{label}</span>
      <strong className="crm-ads-step-value">{count(value)}</strong>
      <small>{each == null ? "No cost yet" : `${dollars(each)} each`}</small>
    </li>
  );
}

/**
 * One campaign, opened over the table, read top to bottom: what it returned,
 * which ads did the work, and which people it brought in.
 */
function CampaignDrawer({
  campaign,
  leads,
  onOpenLead,
  onClose,
}: {
  campaign: AdsReportCampaign;
  leads: CrmLead[];
  onOpenLead: (lead: CrmLead) => void;
  onClose: () => void;
}) {
  // Most campaigns run one ad set, so ads are listed directly; the ad set only
  // appears as a tag when there is more than one to tell apart.
  const multipleAdsets = campaign.adsets.length > 1;
  const ads: Array<AdsReportAd & { adsetId: string }> = campaign.adsets
    .flatMap((adset) => adset.ads.map((ad) => ({ ...ad, adsetId: adset.adsetId })))
    .sort((a, b) => b.spendCents - a.spendCents);
  const withLeads = ads.filter((ad) => ad.costPerLeadCents != null);
  const bestAdId =
    withLeads.length > 1
      ? withLeads.reduce((best, ad) =>
          (ad.costPerLeadCents ?? Infinity) < (best.costPerLeadCents ?? Infinity) ? ad : best,
        ).adId
      : null;
  const orderedLeads = [...leads].sort((a, b) => {
    const rank = (lead: CrmLead) => (lead.status === "WON" ? 0 : ["LOST", "SPAM", "UNRESPONSIVE"].includes(lead.status) ? 2 : 1);
    return rank(a) - rank(b);
  });

  return (
    <div
      className="crm-ads-drawer-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="crm-ads-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Campaign details for ${campaign.campaignName}`}
      >
        <header>
          <div>
            <p>CAMPAIGN</p>
            <h3>{campaign.campaignName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close campaign"
            title="Close campaign"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="crm-ads-drawer-body">
          <section className="crm-ads-drawer-intro" aria-label="Campaign summary">
            <p>
              <strong>{dollars(campaign.spendCents)}</strong> spent brought in{" "}
              <strong>{plural(campaign.leads, "lead")}</strong> and{" "}
              <strong>{plural(campaign.won, "won customer")}</strong> worth{" "}
              <strong>{dollars(campaign.revenueCents)}</strong>.
            </p>
            <Verdict roas={campaign.roas} />
            <dl className="crm-ads-drawer-stats">
              <div>
                <dt>Spent</dt>
                <dd>{dollars(campaign.spendCents)}</dd>
              </div>
              <div>
                <dt>Leads</dt>
                <dd>{count(campaign.leads)}</dd>
              </div>
              <div>
                <dt>Cost per lead</dt>
                <dd>{cost(campaign.costPerLeadCents)}</dd>
              </div>
              <div>
                <dt>Return</dt>
                <dd>{ratio(campaign.roas)}</dd>
              </div>
            </dl>
          </section>

          <section aria-label="Ads in this campaign">
            <h4>
              Ads in this campaign
              <Badge tone="neutral">{ads.length}</Badge>
            </h4>
            {ads.length === 0 ? (
              <p className="crm-ads-quiet">No ads ran in this range.</p>
            ) : (
              <ol className="crm-ads-ad-list">
                {ads.map((ad) => {
                  const spendShare =
                    campaign.spendCents > 0 ? ad.spendCents / campaign.spendCents : 0;
                  return (
                    <li key={ad.adId} className="crm-ads-ad">
                      <div className="crm-ads-ad-head">
                        <strong>{ad.adName}</strong>
                        {ad.adId === bestAdId ? (
                          <em className="crm-ads-best">Cheapest leads</em>
                        ) : null}
                        {multipleAdsets ? (
                          <small title={`Ad set ID ${ad.adsetId}`}>{adsetLabel(ad.adsetId)}</small>
                        ) : null}
                      </div>
                      <span
                        className="crm-ads-share"
                        role="img"
                        aria-label={`${Math.round(spendShare * 100)}% of this campaign's spend`}
                      >
                        <span style={{ width: `${Math.max(spendShare * 100, spendShare > 0 ? 2 : 0)}%` } as CSSProperties} />
                      </span>
                      <dl>
                        <div>
                          <dt>Spent</dt>
                          <dd>{dollars(ad.spendCents)}</dd>
                        </div>
                        <div>
                          <dt>Leads</dt>
                          <dd>{count(ad.leads)}</dd>
                        </div>
                        <div>
                          <dt>Cost per lead</dt>
                          <dd>{cost(ad.costPerLeadCents)}</dd>
                        </div>
                        <div>
                          <dt>Won</dt>
                          <dd>{count(ad.won)}</dd>
                        </div>
                      </dl>
                      {ad.leads === 0 ? (
                        <p className="crm-ads-quiet">No leads from this ad yet.</p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section aria-label="Leads from this campaign">
            <h4>
              Leads from this campaign
              <Badge tone="neutral">{leads.length}</Badge>
            </h4>
            {leads.length === 0 ? (
              <p className="crm-ads-quiet">
                Spend recorded, but no lead has carried this campaign yet.
              </p>
            ) : (
              <ul className="crm-ads-campaign-leads">
                {orderedLeads.map((lead) => (
                  <li key={lead.id}>
                    <button type="button" onClick={() => onOpenLead(lead)}>
                      <span>
                        <strong>
                          {lead.firstName} {lead.lastName}
                        </strong>
                        <small>{lead.serviceRequested}</small>
                      </span>
                      {lead.status === "WON" ? (
                        <span className="crm-ads-lead-value">{dollars(lead.finalRevenueCents)}</span>
                      ) : null}
                      <Badge
                        tone={
                          lead.status === "WON"
                            ? "green"
                            : ["LOST", "SPAM", "UNRESPONSIVE"].includes(lead.status)
                              ? "red"
                              : "blue"
                        }
                      >
                        {LEAD_STATUS_LABELS[lead.status] ?? lead.status.replaceAll("_", " ")}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

export function AdsView({
  leads,
  appointments,
  metaAdInsights,
  providerConnections,
  metaAdsBackfills,
  clients,
  selectedClientId,
  range,
  generatedAt,
  onOpenLead,
  onOpenConnections,
}: {
  leads: CrmLead[];
  appointments: CrmAppointment[];
  metaAdInsights: CrmMetaAdInsight[];
  providerConnections: CrmProviderConnection[];
  metaAdsBackfills: CrmMetaAdsBackfill[];
  clients: CrmClient[];
  selectedClientId: string;
  range: string;
  generatedAt: string;
  onOpenLead: (lead: CrmLead) => void;
  onOpenConnections: () => void;
}) {
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(null);

  const connected = providerConnections.some(
    (connection) =>
      connection.provider === "meta_ads" &&
      (connection.isActive || connection.isLinked),
  );

  // Read the clock once on mount: it is impure, and a boundary that drifted
  // mid-session would make the "older spend is missing" notice come and go on
  // its own.
  const [openedAt] = useState(() => Date.now());
  const rangeStart = useMemo(() => {
    const days = Number(range);
    if (range === "all" || !Number.isFinite(days) || days <= 0) return null;
    return new Date(openedAt - days * 86_400_000).toISOString().slice(0, 10);
  }, [range, openedAt]);

  const report = useMemo(
    () =>
      buildAdsReport({
        insights: metaAdInsights,
        leads: leads.map((lead) => ({
          id: lead.id,
          metaCampaignId: lead.metaCampaignId,
          metaAdsetId: lead.metaAdsetId,
          metaAdId: lead.metaAdId,
          status: lead.status,
          finalRevenueCents: lead.finalRevenueCents,
        })),
        connected,
        rangeStart,
      }),
    [metaAdInsights, leads, connected, rangeStart],
  );

  const backfill = metaAdsBackfills.find(
    (run) => selectedClientId === "all" || run.clientId === selectedClientId,
  );
  const currency = providerConnections.find(
    (connection) => connection.provider === "meta_ads",
  )?.currency;
  const leadsByCampaign = useMemo(() => {
    const grouped = new Map<string, CrmLead[]>();
    for (const lead of leads) {
      if (!lead.metaCampaignId) continue;
      const list = grouped.get(lead.metaCampaignId) ?? [];
      list.push(lead);
      grouped.set(lead.metaCampaignId, list);
    }
    return grouped;
  }, [leads]);

  // The campaign that returned the most per dollar, named only when there is
  // more than one to compare.
  const bestCampaignId = useMemo(() => {
    const ranked = report.campaigns.filter((c) => c.roas != null);
    if (ranked.length < 2) return null;
    return ranked.reduce((best, c) => ((c.roas ?? 0) > (best.roas ?? 0) ? c : best))
      .campaignId;
  }, [report.campaigns]);

  const openCampaign = openCampaignId
    ? report.campaigns.find((c) => c.campaignId === openCampaignId)
    : undefined;

  const rangeLabel = RANGE_LABELS[range] ?? `Last ${range} days`;
  const totals = report.totals;
  const generatedAtTimestamp = timestamp(generatedAt);

  // ---- The Dashboard's numbers, computed the same way. ----
  const adLeads = leads.filter((lead) => Boolean(lead.metaCampaignId));
  const adWonLeads = adLeads.filter((lead) => lead.status === "WON");
  const totalRevenueCents = leads
    .filter((lead) => lead.status === "WON")
    .reduce((sum, lead) => sum + lead.finalRevenueCents, 0);
  const adRevenueShare =
    totalRevenueCents > 0 && totals.revenueCents > 0
      ? Math.round((totals.revenueCents / totalRevenueCents) * 100)
      : null;
  const budgetCents = clients.reduce((sum, client) => sum + client.monthlyAdBudgetCents, 0);
  // Spend over the last 30 days against a monthly budget is a fair comparison;
  // 7 or 90 days against a month is not, so the percentage is only stated for
  // the 30-day view. The real figure is shown, overspend included; only the
  // bar is capped at full.
  const budgetComparable = budgetCents > 0 && range === "30";
  const budgetUsedPercent =
    budgetComparable && totals.spendCents
      ? Math.round((totals.spendCents / budgetCents) * 100)
      : 0;
  const budgetText = !budgetCents
    ? null
    : budgetComparable
      ? `${budgetUsedPercent}% of ${dollars(budgetCents)} monthly budget`
      : `${dollars(budgetCents)} monthly budget`;

  const spendSeries = bucketSeries(metaAdInsights, generatedAtTimestamp, range, (insight) => insight.date, (insight) => insight.spendCents / 100);
  const adLeadSeries = bucketSeries(adLeads, generatedAtTimestamp, range, (lead) => lead.createdAt);
  const adRevenueSeries = bucketSeries(adWonLeads, generatedAtTimestamp, range, (lead) => lead.updatedAt, (lead) => Math.max(0, lead.finalRevenueCents / 100));

  const kpiCards: KpiCard[] = [
    {
      label: "Ad spend",
      value: dollars(totals.spendCents),
      support: budgetText ?? `${count(totals.clicks)} clicks · ${percent(totals.ctr)} clicked`,
      icon: TrendingUp,
      tone: "purple",
      // As on the Dashboard: spending less is not bad and more is not good, so
      // the card's colour follows the return on that spend instead.
      trend: ratioTrend(adRevenueSeries, spendSeries),
      trendBasis: "Return on ad spend",
      series: spendSeries,
      money: true,
    },
    {
      label: "Leads from ads",
      value: count(totals.leads),
      support: totals.costPerLeadCents == null ? "No traced leads yet" : `${dollars(totals.costPerLeadCents)} per lead`,
      icon: UsersRound,
      tone: "green",
      trend: seriesTrend(adLeadSeries),
      series: adLeadSeries,
    },
    {
      label: "Revenue from ads",
      value: dollars(totals.revenueCents),
      support: [
        plural(totals.won, "won customer"),
        adRevenueShare == null ? null : `${adRevenueShare}% of all revenue`,
      ]
        .filter(Boolean)
        .join(" · "),
      icon: CircleDollarSign,
      tone: "green",
      trend: seriesTrend(adRevenueSeries),
      series: adRevenueSeries,
      money: true,
    },
    {
      label: "Return on ad spend",
      value: ratio(totals.roas),
      support:
        totals.roas == null
          ? "Needs both spend and recorded revenue"
          : `$${totals.roas.toFixed(2)} back for every $1 spent`,
      icon: Megaphone,
      tone: totals.roas != null && totals.roas < 1 ? "orange" : "green",
      // The arrow follows the return, not total sales: revenue over spend,
      // first half of the range against the second.
      trend: ratioTrend(adRevenueSeries, spendSeries),
      trendBasis: "Return on ad spend",
      series: adRevenueSeries,
      money: true,
    },
  ];

  // ---- Marketing Snapshot: the Dashboard panel, for the same range. ----
  const activeAppointments = appointments.filter(
    (appointment) => !["CANCELED", "CANCELLED"].includes(appointment.status),
  );
  const todayKey = new Date(generatedAtTimestamp).toDateString();
  const appointmentsToday = activeAppointments.filter(
    (appointment) => new Date(timestamp(appointment.startsAt)).toDateString() === todayKey,
  ).length;
  const appointmentSeries = bucketSeries(activeAppointments, generatedAtTimestamp, range, (appointment) => appointment.startsAt);
  const sourceCounts = new Map<string, number>();
  for (const lead of leads) {
    const label = lead.source.trim() || "Unattributed";
    sourceCounts.set(label, (sourceCounts.get(label) ?? 0) + 1);
  }
  const sortedSources = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]);
  const otherSources = sortedSources.slice(4).reduce((sum, [, n]) => sum + n, 0);
  const sourceEntries: Array<[string, number]> = otherSources
    ? [...sortedSources.slice(0, 4), ["Other sources", otherSources]]
    : sortedSources.slice(0, 4);
  const totalSourceLeads = sourceEntries.reduce((sum, [, n]) => sum + n, 0);
  const sources = sourceEntries.map(([label, n], index) => ({
    label,
    percent: totalSourceLeads ? Math.round((n / totalSourceLeads) * 100) : 0,
    color: SOURCE_COLORS[index % SOURCE_COLORS.length],
    degrees: totalSourceLeads ? (n / totalSourceLeads) * 360 : 0,
  }));
  let sourceCursor = 0;
  const sourceGradient = sources.length
    ? `conic-gradient(${sources
        .map((source) => {
          const start = sourceCursor;
          sourceCursor += source.degrees;
          return `${source.color} ${start.toFixed(1)}deg ${sourceCursor.toFixed(1)}deg`;
        })
        .join(", ")})`
    : "conic-gradient(#edf1ee 0deg 360deg)";

  const heading = (
    <section className="crm-page-heading">
      <div>
        <p>MARKETING</p>
        <h2>Ads</h2>
        <span>
          {report.setupState === "ready" || report.setupState === "missing_url_parameters"
            ? `${dollars(totals.spendCents)} in Meta ads brought in ${plural(totals.leads, "lead")} and ${plural(totals.won, "won customer")} worth ${dollars(totals.revenueCents)}.`
            : "What Meta advertising cost, and what it produced."}
          {currency && currency !== "USD" ? ` Amounts in ${currency}.` : ""}
        </span>
      </div>
      {report.setupState === "ready" || report.setupState === "missing_url_parameters" ? (
        <span className="crm-ads-range">{rangeLabel}</span>
      ) : null}
    </section>
  );

  if (report.setupState === "not_connected") {
    return (
      <div className="crm-view">
        {heading}
        <EmptyState
          title="Meta Ads is not connected"
          description="Connect an ad account and spend starts arriving within fifteen minutes. Until then there is nothing to report."
          action={
            <button className="crm-button-primary" onClick={onOpenConnections}>
              Go to Connections
            </button>
          }
        />
      </div>
    );
  }

  if (report.setupState === "no_data") {
    return (
      <div className="crm-view">
        {heading}
        <EmptyState
          title="Connected, no spend yet"
          description={
            backfill?.status === "running"
              ? `Backfilling history — ${backfill.daysDone} of ${backfill.daysTotal} days done, ${count(backfill.rowsWritten)} rows so far. Numbers appear as it goes.`
              : "The account is connected but no days have synced yet. The first sync runs within fifteen minutes, or backfill history from the connection card."
          }
          action={
            <button className="crm-button-secondary" onClick={onOpenConnections}>
              {backfill?.status === "running"
                ? "View backfill"
                : "Backfill history"}
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="crm-view crm-dashboard-view crm-ads-view">
      {heading}

      {report.disconnected ? (
        <section className="crm-ads-notice is-warning">
          <PlugZap aria-hidden="true" />
          <div>
            <strong>Meta Ads is not connected right now.</strong>
            <p>
              These figures stop at the last sync. Reconnect the ad account to
              keep spend up to date.
            </p>
            <button className="crm-button-secondary" onClick={onOpenConnections}>
              Go to Connections
            </button>
          </div>
        </section>
      ) : null}

      {report.setupState === "missing_url_parameters" ? (
        <section className="crm-ads-notice is-warning">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>Spend is arriving, but no lead can be traced to it.</strong>
            <p>
              {count(report.unattributedLeads)} lead
              {report.unattributedLeads === 1 ? "" : "s"} came in with no campaign
              attached. Meta offers no way to look up which campaign produced a
              click, so the ad has to carry the label itself. Paste this into{" "}
              <em>URL parameters</em> in Ads Manager — leads only carry it from
              the moment it is live.
            </p>
            <SnippetBox />
          </div>
        </section>
      ) : null}

      {report.backfillAvailable ? (
        <section className="crm-ads-notice">
          <Megaphone aria-hidden="true" />
          <div>
            <strong>Older spend is missing.</strong>
            <p>
              {report.earliestSpendDate
                ? `History starts on ${report.earliestSpendDate}, later than the range you are viewing, so costs before then divide by spend that is not here yet.`
                : "No spend has synced for this range yet."}{" "}
              A backfill fetches it.
            </p>
            <button className="crm-button-secondary" onClick={onOpenConnections}>
              Backfill history
            </button>
          </div>
        </section>
      ) : null}

      <section className="crm-dashboard-kpi-grid" aria-label="Ads at a glance">
        {kpiCards.map((card) => (
          <AdsKpiCard key={card.label} card={card} />
        ))}
      </section>

      <section className="crm-panel crm-dashboard-marketing-panel">
        <header>
          <div className="crm-dashboard-widget-heading">
            <Megaphone aria-hidden="true" />
            <h3>Marketing Snapshot</h3>
          </div>
          <Verdict roas={totals.roas} />
        </header>
        <div className="crm-dashboard-marketing-grid">
          <article className="crm-dashboard-marketing-card">
            <span>Ad Spend</span>
            <strong>{dollars(totals.spendCents)}</strong>
            <small>{budgetText ?? "No monthly budget set"}</small>
            <i
              className="crm-dashboard-marketing-progress"
              style={{ "--marketing-progress": `${Math.min(100, budgetUsedPercent)}%` } as CSSProperties}
              aria-hidden="true"
            />
          </article>
          <article className="crm-dashboard-marketing-card">
            <span>Revenue from Ads</span>
            <strong>{totals.revenueCents > 0 ? dollars(totals.revenueCents) : "-"}</strong>
            <small>
              {totals.won
                ? [`${totals.won} won from ads`, adRevenueShare == null ? null : `${adRevenueShare}% of revenue`]
                    .filter(Boolean)
                    .join(" · ")
                : totals.leads
                  ? `${plural(totals.leads, "ad lead")}, none won yet`
                  : "No leads carried a campaign ID"}
            </small>
          </article>
          <article className="crm-dashboard-marketing-card">
            <span>Appointments Booked</span>
            <strong>{activeAppointments.length}</strong>
            <small>
              {activeAppointments.length
                ? appointmentsToday
                  ? `${appointmentsToday} today`
                  : "No appointments today"
                : "No appointments booked"}
            </small>
            <DashboardSparkline
              values={appointmentSeries}
              trend={seriesTrend(appointmentSeries)}
              id="ads-appointments-booked"
            />
          </article>
          <article className="crm-dashboard-marketing-card is-sources">
            <span>Lead Sources</span>
            {sources.length ? (
              <div className="crm-dashboard-source-snapshot">
                <div
                  className="crm-dashboard-source-donut"
                  style={{ "--source-gradient": sourceGradient } as CSSProperties}
                  aria-label={`${totalSourceLeads} total leads by source`}
                >
                  <span>Total</span>
                  <strong>{totalSourceLeads}</strong>
                </div>
                <ul>
                  {sources.map((source) => (
                    <li key={source.label}>
                      <i style={{ background: source.color }} aria-hidden="true" />
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
      </section>

      <section className="crm-panel crm-ads-funnel-panel">
        <header>
          <div className="crm-dashboard-widget-heading">
            <Funnel aria-hidden="true" />
            <h3>From click to customer</h3>
          </div>
          <small>
            {count(totals.impressions)} people saw the ads · {percent(totals.ctr)} clicked
          </small>
        </header>
        <ol className="crm-ads-funnel">
          <FunnelStep label="Clicks" value={totals.clicks} each={totals.cpcCents} />
          <FunnelStep
            label="Leads"
            value={totals.leads}
            each={totals.costPerLeadCents}
            rate={share(totals.leads, totals.clicks)}
            rateLabel="became leads"
          />
          <FunnelStep
            label="Booked jobs"
            value={totals.booked}
            each={totals.costPerBookedCents}
            rate={share(totals.booked, totals.leads)}
            rateLabel="booked"
          />
          <FunnelStep
            label="Won customers"
            value={totals.won}
            each={totals.costPerWonCents}
            rate={share(totals.won, totals.booked)}
            rateLabel="won"
          />
        </ol>
        {report.unattributedLeads ? (
          <p className="crm-ads-footnote">
            {plural(report.unattributedLeads, "other lead")} came from somewhere other than a
            Meta ad, so they are not counted here.
          </p>
        ) : null}
      </section>

      <section className="crm-panel crm-ads-table-panel">
        <header>
          <div className="crm-dashboard-widget-heading">
            <TrendingUp aria-hidden="true" />
            <h3>Campaigns</h3>
          </div>
          <span className="crm-ads-table-hint">Select a campaign to see its ads and leads</span>
        </header>
        {report.campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns in this range"
            description="Widen the date range, or backfill history if the account was connected recently."
          />
        ) : (
          <div className="crm-table-scroll">
            <table className="crm-table crm-ads-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Spend</th>
                  <th>Leads</th>
                  <th>Booked jobs</th>
                  <th>Won customers</th>
                  <th>Revenue</th>
                  <th>Return</th>
                </tr>
              </thead>
              <tbody>
                {report.campaigns.map((campaign) => {
                  const spendShare =
                    totals.spendCents > 0 ? campaign.spendCents / totals.spendCents : 0;
                  const verdict = returnVerdict(campaign.roas);
                  return (
                    <tr
                      key={campaign.campaignId}
                      className="crm-ads-campaign-row"
                      onClick={() => setOpenCampaignId(campaign.campaignId)}
                    >
                      <td data-label="Campaign" className="crm-ads-cell-campaign">
                        <button type="button" className="crm-ads-disclosure">
                          <span>{campaign.campaignName}</span>
                          <small>
                            {plural(campaign.adsets.reduce((n, a) => n + a.ads.length, 0), "ad")}
                            {campaign.campaignId === bestCampaignId ? (
                              <em className="crm-ads-best">Best return</em>
                            ) : null}
                          </small>
                        </button>
                      </td>
                      <td data-label="Spend" className="crm-ads-cell-spend">
                        <strong>{dollars(campaign.spendCents)}</strong>
                        <span
                          className="crm-ads-share"
                          role="img"
                          aria-label={`${Math.round(spendShare * 100)}% of total spend`}
                        >
                          <span style={{ width: `${Math.max(spendShare * 100, spendShare > 0 ? 2 : 0)}%` }} />
                        </span>
                        <small>
                          {count(campaign.impressions)} impressions · {count(campaign.clicks)} clicks
                        </small>
                      </td>
                      <td data-label="Leads">
                        <strong>{count(campaign.leads)}</strong>
                        {campaign.costPerLeadCents != null ? <small>{cost(campaign.costPerLeadCents)} each</small> : null}
                      </td>
                      <td data-label="Booked jobs">
                        <strong>{count(campaign.booked)}</strong>
                        {campaign.costPerBookedCents != null ? <small>{cost(campaign.costPerBookedCents)} each</small> : null}
                      </td>
                      <td data-label="Won customers">
                        <strong>{count(campaign.won)}</strong>
                        {campaign.costPerWonCents != null ? <small>{cost(campaign.costPerWonCents)} each</small> : null}
                      </td>
                      <td data-label="Revenue">
                        <strong>{dollars(campaign.revenueCents)}</strong>
                      </td>
                      <td data-label="Return">
                        <span className={`crm-ads-return is-${verdict.tone}`} title={verdict.label}>
                          {ratio(campaign.roas)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {clients.length > 1 && selectedClientId === "all" ? (
          <p className="crm-connection-note">
            Showing every sub-account together. Pick one in the header to see its
            campaigns on their own.
          </p>
        ) : null}
      </section>

      {openCampaign ? (
        <CampaignDrawer
          campaign={openCampaign}
          leads={leadsByCampaign.get(openCampaign.campaignId) ?? []}
          onOpenLead={onOpenLead}
          onClose={() => setOpenCampaignId(null)}
        />
      ) : null}
    </div>
  );
}
