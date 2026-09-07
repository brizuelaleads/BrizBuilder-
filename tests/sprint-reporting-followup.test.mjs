import assert from "node:assert/strict";
import test from "node:test";
import { buildAdsReport } from "../lib/meta-ads-report.ts";
import { callNeedsFollowUp } from "../lib/call-attention.ts";
import { reportingWindow } from "../lib/reporting-window.ts";

test("report periods include complete boundary days and share the snapshot clock", () => {
  const period = reportingWindow("7", "2026-09-06T16:30:00Z");
  assert.equal(period.startDate, "2026-08-31");
  assert.equal(period.start, Date.parse("2026-08-31T00:00:00Z"));
  assert.equal(period.end, Date.parse("2026-09-06T16:30:00Z"));
  assert.equal(period.endDate, "2026-09-06");
  assert.equal(reportingWindow("all", "2026-09-06T16:30:00Z").start, null);
});

const lead = (id, campaign, revenue) => ({
  id,
  metaCampaignId: campaign,
  metaAdsetId: null,
  metaAdId: null,
  status: "WON",
  finalRevenueCents: revenue,
});
const insight = {
  date: "2026-09-06",
  campaignId: "meta1",
  campaignName: "Services",
  adsetId: "set1",
  adId: "ad1",
  adName: "Estimate",
  spendCents: 10000,
  impressions: 100,
  clicks: 10,
};
test("organic wins do not inflate Meta ROAS", () => {
  const report = buildAdsReport({
    connected: true,
    insights: [insight],
    leads: [lead("meta", "meta1", 30000), lead("organic", null, 90000)],
  });
  assert.equal(report.totals.roas, 3);
  assert.equal(report.totals.costPerLeadCents, 10000);
  assert.equal(report.unattributedLeads, 1);
});
test("missing insight rows are unknown cost, while an explicit zero is zero", () => {
  const leads = [lead("meta", "meta1", 30000)];
  const missing = buildAdsReport({ connected: true, insights: [], leads });
  assert.equal(missing.totals.costPerLeadCents, null);
  assert.equal(missing.totals.costPerWonCents, null);
  assert.equal(missing.campaigns[0].costPerLeadCents, null);
  const zero = buildAdsReport({
    connected: true,
    insights: [{ ...insight, spendCents: 0 }],
    leads,
  });
  assert.equal(zero.totals.costPerLeadCents, 0);
  assert.equal(zero.totals.roas, null);
});
const missed = {
  id: "call1",
  clientId: "business1",
  customerPhone: "+12125550123",
  answered: false,
  direction: "inbound",
  handledAt: null,
  startedAt: "2026-09-01T10:00:00Z",
};
test("handled calls and later successful callbacks leave the attention queue", () => {
  assert.equal(callNeedsFollowUp(missed, []), true);
  assert.equal(
    callNeedsFollowUp({ ...missed, handledAt: "2026-09-01T11:00:00Z" }, []),
    false,
  );
  const callback = {
    ...missed,
    id: "call2",
    direction: "outbound",
    answered: true,
    startedAt: "2026-09-02T11:00:00Z",
  };
  assert.equal(callNeedsFollowUp(missed, [callback]), false);
  assert.equal(
    callNeedsFollowUp(missed, [{ ...callback, clientId: "other-business" }]),
    true,
  );
  assert.equal(
    callNeedsFollowUp(missed, [{ ...callback, answered: false }]),
    true,
  );
});
test("withheld caller numbers cannot resolve unrelated missed calls", () => {
  assert.equal(
    callNeedsFollowUp({ ...missed, customerPhone: null }, [
      {
        ...missed,
        id: "different",
        customerPhone: null,
        answered: true,
        startedAt: "2026-09-02T11:00:00Z",
      },
    ]),
    true,
  );
});
