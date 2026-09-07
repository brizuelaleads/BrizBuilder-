import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { buildAdsReport } from "../lib/meta-ads-report.ts";

const require = createRequire(import.meta.url);
function component(file, name) {
  const built = buildSync({
    entryPoints: [
      new URL(`../${file}`, import.meta.url).pathname.replace(
        /^\/(?=[A-Za-z]:)/,
        "",
      ),
    ],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "lucide-react"],
  });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(
    require,
    compiled,
    compiled.exports,
  );
  return compiled.exports[name];
}
const Dashboard = component("app/crm/DashboardView.tsx", "DashboardView");
const Reports = component("app/crm/ReportsView.tsx", "ReportsView");
const lead = (overrides = {}) => ({
  id: "lead-1",
  firstName: "Ada",
  lastName: "Lovelace",
  source: "Meta",
  clientId: "business-1",
  status: "NEW",
  createdAt: "2026-09-01T12:00:00Z",
  updatedAt: "2026-09-01T12:00:00Z",
  lastContactedAt: null,
  nextFollowUpAt: null,
  finalRevenueCents: 0,
  metaCampaignId: "campaign-1",
  ...overrides,
});
const insight = {
  date: "2026-09-01",
  campaignId: "campaign-1",
  campaignName: "Services",
  adsetId: "set-1",
  adId: "ad-1",
  adName: "Ad",
  spendCents: 10000,
  impressions: 100,
  clicks: 10,
};
const clients = [
  { id: "business-1", businessName: "Services", monthlyAdBudgetCents: 900000 },
];
function props(overrides = {}) {
  return {
    leads: [],
    pipelineLeads: [],
    clients,
    appointments: [],
    tasks: [],
    phoneCalls: [],
    providerConnections: [],
    metaAdInsights: [],
    marketingReport: buildAdsReport({
      connected: false,
      insights: [],
      leads: [],
    }),
    callsNeedingFollowUp: [],
    stages: [],
    range: "7",
    generatedAt: "2026-09-06T12:00:00Z",
    onOpenLead() {},
    onNavigate() {},
    onOpenCallFollowUps() {},
    ...overrides,
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(text).join("");
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}

test("dashboard opens the oldest unanswered lead and the unresolved calls list", () => {
  const opened = [];
  const tree = Dashboard(
    props({
      pipelineLeads: [
        lead(),
        lead({ id: "older", createdAt: "2026-08-01T12:00:00Z" }),
        lead({ id: "contacted", lastContactedAt: "2026-09-02T12:00:00Z" }),
      ],
      callsNeedingFollowUp: [{ id: "call-1" }],
      onOpenLead: (item) => opened.push(item.id),
      onOpenCallFollowUps: () => opened.push("calls"),
    }),
  );
  const buttons = nodes(tree).filter((node) => node.type === "button");
  buttons
    .find((button) => text(button).includes("2 new leads need response"))
    .props.onClick();
  buttons
    .find((button) => text(button).includes("1 calls need follow-up"))
    .props.onClick();
  assert.deepEqual(opened, ["older", "calls"]);
});

test("no-work dashboard has an honest caught-up state", () => {
  const html = renderToStaticMarkup(createElement(Dashboard, props()));
  assert.match(html, /caught up/);
  assert.doesNotMatch(html, /0 new leads need response/);
});

test("dashboard and report render the same attributed ROAS rather than all-source revenue", () => {
  const leads = [
    lead({ status: "WON", finalRevenueCents: 30000 }),
    lead({
      id: "organic",
      metaCampaignId: null,
      source: "Organic",
      status: "WON",
      finalRevenueCents: 90000,
    }),
  ];
  const report = buildAdsReport({
    connected: true,
    insights: [insight],
    leads,
  });
  const dashboard = renderToStaticMarkup(
    createElement(
      Dashboard,
      props({
        leads,
        pipelineLeads: leads,
        metaAdInsights: [insight],
        marketingReport: report,
      }),
    ),
  );
  const summary = renderToStaticMarkup(
    createElement(Reports, {
      leads,
      clients,
      report,
      period: "Last 7 days",
      hasSpendData: true,
    }),
  );
  assert.match(dashboard, /3\.0x Meta ROAS/);
  assert.match(summary, /3\.0x/);
  assert.doesNotMatch(summary, /12\.0x/);
  assert.match(summary, /Meta ad spend<\/span><strong>\$100/);
  assert.match(summary, /Monthly budget/);
});
