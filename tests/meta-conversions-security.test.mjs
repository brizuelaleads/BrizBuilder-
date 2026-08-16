import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
// Line endings are normalized so the block-matching patterns below behave the
// same on a CRLF checkout as they do on LF.
const read = (rel) =>
  fs.readFileSync(path.join(root, rel), "utf8").replaceAll("\r\n", "\n");

const providerSource = read("lib/meta-conversions.ts");
const storeSource = read("lib/meta-conversions-store.ts");
const crmSource = read("db/supabase-crm.ts");
const captureSource = read("app/api/website-leads/[key]/route.ts");
const migrationSource = read("supabase/migrations/20260814000000_meta_conversions.sql");
const testModeMigration = read("supabase/migrations/20260816000000_meta_test_mode.sql");
const pendingPurchaseMigration = read("supabase/migrations/20260817000000_pending_purchase.sql");
const connectionsUi = read("app/crm/WorkflowViews.tsx");

// Brace matcher for constructs whose first `{` opens the body.
const block = (source, needle) => {
  const start = source.indexOf(needle);
  if (start < 0) return undefined;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return undefined;
};

// Brace matching cannot be used on a signature that declares an inline object
// type, because the parameter literal closes before the body opens. Such a
// declaration ends at a closing brace that is alone on its line — the parameter
// literal's own brace is followed by `):` rather than a newline.
const fnBlock = (source, needle) => {
  const start = source.indexOf(needle);
  if (start < 0) return undefined;
  const end = source.indexOf("\n}\n", start);
  return end < 0 ? undefined : source.slice(start, end + 2);
};

test("contact details are hashed before any of them reach Meta", () => {
  // fnBlock again: the trailing `context` parameter has a `= {}` default.
  const userData = fnBlock(providerSource, "export async function buildMetaUserData");
  assert.ok(userData, "buildMetaUserData exists");
  // Every personal identifier goes through the hashing helper.
  for (const field of ["em", "ph", "fn", "ln", "ct", "st", "zp", "country"]) {
    assert.match(
      userData,
      new RegExp(`${field}: await hashed\\(`),
      `${field} is hashed, never sent raw`,
    );
  }
  // The hash itself is a real digest, not an encoding.
  const hash = block(providerSource, "async function sha256Hex");
  assert.ok(hash, "sha256Hex exists");
  assert.match(hash, /crypto\.subtle\.digest\(\s*"SHA-256"/);
  // Raw values must never be assigned straight onto the payload.
  assert.doesNotMatch(userData, /em: identity\.email/);
  assert.doesNotMatch(userData, /ph: identity\.phone/);
});

test("normalization runs before hashing, or matching silently degrades", () => {
  const helper = block(providerSource, "async function hashed");
  assert.ok(helper, "hashed helper exists");
  assert.match(helper, /normalize\(value\)/);
  assert.match(helper, /await sha256Hex\(normalized\)/);
  assert.match(providerSource, /function normalizeEmail[\s\S]*?toLowerCase\(\)/);
  assert.match(providerSource, /function normalizePhone[\s\S]*?replace\(\/\\D\+\/gu, ""\)/);
});

test("the dataset token is encrypted at rest and bound to one tenant", () => {
  assert.match(providerSource, /keyBytes\("META_TOKEN_ENCRYPTION_KEY"\)/);
  assert.match(providerSource, /name: "AES-GCM"/);
  // The organization and client are mixed into the AAD, so a credential row
  // copied to another tenant cannot be decrypted.
  const aad = block(providerSource, "function additionalData");
  assert.ok(aad, "additionalData exists");
  assert.match(aad, /brizbuilder:meta:\$\{organizationId\}:\$\{clientId\}:v1/);
  for (const fn of ["encryptMetaSecret", "decryptMetaSecret"]) {
    const source = block(providerSource, `export async function ${fn}`);
    assert.ok(source, `${fn} exists`);
    assert.match(source, /additionalData\(organizationId, clientId\)/);
  }
});

test("the credentials table is server-only and cannot store provider replies", () => {
  assert.match(
    migrationSource,
    /alter table public\.meta_conversion_credentials enable row level security/,
  );
  assert.match(
    migrationSource,
    /revoke all on table public\.meta_conversion_credentials from anon, authenticated/,
  );
  // No RLS policy is granted, matching the locked google_business_credentials
  // pattern: only the service role can reach credential material.
  assert.doesNotMatch(migrationSource, /create policy[\s\S]*meta_conversion_credentials/);
  // A dataset id is interpolated into a Graph API URL, so its shape is pinned
  // in the database as well as in code.
  assert.match(migrationSource, /dataset_id ~ '\^\[0-9\]\{5,32\}\$'/);
  // Closed vocabulary: an error body can echo back token material.
  assert.match(
    migrationSource,
    /last_status in \('ok', 'rejected', 'unauthorized', 'error'\)/,
  );
  // Tenancy is proven by a composite foreign key, not by trusting the caller.
  assert.match(
    migrationSource,
    /foreign key \(organization_id, client_id\)\s*\n\s*references public\.clients\(organization_id, id\)/,
  );
});

test("connecting Meta checks permission and sub-account access before storing", () => {
  const connect = block(crmSource, 'if (action === "connect_meta_conversions")');
  assert.ok(connect, "connect_meta_conversions handler exists");
  const permissionIndex = connect.indexOf('requirePermission(context, "websites.manage")');
  const clientCheckIndex = connect.indexOf("await requireClient(context, clientId)");
  const verifyIndex = connect.indexOf("verifyMetaDataset(");
  const writeIndex = connect.indexOf('.from("meta_conversion_credentials")');
  assert.ok(permissionIndex >= 0, "permission gate present");
  assert.ok(clientCheckIndex > permissionIndex, "tenant access checked after the gate");
  assert.ok(writeIndex > clientCheckIndex, "nothing is written before both checks");
  // Credentials are proven to work before they are saved.
  assert.ok(verifyIndex > clientCheckIndex && verifyIndex < writeIndex);
  // Tenant columns come from the authenticated context, never the request.
  assert.match(connect, /organization_id: context\.organizationId/);
  assert.doesNotMatch(connect, /input\.organizationId/);
  // The plaintext token is never persisted.
  assert.match(connect, /await encryptMetaSecret\(\s*accessToken,/);
  assert.doesNotMatch(connect, /access_token: accessToken/);
});

test("disconnecting destroys the stored token rather than flagging it", () => {
  const disconnect = block(crmSource, 'if (action === "disconnect_meta_conversions")');
  assert.ok(disconnect, "disconnect_meta_conversions handler exists");
  assert.match(disconnect, /requirePermission\(context, "websites\.manage"\)/);
  assert.match(disconnect, /await requireClient\(context, clientId\)/);
  assert.match(
    disconnect,
    /\.from\("meta_conversion_credentials"\)\s*\n\s*\.delete\(\)/,
    "the credential row is deleted outright",
  );
  assert.match(disconnect, /\.eq\("organization_id", context\.organizationId\)/);
});

test("a Meta outage can never cost the customer a lead", () => {
  const dispatch = block(storeSource, "export async function dispatchMetaConversion");
  assert.ok(dispatch, "dispatchMetaConversion exists");
  // The whole body is wrapped so nothing propagates to the caller.
  assert.match(dispatch, /try \{/);
  assert.match(dispatch, /\} catch \{/);
  // A client with no Meta connection is the normal case, not an error: it
  // returns the quiet outcome rather than throwing or reporting a failure.
  assert.match(dispatch, /if \(!row\) return quiet;/);
  assert.match(dispatch, /attempted: false/);
  // Every exit from the catch is a value, never a rethrow.
  assert.doesNotMatch(dispatch, /throw/);
  // The sender itself also refuses to throw.
  const send = fnBlock(providerSource, "export async function sendMetaConversionEvent");
  assert.ok(send, "sendMetaConversionEvent exists");
  assert.match(
    send,
    /\} catch \{[\s\S]*?return \{ ok: false, status: "error", detail: null \};/,
  );
});

test("only the closed status vocabulary is ever persisted", () => {
  const dispatch = block(storeSource, "export async function dispatchMetaConversion");
  assert.match(dispatch, /last_status: result\.status/);
  // A provider response body must never be written to the database.
  assert.doesNotMatch(dispatch, /last_error/);
  assert.doesNotMatch(dispatch, /response\.(text|json)\(\)/);
});

test("connection checks exercise the capability actually used, without faking a conversion", () => {
  const verify = fnBlock(providerSource, "export async function verifyMetaDataset");
  assert.ok(verify, "verifyMetaDataset exists");
  // A dataset-scoped Conversions API token can post events but often cannot
  // read the pixel node, so the check must not gate on that read.
  assert.match(verify, /\/events`/, "validates against the events endpoint");
  assert.doesNotMatch(
    verify,
    /searchParams\.set\("fields"/,
    "does not gate the connection on reading the dataset node",
  );
  // The test event code is mandatory: it is what keeps the probe event out of
  // the customer's live reporting.
  assert.match(verify, /if \(!testEventCode\.trim\(\)\)/);
  assert.match(verify, /test_event_code: testEventCode/);
  // Reading the display name is best effort and can never fail a connection.
  const name = fnBlock(providerSource, "async function readDatasetName");
  assert.ok(name, "readDatasetName exists");
  assert.match(name, /return null/);
  assert.match(name, /\} catch \{/);
});

test("the CRM conversion identifies itself as CRM-sourced", () => {
  const report = block(crmSource, "async function reconcileLeadPurchase");
  assert.match(report, /event_source: "crm"/);
  assert.match(report, /lead_event_source: "BrizBuilder"/);
  assert.match(report, /actionSource: "system_generated"/);
  // Connecting requires a test event code, so verification cannot invent a
  // conversion in a real account.
  const connect = block(crmSource, 'if (action === "connect_meta_conversions")');
  assert.match(connect, /requireText\(input\.testEventCode, "Test event code", 40\)/);
});

test("connection diagnostics are transient and never reach the database", () => {
  // The detail is built from the response and thrown; it is never handed to a
  // write. Persisting it would defeat the closed status vocabulary.
  const connect = block(crmSource, 'if (action === "connect_meta_conversions")');
  for (const field of ["fbtrace", "traceId", "error_subcode", "diagnostic"]) {
    assert.ok(
      !connect.includes(field),
      `${field} must not be written by the connect handler`,
    );
  }
  const dispatch = block(storeSource, "export async function dispatchMetaConversion");
  assert.doesNotMatch(dispatch, /buildMetaErrorDetail|formatMetaErrorDetail/);
  assert.match(dispatch, /last_status: result\.status/);
  // The sender still reports only the closed vocabulary, not a message.
  const send = fnBlock(providerSource, "export async function sendMetaConversionEvent");
  assert.doesNotMatch(send, /formatMetaErrorDetail/);
});

test("the diagnostic reader takes only the response, never the request", () => {
  const reader = block(providerSource, "async function metaErrorDetail");
  assert.ok(reader, "metaErrorDetail exists");
  // Only status and parsed body go in; the URL, headers, token and payload are
  // not in scope here at all.
  assert.match(reader, /buildMetaErrorDetail\(response\.status, body\)/);
  assert.doesNotMatch(reader, /accessToken|Authorization|headers|url|datasetId/);
  // The body is consumed locally and never returned.
  assert.doesNotMatch(reader, /return body/);
});

test("a refused conversion warns the admin without blocking the save", () => {
  const report = block(crmSource, "async function reconcileLeadPurchase");
  // The warning is produced only after the send, so the pipeline update has
  // already been written by the time it can be returned.
  const dispatchIndex = report.indexOf("await dispatchMetaConversion");
  const warnIndex = report.indexOf("formatMetaErrorDetail");
  assert.ok(dispatchIndex >= 0 && warnIndex > dispatchIndex);
  // A client with no connection, or a successful send, warns about nothing.
  assert.match(report, /if \(!outcome\.attempted \|\| outcome\.ok\) return null;/);
  // A thrown error still cannot break the pipeline update.
  assert.match(report, /\} catch \{[\s\S]*?return null;/);
  // Both handlers pass the warning back to the caller.
  for (const handler of ["update_lead", "move_lead"]) {
    const source = block(crmSource, `if (action === "${handler}")`);
    assert.match(
      source,
      /return metaWarning \? \{ id: leadId, warning: metaWarning \} : \{ id: leadId \};/,
      `${handler} returns the warning without failing`,
    );
  }
});

test("public lead capture never surfaces provider diagnostics", () => {
  // The public endpoint dispatches but must discard the outcome: its response
  // is readable by anyone who can submit a form.
  assert.doesNotMatch(captureSource, /formatMetaErrorDetail|MetaErrorDetail/);
  assert.doesNotMatch(captureSource, /outcome|warning|fbtrace|error_subcode/);
  // Its success body stays limited to the acceptance and the new lead id.
  assert.match(
    captureSource,
    /Response\.json\(\{ accepted: true, leadId: leadResult\.data\.id \}/,
  );
});

test("diagnostics ride the response and are never written", () => {
  const dispatch = block(storeSource, "export async function dispatchMetaConversion");
  // The detail is returned to the caller...
  assert.match(dispatch, /detail: result\.detail/);
  // ...but the row update still writes only the closed status vocabulary.
  // Bounded to the update payload itself, not the rest of the function.
  const updateStart = dispatch.indexOf(".update({");
  const update = dispatch.slice(updateStart, dispatch.indexOf("})", updateStart) + 2);
  assert.match(update, /last_status: result\.status/);
  assert.doesNotMatch(update, /detail|message|fbtrace|last_error/);
});

test("a 2xx is not trusted on its own — the acceptance count decides", () => {
  const send = fnBlock(providerSource, "export async function sendMetaConversionEvent");
  // Success requires Meta to confirm it recorded exactly the one event sent.
  assert.match(send, /if \(isSingleEventRecorded\(body\)\)/);
  assert.match(send, /return \{ ok: true, status: "ok", detail: null \};/);
  // Anything else on a 2xx is a rejection carrying the acceptance detail.
  assert.match(send, /status: "rejected",\s*\n\s*detail: buildMetaAcceptanceDetail\(response\.status, body\)/);
  // The success body is parsed locally and never returned or logged.
  assert.doesNotMatch(send, /return body|console\./);
});

test("the connection probe and the sender share one success rule", () => {
  const verify = fnBlock(providerSource, "export async function verifyMetaDataset");
  const send = fnBlock(providerSource, "export async function sendMetaConversionEvent");

  // Both defer to the same predicate rather than reimplementing the check,
  // so the two paths cannot drift apart.
  assert.match(verify, /isSingleEventRecorded\(body\)/, "probe uses the shared rule");
  assert.match(send, /isSingleEventRecorded\(body\)/, "sender uses the shared rule");

  // Neither carries its own copy of the count comparison.
  for (const [name, source] of [["probe", verify], ["sender", send]]) {
    assert.doesNotMatch(
      source,
      /events_received/,
      `${name} must not read the count itself`,
    );
    assert.doesNotMatch(
      source,
      /readEventsReceived/,
      `${name} must go through the shared predicate`,
    );
  }

  // The probe fails closed: a non-2xx and an unrecorded 2xx both throw, so a
  // connection cannot be stored on either.
  assert.match(verify, /if \(!response\.ok\)[\s\S]*?throw new Error/);
  assert.match(verify, /if \(!isSingleEventRecorded\(body\)\)[\s\S]*?throw new Error/);
  // Both failure paths render through the same sanitized formatter.
  assert.match(verify, /formatMetaErrorDetail\(\s*\n?\s*"Meta accepted the request but did not record/);
  assert.match(verify, /buildMetaAcceptanceDetail\(response\.status, body\)/);
});

test("going live requires permission and sub-account access before any write", () => {
  const live = block(crmSource, 'if (action === "set_meta_conversions_live")');
  assert.ok(live, "set_meta_conversions_live handler exists");
  const permissionIndex = live.indexOf('requirePermission(context, "websites.manage")');
  const clientCheckIndex = live.indexOf("await requireClient(context, clientId)");
  const writeIndex = live.indexOf(".update({");
  assert.ok(permissionIndex >= 0, "permission gate present");
  assert.ok(clientCheckIndex > permissionIndex, "tenant access checked after the gate");
  assert.ok(writeIndex > clientCheckIndex, "nothing written before both checks");
});

test("going live is tenant-scoped and cannot reach another workspace", () => {
  const live = block(crmSource, 'if (action === "set_meta_conversions_live")');
  // Every read and write is pinned to the authenticated organization.
  const orgScopes = live.match(/\.eq\("organization_id", context\.organizationId\)/g) ?? [];
  assert.ok(orgScopes.length >= 3, "lookup and both updates are org-scoped");
  const clientScopes = live.match(/\.eq\("client_id", clientId\)/g) ?? [];
  assert.ok(clientScopes.length >= 3, "lookup and both updates are client-scoped");
  // The organization never comes from the request.
  assert.doesNotMatch(live, /input\.organizationId/);
  assert.match(live, /went_live_by_email: context\.email/);
});

test("going live is one-way, audited, and clears the test event code", () => {
  const live = block(crmSource, 'if (action === "set_meta_conversions_live")');
  // Clearing the code is what makes production payloads omit it.
  assert.match(live, /test_event_code: null/);
  assert.match(live, /mode: "live"/);
  // Refuses to run twice; there is no transition back to test.
  assert.match(live, /already live/);
  assert.doesNotMatch(live, /mode: "test"/, "no path back to test mode");
  assert.match(live, /"provider\.went_live"/, "the transition is audited");
  // Connecting always starts in test and clears any prior live stamps.
  const connect = block(crmSource, 'if (action === "connect_meta_conversions")');
  assert.match(connect, /mode: "test"/);
  assert.match(connect, /went_live_at: null/);
  assert.match(connect, /went_live_by_email: null/);
});

test("the database refuses a live connection that still holds a test code", () => {
  assert.match(testModeMigration, /add column if not exists mode text not null default 'test'/);
  assert.match(testModeMigration, /check \(mode in \('test', 'live'\)\)/);
  // The contradictory state is impossible at rest, not merely avoided in code.
  assert.match(
    testModeMigration,
    /\(mode = 'live' and test_event_code is null\)\s*\n\s*or \(mode = 'test' and test_event_code is not null\)/,
  );
  // Live rows must record who switched them and when.
  assert.match(
    testModeMigration,
    /mode = 'live' and went_live_at is not null and went_live_by_email is not null/,
  );
  // Additive and idempotent, so re-running cannot fail or drop anything.
  assert.doesNotMatch(testModeMigration, /drop (table|column|constraint)/i);
  assert.match(testModeMigration, /if not exists \(\s*\n\s*select 1 from pg_constraint/);
});

test("a live payload omits test_event_code entirely", () => {
  const send = fnBlock(providerSource, "export async function sendMetaConversionEvent");
  // The key is added only when a code exists, and a live row has none.
  assert.match(send, /const payload: Record<string, unknown> = \{ data: \[event\] \};/);
  assert.match(send, /if \(input\.testEventCode\) payload\.test_event_code = input\.testEventCode;/);
  // It is a sibling of data, never inside the event or its custom_data.
  const eventBlock = send.slice(
    send.indexOf("const event: Record<string, unknown> = {"),
    send.indexOf("const payload:"),
  );
  assert.doesNotMatch(eventBlock, /test_event_code/, "absent from the event object");
  assert.doesNotMatch(eventBlock, /custom_data:[\s\S]*test_event_code/);
  // The code reaches the sender only from the stored row, which is null once live.
  assert.match(storeSource, /testEventCode: row\.test_event_code/);
});

test("the connections card states the mode without overclaiming", () => {
  assert.match(connectionsUi, /const metaLive = metaConnection\?\.mode === "live"/);
  // Both states are named explicitly rather than implied.
  assert.match(connectionsUi, /metaLive \? "Live" : "Test mode"/);
  // Going live is confirmed and describes the consequence.
  assert.match(connectionsUi, /set_meta_conversions_live/);
  assert.match(connectionsUi, /Returning to test mode means disconnecting/);
  // Wording stays honest: Meta routes to Test Events only while the code is
  // active, and the app cannot prove what happens when it is not.
  assert.match(connectionsUi, /while that code is the active one/);
  assert.doesNotMatch(
    connectionsUi,
    /will (be|become|count as) live|guaranteed|never counts/i,
    "must not claim what a stale code provably does",
  );
});

test("the Graph version is current enough to be supported", () => {
  const version = providerSource.match(/META_GRAPH_VERSION = "v(\d+)\.0"/)?.[1];
  assert.ok(version, "the Graph version is pinned");
  // Meta supports each version for about two years; staying within a few of
  // the newest keeps the integration clear of the sunset window.
  assert.ok(Number(version) >= 24, `Graph version v${version}.0 is too old`);
});

test("the access token travels in a header and the dataset id is shape checked", () => {
  const send = fnBlock(providerSource, "export async function sendMetaConversionEvent");
  assert.match(send, /Authorization: `Bearer \$\{input\.accessToken\}`/);
  // Never in the query string, where intermediaries log it.
  assert.doesNotMatch(send, /searchParams\.set\("access_token"/);
  assert.doesNotMatch(send, /access_token=/);
  assert.match(send, /assertDatasetId\(input\.datasetId\)/);
  const guard = block(providerSource, "function assertDatasetId");
  assert.ok(guard, "assertDatasetId exists");
  assert.match(guard, /\^\[0-9\]\{5,32\}\$/);
});

test("lead capture stores only recognized attribution and fires one event", () => {
  assert.match(captureSource, /const attribution = normalizeAttribution\(input\)/);
  const normalize = block(providerSource, "export function normalizeAttribution");
  assert.ok(normalize, "normalizeAttribution exists");
  // A landing page is untrusted input: unknown keys are dropped, not stored.
  assert.match(normalize, /for \(const key of ATTRIBUTION_KEYS\)/);
  assert.match(providerSource, /META_MAX_ATTRIBUTION_VALUE = 512/);
  // The pixel and the server agree on one id, so a lead is not counted twice.
  assert.match(captureSource, /eventId: cleanText\(input\.eventId, 100\) \?\? leadResult\.data\.id/);
  assert.match(captureSource, /eventName: "Lead"/);
  // Visitor IP and user agent are passed through, never written to the lead.
  assert.match(captureSource, /clientIpAddress: request\.headers\.get\("cf-connecting-ip"\)/);
  assert.doesNotMatch(captureSource, /client_ip_address:/);
  assert.doesNotMatch(captureSource, /attribution: \{[\s\S]*?cf-connecting-ip/);
});

test("a reported purchase is never sent again", () => {
  const report = block(crmSource, "async function reconcileLeadPurchase");
  assert.ok(report, "reconcileLeadPurchase exists");
  // The permanent stamp closes the lead before anything else is considered.
  assert.match(report, /if \(lead\.purchase_sent_at\) return null;/);
  assert.match(report, /if \(String\(lead\.status\) !== "WON"\) return null;/);
  // A stable event id: a fresh one to carry a corrected value would let Meta
  // count the same customer twice.
  assert.match(report, /eventId: `won-\$\{leadId\}`/);
  assert.match(report, /actionSource: "system_generated"/);
  // Ad reporting must never break a pipeline update.
  assert.match(report, /\} catch \{[\s\S]*?return null;/);
});

test("a won deal with no amount waits instead of sending", () => {
  const report = block(crmSource, "async function reconcileLeadPurchase");
  assert.match(report, /if \(valueCents === null\)/);
  // It records that it is waiting, once, and sends nothing.
  assert.match(report, /if \(!lead\.purchase_pending_since\)/);
  assert.match(report, /purchase_pending_since: new Date\(\)\.toISOString\(\)/);
  // The pending branch returns before any claim or dispatch.
  const pendingIndex = report.indexOf("valueCents === null");
  const claimIndex = report.indexOf("purchase_claim_id: claimId");
  const dispatchIndex = report.indexOf("dispatchMetaConversion");
  assert.ok(pendingIndex < claimIndex && claimIndex < dispatchIndex);
});

test("the send is reserved by an atomic, self-identifying, expiring claim", () => {
  const report = block(crmSource, "async function reconcileLeadPurchase");
  // A unique id per attempt, so one request cannot release another's claim.
  assert.match(report, /const claimId = crypto\.randomUUID\(\);/);
  // One conditional update is the concurrency control: the loser's WHERE stops
  // matching, so exactly one of two racing saves proceeds.
  assert.match(report, /\.eq\("status", "WON"\)/);
  assert.match(report, /\.is\("purchase_sent_at", null\)/);
  // Expiry by age, so a crashed or timed-out request cannot strand the lead.
  assert.match(
    report,
    /\.or\(\s*`purchase_claimed_at\.is\.null,purchase_claimed_at\.lt\.\$\{staleBefore\}`,?\s*\)/,
  );
  assert.match(report, /PURCHASE_CLAIM_TTL_MS/);
  assert.match(crmSource, /const PURCHASE_CLAIM_TTL_MS = [\d_]+;/);
  // Losing the race is a silent no-op, not an error or a second send.
  assert.match(report, /if \(!Array\.isArray\(claimed\) \|\| claimed\.length !== 1\) return null;/);
});

test("purchase_sent_at is written only after Meta confirms, and only once", () => {
  const report = block(crmSource, "async function reconcileLeadPurchase");
  const stampIndex = report.indexOf("purchase_sent_at: new Date().toISOString()");
  const confirmIndex = report.indexOf("if (outcome.attempted && outcome.ok)");
  assert.ok(confirmIndex >= 0, "the stamp is gated on a confirmed outcome");
  assert.ok(stampIndex > confirmIndex, "the stamp follows the confirmation");
  // Guarded so a concurrent writer cannot be overwritten.
  const stampBlock = report.slice(confirmIndex, stampIndex + 500);
  assert.match(stampBlock, /\.is\("purchase_sent_at", null\)/);
  // Recording it as sent clears the pending marker in the same write, so the
  // two can never both be set.
  assert.match(stampBlock, /purchase_pending_since: null/);
  // dispatchMetaConversion only reports ok when Meta recorded exactly one
  // event, so the stamp inherits that requirement.
  assert.match(storeSource, /ok: result\.ok/);
});

test("a failure releases only this request's claim and stays retryable", () => {
  const report = block(crmSource, "async function reconcileLeadPurchase");
  // The release is matched on the claim id this request generated.
  assert.match(
    report,
    /purchase_claimed_at: null, purchase_claim_id: null[\s\S]*?\.eq\("purchase_claim_id", claimId\)/,
  );
  // It runs on both paths, so a rejection does not leave the lead reserved.
  const releaseIndex = report.indexOf('.eq("purchase_claim_id", claimId)');
  const warningIndex = report.indexOf("The deal was saved, but Meta did not accept");
  assert.ok(releaseIndex < warningIndex, "the claim is released before returning a warning");
  // Nothing on the failure path stamps the lead as sent.
  const failureBlock = report.slice(warningIndex);
  assert.doesNotMatch(failureBlock, /purchase_sent_at:/);
  assert.match(report, /retried on the next save/);
});

test("both handlers reconcile on every save, not only on the transition", () => {
  for (const handler of ["update_lead", "move_lead"]) {
    const source = block(crmSource, `if (action === "${handler}")`);
    assert.ok(source, `${handler} exists`);
    assert.match(source, /await reconcileLeadPurchase\(\s*\n?\s*context\.organizationId/);
    // The old transition-only guard is gone, which is what lets a value
    // entered later still report.
    assert.doesNotMatch(source, /reportLeadWonToMeta/);
    assert.doesNotMatch(source, /previousStatus/);
  }
  assert.doesNotMatch(crmSource, /reportLeadWonToMeta/, "the old reporter is fully replaced");
});

test("the pending purchase migration is additive and closes existing won deals", () => {
  for (const column of [
    "purchase_sent_at timestamptz",
    "purchase_pending_since timestamptz",
    "purchase_claimed_at timestamptz",
    "purchase_claim_id text",
  ]) {
    assert.ok(
      pendingPurchaseMigration.includes(`add column if not exists ${column}`),
      `${column} added idempotently`,
    );
  }
  // Historical won deals are stamped closed so a later edit cannot fire a
  // conversion for something that closed weeks ago.
  assert.match(
    pendingPurchaseMigration,
    /update public\.leads\s*\nset purchase_sent_at = updated_at\s*\nwhere status = 'WON'\s*\n\s*and purchase_sent_at is null;/,
  );
  assert.doesNotMatch(pendingPurchaseMigration, /drop (table|column|constraint)/i);
});

test("the database rejects a half-written claim and a sent-but-pending lead", () => {
  // Both halves of a reservation move together: an owner with no timestamp
  // could never expire, and a timestamp with no owner could not be released.
  assert.match(
    pendingPurchaseMigration,
    /\(purchase_claimed_at is null and purchase_claim_id is null\)\s*\n\s*or \(purchase_claimed_at is not null and purchase_claim_id is not null\)/,
  );
  // A recorded Purchase is not still waiting for one.
  assert.match(
    pendingPurchaseMigration,
    /check \(purchase_sent_at is null or purchase_pending_since is null\)/,
  );
  // Constraints are added after the backfill, so existing rows already comply.
  const backfillIndex = pendingPurchaseMigration.indexOf("set purchase_sent_at = updated_at");
  const constraintIndex = pendingPurchaseMigration.indexOf("leads_purchase_claim_pair_check");
  assert.ok(backfillIndex >= 0 && constraintIndex > backfillIndex);
  // Idempotent, so re-running is safe.
  assert.match(pendingPurchaseMigration, /if not exists \(\s*\n\s*select 1 from pg_constraint/);
});
