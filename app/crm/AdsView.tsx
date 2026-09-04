"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Megaphone, TriangleAlert } from "lucide-react";
import type {
  CrmLead,
  CrmMetaAdInsight,
  CrmMetaAdsBackfill,
  CrmProviderConnection,
} from "../../db/crm";
import { buildAdsReport, type AdsMetrics } from "../../lib/meta-ads-report";
import { Badge, EmptyState, money } from "./ui";

// The URL parameters an ad must carry for a click to be traceable. Repeated
// here rather than imported so the snippet the operator copies is the literal
// text in the source, not a value assembled at runtime.
const URL_PARAMETERS =
  "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}" +
  "&utm_term={{adset.id}}&utm_content={{ad.id}}";

function ratio(value: number | null, digits = 1) {
  return value == null ? "—" : `${value.toFixed(digits)}x`;
}

function percent(value: number | null) {
  return value == null ? "—" : `${(value * 100).toFixed(2)}%`;
}

/** A cost that has no denominator yet reads as unknown, never as zero. */
function cost(value: number | null) {
  return value == null ? "—" : money(value, true);
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
            // Clipboard access can be refused; the text is selectable anyway,
            // so this is a convenience rather than the only way to get it.
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

function MetricCells({ metrics }: { metrics: AdsMetrics }) {
  return (
    <>
      <td data-label="Spend">{money(metrics.spendCents, true)}</td>
      <td data-label="Leads">{metrics.leads}</td>
      <td data-label="Cost / lead">{cost(metrics.costPerLeadCents)}</td>
      <td data-label="Booked">{metrics.booked}</td>
      <td data-label="Cost / booked">{cost(metrics.costPerBookedCents)}</td>
      <td data-label="Won">{metrics.won}</td>
      <td data-label="Revenue">{money(metrics.revenueCents, true)}</td>
      <td data-label="ROAS">{ratio(metrics.roas)}</td>
    </>
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
  const [expanded, setExpanded] = useState<string | null>(null);

  const connected = providerConnections.some(
    (connection) =>
      connection.provider === "meta_ads" &&
      (connection.isActive || connection.isLinked),
  );

  // Read the clock once on mount rather than on every render: it is impure, and
  // a boundary that drifts mid-session would make the "older spend is missing"
  // notice appear and disappear on its own.
  const [openedAt] = useState(() => Date.now());
  // The earliest day the current range asks about. Used only to decide whether
  // older spend is still missing, so a day boundary is precise enough.
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
              ? `Backfilling history — ${backfill.daysDone} of ${backfill.daysTotal} days done. Numbers appear as it goes.`
              : "The account is connected but no days have synced yet. The first sync runs within fifteen minutes, or backfill history from the connection card."
          }
          action={
            <button className="crm-button-secondary" onClick={onOpenConnections}>
              Open connection
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="crm-view crm-ads-view">
      {heading}

      {report.setupState === "missing_url_parameters" ? (
        <section className="crm-ads-notice is-warning">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>Spend is arriving, but no lead can be traced to it.</strong>
            <p>
              {report.unattributedLeads} lead
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
                ? `History starts on ${report.earliestSpendDate}, which is later than the range you are viewing, so costs before then divide by spend that is not here yet.`
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
        <MetricCard
          label="Ad spend"
          value={money(report.totals.spendCents, true)}
          support={`${report.totals.clicks.toLocaleString()} clicks · ${percent(report.totals.ctr)} CTR`}
        />
        <MetricCard
          label="Meta leads"
          value={String(report.totals.leads)}
          support={
            report.unattributedLeads
              ? `${report.unattributedLeads} not traceable to an ad`
              : "All leads traced to a campaign"
          }
        />
        <MetricCard
          label="Cost per lead"
          value={cost(report.totals.costPerLeadCents)}
          support={`${cost(report.totals.cpcCents)} per click`}
        />
        <MetricCard
          label="Booked jobs"
          value={String(report.totals.booked)}
          support={`${cost(report.totals.costPerBookedCents)} to book one`}
        />
        <MetricCard
          label="Won customers"
          value={String(report.totals.won)}
          support={`${cost(report.totals.costPerWonCents)} to win one`}
        />
        <MetricCard
          label="Won revenue"
          value={money(report.totals.revenueCents, true)}
          support={
            report.totals.roas == null
              ? "No revenue recorded yet"
              : `${ratio(report.totals.roas)} return on spend`
          }
        />
      </section>

      <section className="crm-panel crm-ads-table-panel">
        <header>
          <div>
            <p>BY CAMPAIGN</p>
            <h3>Campaign performance</h3>
          </div>
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
                  <th>Cost / lead</th>
                  <th>Booked</th>
                  <th>Cost / booked</th>
                  <th>Won</th>
                  <th>Revenue</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {report.campaigns.map((campaign) => {
                  const open = expanded === campaign.campaignId;
                  const campaignLeads =
                    leadsByCampaign.get(campaign.campaignId) ?? [];
                  return [
                    <tr
                      key={campaign.campaignId}
                      className="crm-ads-campaign-row"
                      onClick={() =>
                        setExpanded(open ? null : campaign.campaignId)
                      }
                    >
                      <td data-label="Campaign">
                        <button
                          type="button"
                          className="crm-ads-disclosure"
                          aria-expanded={open}
                        >
                          {open ? <ChevronDown /> : <ChevronRight />}
                          <span>{campaign.campaignName}</span>
                        </button>
                      </td>
                      <MetricCells metrics={campaign} />
                    </tr>,
                    open ? (
                      <tr key={`${campaign.campaignId}-detail`}>
                        <td colSpan={9} className="crm-ads-detail-cell">
                          <div className="crm-ads-detail">
                            {campaign.adsets.map((adset) => (
                              <div key={adset.adsetId} className="crm-ads-adset">
                                <h4>
                                  Ad set {adset.adsetId}
                                  <Badge tone="neutral">
                                    {money(adset.spendCents, true)} ·{" "}
                                    {adset.leads} leads
                                  </Badge>
                                </h4>
                                <ul>
                                  {adset.ads.map((ad) => (
                                    <li key={ad.adId}>
                                      <span>{ad.adName}</span>
                                      <span>{money(ad.spendCents, true)}</span>
                                      <span>{ad.leads} leads</span>
                                      <span>{cost(ad.costPerLeadCents)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                            <div className="crm-ads-campaign-leads">
                              <h4>
                                Leads from this campaign
                                <Badge tone="neutral">
                                  {campaignLeads.length}
                                </Badge>
                              </h4>
                              {campaignLeads.length === 0 ? (
                                <p>
                                  Spend recorded, no leads carrying this
                                  campaign yet.
                                </p>
                              ) : (
                                <ul>
                                  {campaignLeads.slice(0, 25).map((lead) => (
                                    <li key={lead.id}>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          onOpenLead(lead);
                                        }}
                                      >
                                        <span>
                                          {lead.firstName} {lead.lastName}
                                        </span>
                                        <span>{lead.serviceRequested}</span>
                                        <Badge
                                          tone={
                                            lead.status === "WON"
                                              ? "green"
                                              : lead.status === "LOST"
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
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ];
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
    </div>
  );
}
