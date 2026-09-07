"use client";

import type { CrmClient, CrmLead } from "../../db/crm";
import type { AdsReport } from "../../lib/meta-ads-report";
import { Badge, money } from "./ui";

export function ReportsView({
  leads,
  clients,
  report,
  period,
  hasSpendData,
}: {
  leads: CrmLead[];
  clients: CrmClient[];
  report: AdsReport;
  period: string;
  hasSpendData: boolean;
}) {
  const revenue = leads.reduce(
    (sum, lead) => sum + (lead.status === "WON" ? lead.finalRevenueCents : 0),
    0,
  );
  const budget = clients.reduce(
    (sum, client) => sum + client.monthlyAdBudgetCents,
    0,
  );
  const stages = [
    "NEW",
    "CONTACTED",
    "QUALIFIED",
    "APPOINTMENT_BOOKED",
    "ESTIMATE_SENT",
    "WON",
  ];
  const funnel = stages.map((status) => ({
    status,
    count: leads.filter((lead) => lead.status === status).length,
  }));
  const largestStage = Math.max(1, ...funnel.map((stage) => stage.count));
  const sources = Object.entries(
    leads.reduce<Record<string, { count: number; revenue: number }>>(
      (rows, lead) => {
        const source = lead.source.trim() || "Unattributed";
        const row = rows[source] ?? { count: 0, revenue: 0 };
        row.count++;
        if (lead.status === "WON") row.revenue += lead.finalRevenueCents;
        rows[source] = row;
        return rows;
      },
      {},
    ),
  ).sort((a, b) => b[1].count - a[1].count);

  return (
    <div className="crm-view crm-report-view">
      <section className="crm-page-heading">
        <div>
          <p>PERFORMANCE REPORT</p>
          <h2>Workspace report</h2>
          <span>
            {clients.length === 1
              ? clients[0].businessName
              : `${clients.length} businesses`}{" "}
            · {period}
          </span>
        </div>
        <button className="crm-button-secondary" onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </section>
      <div className="crm-report-note">
        <Badge tone="neutral">CRM + Meta</Badge>
        <p>
          Revenue is the recorded value of won leads created in this period,
          across all sources. Meta costs and ROAS use only leads carrying a Meta
          campaign ID. These are lead-cohort results, not cash collected during
          the period. CRM dates use UTC calendar days; Meta daily dates follow
          the ad account’s timezone.
        </p>
      </div>
      <section
        className="crm-report-summary"
        aria-label="Workspace performance"
      >
        <article>
          <span>Leads · all sources</span>
          <strong>{leads.length}</strong>
        </article>
        <article>
          <span>Won revenue · all sources</span>
          <strong>{money(revenue)}</strong>
        </article>
        <article>
          <span>Meta ad spend</span>
          <strong>
            {hasSpendData ? money(report.totals.spendCents) : "—"}
          </strong>
        </article>
        <article>
          <span>Meta-attributed ROAS</span>
          <strong>
            {report.totals.roas == null
              ? "—"
              : `${report.totals.roas.toFixed(1)}x`}
          </strong>
        </article>
      </section>
      <section className="crm-report-summary" aria-label="Meta attribution">
        <article>
          <span>Meta-attributed leads</span>
          <strong>{report.totals.leads}</strong>
        </article>
        <article>
          <span>Meta-attributed won revenue</span>
          <strong>{money(report.totals.revenueCents)}</strong>
        </article>
        <article>
          <span>Cost per Meta lead</span>
          <strong>
            {report.totals.costPerLeadCents == null
              ? "—"
              : money(report.totals.costPerLeadCents)}
          </strong>
        </article>
        <article>
          <span>Monthly budget · planned</span>
          <strong>{money(budget)}</strong>
        </article>
      </section>
      <div className="crm-report-note">
        <p>
          {hasSpendData
            ? "Spending comes from saved Meta ad rows; the monthly budget is never used as actual spend. "
            : "No synced Meta ad rows are available for this period. "}
          {report.setupState === "not_connected"
            ? "Connect Meta Ads to refresh spending. "
            : ""}
          {report.unattributedLeads} leads have no Meta campaign ID and are
          excluded from Meta ratios. Figures reflect records currently loaded;
          missing or partial sync history can understate totals.
          {report.backfillAvailable
            ? " Older ad history may need a backfill in Ads."
            : ""}
        </p>
      </div>
      <section className="crm-dashboard-grid">
        <article className="crm-panel">
          <header>
            <div>
              <p>PIPELINE</p>
              <h3>Current lead stages</h3>
            </div>
          </header>
          <div className="crm-funnel">
            {funnel.map((stage) => (
              <div key={stage.status}>
                <span>{stage.status.replaceAll("_", " ")}</span>
                <i aria-hidden="true">
                  <b
                    style={{ width: `${(stage.count / largestStage) * 100}%` }}
                  />
                </i>
                <strong>{stage.count}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="crm-panel">
          <header>
            <div>
              <p>LEAD SOURCES</p>
              <h3>Volume and won revenue</h3>
            </div>
          </header>
          {sources.length ? (
            <table className="crm-mini-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Leads</th>
                  <th>Won revenue</th>
                </tr>
              </thead>
              <tbody>
                {sources.map(([source, row]) => (
                  <tr key={source}>
                    <td>{source}</td>
                    <td>{row.count}</td>
                    <td>{money(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>
              No leads in this period. Choose a wider date range to see older
              records.
            </p>
          )}
        </article>
      </section>
      <section className="crm-panel crm-report-recommendations">
        <header>
          <div>
            <p>NEXT ACTIONS</p>
            <h3>What needs attention</h3>
          </div>
        </header>
        <ol>
          <li>
            <strong>Respond to unanswered leads.</strong>
            <span>
              {
                leads.filter(
                  (lead) => lead.status === "NEW" && !lead.lastContactedAt,
                ).length
              }{" "}
              leads in this period still need a first response.
            </span>
          </li>
          <li>
            <strong>Follow up on open estimates.</strong>
            <span>
              {leads.filter((lead) => lead.status === "ESTIMATE_SENT").length}{" "}
              leads are in the estimate-sent stage.
            </span>
          </li>
          <li>
            <strong>Review campaign attribution.</strong>
            <span>
              {report.unattributedLeads} leads have no Meta campaign ID. Review
              their sources before comparing them with advertising costs.
            </span>
          </li>
        </ol>
      </section>
    </div>
  );
}
