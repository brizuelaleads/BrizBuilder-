"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  CircleCheck,
  CircleMinus,
  Megaphone,
  PlugZap,
  TriangleAlert,
  X,
} from "lucide-react";
import type {
  CrmLead,
  CrmMetaAdInsight,
  CrmMetaAdsBackfill,
  CrmProviderConnection,
} from "../../db/crm";
import {
  buildAdsReport,
  type AdsMetrics,
  type AdsReportCampaign,
} from "../../lib/meta-ads-report";
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

function ratio(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1)}x`;
}

function percent(value: number | null) {
  return value == null ? "—" : `${(value * 100).toFixed(2)}%`;
}

/** A share of a step; "—" when there is nothing to take a share of. */
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
  icon: typeof CircleCheck;
} {
  if (roas == null)
    return { tone: "neutral", label: "Not enough results yet", icon: CircleMinus };
  if (roas >= 1)
    return { tone: "green", label: "Earning more than it costs", icon: CircleCheck };
  return { tone: "red", label: "Costing more than it has earned", icon: TriangleAlert };
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

function MetricCard({
  label,
  value,
  support,
  hint,
}: {
  label: string;
  value: string;
  support?: string;
  /** Plain-language meaning, offered on hover and to screen readers. */
  hint?: string;
}) {
  return (
    <article className="crm-ads-metric" title={hint}>
      <span>{label}</span>
      <strong>{value}</strong>
      {support ? <small>{support}</small> : null}
      {hint ? <span className="crm-ads-sr">{hint}</span> : null}
    </article>
  );
}

/** The step-to-step rate between two funnel tiles. */
function FunnelStep({ rate, label }: { rate: string | null; label: string }) {
  return (
    <div className="crm-ads-step" aria-hidden={rate == null}>
      <ArrowRight aria-hidden="true" />
      <span>
        <strong>{rate ?? "—"}</strong> {label}
      </span>
    </div>
  );
}

/**
 * The one sentence the tab exists to answer, then the number behind it.
 */
function ReturnHeadline({ totals }: { totals: AdsMetrics }) {
  const verdict = returnVerdict(totals.roas);
  const Icon = verdict.icon;
  const perDollar =
    totals.roas == null ? null : `$${totals.roas.toFixed(2)} back for every $1 spent`;
  return (
    <section className="crm-panel crm-ads-headline" aria-label="Return on ad spend">
      <div className="crm-ads-hero">
        <span>Return on ad spend</span>
        <strong>{ratio(totals.roas)}</strong>
        <small>{perDollar ?? "Needs both spend and recorded revenue"}</small>
      </div>
      <div className="crm-ads-story">
        <p>
          <strong>{dollars(totals.spendCents)}</strong> in Meta ads brought in{" "}
          <strong>{plural(totals.leads, "lead")}</strong>,{" "}
          <strong>{plural(totals.booked, "booked job")}</strong> and{" "}
          <strong>{plural(totals.won, "won customer")}</strong> worth{" "}
          <strong>{dollars(totals.revenueCents)}</strong>.
        </p>
        <span className={`crm-ads-verdict is-${verdict.tone}`}>
          <Icon aria-hidden="true" />
          {verdict.label}
        </span>
      </div>
    </section>
  );
}

/**
 * One campaign, opened over the table.
 *
 * A drawer rather than an inline row: a campaign's ad sets, its ads and its
 * leads together are more than a table row can hold without pushing everything
 * below it off the screen.
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
  const verdict = returnVerdict(campaign.roas);
  const VerdictIcon = verdict.icon;
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
            <small>ID {campaign.campaignId}</small>
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
          <section className="crm-ads-drawer-return" aria-label="Campaign return">
            <div>
              <span>Return on ad spend</span>
              <strong>{ratio(campaign.roas)}</strong>
            </div>
            <span className={`crm-ads-verdict is-${verdict.tone}`}>
              <VerdictIcon aria-hidden="true" />
              {verdict.label}
            </span>
          </section>

          <section className="crm-ads-drawer-summary" aria-label="Campaign summary">
            <div>
              <span>Spend</span>
              <strong>{dollars(campaign.spendCents)}</strong>
              <small>
                {count(campaign.impressions)} impressions · {count(campaign.clicks)} clicks
              </small>
            </div>
            <div>
              <span>Leads</span>
              <strong>{count(campaign.leads)}</strong>
              {campaign.costPerLeadCents != null ? <small>{cost(campaign.costPerLeadCents)} each</small> : null}
            </div>
            <div>
              <span>Booked jobs</span>
              <strong>{count(campaign.booked)}</strong>
              {campaign.costPerBookedCents != null ? <small>{cost(campaign.costPerBookedCents)} each</small> : null}
            </div>
            <div>
              <span>Won customers</span>
              <strong>{count(campaign.won)}</strong>
              <small>{dollars(campaign.revenueCents)} revenue</small>
            </div>
          </section>

          <section aria-label="Ad sets">
            <h4>Ad sets and ads</h4>
            {campaign.adsets.length === 0 ? (
              <p className="crm-ads-quiet">
                No ad sets in this range.
              </p>
            ) : (
              campaign.adsets.map((adset) => (
                <div key={adset.adsetId} className="crm-ads-adset">
                  <h5>
                    <span title={`Ad set ID ${adset.adsetId}`}>{adsetLabel(adset.adsetId)}</span>
                    <small>
                      {dollars(adset.spendCents)} · {plural(adset.leads, "lead")} ·{" "}
                      {cost(adset.costPerLeadCents)} per lead
                    </small>
                  </h5>
                  <table className="crm-ads-ad-table">
                    <thead>
                      <tr>
                        <th scope="col">Ad</th>
                        <th scope="col">Spend</th>
                        <th scope="col">Leads</th>
                        <th scope="col">Cost per lead</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adset.ads.map((ad) => (
                        <tr key={ad.adId}>
                          <td>{ad.adName}</td>
                          <td>{dollars(ad.spendCents)}</td>
                          <td>{count(ad.leads)}</td>
                          <td>{cost(ad.costPerLeadCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
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
                {leads.map((lead) => (
                  <li key={lead.id}>
                    <button type="button" onClick={() => onOpenLead(lead)}>
                      <span>
                        {lead.firstName} {lead.lastName}
                      </span>
                      <span>{lead.serviceRequested}</span>
                      <Badge
                        tone={
                          lead.status === "WON"
                            ? "green"
                            : ["LOST", "SPAM", "UNRESPONSIVE"].includes(
                                  lead.status,
                                )
                              ? "red"
                              : "blue"
                        }
                      >
                        {lead.status.replaceAll("_", " ")}
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
  metaAdInsights,
  providerConnections,
  metaAdsBackfills,
  clients,
  selectedClientId,
  range,
  onOpenLead,
  onOpenConnections,
}: {
  leads: CrmLead[];
  metaAdInsights: CrmMetaAdInsight[];
  providerConnections: CrmProviderConnection[];
  metaAdsBackfills: CrmMetaAdsBackfill[];
  clients: Array<{ id: string; businessName: string }>;
  selectedClientId: string;
  range: string;
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

  const heading = (
    <section className="crm-page-heading">
      <div>
        <p>MARKETING</p>
        <h2>Ads</h2>
        <span>
          What Meta advertising cost, and what it produced.
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
    <div className="crm-view crm-ads-view">
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

      <ReturnHeadline totals={totals} />

      <section className="crm-ads-group" aria-labelledby="crm-ads-funnel-title">
        <h3 id="crm-ads-funnel-title">From spend to revenue</h3>
        <div className="crm-ads-metrics crm-ads-funnel">
          <MetricCard
            label="Ad spend"
            value={dollars(totals.spendCents)}
            support={`${count(totals.impressions)} impressions · ${count(totals.clicks)} clicks (${percent(totals.ctr)} clicked)`}
            hint="What Meta charged for these ads in the selected range."
          />
          <FunnelStep rate={share(totals.leads, totals.clicks)} label="of clicks became leads" />
          <MetricCard
            label="Leads from Meta ads"
            value={count(totals.leads)}
            support={
              report.unattributedLeads
                ? `${count(report.unattributedLeads)} other leads not traceable to an ad`
                : "All leads traced to a campaign"
            }
            hint="Leads whose form or call carried a Meta campaign."
          />
          <FunnelStep rate={share(totals.booked, totals.leads)} label="of leads booked" />
          <MetricCard
            label="Booked jobs"
            value={count(totals.booked)}
            support="Booked, estimate sent, or won"
            hint="Leads that reached an appointment or further."
          />
          <FunnelStep rate={share(totals.won, totals.booked)} label="of booked jobs won" />
          <MetricCard
            label="Won revenue"
            value={dollars(totals.revenueCents)}
            support={plural(totals.won, "won customer")}
            hint="Revenue recorded on won leads that came from these ads."
          />
        </div>
      </section>

      <section className="crm-ads-group" aria-labelledby="crm-ads-cost-title">
        <h3 id="crm-ads-cost-title">What each result cost</h3>
        <div className="crm-ads-metrics crm-ads-costs">
          <MetricCard
            label="Cost per lead"
            value={cost(totals.costPerLeadCents)}
            support={`${cost(totals.cpcCents)} per click`}
            hint="Ad spend divided by leads from Meta ads."
          />
          <MetricCard
            label="Cost per booked job"
            value={cost(totals.costPerBookedCents)}
            support="Ad spend divided by booked jobs"
            hint="Ad spend divided by booked jobs."
          />
          <MetricCard
            label="Cost per won customer"
            value={cost(totals.costPerWonCents)}
            support="Ad spend divided by won customers"
            hint="Ad spend divided by won customers."
          />
        </div>
      </section>

      <section className="crm-panel crm-ads-table-panel">
        <header>
          <div>
            <p>BY CAMPAIGN</p>
            <h3>Campaign performance</h3>
          </div>
          <span className="crm-ads-table-hint">Select a campaign for its ads and leads</span>
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
