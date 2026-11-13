"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  CalendarCheck,
  ChevronRight,
  CircleCheck,
  CircleMinus,
  Eye,
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
import { timestamp } from "./dashboard-charts";
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

function MetricCard({
  label,
  value,
  support,
}: {
  label: string;
  value: string;
  support?: string;
}) {
  return (
    <article className="crm-ads-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {support ? <small>{support}</small> : null}
    </article>
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
    <li className="crm-ads-journey-step">
      {rate !== undefined ? (
        <span className="crm-ads-journey-rate">
          <ArrowRight aria-hidden="true" />
          {rate ?? "—"}
        </span>
      ) : null}
      <strong>{count(value)}</strong>
      <span>{label}</span>
      {each !== undefined ? (
        <small>{each == null ? "No cost yet" : `${dollars(each)} each`}</small>
      ) : null}
    </li>
  );
}

/**
 * A campaign as a card a business owner can read in a few seconds: did it
 * pay, what it cost against what it earned, and how many jobs came of it.
 * Delivery detail sits in one quiet line underneath.
 */
function CampaignCard({
  campaign,
  best,
  onOpen,
}: {
  campaign: AdsReportCampaign;
  best: boolean;
  onOpen: () => void;
}) {
  const adCount = campaign.adsets.reduce((n, adset) => n + adset.ads.length, 0);
  const verdict = returnVerdict(campaign.roas);
  return (
    <article className="crm-ads-campaign">
      <header>
        <div>
          <h4>{campaign.campaignName}</h4>
          <small>
            {plural(adCount, "ad")}
            {best ? <em className="crm-ads-best">Best return</em> : null}
          </small>
        </div>
        <span className={`crm-ads-return is-${verdict.tone}`} title={verdict.label}>
          {campaign.roas == null
            ? "No return yet"
            : `${backPerDollar(campaign.roas)} per $1`}
        </span>
      </header>

      <MoneyBars spentCents={campaign.spendCents} earnedCents={campaign.revenueCents} />

      <dl className="crm-ads-campaign-results">
        <div>
          <dt>Leads</dt>
          <dd>{count(campaign.leads)}</dd>
          <small>{campaign.costPerLeadCents == null ? "—" : `${cost(campaign.costPerLeadCents)} each`}</small>
        </div>
        <div>
          <dt>Booked</dt>
          <dd>{count(campaign.booked)}</dd>
          <small>{campaign.costPerBookedCents == null ? "—" : `${cost(campaign.costPerBookedCents)} each`}</small>
        </div>
        <div>
          <dt>Jobs won</dt>
          <dd>{count(campaign.won)}</dd>
          <small>{campaign.costPerWonCents == null ? "—" : `${cost(campaign.costPerWonCents)} each`}</small>
        </div>
      </dl>

      <footer>
        <small>
          {count(campaign.impressions)} saw it · {count(campaign.clicks)} clicked
          {campaign.ctr == null ? "" : ` (${percent(campaign.ctr)})`} · {ratio(campaign.roas)} return
        </small>
        <button type="button" className="crm-ads-campaign-open" onClick={onOpen}>
          See ads and leads <ChevronRight aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}

/**
 * One campaign, opened over the page, read top to bottom: what it returned,
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
              Every $1 here brought back <strong>{backPerDollar(campaign.roas)}</strong>.{" "}
              <strong>{plural(campaign.leads, "lead")}</strong>,{" "}
              <strong>{plural(campaign.booked, "booking")}</strong> and{" "}
              <strong>{plural(campaign.won, "job")} won</strong>.
            </p>
            <Verdict roas={campaign.roas} />
            <MoneyBars spentCents={campaign.spendCents} earnedCents={campaign.revenueCents} />
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

  // This period at a glance: the Dashboard's appointments and lead sources.
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

      <section className="crm-ads-metrics" aria-label="Meta Ads summary">
        <MetricCard label="Ad spend" value={dollars(totals.spendCents)} />
        <MetricCard label="Leads from Meta ads" value={count(totals.leads)}
          support={report.unattributedLeads ? `${count(report.unattributedLeads)} other leads have no campaign attached` : undefined} />
        <MetricCard label="Cost per lead" value={cost(totals.costPerLeadCents)} />
        <MetricCard label="Won revenue" value={dollars(totals.revenueCents)} />
      </section>

      <section className="crm-panel crm-ads-results" aria-label="Ad results">
        <div className="crm-ads-results-heading">
          <span>Results</span>
          <small>From lead to customer</small>
        </div>
        <dl>
          <div>
            <dt title="Appointments booked, estimates sent, and won customers">Booked jobs</dt>
            <dd>{count(totals.booked)}</dd>
            <small>{cost(totals.costPerBookedCents)} per booking</small>
          </div>
          <div>
            <dt>Won customers</dt>
            <dd>{count(totals.won)}</dd>
            <small>{cost(totals.costPerWonCents)} per customer</small>
          </div>
          <div>
            <dt>Return on ad spend</dt>
            <dd>{ratio(totals.roas)}</dd>
            <small>Recorded revenue / ad spend</small>
          </div>
        </dl>
      </section>

      <details className="crm-panel crm-ads-delivery">
        <summary>
          <span>Ad delivery</span>
          <small>{count(totals.clicks)} clicks</small>
        </summary>
        <dl>
          <div><dt>Impressions</dt><dd>{count(totals.impressions)}</dd></div>
          <div><dt>Clicks</dt><dd>{count(totals.clicks)}</dd></div>
          <div><dt>Click-through rate</dt><dd>{percent(totals.ctr)}</dd></div>
          <div><dt>Cost per click</dt><dd>{cost(totals.cpcCents)}</dd></div>
        </dl>
      </details>

      {/* The scoreboard: the one question, then money out and money in. */}
      <details className="crm-panel crm-ads-breakdown"><summary>Revenue and budget details</summary>
      <section className="crm-ads-score" aria-label="Return on ad spend">
        <div className="crm-ads-score-answer">
          <span>Every $1 you spent on ads brought back</span>
          <strong>{backPerDollar(totals.roas)}</strong>
          <Verdict roas={totals.roas} />
        </div>
        <dl className="crm-ads-score-figures">
          <div>
            <dt>Spent on ads</dt>
            <dd>{dollars(totals.spendCents)}</dd>
            <small>{budgetText}</small>
            {budgetComparable ? (
              <span className={`crm-ads-budget${budgetUsedPercent > 100 ? " is-over" : ""}`} aria-hidden="true">
                <span style={{ width: `${Math.min(100, budgetUsedPercent)}%` } as CSSProperties} />
              </span>
            ) : null}
          </div>
          <div>
            <dt>Earned from ads</dt>
            <dd>{dollars(totals.revenueCents)}</dd>
            <small>
              {plural(totals.won, "job")} won
              {adRevenueShare == null ? "" : ` · ${adRevenueShare}% of your revenue`}
            </small>
          </div>
          <div>
            <dt>Return on ad spend</dt>
            <dd>{ratio(totals.roas)}</dd>
            <small>Earned divided by spent</small>
          </div>
        </dl>
      </section>

      </details>

      {/* How people moved from seeing an ad to becoming a customer. */}
      <details className="crm-panel crm-ads-breakdown"><summary>View the customer journey</summary>
      <section className="crm-ads-journey">
        <header>
          <div className="crm-dashboard-widget-heading">
            <Route aria-hidden="true" />
            <h3>How ad viewers became customers</h3>
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

      </details>

      {/* Campaigns, one card each. */}
      <section className="crm-ads-campaigns" aria-labelledby="crm-ads-campaigns-title">
        <div className="crm-ads-section-title">
          <h3 id="crm-ads-campaigns-title">Your campaigns</h3>
          {clients.length > 1 && selectedClientId === "all" ? (
            <small>Every sub-account together. Pick one in the header to see its campaigns alone.</small>
          ) : null}
        </div>
        {report.campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns in this range"
            description="Widen the date range, or backfill history if the account was connected recently."
          />
        ) : (
          <div className="crm-ads-campaign-grid">
            {report.campaigns.map((campaign) => (
              <CampaignCard
                key={campaign.campaignId}
                campaign={campaign}
                best={campaign.campaignId === bestCampaignId}
                onOpen={() => setOpenCampaignId(campaign.campaignId)}
              />
            ))}
          </div>
        )}
      </section>

      {/* The rest of the marketing picture, for the same range. */}
      <section className="crm-panel crm-ads-glance">
        <header>
          <div className="crm-dashboard-widget-heading">
            <Eye aria-hidden="true" />
            <h3>This period at a glance</h3>
          </div>
        </header>
        <div className="crm-ads-glance-body">
          <div className="crm-ads-glance-stat">
            <CalendarCheck aria-hidden="true" />
            <div>
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
