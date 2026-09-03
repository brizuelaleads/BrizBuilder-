import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  metaCampaignIdFromAttribution,
  normalizeAdAccountId,
} from "../lib/meta-ads-ids.ts";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
// Line endings are normalized so the block-matching patterns below behave the
// same on a CRLF checkout as they do on LF.
const read = (rel) =>
  fs.readFileSync(path.join(root, rel), "utf8").replaceAll("\r\n", "\n");

const adsSource = read("lib/meta-ads.ts");
const idsSource = read("lib/meta-ads-ids.ts");
const syncSource = read("lib/meta-ads-sync.ts");
const crmSource = read("db/supabase-crm.ts");
const workerSource = read("worker/index.ts");
const dashboardSource = read("app/crm/DashboardView.tsx");
const connectionsUi = read("app/crm/WorkflowViews.tsx");
const migrationSource = read(
  "supabase/migrations/20260901000000_meta_ads_insights.sql",
);

test("an ad account id is accepted with or without the act_ prefix", () => {
  assert.equal(normalizeAdAccountId("act_123456789"), "act_123456789");
  assert.equal(normalizeAdAccountId("123456789"), "act_123456789");
  assert.equal(normalizeAdAccountId("  act_123456789  "), "act_123456789");
});

test("anything that is not an ad account id is refused", () => {
  for (const value of [
    "",
    "act_",
    "act_abc",
    "me/adaccounts",
    "act_123; drop table",
    "../../etc/passwd",
    null,
    undefined,
    12345,
  ]) {
    assert.throws(
      () => normalizeAdAccountId(value),
      /ad account ID/,
      `${String(value)} must be refused`,
    );
  }
});

test("the access token travels in a header, never in a URL", () => {
  // A URL reaches log lines and error messages; a header does not. The paging
  // cursor Meta returns carries the token inline, which is why it is rebuilt
  // rather than followed as given.
  assert.match(
    adsSource,
    /headers: \{ Authorization: `Bearer \$\{accessToken\}` \}/,
  );
  assert.ok(
    !/searchParams\.set\(\s*["']access_token["']/.test(adsSource),
    "the token is never written into a query string",
  );
  assert.match(adsSource, /parsed\.searchParams\.delete\("access_token"\)/);
});

test("paging never leaves graph.facebook.com and is bounded", () => {
  // Following an attacker-influenced next cursor would send the request, and
  // whatever it carries, somewhere else entirely.
  assert.match(
    adsSource,
    /if \(parsed\.hostname !== "graph\.facebook\.com"\) return null;/,
  );
  assert.match(adsSource, /page < MAX_INSIGHT_PAGES/);
});

test("Meta refusals are classified so the sync can react to each", () => {
  // A revoked token needs a reconnection, a throttle needs a retry, and
  // everything else is worth surfacing once. Collapsing them loses that.
  assert.match(adsSource, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(adsSource, /response\.status === 429 \|\| detail\.code === 4 \|\| detail\.code === 17/);
  assert.match(adsSource, /formatMetaErrorDetail\(summary, detail\)/);
});

test("only sanitized text is stored against a connection", () => {
  // MetaAdsError messages are already built through the redaction helpers. An
  // arbitrary throw can carry a URL or a payload fragment, so it is replaced
  // rather than recorded.
  assert.match(
    syncSource,
    /return \{ status: "error", message: "Meta could not be reached\." \};/,
  );
  assert.ok(
    !/last_error: String\(error/.test(syncSource),
    "a raw exception is never written to last_error",
  );
});

test("two isolates cannot sync one client at the same time", () => {
  // The guard is the WHERE clause, not a read followed by a write: both
  // isolates issue the UPDATE and Postgres lets exactly one of them match.
  assert.match(
    syncSource,
    /\.update\(\{ sync_started_at: new Date\(\)\.toISOString\(\) \}\)[\s\S]{0,200}?\.or\(\s*`sync_started_at\.is\.null,sync_started_at\.lt\.\$\{staleBefore\}`/,
  );
  assert.match(syncSource, /if \(!\(await claim\(row\)\)\) \{/);
});

test("an abandoned claim is recoverable", () => {
  // A Worker killed mid-sync must not strand a client until someone notices.
  assert.match(syncSource, /CLAIM_STALE_AFTER_MS = 20 \* 60_000/);
  assert.match(syncSource, /sync_started_at: null/);
});

test("the restatement window is re-fetched and upserted, not appended", () => {
  // Meta adjusts recent days after the fact. Re-reading and upserting is what
  // makes the stored numbers converge instead of freezing at first report.
  assert.match(syncSource, /RESTATEMENT_WINDOW_DAYS = 3/);
  assert.match(
    syncSource,
    /onConflict: "organization_id,client_id,date_start,ad_id"/,
  );
  assert.match(
    migrationSource,
    /unique \(organization_id, client_id, date_start, ad_id\)/,
  );
});

test("only a successful pass advances the last-synced stamp", () => {
  // Otherwise the connection card reports freshness when all that happened was
  // that something tried and failed.
  assert.match(syncSource, /\.\.\.\(status === "ok" \? \{ last_sync_at: now \} : \{\}\)/);
});

test("a failing client cannot stop the ones after it", () => {
  assert.match(syncSource, /outcomes\.push\(await syncOne\(row\)\)/);
  assert.match(syncSource, /catch \(error\) \{\s*const failure = describeFailure\(error\)/);
});

test("the ads tables are service-role only, like every other tenant table", () => {
  for (const table of ["meta_ads_credentials", "meta_ad_insights"]) {
    assert.match(
      migrationSource,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
    assert.match(
      migrationSource,
      new RegExp(`revoke all on table public\\.${table} from anon, authenticated`),
    );
  }
});

test("ad rows cannot outlive the client they belong to", () => {
  // The composite foreign key is what stops a row being written under one
  // organization's id and another organization's client.
  for (const constraint of [
    "meta_ads_credentials_organization_client_fk",
    "meta_ad_insights_organization_client_fk",
  ]) {
    assert.match(migrationSource, new RegExp(constraint));
  }
  assert.match(
    migrationSource,
    /references public\.clients\(organization_id, id\)[\s\S]{0,40}on delete cascade/,
  );
});

test("the connect action verifies the token before storing it", () => {
  // A bad paste must fail while the person who can fix it is still looking at
  // the screen, not silently on every sync from then on.
  const block = crmSource.slice(
    crmSource.indexOf('if (action === "connect_meta_ads")'),
  );
  const verifyAt = block.indexOf("verifyMetaAdAccount");
  const encryptAt = block.indexOf("encryptMetaSecret");
  assert.ok(verifyAt > -1 && encryptAt > -1);
  assert.ok(verifyAt < encryptAt, "verification comes before the token is saved");
});

test("every Meta Ads action is permissioned and client-scoped", () => {
  for (const action of [
    "connect_meta_ads",
    "sync_meta_ads",
    "disconnect_meta_ads",
  ]) {
    const start = crmSource.indexOf(`if (action === "${action}")`);
    assert.ok(start > -1, `${action} exists`);
    const block = crmSource.slice(start, start + 900);
    assert.match(block, /requirePermission\(context, "websites\.manage"\)/);
    assert.match(block, /await requireClient\(context, clientId\)/);
  }
});

test("disconnecting destroys the token and keeps the spend history", () => {
  const block = crmSource.slice(
    crmSource.indexOf('if (action === "disconnect_meta_ads")'),
    crmSource.indexOf('if (action === "disconnect_meta_ads")') + 1600,
  );
  assert.match(block, /from\("meta_ads_credentials"\)\s*\.delete\(\)/);
  assert.ok(
    !/from\("meta_ad_insights"\)\s*\.delete\(\)/.test(block),
    "a past report must not change because a token was rotated",
  );
});

test("the account picker never persists anything", () => {
  const start = crmSource.indexOf('if (action === "list_meta_ad_accounts")');
  const block = crmSource.slice(start, start + 600);
  assert.match(block, /requirePermission\(context, "websites\.manage"\)/);
  assert.ok(
    !/\.upsert\(|\.insert\(|\.update\(/.test(block),
    "listing accounts is a read",
  );
});

test("an ad platform being slow cannot delay call ingestion", () => {
  // Separate waitUntil calls on the same tick: neither job can fail or hold up
  // the other.
  assert.match(workerSource, /ctx\.waitUntil\(\s*syncMetaAdsInsights\(\)/);
  assert.match(workerSource, /ctx\.waitUntil\(\s*reconcileCallRailIngestion\(\)/);
});

test("the dashboard reports spend it actually has", () => {
  // The tile used to sum a field only the Twilio connector ever wrote, so it
  // could never resolve. It now reads the synced ad rows.
  assert.match(
    dashboardSource,
    /const reportedAdSpendCents = metaAdInsights\.reduce\(/,
  );
  assert.ok(
    !/connection\.monthSpend \?\? 0/.test(dashboardSource),
    "spend no longer comes from a field no ad connector populates",
  );
});

test("no sparkline is fabricated from its own summary value", () => {
  // The ROAS trend was once the current figure multiplied by a fixed rising
  // series -- a chart that always went up regardless of the data.
  assert.ok(
    !/roas \* 0\.\d+/.test(dashboardSource),
    "the trend line is measured, not invented",
  );
  assert.match(
    dashboardSource,
    /sparkline: bucketSeries\(\s*metaAdInsights,/,
  );
});

test("cost per lead counts only leads that carry a campaign", () => {
  // Dividing spend by every lead would credit Meta with referrals and organic
  // calls, which is how a cost-per-lead figure quietly becomes fiction.
  assert.match(
    dashboardSource,
    /const attributedLeads = leads\.filter\(\(lead\) => Boolean\(lead\.metaCampaignId\)\)/,
  );
  assert.match(
    dashboardSource,
    /reportedAdSpendCents \/ attributedLeads\.length/,
  );
});

test("a lead is joined to a campaign only by a Meta-shaped id", () => {
  // utm_campaign is caller-controlled on the public lead endpoint, so a
  // free-text label must never be presented as a join into an ad account.
  assert.equal(
    metaCampaignIdFromAttribution({ utm_campaign: "120209876543210" }),
    "120209876543210",
  );
  for (const attribution of [
    { utm_campaign: "spring-promo" },
    { utm_campaign: "Summer Sale 2026" },
    { utm_campaign: "12" },
    { utm_campaign: "  " },
    { utm_campaign: 120209876543210 },
    { utm_campaign: null },
    { utm_source: "meta" },
    {},
    null,
    undefined,
    "not-an-object",
    [{ utm_campaign: "120209876543210" }],
  ]) {
    assert.equal(
      metaCampaignIdFromAttribution(attribution),
      null,
      `${JSON.stringify(attribution)} must not resolve to a campaign`,
    );
  }
  assert.match(crmSource, /metaCampaignId: metaCampaignIdFromAttribution\(row\.attribution\)/);
});

test("the id rules stay dependency-free so they can be exercised directly", () => {
  // Matching callrail-ids.ts: a rule that decides what crosses a trust boundary
  // is tested against its own behaviour, not against a regex over its source.
  assert.ok(
    !/^import /m.test(idsSource),
    "meta-ads-ids.ts imports nothing",
  );
});

test("only the campaign id reaches the browser, not the click identifiers", () => {
  // attribution also holds fbclid, fbc and fbp. Nothing in the interface needs
  // them, so nothing in the interface is given them.
  assert.ok(
    !/attribution: normalizeAttribution\(row\.attribution\)/.test(crmSource) ||
      !/attribution:/.test(read("db/crm.ts")),
    "the raw attribution blob is not part of the lead payload",
  );
  const leadType = read("db/crm.ts");
  assert.ok(
    !/\bfbclid\b/.test(leadType),
    "no click identifier is declared on a client-facing type",
  );
});

test("the connection card offers Meta Ads separately from Conversions", () => {
  // Different permissions, different tokens: a business can have one without
  // the other, so they cannot share a card.
  assert.match(connectionsUi, /provider === "meta_ads"/);
  assert.match(connectionsUi, /action: "connect_meta_ads"/);
  assert.match(connectionsUi, /action: "list_meta_ad_accounts"/);
  assert.match(connectionsUi, /action: "disconnect_meta_ads"/);
});

test("the Meta Ads setup uses the integrations card layout", () => {
  const card = connectionsUi.slice(
    connectionsUi.indexOf('expandedIntegration === "meta-ads"'),
    connectionsUi.indexOf('expandedIntegration === "callrail"'),
  );
  assert.match(card, /crm-integration-footer/);
  assert.match(card, /crm-integration-advanced/);
  assert.match(card, /crm-connection-details compact crm-connection-details-simple/);
  assert.doesNotMatch(card, /crm-integration-actions|crm-integration-detail/);
});

test("the browser does not keep the token after connecting", () => {
  const block = connectionsUi.slice(
    connectionsUi.indexOf('action: "connect_meta_ads"'),
  );
  assert.match(block.slice(0, 700), /setMetaAdsToken\(""\)/);
});

test("the connection card tells you to label the ads before connecting", () => {
  // Meta offers no lookup from a click back to a campaign, so this label is the
  // only link between a lead and the ad that paid for it -- and a lead only
  // carries it if the label was live at click time. Someone who connects an
  // account without setting it gets spend they cannot attribute to anything.
  const form = connectionsUi.slice(
    connectionsUi.indexOf('action: "connect_meta_ads"'),
    connectionsUi.indexOf("System User access token"),
  );
  assert.match(form, /Set this in Ads Manager first/);
  // JSX writes the braces as entities; these render as {{campaign.id}} etc.
  const brace = "&#123;&#123;";
  const close = "&#125;&#125;";
  for (const field of ["campaign.id", "adset.id", "ad.id"]) {
    assert.ok(
      form.includes(`${brace}${field}${close}`),
      `the snippet carries ${field}`,
    );
  }
  assert.match(form, /utm_source=meta/);
});

// ---------------------------------------------------------------------------
// Historical backfill
// ---------------------------------------------------------------------------

const backfillSource = read("lib/meta-ads-backfill.ts");
const rangeSource = read("lib/meta-ads-range.ts");
const backfillMigration = read(
  "supabase/migrations/20260903000000_meta_ads_backfill.sql",
);

test("a backfill range stops short of the window the sync owns", async () => {
  const { resolveBackfillRange, latestBackfillDay } = await import(
    "../lib/meta-ads-range.ts"
  );
  const today = new Date("2026-09-03T12:00:00Z");
  assert.equal(latestBackfillDay(today), "2026-08-31");

  // Asking through today is reasonable; the answer is the part the sync does
  // not already re-fetch every fifteen minutes.
  const clamped = resolveBackfillRange("2026-08-01", "2026-09-03", today);
  assert.deepEqual(clamped, { since: "2026-08-01", until: "2026-08-31" });

  // A range entirely in the past is untouched.
  const past = resolveBackfillRange("2026-06-01", "2026-06-30", today);
  assert.deepEqual(past, { since: "2026-06-01", until: "2026-06-30" });
});

test("a backfill range that is nothing but the sync window is refused", async () => {
  const { resolveBackfillRange } = await import("../lib/meta-ads-range.ts");
  const today = new Date("2026-09-03T12:00:00Z");
  assert.throws(
    () => resolveBackfillRange("2026-09-02", "2026-09-03", today),
    /automatic sync already covers/,
  );
});

test("malformed, reversed and oversized ranges are refused", async () => {
  const { resolveBackfillRange } = await import("../lib/meta-ads-range.ts");
  const today = new Date("2026-09-03T12:00:00Z");
  const cases = [
    ["", "2026-08-01", /YYYY-MM-DD/],
    ["2026-08-01", "", /YYYY-MM-DD/],
    ["01-08-2026", "2026-08-05", /YYYY-MM-DD/],
    [null, undefined, /YYYY-MM-DD/],
    ["2026-13-45", "2026-14-99", /real calendar dates|YYYY-MM-DD/],
    ["2026-08-30", "2026-08-01", /start date must be on or before/],
    ["2020-01-01", "2026-08-31", /at most 366 days/],
  ];
  for (const [since, until, pattern] of cases) {
    assert.throws(
      () => resolveBackfillRange(since, until, today),
      pattern,
      `${String(since)}..${String(until)} must be refused`,
    );
  }
});

test("backfilled rows land on the same key as the sync, so spend cannot double", () => {
  // The whole no-duplicate-spend guarantee is this: the backfill does not have
  // its own write path, it calls the sync's storeInsights, which upserts.
  assert.match(backfillSource, /storeInsights\(credential, insights\)/);
  assert.ok(
    !/from\("meta_ad_insights"\)[\s\S]{0,80}\.insert\(/.test(backfillSource),
    "the backfill never inserts insight rows directly",
  );
  assert.match(
    read("lib/meta-ads-sync.ts"),
    /onConflict: "organization_id,client_id,date_start,ad_id"/,
  );
});

test("the backfill and the scheduled sync cannot call Meta at once", () => {
  // Both take the same per-client claim on meta_ads_credentials.
  assert.match(backfillSource, /if \(!\(await claim\(credential\)\)\) return toProgress\(run\)/);
  assert.match(backfillSource, /from "\.\/meta-ads-sync"/);
});

test("rows are stored before the cursor advances", () => {
  // A crash between the two costs a repeated window, which the upsert absorbs.
  // The other order costs a silently missing one.
  const body = backfillSource.slice(backfillSource.indexOf("for (let pass"));
  const store = body.indexOf("storeInsights");
  const cursorWrite = body.indexOf("cursor_date:");
  assert.ok(store > -1 && cursorWrite > -1);
  assert.ok(store < cursorWrite, "storeInsights runs before the cursor is written");
});

test("the range rules stay dependency-free so they can be exercised directly", () => {
  assert.ok(!/^import /m.test(rangeSource), "meta-ads-range.ts imports nothing");
});

test("work is bounded per invocation", () => {
  // A Worker has a fixed CPU and subrequest budget, and Meta rate-limits the
  // application rather than the caller.
  assert.match(rangeSource, /CHUNKS_PER_PASS = \d+/);
  assert.match(backfillSource, /pass < CHUNKS_PER_PASS/);
  assert.match(rangeSource, /DEFAULT_CHUNK_DAYS = \d+/);
});

test("a rate limit pauses a backfill rather than failing it", () => {
  // Throttling is Meta asking to be asked later, not the run being broken.
  assert.match(
    backfillSource,
    /failure\.status === "rate_limited" \? "running" : "failed"/,
  );
});

test("only sanitized text is stored against a backfill run", () => {
  assert.match(backfillSource, /describeFailure\(error\)/);
  assert.ok(
    !/last_error: String\(error/.test(backfillSource),
    "a raw exception is never written to last_error",
  );
});

test("one backfill per client is enforced by the database", () => {
  assert.match(
    backfillMigration,
    /create unique index if not exists meta_ads_backfill_runs_active_uidx[\s\S]*?where status = 'running'/,
  );
  assert.match(backfillSource, /A backfill is already running for this client/);
});

test("the backfill table is service-role only and cannot outlive its client", () => {
  assert.match(
    backfillMigration,
    /alter table public\.meta_ads_backfill_runs enable row level security/,
  );
  assert.match(
    backfillMigration,
    /revoke all on table public\.meta_ads_backfill_runs from anon, authenticated/,
  );
  assert.match(backfillMigration, /meta_ads_backfill_runs_organization_client_fk/);
});

test("the backfill table holds no spend", () => {
  // Spend lives in meta_ad_insights under one key. A second copy here would be
  // a second source of truth to disagree with it.
  for (const column of ["spend_cents", "impressions", "clicks"]) {
    assert.ok(
      !backfillMigration.includes(column),
      `${column} must not be on the backfill run table`,
    );
  }
});

test("every backfill action is permissioned and client-scoped", () => {
  for (const action of [
    "start_meta_ads_backfill",
    "advance_meta_ads_backfill",
    "cancel_meta_ads_backfill",
  ]) {
    const start = crmSource.indexOf(`if (action === "${action}")`);
    assert.ok(start > -1, `${action} exists`);
    const block = crmSource.slice(start, start + 900);
    assert.match(block, /requirePermission\(context, "websites\.manage"\)/);
    assert.match(block, /await requireClient\(context, clientId\)/);
  }
});

test("a long backfill cannot delay the restatement sync", () => {
  // Separate waitUntil calls: neither job can hold up or fail the other.
  assert.match(workerSource, /ctx\.waitUntil\(\s*advanceMetaAdsBackfills\(\)/);
  assert.match(workerSource, /ctx\.waitUntil\(\s*syncMetaAdsInsights\(\)/);
});

test("the card explains that the range stops short of today", () => {
  const anchor = connectionsUi.indexOf('action: "start_meta_ads_backfill"');
  assert.ok(anchor > -1, "the start action is wired in the card");
  const block = connectionsUi.slice(anchor - 5000, anchor + 4000);
  // Copy wraps across lines in JSX, so match on whitespace-tolerant phrases.
  assert.match(block, /automatic sync already\s+owns that window/);
  assert.match(block, /Last 30 days/);
  assert.match(block, /Last 90 days/);
  assert.match(block, /action: "cancel_meta_ads_backfill"/);
  assert.match(block, /action: "advance_meta_ads_backfill"/);
  assert.match(block, /role="progressbar"/);
});
