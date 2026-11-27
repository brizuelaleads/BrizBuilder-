import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  isRecurringDue,
  nextRecurringDay,
  nextRecurringDayAfter,
  normalizeRecurringInput,
  recurringLabel,
} from "../lib/square-core.ts";

const read = (rel) =>
  fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");

const NOW = new Date("2026-11-27T15:00:00Z");
const plan = (over = {}) => ({
  recipientName: "Jordan Chen",
  recipientEmail: "jordan@example.com",
  title: "Monthly maintenance",
  lineItems: [{ name: "Maintenance", quantity: 1, unitPrice: "500" }],
  frequency: "monthly",
  startDate: "2026-12-01",
  dueInDays: 14,
  endAfterCount: null,
  ...over,
});

test("monthly plans keep their day of the month through short months", () => {
  assert.equal(nextRecurringDay("2027-01-31", "monthly", 31), "2027-02-28");
  assert.equal(nextRecurringDay("2027-02-28", "monthly", 31), "2027-03-31");
  assert.equal(nextRecurringDay("2028-01-31", "monthly", 31), "2028-02-29");
  assert.equal(nextRecurringDay("2026-12-15", "monthly", 15), "2027-01-15");
  assert.equal(nextRecurringDay("2026-11-30", "quarterly", 30), "2027-02-28");
  assert.equal(nextRecurringDay("2028-02-29", "yearly", 29), "2029-02-28");
  assert.equal(nextRecurringDay("2026-12-28", "weekly", 28), "2027-01-04");
  assert.equal(nextRecurringDay("2026-12-28", "biweekly", 28), "2027-01-11");
});

test("a plan that fell behind skips to the next future billing day instead of billing every missed one", () => {
  assert.equal(nextRecurringDayAfter("2026-08-01", "2026-11-27", "monthly", 1), "2026-12-01");
  assert.equal(nextRecurringDayAfter("2026-11-27", "2026-11-27", "monthly", 27), "2026-12-27");
});

test("a billing day counts from 14:00 UTC, and an overdue one at once", () => {
  assert.equal(isRecurringDue("2026-11-27", new Date("2026-11-27T13:59:00Z")), false);
  assert.equal(isRecurringDue("2026-11-27", new Date("2026-11-27T14:00:00Z")), true);
  assert.equal(isRecurringDue("2026-11-26", new Date("2026-11-27T01:00:00Z")), true);
  assert.equal(isRecurringDue("2026-11-28", new Date("2026-11-27T23:00:00Z")), false);
});

test("schedules read in plain words", () => {
  assert.equal(recurringLabel("monthly", 1, "2026-12-01"), "Monthly on the 1st");
  assert.equal(recurringLabel("monthly", 22, "2026-12-22"), "Monthly on the 22nd");
  assert.equal(recurringLabel("monthly", 31, "2026-12-31"), "Monthly on the last day");
  assert.equal(recurringLabel("weekly", 4, "2026-12-04"), "Weekly on Friday");
  assert.equal(recurringLabel("yearly", 5, "2027-03-05"), "Yearly on Mar 5");
});

test("recurring input is checked like an invoice, plus its schedule", () => {
  const ok = normalizeRecurringInput(plan(), NOW);
  assert.equal(ok.totalCents, 50000);
  assert.equal(ok.anchorDay, 1);
  assert.equal(ok.endAfterCount, null);
  assert.equal(normalizeRecurringInput(plan({ endAfterCount: "12" }), NOW).endAfterCount, 12);
  assert.throws(() => normalizeRecurringInput(plan({ frequency: "daily" }), NOW), /how often/);
  assert.throws(() => normalizeRecurringInput(plan({ startDate: "2026-10-01" }), NOW), /past/);
  assert.throws(() => normalizeRecurringInput(plan({ startDate: "2028-01-01" }), NOW), /next year/);
  assert.throws(() => normalizeRecurringInput(plan({ dueInDays: 120 }), NOW), /0 to 90/);
  assert.throws(() => normalizeRecurringInput(plan({ endAfterCount: 0 }), NOW), /Stop after/);
  assert.throws(() => normalizeRecurringInput(plan({ recipientEmail: "nope" }), NOW), /valid email/);
  assert.throws(() => normalizeRecurringInput(plan({ lineItems: [] }), NOW), /line item/);
});

const store = read("db/supabase-square.ts");
const fnBody = (name) => {
  const start = store.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} exists`);
  return store.slice(start, store.indexOf("\n}\n", start));
};

test("every plan action authorizes the caller and pins the plan to the tenant", () => {
  for (const name of ["createRecurringPlan", "updateRecurringPlan", "setRecurringPlanStatus"])
    assert.match(fnBody(name), /await authorize\(user, scope, "invoice"\)/, name);
  assert.match(fnBody("planFor"), /\.eq\("id", planId\)\s*\.eq\("organization_id", organizationId\),\s*clientId,/);
  // Recipients picked in the browser are re-checked against the tenant.
  for (const name of ["createRecurringPlan", "updateRecurringPlan"])
    assert.match(fnBody(name), /checkedRecipient\(context\.organizationId, clientId, input\.recipientId\)/, name);
});

test("a billing period is claimed before it is sent, so it cannot go out twice", () => {
  const run = fnBody("runPlan");
  const claim = run.indexOf('.eq("next_run_on", period)');
  const send = run.indexOf("issueInvoice(");
  assert.ok(claim > 0 && send > claim, "claim happens before the send");
  assert.match(run, /\.eq\("status", "active"\)\s*\.eq\("next_run_on", period\)/);
  assert.match(run, /recurring: \{ planId: String\(plan\.id\), period \}/);
  const migration = read("supabase/migrations/20261127000000_square_recurring_plans.sql");
  assert.match(migration, /create unique index if not exists square_invoices_recurring_period_uidx\s+on public\.square_invoices\(recurring_plan_id, recurring_period\)/);
});

test("a disconnected Square account holds the plan instead of skipping the period", () => {
  const run = fnBody("runPlan");
  const offline = run.indexOf("if (!isLive(connection)");
  const claim = run.indexOf('.eq("next_run_on", period)');
  assert.ok(offline > 0 && offline < claim);
  assert.match(run.slice(offline, claim), /return "skipped";/);
});

test("recurring plans are server-only and run from the Worker cron", () => {
  const migration = read("supabase/migrations/20261127000000_square_recurring_plans.sql");
  assert.match(migration, /alter table public\.square_recurring_plans enable row level security;/);
  assert.match(migration, /revoke all on table public\.square_recurring_plans from anon, authenticated;/);
  const worker = read("worker/index.ts");
  assert.match(worker, /ctx\.waitUntil\(\s*runRecurringSquareBilling\(\)\.catch\(/);
  const route = read("app/api/square/route.ts");
  for (const action of ["create_recurring", "update_recurring", "recurring_status"])
    assert.match(route, new RegExp(`case "${action}":`));
});
