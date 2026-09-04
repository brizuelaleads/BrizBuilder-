"use client";

import { useMemo, useState } from "react";
import { Megaphone, TriangleAlert, X } from "lucide-react";
import type {
  CrmLead,
  CrmMetaAdInsight,
  CrmMetaAdsBackfill,
  CrmProviderConnection,
} from "../../db/crm";
import {
  buildAdsReport,
  type AdsReportCampaign,
} from "../../lib/meta-ads-report";
import { Badge, EmptyState, money } from "./ui";

// The URL parameters an ad must carry for a click to be traceable. Written out
// here rather than assembled, so what the operator copies is the literal text
// in the source.
const URL_PARAMETERS =
  "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}" +
  "&utm_term={{adset.id}}&utm_content={{ad.id}}";

function ratio(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1)}x`;
}

function percent(value: number | null) {
  return value == null ? "—" : `${(value * 100).toFixed(2)}%`;
}

/** A cost with no denominator reads as unknown, never as zero. */
function cost(value: number | null) {
  return value == null ? "—" : money(value, true);
}

function count(value: number) {
  return value.toLocaleString();
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
            <small>{campaign.campaignId}</small>
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
          <section className="crm-ads-drawer-summary" aria-label="Campaign summary">
            <div>
              <span>Spend</span>
              <strong>{money(campaign.spendCents, true)}</strong>
            </div>
            <div>
              <span>Leads</span>
              <strong>{count(campaign.leads)}</strong>
            </div>
            <div>
              <span>Cost per lead</span>
              <strong>{cost(campaign.costPerLeadCents)}</strong>
            </div>
            <div>
              <span>Booked jobs</span>
              <strong>{count(campaign.booked)}</strong>
            </div>
            <div>
              <span>Won customers</span>
              <strong>{count(campaign.won)}</strong>
            </div>
            <div>
              <span>Revenue</span>
              <strong>{money(campaign.revenueCents, true)}</strong>
            </div>
            <div>
              <span>ROAS</span>
              <strong>{ratio(campaign.roas)}</strong>
            </div>
            <div>
              <span>Impressions</span>
              <strong>{count(campaign.impressions)}</strong>
            </div>
          </section>

          <section aria-label="Ad sets">
            <h4>Ad sets</h4>
            {campaign.adsets.length === 0 ? (
              <p className="crm-ads-quiet">
                No ad sets in this range.
              </p>
            ) : (
              campaign.adsets.map((adset) => (
                <div key={adset.adsetId} className="crm-ads-adset">
                  <h5>
                    <span>Ad set {adset.adsetId}</span>
                    <Badge tone="neutral">
                      {money(adset.spendCents, true)} · {count(adset.leads)} leads
                      · {cost(adset.costPerLeadCents)} CPL
                    </Badge>
                  </h5>
                  <ul>
                    {adset.ads.map((ad) => (
                      <li key={ad.adId}>
                        <span>{ad.adName}</span>
                        <span>{money(ad.spendCents, true)}</span>
                        <span>{count(ad.leads)} leads</span>
                        <span>{cost(ad.costPerLeadCents)}</span>
                      </li>
                    ))}
                  </ul>
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

  const openCampaign = openCampaignId
    ? report.campaigns.find((c) => c.campaignId === openCampaignId)
    : undefined;

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
        <MetricCard
          label="Ad spend"
          value={money(report.totals.spendCents, true)}
          support={`${count(report.totals.clicks)} clicks · ${percent(report.totals.ctr)} CTR`}
        />
        <MetricCard
          label="Leads from Meta ads"
          value={count(report.totals.leads)}
          support={
            report.unattributedLeads
              ? `${count(report.unattributedLeads)} not traceable to an ad`
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
          value={count(report.totals.booked)}
          support="Booked, estimate sent, or won"
        />
        <MetricCard
          label="Cost per booked job"
          value={cost(report.totals.costPerBookedCents)}
          support={`${cost(report.totals.costPerWonCents)} per won customer`}
        />
        <MetricCard
          label="Won revenue"
          value={money(report.totals.revenueCents, true)}
          support={`${count(report.totals.won)} won customer${report.totals.won === 1 ? "" : "s"}`}
        />
        <MetricCard
          label="ROAS"
          value={ratio(report.totals.roas)}
          support={
            report.totals.roas == null
              ? "Needs both spend and recorded revenue"
              : "Revenue per unit of spend"
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
                  <th>Impressions</th>
                  <th>Clicks</th>
                  <th>Leads</th>
                  <th>CPL</th>
                  <th>Booked jobs</th>
                  <th>Won customers</th>
                  <th>Revenue</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {report.campaigns.map((campaign) => (
                  <tr
                    key={campaign.campaignId}
                    className="crm-ads-campaign-row"
                    onClick={() => setOpenCampaignId(campaign.campaignId)}
                  >
                    <td data-label="Campaign">
                      <button type="button" className="crm-ads-disclosure">
                        <span>{campaign.campaignName}</span>
                        <small>{campaign.campaignId}</small>
                      </button>
                    </td>
                    <td data-label="Spend">
                      {money(campaign.spendCents, true)}
                    </td>
                    <td data-label="Impressions">{count(campaign.impressions)}</td>
                    <td data-label="Clicks">{count(campaign.clicks)}</td>
                    <td data-label="Leads">{count(campaign.leads)}</td>
                    <td data-label="CPL">{cost(campaign.costPerLeadCents)}</td>
                    <td data-label="Booked jobs">{count(campaign.booked)}</td>
                    <td data-label="Won customers">{count(campaign.won)}</td>
                    <td data-label="Revenue">
                      {money(campaign.revenueCents, true)}
                    </td>
                    <td data-label="ROAS">{ratio(campaign.roas)}</td>
                  </tr>
                ))}
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
