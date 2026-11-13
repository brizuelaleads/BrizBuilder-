"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  CalendarDays,
  CircleCheck,
  CircleMinus,
  Layers,
  Megaphone,
  PlugZap,
  Route,
  TriangleAlert,
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
import { DAY_MS, timestamp } from "./dashboard-charts";
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

/** "$6.49" for a 6.49x return: what came back for each dollar spent. */
function backPerDollar(roas: number | null) {
  return roas == null ? "—" : `$${roas.toFixed(2)}`;
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

/**
 * Money out against money in, as two bars on one scale: the comparison a
 * business owner makes in their head, drawn so it does not have to be.
 */
function MoneyBars({ spentCents, earnedCents }: { spentCents: number; earnedCents: number }) {
  const scale = Math.max(spentCents, earnedCents, 1);
  const width = (cents: number) =>
    `${cents > 0 ? Math.max((cents / scale) * 100, 2) : 0}%`;
  return (
    <dl className="crm-ads-money" aria-label={`Spent ${dollars(spentCents)}, earned ${dollars(earnedCents)}`}>
      <div className="is-spent">
        <dt>Spent</dt>
        <dd>
          <span className="crm-ads-money-bar" aria-hidden="true">
            <span style={{ width: width(spentCents) } as CSSProperties} />
          </span>
          <strong>{dollars(spentCents)}</strong>
        </dd>
      </div>
      <div className="is-earned">
        <dt>Earned</dt>
        <dd>
          <span className="crm-ads-money-bar" aria-hidden="true">
            <span style={{ width: width(earnedCents) } as CSSProperties} />
          </span>
          <strong>{dollars(earnedCents)}</strong>
        </dd>
      </div>
    </dl>
  );
}

/** One step from seeing an ad to becoming a customer. */
function JourneyStep({
  label,
  value,
  each,
  rate,
}: {
  label: string;
  value: number;
  each?: number | null;
  rate?: string | null;
}) {
  return (
    <li className="crm-ads-step">
      <strong>{count(value)}</strong>
      <span>{label}</span>
      {rate !== undefined ? (
        <em className="crm-ads-step-rate" title="Share of the step before">
          <ArrowRight aria-hidden="true" />
          {rate ?? "—"}
        </em>
      ) : (
        <em className="crm-ads-step-rate is-blank" aria-hidden="true" />
      )}
      <small>
        {each === undefined ? "" : each == null ? "No cost yet" : `${dollars(each)} each`}
      </small>
    </li>
  );
}

type DayPoint = { label: string; spendCents: number; leads: number };

function isoDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function shortDate(key: string) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Spend and Meta-ad leads per day across the selected range. Ranges longer
 * than about six weeks are grouped into weeks so each bar stays readable.
 * Days with no spend are kept as empty bars: a gap is information.
 */
function dailySeries(
  insights: CrmMetaAdInsight[],
  adLeads: CrmLead[],
  rangeStart: string | null,
  earliestSpendDate: string | null,
  openedAt: number,
): { points: DayPoint[]; byWeek: boolean } {
  const endKey = isoDay(openedAt);
  const startKey = rangeStart ?? earliestSpendDate ?? isoDay(openedAt - 29 * DAY_MS);
  const start = timestamp(startKey);
  const end = timestamp(endKey);
  if (!start || !end || start > end) return { points: [], byWeek: false };

  const days = Math.floor((end - start) / DAY_MS) + 1;
  const byWeek = days > 45;
  const size = byWeek ? 7 : 1;
  const buckets = Math.ceil(days / size);
  const points: DayPoint[] = Array.from({ length: buckets }, (_, index) => {
    const from = isoDay(start + index * size * DAY_MS);
    const to = isoDay(Math.min(end, start + ((index + 1) * size - 1) * DAY_MS));
    return {
      label: from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`,
      spendCents: 0,
      leads: 0,
    };
  });
  const bucketOf = (key: string) => {
    const at = timestamp(key);
    if (!at || at < start || at > end + DAY_MS - 1) return -1;
    return Math.min(buckets - 1, Math.floor((at - start) / DAY_MS / size));
  };
  for (const insight of insights) {
    const index = bucketOf(insight.date);
    if (index >= 0) points[index].spendCents += insight.spendCents;
  }
  for (const lead of adLeads) {
    const at = timestamp(lead.createdAt);
    const index = at ? bucketOf(isoDay(at)) : -1;
    if (index >= 0) points[index].leads += 1;
  }
  return { points, byWeek };
}

/**
 * Two small bar charts sharing one day axis: what was spent, and the leads
 * that came of it. Each has its own scale, so neither is read against the
 * other's axis. Hovering a day shows both figures; the same numbers are in a
 * table for screen readers.
 */
function DailyChart({ points, byWeek }: { points: DayPoint[]; byWeek: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const peakSpend = Math.max(0, ...points.map((point) => point.spendCents));
  const peakLeads = Math.max(0, ...points.map((point) => point.leads));
  const height = (value: number, peak: number) =>
    `${value > 0 && peak > 0 ? Math.max((value / peak) * 100, 3) : 0}%`;
  const unit = byWeek ? "week" : "day";
  const point = active == null ? null : points[active];

  return (
    <div className="crm-ads-daily">
      <div className="crm-ads-daily-label">
        <span>Spend</span>
        <small>Top {unit} {dollars(peakSpend)}</small>
      </div>
      <div className="crm-ads-daily-bars is-spend" aria-hidden="true">
        {points.map((day, index) => (
          <span key={index} className={active === index ? "is-active" : undefined}>
            <i style={{ height: height(day.spendCents, peakSpend) } as CSSProperties} />
          </span>
        ))}
      </div>
      <div className="crm-ads-daily-label">
        <span>Leads</span>
        <small>Top {unit} {count(peakLeads)}</small>
      </div>
      <div className="crm-ads-daily-bars is-leads" aria-hidden="true">
        {points.map((day, index) => (
          <span key={index} className={active === index ? "is-active" : undefined}>
            <i style={{ height: height(day.leads, peakLeads) } as CSSProperties} />
          </span>
        ))}
      </div>
      <div
        className="crm-ads-daily-hits"
        aria-hidden="true"
        onMouseLeave={() => setActive(null)}
      >
        {points.map((_, index) => (
          <span
            key={index}
            onMouseEnter={() => setActive(index)}
            onClick={() => setActive(index)}
          />
        ))}
      </div>
      <div className="crm-ads-daily-axis" aria-hidden="true">
        <span>{points[0]?.label}</span>
        <span>{points.at(-1)?.label}</span>
      </div>
      {point && active != null ? (
        <output
          className="crm-ads-daily-tip"
          style={{ left: `clamp(80px, ${((active + 0.5) / points.length) * 100}%, calc(100% - 80px))` } as CSSProperties}
        >
          <time>{point.label}</time>
          <span>
            Spent <strong>{dollars(point.spendCents)}</strong>
          </span>
          <span>
            Leads <strong>{count(point.leads)}</strong>
          </span>
        </output>
      ) : null}
      <table className="sr-only">
        <caption>Ad spend and leads by {unit}</caption>
        <thead>
          <tr>
            <th scope="col">{byWeek ? "Week" : "Day"}</th>
            <th scope="col">Spend</th>
            <th scope="col">Leads</th>
          </tr>
        </thead>
        <tbody>
          {points.map((day, index) => (
            <tr key={index}>
              <td>{day.label}</td>
              <td>{dollars(day.spendCents)}</td>
              <td>{count(day.leads)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CLOSED_STATUSES = ["LOST", "SPAM", "UNRESPONSIVE"];

function leadTone(status: string) {
  if (status === "WON") return "green" as const;
  return CLOSED_STATUSES.includes(status) ? ("red" as const) : ("blue" as const);
}

/** Won first, then still open, then closed; newest first within each. */
function orderLeads(leads: CrmLead[]) {
  const rank = (lead: CrmLead) =>
    lead.status === "WON" ? 0 : CLOSED_STATUSES.includes(lead.status) ? 2 : 1;
  return [...leads].sort(
    (a, b) => rank(a) - rank(b) || timestamp(b.createdAt) - timestamp(a.createdAt),
  );
}

/** A list of leads, each a row that opens the lead: name, then status. */
function LeadList({ leads, onOpenLead }: { leads: CrmLead[]; onOpenLead: (lead: CrmLead) => void }) {
  return (
    <ul className="crm-ads-campaign-leads">
      {orderLeads(leads).map((lead) => (
        <li key={lead.id}>
          <button type="button" onClick={() => onOpenLead(lead)}>
            <strong>
              {lead.firstName} {lead.lastName}
            </strong>
            {lead.status === "WON" ? (
              <span className="crm-ads-lead-value">{dollars(lead.finalRevenueCents)}</span>
            ) : null}
            <Badge tone={leadTone(lead.status)}>
              {LEAD_STATUS_LABELS[lead.status] ?? lead.status.replaceAll("_", " ")}
            </Badge>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * One campaign, kept to what a business owner needs at a glance: did it pay,
 * then each ad with one line of numbers and the people it brought in.
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
  // Escape closes, as every other panel in the CRM does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ads: AdsReportAd[] = campaign.adsets
    .flatMap((adset) => adset.ads)
    .sort((a, b) => b.spendCents - a.spendCents);
  const withLeads = ads.filter((ad) => ad.costPerLeadCents != null);
  const bestAdId =
    withLeads.length > 1
      ? withLeads.reduce((best, ad) =>
          (ad.costPerLeadCents ?? Infinity) < (best.costPerLeadCents ?? Infinity) ? ad : best,
        ).adId
      : null;

  // Each lead under the ad its click carried ({{ad.id}} in utm_content). A
  // lead that carried the campaign but no known ad is listed on its own,
  // never guessed onto an ad.
  const adIds = new Set(ads.map((ad) => ad.adId));
  const leadsByAd = new Map<string, CrmLead[]>();
  const leadsWithoutAd: CrmLead[] = [];
  for (const lead of leads) {
    if (lead.metaAdId && adIds.has(lead.metaAdId)) {
      const list = leadsByAd.get(lead.metaAdId) ?? [];
      list.push(lead);
      leadsByAd.set(lead.metaAdId, list);
    } else {
      leadsWithoutAd.push(lead);
    }
  }

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
          {/* Did it pay: three numbers and a verdict. */}
          <section className="crm-ads-drawer-intro" aria-label="Campaign summary">
            <dl>
              <div>
                <dt>Spent</dt>
                <dd>{dollars(campaign.spendCents)}</dd>
              </div>
              <div>
                <dt>Earned</dt>
                <dd>{dollars(campaign.revenueCents)}</dd>
              </div>
              <div>
                <dt>Back per $1</dt>
                <dd>{backPerDollar(campaign.roas)}</dd>
              </div>
            </dl>
            <Verdict roas={campaign.roas} />
          </section>

          {/* Each ad: one line of numbers, then who it brought in. */}
          <section aria-label="Ads in this campaign">
            <h4>Ads</h4>
            {ads.length === 0 ? (
              <p className="crm-ads-quiet">No ads ran in this range.</p>
            ) : (
              <ol className="crm-ads-ad-list">
                {ads.map((ad) => {
                  const adLeads = leadsByAd.get(ad.adId) ?? [];
                  return (
                    <li key={ad.adId} className="crm-ads-ad">
                      <div className="crm-ads-ad-head">
                        <strong>{ad.adName}</strong>
                        {ad.adId === bestAdId ? (
                          <em className="crm-ads-best">Cheapest leads</em>
                        ) : null}
                      </div>
                      <p className="crm-ads-ad-line">
                        {dollars(ad.spendCents)} spent · {plural(ad.leads, "lead")} ·{" "}
                        {count(ad.won)} won
                      </p>
                      {adLeads.length ? (
                        <LeadList leads={adLeads} onOpenLead={onOpenLead} />
                      ) : (
                        <p className="crm-ads-quiet">No leads from this ad yet.</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {leadsWithoutAd.length ? (
            <section aria-label="Leads from this campaign">
              <h4>Ad not tracked</h4>
              <p className="crm-ads-quiet crm-ads-drawer-note">
                These came from this campaign, but we can&apos;t tell which ad.
              </p>
              <LeadList leads={leadsWithoutAd} onOpenLead={onOpenLead} />
            </section>
          ) : leads.length === 0 ? (
            <p className="crm-ads-quiet">No leads from this campaign yet.</p>
          ) : null}
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
  const [backfillDismissed, setBackfillDismissed] = useState(false);

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

  // Day by day, counting only leads the report credits to a campaign, so the
  // chart's leads add up to the Leads tile.
  const daily = useMemo(() => {
    const campaignIds = new Set(report.campaigns.map((c) => c.campaignId));
    const adLeads = leads.filter(
      (lead) => lead.metaCampaignId && campaignIds.has(lead.metaCampaignId),
    );
    return dailySeries(metaAdInsights, adLeads, rangeStart, report.earliestSpendDate, openedAt);
  }, [leads, metaAdInsights, rangeStart, report.campaigns, report.earliestSpendDate, openedAt]);

  const openCampaign = openCampaignId
    ? report.campaigns.find((c) => c.campaignId === openCampaignId)
    : undefined;

  const rangeLabel = RANGE_LABELS[range] ?? `Last ${range} days`;
  const totals = report.totals;
  const generatedAtTimestamp = timestamp(generatedAt);

  // Ads' share of all won revenue in the range.
  const totalRevenueCents = leads
    .filter((lead) => lead.status === "WON")
    .reduce((sum, lead) => sum + lead.finalRevenueCents, 0);
  const adRevenueShare =
    totalRevenueCents > 0 && totals.revenueCents > 0
      ? Math.round((totals.revenueCents / totalRevenueCents) * 100)
      : null;

  // Spend over the last 30 days against a monthly budget is a fair comparison;
  // 7 or 90 days against a month is not, so the percentage is only stated for
  // the 30-day view. The real figure is shown, overspend included.
  const budgetCents = clients.reduce((sum, client) => sum + client.monthlyAdBudgetCents, 0);
  const budgetComparable = budgetCents > 0 && range === "30";
  const budgetUsedPercent =
    budgetComparable && totals.spendCents
      ? Math.round((totals.spendCents / budgetCents) * 100)
      : 0;
  const budgetText = !budgetCents
    ? "No monthly budget set"
    : budgetComparable
      ? `${budgetUsedPercent}% of ${dollars(budgetCents)} monthly budget`
      : `${dollars(budgetCents)} monthly budget`;

  // Appointments and lead sources for the same range: where the ads sit in
  // the whole picture.
  const activeAppointments = appointments.filter(
    (appointment) => !["CANCELED", "CANCELLED"].includes(appointment.status),
  );
  const todayKey = new Date(generatedAtTimestamp).toDateString();
  const appointmentsToday = activeAppointments.filter(
    (appointment) => new Date(timestamp(appointment.startsAt)).toDateString() === todayKey,
  ).length;
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
    count: n,
    percent: totalSourceLeads ? Math.round((n / totalSourceLeads) * 100) : 0,
    color: SOURCE_COLORS[index % SOURCE_COLORS.length],
  }));

  const heading = (
    <section className="crm-page-heading">
      <div>
        <p>MARKETING</p>
        <h2>Ads</h2>
        <span>
          What your Meta ads cost and what they brought in.
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

      {/* Status notes sit as slim bars above the report, not blocks in it. */}
      {report.disconnected ? (
        <div className="crm-ads-toast is-warning" role="status">
          <PlugZap aria-hidden="true" />
          <p>
            <strong>Meta Ads is not connected right now.</strong>{" "}
            <span>Figures stop at the last sync.</span>
          </p>
          <button className="crm-button-secondary" onClick={onOpenConnections}>
            Go to Connections
          </button>
        </div>
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

      {report.backfillAvailable && !backfillDismissed ? (
        <div className="crm-ads-toast" role="status">
          <CalendarDays aria-hidden="true" />
          <p>
            <strong>Older spend is missing.</strong>{" "}
            <span>
              {report.earliestSpendDate
                ? `Spend history starts ${shortDate(report.earliestSpendDate)}, so earlier days aren't counted yet.`
                : "No spend has synced for this range yet."}
            </span>
          </p>
          <button className="crm-button-secondary" onClick={onOpenConnections}>
            Backfill history
          </button>
          <button
            type="button"
            className="crm-ads-toast-close"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => setBackfillDismissed(true)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* 1. The report card: did the ads pay, in one number and one sentence. */}
      <section className="crm-panel crm-ads-score" aria-label="Return on ad spend">
        <div className="crm-ads-score-answer">
          <span>Every $1 you spent on ads brought back</span>
          <strong>{backPerDollar(totals.roas)}</strong>
          <Verdict roas={totals.roas} />
          <p className="crm-ads-score-story">
            {dollars(totals.spendCents)} spent <ArrowRight aria-hidden="true" />{" "}
            {plural(totals.leads, "lead")} <ArrowRight aria-hidden="true" />{" "}
            {plural(totals.won, "job")} won <ArrowRight aria-hidden="true" />{" "}
            {dollars(totals.revenueCents)} earned
          </p>
        </div>
        <div className="crm-ads-score-money">
          <MoneyBars spentCents={totals.spendCents} earnedCents={totals.revenueCents} />
          <p className="crm-ads-score-budget">
            <span>{budgetText}</span>
            <span>{ratio(totals.roas)} return on ad spend</span>
          </p>
          {budgetComparable ? (
            <span className={`crm-ads-budget${budgetUsedPercent > 100 ? " is-over" : ""}`} aria-hidden="true">
              <span style={{ width: `${Math.min(100, budgetUsedPercent)}%` } as CSSProperties} />
            </span>
          ) : null}
        </div>
      </section>

      {/* 2. The path from an ad to a customer: the key numbers, each with the
          share that moved on and what it cost. */}
      <section className="crm-panel crm-ads-journey">
        <header>
          <div className="crm-dashboard-widget-heading">
            <Route aria-hidden="true" />
            <h3>From ad to customer</h3>
          </div>
        </header>
        <ol>
          <JourneyStep label="saw your ads" value={totals.impressions} />
          <JourneyStep label="clicked" value={totals.clicks} rate={percent(totals.ctr)} each={totals.cpcCents} />
          <JourneyStep label="became leads" value={totals.leads} rate={share(totals.leads, totals.clicks)} each={totals.costPerLeadCents} />
          <JourneyStep label="booked a job" value={totals.booked} rate={share(totals.booked, totals.leads)} each={totals.costPerBookedCents} />
          <JourneyStep label="became customers" value={totals.won} rate={share(totals.won, totals.booked)} each={totals.costPerWonCents} />
        </ol>
        {report.unattributedLeads ? (
          <p className="crm-ads-footnote">
            {plural(report.unattributedLeads, "other lead")} came from somewhere other than a
            Meta ad, so they are not counted here.
          </p>
        ) : null}
      </section>

      {/* 3. Over time, and where the ads sit among everything else. */}
      <div className="crm-ads-pair">
        <section className="crm-panel crm-ads-trend">
          <header>
            <div className="crm-dashboard-widget-heading">
              <CalendarDays aria-hidden="true" />
              <h3>{daily.byWeek ? "Week by week" : "Day by day"}</h3>
            </div>
            <small>Hover a bar for that {daily.byWeek ? "week" : "day"}</small>
          </header>
          {daily.points.length ? (
            <DailyChart points={daily.points} byWeek={daily.byWeek} />
          ) : (
            <p className="crm-ads-quiet">No days to chart in this range.</p>
          )}
        </section>

        <section className="crm-panel crm-ads-glance">
          <header>
            <div className="crm-dashboard-widget-heading">
              <Layers aria-hidden="true" />
              <h3>Ads and everything else</h3>
            </div>
          </header>
          <div className="crm-ads-glance-body">
            <div className="crm-ads-glance-stat">
              <span>Ads&apos; share of revenue</span>
              <strong>{adRevenueShare == null ? "—" : `${adRevenueShare}%`}</strong>
              <small>
                {adRevenueShare == null
                  ? "No won revenue in this range"
                  : `${dollars(totals.revenueCents)} of ${dollars(totalRevenueCents)}`}
              </small>
            </div>
            <div className="crm-ads-glance-stat">
              <span>Appointments booked</span>
              <strong>{count(activeAppointments.length)}</strong>
              <small>
                {activeAppointments.length
                  ? appointmentsToday
                    ? `${appointmentsToday} today`
                    : "None today"
                  : "No appointments booked"}
              </small>
            </div>
            <div className="crm-ads-sources">
              <span>Where all {plural(totalSourceLeads, "lead")} came from</span>
              {sources.length ? (
                <>
                  <span className="crm-ads-sources-bar" role="img" aria-label={sources.map((s) => `${s.label} ${s.percent}%`).join(", ")}>
                    {sources.map((source) => (
                      <span key={source.label} style={{ width: `${(source.count / totalSourceLeads) * 100}%`, background: source.color } as CSSProperties} />
                    ))}
                  </span>
                  <ul>
                    {sources.map((source) => (
                      <li key={source.label}>
                        <i style={{ background: source.color }} aria-hidden="true" />
                        <span>{source.label}</span>
                        <strong>{source.percent}%</strong>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <small>No lead source data yet</small>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* 4. Every campaign, one row each. A row opens its ads and leads. */}
      <section className="crm-panel crm-ads-campaigns" aria-labelledby="crm-ads-campaigns-title">
        <header>
          <div className="crm-dashboard-widget-heading">
            <Megaphone aria-hidden="true" />
            <h3 id="crm-ads-campaigns-title">Campaigns</h3>
          </div>
          <small>
            {clients.length > 1 && selectedClientId === "all"
              ? "Every sub-account together. Pick one in the header to see its campaigns alone."
              : "Select a campaign to see its ads and leads"}
          </small>
        </header>
        {report.campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns in this range"
            description="Widen the date range, or backfill history if the account was connected recently."
          />
        ) : (
          <table className="crm-ads-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Spend</th>
                <th>Leads</th>
                <th>Cost per lead</th>
                <th>Booked jobs</th>
                <th>Won customers</th>
                <th>Revenue</th>
                <th>Return</th>
              </tr>
            </thead>
            <tbody>
              {report.campaigns.map((campaign) => {
                const verdict = returnVerdict(campaign.roas);
                const spendShare =
                  totals.spendCents > 0 ? campaign.spendCents / totals.spendCents : 0;
                return (
                  <tr key={campaign.campaignId}>
                    <td className="crm-ads-table-name">
                      <button
                        type="button"
                        className="crm-ads-disclosure"
                        onClick={() => setOpenCampaignId(campaign.campaignId)}
                      >
                        {campaign.campaignName}
                      </button>
                      {campaign.campaignId === bestCampaignId ? (
                        <em className="crm-ads-best">Best return</em>
                      ) : null}
                      <small>
                        {count(campaign.impressions)} saw it · {count(campaign.clicks)} clicked
                        {campaign.ctr == null ? "" : ` (${percent(campaign.ctr)})`}
                      </small>
                    </td>
                    <td data-label="Spend">
                      {dollars(campaign.spendCents)}
                      <span className="crm-ads-share" aria-hidden="true">
                        <span style={{ width: `${Math.max(spendShare * 100, spendShare > 0 ? 2 : 0)}%` } as CSSProperties} />
                      </span>
                    </td>
                    <td data-label="Leads">{count(campaign.leads)}</td>
                    <td data-label="Cost per lead">{cost(campaign.costPerLeadCents)}</td>
                    <td data-label="Booked jobs">
                      {count(campaign.booked)}
                      <small>{cost(campaign.costPerBookedCents)} each</small>
                    </td>
                    <td data-label="Won customers">
                      {count(campaign.won)}
                      <small>{cost(campaign.costPerWonCents)} each</small>
                    </td>
                    <td data-label="Revenue">{dollars(campaign.revenueCents)}</td>
                    <td data-label="Return">
                      <span className={`crm-ads-return is-${verdict.tone}`} title={verdict.label}>
                        {ratio(campaign.roas)}
                        <span className="sr-only">, {verdict.label}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
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
