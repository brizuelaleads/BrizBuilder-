import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildAdsReport, BOOKED_STATUSES } from "../lib/meta-ads-report.ts";
import {
  metaAdIdFromAttribution,
  metaAdsetIdFromAttribution,
  metaCampaignIdFromAttribution,
} from "../lib/meta-ads-ids.ts";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (rel) =>
  fs.readFileSync(path.join(root, rel), "utf8").replaceAll("\r\n", "\n");
const adsView = read("app/crm/AdsView.tsx");
const crmApp = read("app/CrmApp.tsx");
const reportSource = read("lib/meta-ads-report.ts");

const insight = (over = {}) => ({
  date: "2026-08-01",
  campaignId: "120200000000001",
  campaignName: "Termite - Austin",
  adsetId: "120300000000001",
  adId: "120400000000001",
  adName: "Video A",
  spendCents: 10_000,
  impressions: 1000,
  clicks: 50,
  ...over,
});
const lead = (over = {}) => ({
  id: "l1",
  metaCampaignId: "120200000000001",
  metaAdsetId: "120300000000001",
  metaAdId: "120400000000001",
  status: "NEW",
  finalRevenueCents: 0,
  ...over,
});

test("spend, leads and outcomes roll up into one campaign row", () => {
  const report = buildAdsReport({
    connected: true,
    insights: [insight(), insight({ date: "2026-08-02", spendCents: 5_000 })],
    leads: [
      lead({ id: "a" }),
      lead({ id: "b", status: "APPOINTMENT_BOOKED" }),
      lead({ id: "c", status: "WON", finalRevenueCents: 90_000 }),
    ],
  });
  assert.equal(report.totals.spendCents, 15_000);
  assert.equal(report.totals.leads, 3);
  assert.equal(report.totals.won, 1);
  assert.equal(report.totals.revenueCents, 90_000);
  assert.equal(report.campaigns.length, 1);
  assert.equal(report.campaigns[0].campaignName, "Termite - Austin");
  assert.equal(report.campaigns[0].spendCents, 15_000);
});

test("a won job counts as booked, so cost per booked cannot rise as you close more", () => {
  // Excluding WON would make the metric worsen the better the business does.
  assert.deepEqual([...BOOKED_STATUSES].sort(), [
    "APPOINTMENT_BOOKED",
    "ESTIMATE_SENT",
    "WON",
  ]);
  const report = buildAdsReport({
    connected: true,
    insights: [insight({ spendCents: 30_000 })],
    leads: [
      lead({ id: "a", status: "APPOINTMENT_BOOKED" }),
      lead({ id: "b", status: "ESTIMATE_SENT" }),
      lead({ id: "c", status: "WON", finalRevenueCents: 100_000 }),
    ],
  });
  assert.equal(report.totals.booked, 3);
  assert.equal(report.totals.costPerBookedCents, 10_000);
});

test("only leads carrying a campaign are costed against Meta spend", () => {
  // Dividing by every lead would credit Meta with referrals and organic calls.
  const report = buildAdsReport({
    connected: true,
    insights: [insight({ spendCents: 20_000 })],
    leads: [
      lead({ id: "a" }),
      lead({ id: "b", metaCampaignId: null, metaAdsetId: null, metaAdId: null }),
      lead({ id: "c", metaCampaignId: null, metaAdsetId: null, metaAdId: null }),
    ],
  });
  assert.equal(report.totals.leads, 1);
  assert.equal(report.unattributedLeads, 2);
  assert.equal(report.totals.costPerLeadCents, 20_000);
});

test("a ratio with no denominator is null, never a zero that looks like an answer", () => {
  const report = buildAdsReport({
    connected: true,
    insights: [insight({ spendCents: 50_000, clicks: 0, impressions: 0 })],
    leads: [],
  });
  assert.equal(report.totals.costPerLeadCents, null);
  assert.equal(report.totals.costPerBookedCents, null);
  assert.equal(report.totals.costPerWonCents, null);
  assert.equal(report.totals.roas, null);
  assert.equal(report.totals.ctr, null);
  assert.equal(report.totals.cpcCents, null);
});

test("ROAS needs both spend and revenue", () => {
  const noRevenue = buildAdsReport({
    connected: true,
    insights: [insight()],
    leads: [lead()],
  });
  assert.equal(noRevenue.totals.roas, null);

  const both = buildAdsReport({
    connected: true,
    insights: [insight({ spendCents: 25_000 })],
    leads: [lead({ status: "WON", finalRevenueCents: 100_000 })],
  });
  assert.equal(both.totals.roas, 4);
});

test("drilling into a campaign gives ad sets and ads with their own leads", () => {
  const report = buildAdsReport({
    connected: true,
    insights: [
      insight({ adsetId: "set1", adId: "ad1", spendCents: 10_000 }),
      insight({ adsetId: "set1", adId: "ad2", spendCents: 6_000 }),
      insight({ adsetId: "set2", adId: "ad3", spendCents: 4_000 }),
    ],
    leads: [
      lead({ id: "a", metaAdsetId: "set1", metaAdId: "ad1" }),
      lead({
        id: "b",
        metaAdsetId: "set1",
        metaAdId: "ad1",
        status: "WON",
        finalRevenueCents: 50_000,
      }),
      lead({ id: "c", metaAdsetId: "set2", metaAdId: "ad3" }),
    ],
  });
  const campaign = report.campaigns[0];
  assert.equal(campaign.adsets.length, 2);
  // Sorted by spend, so the ad set taking the most money is first.
  assert.equal(campaign.adsets[0].adsetId, "set1");
  assert.equal(campaign.adsets[0].spendCents, 16_000);
  assert.equal(campaign.adsets[0].leads, 2);
  assert.equal(campaign.adsets[0].ads[0].adId, "ad1");
  assert.equal(campaign.adsets[0].ads[0].leads, 2);
  assert.equal(campaign.adsets[0].ads[0].won, 1);
  assert.equal(campaign.adsets[1].leads, 1);
});

test("a lead whose campaign has no spend in range still gets a row", () => {
  // Clicked last month, converted today. Dropping it would hide a real
  // conversion and overstate the cost per lead of everything else.
  const report = buildAdsReport({
    connected: true,
    insights: [insight({ campaignId: "11111111111", campaignName: "Live" })],
    leads: [
      lead({ metaCampaignId: "22222222222", metaAdsetId: null, metaAdId: null }),
    ],
  });
  const older = report.campaigns.find((c) => c.campaignId === "22222222222");
  assert.ok(older, "the campaign with no spend still appears");
  assert.equal(older.leads, 1);
  assert.equal(older.spendCents, 0);
  assert.equal(older.costPerLeadCents, 0);
});

test("the newest campaign name wins, so a rename does not orphan spend", () => {
  const report = buildAdsReport({
    connected: true,
    insights: [
      insight({ campaignName: "Old name" }),
      insight({ date: "2026-08-02", campaignName: "New name" }),
    ],
    leads: [],
  });
  assert.equal(report.campaigns[0].campaignName, "New name");
});

test("setup states are distinguished, because each needs a different action", () => {
  assert.equal(
    buildAdsReport({ connected: false, insights: [], leads: [] }).setupState,
    "not_connected",
  );
  assert.equal(
    buildAdsReport({ connected: true, insights: [], leads: [] }).setupState,
    "no_data",
  );
  // Spend arriving, leads arriving, none of them traceable: the ads are not
  // carrying the URL parameters.
  assert.equal(
    buildAdsReport({
      connected: true,
      insights: [insight()],
      leads: [lead({ metaCampaignId: null, metaAdsetId: null, metaAdId: null })],
    }).setupState,
    "missing_url_parameters",
  );
  assert.equal(
    buildAdsReport({ connected: true, insights: [insight()], leads: [lead()] })
      .setupState,
    "ready",
  );
});

test("a disconnected account keeps showing the spend it already synced", () => {
  // Disconnecting stops new syncs; it does not make the recorded spend untrue.
  const stale = buildAdsReport({ connected: false, insights: [insight()], leads: [lead()] });
  assert.equal(stale.setupState, "ready");
  assert.equal(stale.disconnected, true);
  assert.ok(stale.totals.spendCents > 0);
  // Without history there is still nothing to show.
  assert.equal(buildAdsReport({ connected: false, insights: [], leads: [lead()] }).setupState, "not_connected");
  assert.equal(buildAdsReport({ connected: true, insights: [insight()], leads: [lead()] }).disconnected, false);
  // Backfill needs a live connection, so it is not offered on a stale one.
  assert.equal(stale.backfillAvailable, false);
  assert.ok(adsView.includes("Meta Ads is not connected right now."));
});

test("backfill is offered when history is thinner than the range", () => {
  const short = buildAdsReport({
    connected: true,
    insights: [insight({ date: "2026-08-20" })],
    leads: [lead()],
    rangeStart: "2026-08-01",
  });
  assert.equal(short.earliestSpendDate, "2026-08-20");
  assert.equal(short.backfillAvailable, true);

  const complete = buildAdsReport({
    connected: true,
    insights: [insight({ date: "2026-07-25" })],
    leads: [lead()],
    rangeStart: "2026-08-01",
  });
  assert.equal(complete.backfillAvailable, false);
});

test("each Meta id comes from the parameter Meta substitutes it into", () => {
  const attribution = {
    utm_campaign: "120200000000001",
    utm_term: "120300000000002",
    utm_content: "120400000000003",
  };
  assert.equal(metaCampaignIdFromAttribution(attribution), "120200000000001");
  assert.equal(metaAdsetIdFromAttribution(attribution), "120300000000002");
  assert.equal(metaAdIdFromAttribution(attribution), "120400000000003");
  // These fields are caller-controlled on the public lead endpoint.
  for (const forged of [
    { utm_campaign: "spring-promo", utm_term: "set-a", utm_content: "ad-b" },
    { utm_campaign: "  ", utm_term: 12345, utm_content: null },
  ]) {
    assert.equal(metaCampaignIdFromAttribution(forged), null);
    assert.equal(metaAdsetIdFromAttribution(forged), null);
    assert.equal(metaAdIdFromAttribution(forged), null);
  }
});

test("the report module stays dependency-free", () => {
  assert.ok(
    !/^import /m.test(reportSource),
    "meta-ads-report.ts imports nothing, so the money maths is directly testable",
  );
});

test("the Ads tab is a main tab and respects the workspace date range", () => {
  // A daily "is the money working" question belongs beside Dashboard and
  // Leads, not filed under channel setup.
  assert.match(crmApp, /id: "ads", label: "Ads", icon: <Megaphone \/>, section: "MAIN"/);
  assert.match(crmApp, /\["dashboard", "leads", "calls", "reports", "ads"\]/);
  assert.match(crmApp, /view === "ads" && \(/);
});

test("the tab covers every setup state and offers the snippet", () => {
  for (const copy of [
    "Meta Ads is not connected",
    "Connected, no spend yet",
    "Spend is arriving, but no lead can be traced to it",
    "Older spend is missing",
  ]) {
    assert.ok(adsView.includes(copy), `${copy} is handled`);
  }
  assert.match(adsView, /utm_campaign=\{\{campaign\.id\}\}/);
  assert.match(adsView, /utm_term=\{\{adset\.id\}\}/);
  assert.match(adsView, /utm_content=\{\{ad\.id\}\}/);
  assert.match(adsView, /navigator\.clipboard\.writeText\(URL_PARAMETERS\)/);
});

const has = (source, text) => assert.ok(source.includes(text), `${text} is present`);

test("the tab answers one question first, then keeps every figure", () => {
  // The Dashboard's panel style, but a layout of its own: a report card, the
  // path to a customer, day by day, the wider lead picture and one table.
  has(adsView, 'className="crm-view crm-dashboard-view crm-ads-view"');
  has(adsView, "Every $1 you spent on ads brought back");
  has(adsView, "<strong>{backPerDollar(totals.roas)}</strong>");
  has(adsView, "<MoneyBars spentCents={totals.spendCents} earnedCents={totals.revenueCents} />");
  has(adsView, "{ratio(totals.roas)} return on ad spend");
  // Every step from seeing an ad to becoming a customer, with what each cost
  // and the share that moved on, so a drop-off is visible where it happens.
  has(adsView, "<h3>From ad to customer</h3>");
  for (const step of ["saw your ads", "clicked", "became leads", "booked a job", "became customers"])
    has(adsView, `label="${step}"`);
  for (const rate of [
    "percent(totals.ctr)",
    "share(totals.leads, totals.clicks)",
    "share(totals.booked, totals.leads)",
    "share(totals.won, totals.booked)",
  ])
    has(adsView, `rate={${rate}}`);
  for (const each of ["totals.cpcCents", "totals.costPerLeadCents", "totals.costPerBookedCents", "totals.costPerWonCents"])
    has(adsView, `each={${each}}`);
  // The rest of the marketing picture for the same range.
  has(adsView, "<h3>Ads and everything else</h3>");
  for (const copy of ["Appointments booked", "came from", "Ads&apos; share of revenue", "`${adRevenueShare}%`"])
    has(adsView, copy);
  // A good or bad return is never colour alone: it carries an icon and words.
  has(adsView, 'label: "Earning more than it costs"');
  has(adsView, 'label: "Costing more than it has earned"');
});

test("spend and leads are charted day by day without a second axis", () => {
  // Two single-series charts on one shared day axis, each on its own scale,
  // and the same numbers in a table for screen readers.
  has(adsView, "function DailyChart(");
  has(adsView, "crm-ads-daily-bars is-spend");
  has(adsView, "crm-ads-daily-bars is-leads");
  has(adsView, '<table className="sr-only">');
  // Long ranges group into weeks so bars stay readable.
  has(adsView, "const byWeek = days > 45;");
  // Only leads the report credits to a campaign, so the chart adds up to the
  // funnel's lead count.
  has(adsView, "lead.metaCampaignId && campaignIds.has(lead.metaCampaignId)");
});

test("budget use is never understated", () => {
  // Overspend shows as more than 100%; only the bar is capped, and it turns
  // amber with the percentage written beside it.
  assert.ok(!adsView.includes("Math.min(100, Math.round((totals.spendCents"));
  has(adsView, "width: `${Math.min(100, budgetUsedPercent)}%`");
  has(adsView, 'budgetUsedPercent > 100 ? " is-over" : ""');
  // A month's budget is only compared with a month of spend.
  has(adsView, 'const budgetComparable = budgetCents > 0 && range === "30";');
});

test("one campaign table carries delivery as well as money", () => {
  for (const header of ["Campaign", "Spend", "Leads", "Cost per lead", "Booked jobs", "Won customers", "Revenue", "Return"])
    has(adsView, `<th>${header}</th>`);
  // Impressions and clicks tell you whether a bad cost per lead is a delivery
  // problem or a conversion problem, so every row still shows them.
  for (const figure of [
    "count(campaign.impressions)",
    "count(campaign.clicks)",
    "percent(campaign.ctr)",
    "cost(campaign.costPerLeadCents)",
    "cost(campaign.costPerBookedCents)",
    "cost(campaign.costPerWonCents)",
    "ratio(campaign.roas)",
  ])
    has(adsView, figure);
  // The return pill says its verdict in words, not only colour.
  has(adsView, '<span className="sr-only">, {verdict.label}</span>');
  // The campaign name opens its drawer.
  has(adsView, "onClick={() => setOpenCampaignId(campaign.campaignId)}");
  // On a phone each row becomes a labelled card, so nothing scrolls sideways.
  has(read("app/crm/controls.css"), ".crm-ads-table td[data-label]::before { content: attr(data-label)");
});

test("a campaign opens in a drawer that reads top to bottom", () => {
  assert.match(adsView, /function CampaignDrawer\(/);
  assert.match(adsView, /role="dialog"/);
  assert.match(adsView, /aria-modal="true"/);
  // What it returned, in a sentence, then the numbers behind it.
  assert.match(adsView, /aria-label="Campaign summary"/);
  assert.match(adsView, /<Verdict roas=\{campaign\.roas\} \/>/);
  // Each ad is a card with what it spent, its leads, their cost and wins; ad
  // sets only appear when there is more than one to tell apart.
  assert.match(adsView, /aria-label="Ads in this campaign"/);
  assert.match(adsView, /const multipleAdsets = campaign\.adsets\.length > 1;/);
  for (const figure of ["dollars(ad.spendCents)", "count(ad.leads)", "cost(ad.costPerLeadCents)", "count(ad.won)"])
    assert.ok(adsView.includes(figure), `${figure} is shown per ad`);
  assert.match(adsView, /No leads from this ad yet\./);
  // The people it brought in, won first, each opening their lead.
  assert.match(adsView, /aria-label="Leads from this campaign"/);
  assert.match(adsView, /onClick=\{\(\) => onOpenLead\(lead\)\}/);
});

test("the tab shows a dash for a cost it cannot compute, never a zero", () => {
  assert.match(adsView, /return value == null \? "—" : dollars\(value\)/);
  // Exact dollars: "$1K" would hide the difference between $1,213 and $1,000.
  assert.doesNotMatch(adsView, /money\([^)]*, true\)/);
});

test("stylesheets never hand-write -webkit-backdrop-filter", () => {
  // The CSS minifier treats a hand-written -webkit-backdrop-filter beside an
  // identical backdrop-filter as a duplicate and keeps only the prefixed one,
  // so Chrome lost every Glass blur in production (the lead record showed the
  // campaign drawer through it). Write only backdrop-filter; the build adds
  // the -webkit- prefix itself.
  for (const file of [
    "app/globals.css",
    "app/landing.module.css",
    "app/crm/controls.css",
    "app/crm/theme-glass.css",
    "app/crm/design-system.css",
    "app/crm/mobile.css",
    "app/crm/account-switcher.css",
  ])
    assert.ok(!read(file).includes("-webkit-backdrop-filter"), `${file} hand-writes -webkit-backdrop-filter`);
});

test("the campaign drawer lists each lead under the ad that produced it", () => {
  // A lead goes under the ad its click carried ({{ad.id}} in utm_content);
  // one that carried the campaign but no known ad is listed apart, never
  // guessed onto an ad.
  assert.ok(adsView.includes("if (lead.metaAdId && adIds.has(lead.metaAdId))"));
  assert.ok(adsView.includes("Leads from this ad"));
  assert.ok(adsView.includes("Leads with no ad recorded"));
  // Each ad shows delivery and money, and its own return.
  for (const figure of ["count(ad.clicks)", "percent(ad.ctr)", "dollars(ad.revenueCents)", "returnVerdict(ad.roas)"])
    assert.ok(adsView.includes(figure), `${figure} is shown per ad`);
  // The campaign's own path from seeing it to buying.
  assert.ok(adsView.includes('aria-label="From ad to customer"'));
});
