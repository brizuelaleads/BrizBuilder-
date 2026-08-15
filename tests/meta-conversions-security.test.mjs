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
  // A client with no Meta connection is the normal case, not an error.
  assert.match(dispatch, /if \(!row\) return;/);
  // The sender itself also refuses to throw.
  const send = fnBlock(providerSource, "export async function sendMetaConversionEvent");
  assert.ok(send, "sendMetaConversionEvent exists");
  assert.match(send, /\} catch \{\s*\n\s*return \{ ok: false, status: "error" \};/);
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
  const report = block(crmSource, "async function reportLeadWonToMeta");
  assert.match(report, /event_source: "crm"/);
  assert.match(report, /lead_event_source: "BrizBuilder"/);
  assert.match(report, /actionSource: "system_generated"/);
  // Connecting requires a test event code, so verification cannot invent a
  // conversion in a real account.
  const connect = block(crmSource, 'if (action === "connect_meta_conversions")');
  assert.match(connect, /requireText\(input\.testEventCode, "Test event code", 40\)/);
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

test("the won conversion fires once, on the transition into WON", () => {
  const report = block(crmSource, "async function reportLeadWonToMeta");
  assert.ok(report, "reportLeadWonToMeta exists");
  assert.match(
    report,
    /if \(nextStatus !== "WON" \|\| previousStatus === "WON"\) return;/,
    "re-saving a won lead does not resend",
  );
  // A distinct event id, so Meta records a second conversion rather than
  // deduplicating it against the original form submission.
  assert.match(report, /eventId: `won-\$\{leadId\}`/);
  assert.match(report, /actionSource: "system_generated"/);
  // Ad reporting must never break a pipeline update.
  assert.match(report, /\} catch \{/);
  // Both status paths report, and both read the previous status first.
  for (const handler of ["update_lead", "move_lead"]) {
    const source = block(crmSource, `if (action === "${handler}")`);
    assert.ok(source, `${handler} exists`);
    assert.match(source, /await reportLeadWonToMeta\(/, `${handler} reports won leads`);
    assert.match(source, /String\(lead\.status\)/, `${handler} passes the previous status`);
  }
});
