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

test("the Ads tab is in navigation and respects the workspace date range", () => {
  assert.match(crmApp, /id: "ads", label: "Ads"/);
  assert.match(crmApp, /\["dashboard", "leads", "reports", "ads"\]/);
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
  assert.match(adsView, /navigator\.clipboard\.writeText\(URL_PARAMETERS\)/);
});

test("the tab shows a dash for a cost it cannot compute, never a zero", () => {
  assert.match(adsView, /return value == null \? "—" : money\(value, true\)/);
});

test("a wide table scrolls inside itself rather than the page", () => {
  assert.match(adsView, /className="crm-table-scroll"/);
  assert.match(read("app/globals.css"), /\.crm-table-scroll \{ overflow-x: auto; \}/);
});
