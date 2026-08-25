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

const idSource = read("lib/callrail-ids.ts");
const providerSource = read("lib/callrail.ts");
const storeSource = read("lib/callrail-store.ts");
const crmSource = read("db/supabase-crm.ts");
const migrationSource = read(
  "supabase/migrations/20260819000000_callrail_connection.sql",
);
const connectionsUi = read("app/crm/WorkflowViews.tsx");
const dniRoute = read("app/api/callrail/dni-test/route.ts");
const dniSource = read("lib/callrail-dni.ts");
const dniPage = read("lib/callrail-dni-page.ts");

/**
 * Source with line comments removed.
 *
 * These files document what they deliberately avoid — "no async", "never sent
 * here" — so searching the raw text finds the promise rather than a breach of
 * it. Only comments introduced at a line start or after whitespace are cut, so
 * a protocol-relative URL inside a string survives.
 */
const codeOnly = (source) =>
  source
    .split("\n")
    .map((line) => {
      const at = line.search(/(?:^|\s)\/\//);
      if (at < 0) return line;
      return line.slice(0, line.indexOf("//", at));
    })
    .join("\n");

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

test("the credentials table is server-only", () => {
  assert.match(
    migrationSource,
    /alter table public\.callrail_credentials enable row level security;/,
  );
  assert.match(
    migrationSource,
    /revoke all on table public\.callrail_credentials from anon, authenticated;/,
  );
  // No policy may exist on this table: RLS with no policy is what makes it
  // unreachable by anything other than the service role.
  assert.equal(/create policy[^;]*callrail_credentials/i.test(migrationSource), false);
});

test("the API key is only ever stored as ciphertext", () => {
  assert.match(migrationSource, /api_key_ciphertext text not null/);
  assert.match(migrationSource, /api_key_iv text not null/);
  // A plaintext column would defeat the whole arrangement.
  assert.equal(/\bapi_key text\b/.test(migrationSource), false);
});

test("encryption binds the tenant into the additional authenticated data", () => {
  assert.match(
    providerSource,
    /brizbuilder:callrail:\$\{organizationId\}:\$\{clientId\}:v1/,
  );
  assert.match(providerSource, /additionalData: additionalData\(/);
});

test("id validation is not numeric-only and admits official resource ids", () => {
  // The regression this guards: an earlier revision constrained both ids to
  // digits, which rejects every id CallRail v3 actually returns.
  assert.match(idSource, /\^ACC\$\{RESOURCE_ID_BODY\}\$|ACC\$\{RESOURCE_ID_BODY\}/);
  assert.match(idSource, /COM\$\{RESOURCE_ID_BODY\}/);
  assert.match(migrationSource, /ACC\[A-Za-z0-9\]\{8,64\}/);
  assert.match(migrationSource, /COM\[A-Za-z0-9\]\{8,64\}/);
  // A fixed 32 would fail closed the day CallRail changes the length.
  assert.equal(/\{32\}/.test(migrationSource), false);
});

test("the SQL and TypeScript id patterns cannot drift apart", () => {
  // callrail-ids.ts publishes the Postgres equivalents; the migration must use
  // exactly those, so a change in one place cannot silently pass the other.
  const accountPattern = idSource.match(/account:\s*"([^"]+)"/)?.[1];
  const companyPattern = idSource.match(/company:\s*"([^"]+)"/)?.[1];
  assert.ok(accountPattern, "account SQL pattern is published");
  assert.ok(companyPattern, "company SQL pattern is published");
  assert.ok(
    migrationSource.includes(accountPattern),
    "migration uses the published account pattern",
  );
  assert.ok(
    migrationSource.includes(companyPattern),
    "migration uses the published company pattern",
  );
});

test("ids are validated before they reach a request path", () => {
  for (const fn of [
    "export async function getCallRailAccount",
    "export async function listCallRailCompanies",
    "export async function getCallRailCompany",
  ]) {
    const body = block(providerSource, fn);
    assert.ok(body, `${fn} exists`);
    assert.match(
      body,
      /assertCallRail(Account|Company)Id\(/,
      `${fn} validates before interpolating`,
    );
  }
});

test("the connect action never accepts an account id from the caller", () => {
  const connect = block(crmSource, 'if (action === "connect_callrail")');
  assert.ok(connect, "connect_callrail exists");
  // The account list comes from the key, which is the only authoritative
  // source for what that key can reach.
  assert.match(connect, /listCallRailAccounts\(apiKey\)/);
  assert.equal(
    /input\.accountId/.test(connect),
    false,
    "connect must not read an account id from the request",
  );
});

test("the final selection is verified against CallRail before it is stored", () => {
  const select = block(crmSource, 'if (action === "select_callrail_company")');
  assert.ok(select, "select_callrail_company exists");
  // Both, not just the company: a rotated key can still read a company while
  // no longer reaching the account it belongs to.
  assert.match(select, /getCallRailAccount\(/);
  assert.match(select, /getCallRailCompany\(/);
  const accountIndex = select.indexOf("getCallRailAccount(");
  const updateIndex = select.indexOf('.from("callrail_credentials")');
  assert.ok(
    accountIndex < updateIndex,
    "verification happens before the write",
  );
});

test("the API key is never returned to a caller", () => {
  for (const [name, source] of Object.entries({
    "db/supabase-crm.ts CallRail actions": crmSource,
    "lib/callrail-store.ts": storeSource,
  })) {
    // A returned object literal must never carry the key under any spelling.
    assert.equal(
      /return\s*\{[^}]*\bapiKey\b/s.test(
        source.split("callrail").slice(1).join("callrail"),
      ) && /return\s*\{[^}]*\bapiKey:/.test(source),
      false,
      `${name} must not return the key`,
    );
  }
  // loadCallRailApiAccess is the one function that hands the key to a caller,
  // and it is server-side only. Nothing in the action layer may forward it.
  const actions = [
    'if (action === "connect_callrail")',
    'if (action === "select_callrail_account")',
    'if (action === "select_callrail_company")',
    'if (action === "check_callrail_connection")',
    'if (action === "disconnect_callrail")',
  ];
  for (const marker of actions) {
    const body = block(crmSource, marker);
    assert.ok(body, `${marker} exists`);
    const returned = body.slice(body.lastIndexOf("return "));
    assert.equal(
      /apiKey/.test(returned),
      false,
      `${marker} must not return the key`,
    );
  }
});

test("the browser never keeps the key after submission", () => {
  const form = connectionsUi.slice(connectionsUi.indexOf("connect_callrail"));
  assert.match(
    form,
    /apiKey:\s*""/,
    "the key input is cleared once submitted",
  );
  // A password-type input keeps it out of autofill history and shoulder view.
  const card = connectionsUi.slice(
    connectionsUi.indexOf("crm-connection-card callrail"),
  );
  assert.match(card, /type="password"/);
});

test("only the closed status vocabulary is persisted", () => {
  assert.match(
    migrationSource,
    /last_status in \('ok', 'unauthorized', 'not_found', 'rejected', 'error'\)/,
  );
  // Provider response bodies must never reach storage: an error payload can
  // echo back request material.
  assert.equal(/response\.json\(\)/.test(storeSource), false);
});

test("CallScribe is reported as a company setting, never as an API entitlement", () => {
  // callscribe_enabled proves the feature is on for the company. It does not
  // prove the subscription permits transcript retrieval through the API, and
  // the UI must not let anyone read it that way.
  assert.match(providerSource, /callScribeEnabled: row\.callscribe_enabled === true/);
  assert.equal(
    /transcriptsEnabled/.test(providerSource + crmSource + connectionsUi),
    false,
    "no field may be named as though it proved transcript availability",
  );
  const card = connectionsUi.slice(
    connectionsUi.indexOf("crm-connection-card callrail"),
  );
  assert.match(card, /CallScribe/);
  assert.match(
    card,
    /does not confirm|not confirm|separate plan entitlement/i,
    "the card states that CallScribe does not establish API transcript access",
  );
});

test("every CallRail action is permission gated and audited where it changes state", () => {
  const stateChanging = [
    'if (action === "connect_callrail")',
    'if (action === "select_callrail_account")',
    'if (action === "select_callrail_company")',
    'if (action === "disconnect_callrail")',
  ];
  for (const marker of stateChanging) {
    const body = block(crmSource, marker);
    assert.ok(body, `${marker} exists`);
    assert.match(body, /requirePermission\(context, "call_tracking\.manage"\)/);
    assert.match(body, /await requireClient\(context, clientId\)/);
    assert.match(body, /await audit\(/, `${marker} writes an audit event`);
  }
  const check = block(crmSource, 'if (action === "check_callrail_connection")');
  assert.match(check, /requirePermission\(context, "call_tracking\.manage"\)/);
  assert.match(check, /await requireClient\(context, clientId\)/);
});

test("disconnect destroys the stored credential", () => {
  const body = block(crmSource, 'if (action === "disconnect_callrail")');
  assert.ok(body);
  assert.match(body, /\.from\("callrail_credentials"\)\s*\.delete\(\)/);
});

test("account and company ids are constrained separately, at both layers", () => {
  // Postgres: two distinct constraints, each admitting only its own prefix.
  const accountCheck = migrationSource.slice(
    migrationSource.indexOf("callrail_credentials_account_id_check"),
    migrationSource.indexOf("callrail_credentials_company_id_check"),
  );
  const companyCheck = migrationSource.slice(
    migrationSource.indexOf("callrail_credentials_company_id_check"),
    migrationSource.indexOf("callrail_credentials_company_requires_account_check"),
  );
  assert.match(accountCheck, /ACC\[A-Za-z0-9\]/);
  assert.equal(/COM\[A-Za-z0-9\]/.test(accountCheck), false, "account check must not admit COM");
  assert.match(companyCheck, /COM\[A-Za-z0-9\]/);
  assert.equal(/ACC\[A-Za-z0-9\]/.test(companyCheck), false, "company check must not admit ACC");

  // TypeScript: the action layer uses the matching validator for each field.
  const selectAccount = block(crmSource, 'if (action === "select_callrail_account")');
  const selectCompany = block(crmSource, 'if (action === "select_callrail_company")');
  assert.match(selectAccount, /assertCallRailAccountId\(/);
  assert.equal(/assertCallRailCompanyId\(/.test(selectAccount), false);
  assert.match(selectCompany, /assertCallRailCompanyId\(/);
});

test("a connection without a selected company is never reported as connected", () => {
  // connect and select_account both leave setup incomplete, so neither may
  // write "connected" — that word means usable.
  const connect = block(crmSource, 'if (action === "connect_callrail")');
  const selectAccount = block(crmSource, 'if (action === "select_callrail_account")');
  assert.match(connect, /"setup_required"/);
  assert.equal(
    /status: "connected"/.test(connect),
    false,
    "connect must not hard-code a connected status",
  );
  assert.match(selectAccount, /status: "setup_required"/);
  assert.equal(
    /status: "connected"/.test(selectAccount),
    false,
    "choosing an account alone must not connect",
  );
  // The health check has three outcomes and mid-setup is its own.
  const check = block(crmSource, 'if (action === "check_callrail_connection")');
  assert.match(check, /outcome\.setupStatus !== "ready"[\s\S]*?"setup_required"/);
});

test("connected is only written after both halves are re-fetched", () => {
  const connect = block(crmSource, 'if (action === "connect_callrail")');
  // The status is derived from two individual reads, not from a listing.
  assert.match(connect, /verifiedAccount && verifiedCompany\s*\?\s*"connected"/);
  assert.match(connect, /getCallRailAccount\(/);
  assert.match(connect, /getCallRailCompany\(/);

  const selectCompany = block(crmSource, 'if (action === "select_callrail_company")');
  const accountRead = selectCompany.indexOf("getCallRailAccount(");
  const companyRead = selectCompany.indexOf("getCallRailCompany(");
  const connectedWrite = selectCompany.indexOf('status: "connected"');
  assert.ok(accountRead > -1 && companyRead > -1, "both are re-fetched");
  assert.ok(
    accountRead < connectedWrite && companyRead < connectedWrite,
    "both reads precede the connected write",
  );
});

test("an abandoned partial setup can be resumed or disconnected", () => {
  // Resume: both listing actions and both select actions work from the stored
  // key, so nothing from the connect step needs to survive in the browser.
  for (const marker of [
    'if (action === "list_callrail_accounts")',
    'if (action === "list_callrail_companies")',
    'if (action === "select_callrail_account")',
    'if (action === "select_callrail_company")',
  ]) {
    const body = block(crmSource, marker);
    assert.ok(body, `${marker} exists`);
    assert.match(body, /loadCallRailApiAccess\(/, `${marker} resumes from the stored key`);
  }
  // Disconnect is unconditional: it does not require a completed setup.
  const disconnect = block(crmSource, 'if (action === "disconnect_callrail")');
  assert.equal(
    /company_id|setupStatus|setup_required/.test(disconnect),
    false,
    "disconnect must not depend on how far setup got",
  );
});

test("abandoned setups are cleaned up automatically, one client at a time", () => {
  const cleanupSource = read("lib/callrail-cleanup.ts");
  assert.match(cleanupSource, /ABANDONED_SETUP_TTL_MS = 14 \* 24 \* 60 \* 60 \* 1000/);
  const purge = block(
    storeSource,
    "export async function purgeAbandonedCallRailSetup",
  );
  assert.ok(purge, "the purge exists");
  // Both halves of the scope are applied, plus the two abandonment conditions.
  assert.match(purge, /\.eq\("organization_id", filter\.organizationId\)/);
  assert.match(purge, /\.eq\("client_id", filter\.clientId\)/);
  assert.match(purge, /\.is\("company_id", null\)/);
  assert.match(purge, /\.lt\("updated_at", filter\.updatedBefore\)/);
  // Driven from the actions, because Phase 1 has no scheduler.
  const connect = block(crmSource, 'if (action === "connect_callrail")');
  assert.match(connect, /purgeAbandonedCallRailSetupForClient\(context, clientId\)/);
  assert.match(crmSource, /"provider\.abandoned_setup_cleared"/);
  // The index leads with the client, matching the query it serves.
  assert.match(
    migrationSource,
    /callrail_credentials_abandoned_setup_idx\s*\n\s*on public\.callrail_credentials \(organization_id, client_id, updated_at\)\s*\n\s*where company_id is null/,
  );
});

test("cleanup can never reach a client the caller was not authorized for", () => {
  // The regression this guards: an organization-scoped sweep triggered from a
  // client-facing action. call_tracking.manage is held by CLIENT_OWNER, so that
  // would let one business delete another's credential row, flip its connection
  // status and appear in its audit trail.
  const purge = block(
    storeSource,
    "export async function purgeAbandonedCallRailSetup",
  );
  assert.match(
    purge,
    /purgeAbandonedCallRailSetup\(\s*organizationId: string,\s*clientId: string,/,
    "the purge requires a client id, not just an organization",
  );
  // Both statements it issues are client-scoped: the delete and the
  // provider_connections update that follows it.
  const eqClient = purge.match(/\.eq\("client_id", filter\.clientId\)/g) ?? [];
  assert.equal(eqClient.length, 2, "delete and status update are both scoped");
  assert.equal(
    /\.in\(\s*"client_id"/.test(purge),
    false,
    "no multi-client fan-out",
  );

  // No organization-only entry point survives anywhere.
  assert.equal(
    /purgeAbandonedCallRailSetups\b/.test(storeSource + crmSource),
    false,
    "the organization-wide variant must not exist",
  );
  const wrapper = block(
    crmSource,
    "async function purgeAbandonedCallRailSetupForClient",
  );
  assert.ok(wrapper, "the action-layer wrapper exists");
  assert.match(wrapper, /clientId: string/);
  // The audit entry names the cleaned client and nothing else — no list of
  // other clients can appear in another business's trail.
  assert.match(wrapper, /\{ provider: "callrail" \},\s*clientId,/);
  assert.equal(
    /clearedClientIds/.test(wrapper),
    false,
    "no cross-client ids in the audit payload",
  );

  // Every call site passes the client the caller was authorized for, and that
  // authorization happens first.
  for (const marker of [
    'if (action === "connect_callrail")',
    'if (action === "check_callrail_connection")',
  ]) {
    const body = block(crmSource, marker);
    assert.ok(body, `${marker} exists`);
    const authorize = body.indexOf("await requireClient(context, clientId)");
    const cleanup = body.indexOf("purgeAbandonedCallRailSetupForClient(context, clientId)");
    assert.ok(authorize > -1, `${marker} authorizes the client`);
    assert.ok(cleanup > -1, `${marker} cleans up the authorized client`);
    assert.ok(
      authorize < cleanup,
      `${marker} must authorize before cleaning up`,
    );
  }
});

test("neither listing action can return a key or decrypted credential", () => {
  for (const marker of [
    'if (action === "list_callrail_accounts")',
    'if (action === "list_callrail_companies")',
  ]) {
    const body = block(crmSource, marker);
    assert.ok(body, `${marker} exists`);
    const returned = body.slice(body.indexOf("return {"));
    assert.equal(/apiKey/.test(returned), false, `${marker} must not return the key`);
    assert.equal(
      /access\b(?!\.(accountId|companyId|apiKey))/.test(returned),
      false,
      `${marker} must not spread the decrypted access object`,
    );
    // Allowlist rather than a spot check: every key the listing returns has to
    // be one of these, so a future edit cannot quietly widen the payload.
    const allowed = new Set([
      "accounts",
      "accountsTruncated",
      "selectedAccountId",
      "companies",
      "companiesTruncated",
      "selectedCompanyId",
    ]);
    const keys = [...returned.matchAll(/^\s+([A-Za-z][A-Za-z0-9]*):/gm)].map(
      (match) => match[1],
    );
    assert.ok(keys.length > 0, `${marker} returns something`);
    for (const key of keys) {
      assert.ok(allowed.has(key), `${marker} returns unexpected key: ${key}`);
    }
  }
});

test("one CallRail company can serve only one client", () => {
  const uniqueness = read(
    "supabase/migrations/20260819010000_callrail_company_uniqueness.sql",
  );
  // Enforced in the database, so no future code path can bypass it.
  assert.match(
    uniqueness,
    /create unique index[\s\S]*?callrail_credentials_company_unique_idx[\s\S]*?\(organization_id, company_id\)[\s\S]*?where company_id is not null/,
  );
  // A setup that has not chosen a company yet must stay exempt, or two
  // half-finished connections would collide on NULL.
  assert.match(uniqueness, /where company_id is not null/);

  // And surfaced in the application, before anything is written.
  const conflict = block(crmSource, "async function callRailCompanyConflict");
  assert.ok(conflict, "the conflict lookup exists");
  assert.match(conflict, /\.eq\("organization_id", organizationId\)/);
  assert.match(conflict, /\.eq\("company_id", companyId\)/);
  assert.match(conflict, /\.neq\("client_id", clientId\)/);

  const select = block(crmSource, 'if (action === "select_callrail_company")');
  const checkAt = select.indexOf("callRailCompanyConflict(");
  const writeAt = select.indexOf('.from("callrail_credentials")');
  assert.ok(checkAt > -1, "selection checks for a conflict");
  assert.ok(checkAt < writeAt, "the check precedes the write");
  assert.match(select, /already connected to \$\{claimedBy\}/);

  // Reconnecting must not silently re-claim a company someone else now holds.
  const connect = block(crmSource, 'if (action === "connect_callrail")');
  assert.match(connect, /callRailCompanyConflict\([\s\S]*?keptCompany = null;/);
});

test("the DNI test page cannot create a lead or report a conversion", () => {
  // Nothing on this page may capture. The guarantee is structural: there is no
  // code here that could, and these assertions keep it that way.
  for (const forbidden of [
    "dispatchMetaConversion",
    "meta-conversions",
    "decideMetaEligibility",
    "normalizeAttribution",
    "from(\"leads\")",
    "from(\"contacts\")",
    ".insert(",
    ".upsert(",
    ".update(",
    ".delete(",
  ]) {
    assert.equal(
      dniRoute.includes(forbidden),
      false,
      `the DNI page must not contain ${forbidden}`,
    );
  }
  // No outbound path from the rendered page either.
  for (const forbidden of ["fetch(", "XMLHttpRequest", "sendBeacon", "<form"]) {
    assert.equal(
      dniRoute.includes(forbidden),
      false,
      `the DNI page must not contain ${forbidden}`,
    );
  }
  // Only GET is served.
  assert.match(dniRoute, /export async function GET\(/);
  assert.equal(/export async function (POST|PUT|PATCH|DELETE)\(/.test(dniRoute), false);
});

test("the DNI test page reads only its token from the query string", () => {
  // Click identifiers arrive in the address bar. The server must never parse
  // them, so exactly one parameter may ever be read here.
  const reads = [...dniRoute.matchAll(/searchParams\.get\(([^)]*)\)/g)].map(
    (match) => match[1].trim(),
  );
  assert.deepEqual(
    reads,
    ["DNI_EXCHANGE_PARAM"],
    "only the exchange token is read",
  );
  // And nothing is written to a log.
  assert.equal(/console\.(log|info|warn|error|debug)/.test(dniRoute), false);
});

test("the DNI test page refuses indexing and locks down what may run", () => {
  // The header values live in the shared constant every response spreads.
  const dniHeaders = read("lib/callrail-dni.ts");
  assert.match(
    dniHeaders,
    /"X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet"/,
  );
  assert.match(dniHeaders, /"Referrer-Policy": "no-referrer"/);
  assert.match(dniRoute, /const BASE_HEADERS = DNI_NO_STORE_HEADERS;/);
  assert.match(
    dniPage,
    /<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">/,
  );
  // Only CallRail may execute or be contacted from a page that deliberately
  // carries click identifiers in its address bar. The policy is built beside
  // the markup it admits, so it is asserted there.
  const policy = block(dniPage, "export function buildDniCsp(");
  assert.ok(policy, "the policy builder was found");
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src[^\n]*DNI_SCRIPT_HOSTS/);
  // Exactly two CallRail hosts, named in full rather than covered by a
  // wildcard. The precise list, and the absence of every broader
  // permission, are asserted against the rendered policy in
  // tests/callrail-dni-page.test.mjs.
  assert.match(dniPage, /"https:\/\/js\.callrail\.com"/);
  // Scoped to the script-src line: connect-src and img-src legitimately
  // carry a wildcard, and only executable code is restricted this tightly.
  const scriptLine = policy
    .split("\n")
    .find((line) => line.includes("script-src"));
  assert.ok(scriptLine, "the script-src line was found");
  assert.equal(/\*/.test(scriptLine), false, "no wildcard in script-src");
  assert.equal(scriptLine.includes("strict-dynamic"), false);
  assert.equal(scriptLine.includes("unsafe-"), false);
  assert.match(policy, /form-action 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test("the credential never survives in a URL", () => {
  // The exchange trades the token for a cookie and redirects to a URL without
  // it, so it reaches neither the address bar, the history entry, nor a
  // referrer.
  assert.match(dniRoute, /status: 303/);
  assert.match(dniRoute, /Location: cleanDniRedirect\(request\.url\)/);
  assert.match(dniRoute, /"Set-Cookie": buildDniCookie\(/);
  // Referrer-Policy rides on every response, not only the page: it is part of
  // the shared header set the route spreads everywhere.
  const dniHeaders2 = read("lib/callrail-dni.ts");
  assert.match(dniHeaders2, /"Referrer-Policy": "no-referrer"/);
  assert.match(dniRoute, /\.\.\.BASE_HEADERS/);
  assert.match(dniPage, /<meta name="referrer" content="no-referrer">/);
  // The rendered page is reached by cookie, never by token.
  assert.match(dniRoute, /verifyDniCredential\(readDniCookie\(/);
  // HttpOnly is what keeps it away from CallRail's script on this very page.
  const dni = read("lib/callrail-dni.ts");
  assert.match(dni, /"HttpOnly"/);
  assert.match(dni, /"Secure"/);
  assert.match(dni, /"SameSite=Strict"/);
});

test("same-origin fetches stay blocked alongside every other destination", () => {
  // 'self' must appear in no directive: a page carrying click identifiers must
  // not be able to post them back to us either.
  // The policy is built in the page module from the digests of what it emits,
  // so that is where the directives live now.
  const policy = block(dniPage, "export function buildDniCsp(");
  assert.ok(policy, "the policy builder exists");
  assert.equal(/'self'/.test(policy), false, "no directive may allow self");
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /connect-src https:\/\/\*\.callrail\.com/);
  assert.match(policy, /form-action 'none'/);
  // Inline blocks are admitted by hash, never by blanket allowance.
  assert.equal(
    /unsafe-inline|unsafe-eval|unsafe-hashes/.test(codeOnly(policy)),
    false,
    "no unsafe-* source expression",
  );
  assert.match(policy, /hashes\.bootstrap/);
  assert.match(policy, /hashes\.main/);
  assert.match(policy, /hashes\.style/);
  // And the route serves exactly that policy rather than one of its own.
  assert.match(dniRoute, /"Content-Security-Policy": page\.contentSecurityPolicy/);
  assert.equal(
    /unsafe-inline/.test(codeOnly(dniRoute)),
    false,
    "the route declares no inline allowance",
  );
});

test("the DNI test page is gated by a signed, short-lived credential", () => {
  assert.match(dniRoute, /verifyDniCredential\(/);
  // A forged token, an expired one and an unknown client are all one answer.
  assert.match(dniRoute, /if \(!claim\) return notFound\(\)/);
  const notFoundBody = block(dniRoute, "function notFound()");
  assert.match(notFoundBody, /status: 404/);

  const mint = block(crmSource, 'if (action === "create_callrail_dni_test_link")');
  assert.ok(mint, "the mint action exists");
  assert.match(mint, /DNI_EXCHANGE_TTL_MS/);
  assert.match(mint, /requirePermission\(context, "call_tracking\.manage"\)/);
  assert.match(mint, /await requireClient\(context, clientId\)/);
  assert.match(mint, /config\.setupStatus !== "ready"/);
  assert.match(mint, /await audit\(/);
  // Auditing the token itself would outlive the fifteen minutes it is worth.
  assert.equal(/metadata[\s\S]{0,80}token/.test(mint), false);
});

test("a script URL is verified as CallRail's at the point it is embedded", () => {
  // Stored data, not a constant, by the time it reaches a script tag. The
  // check lives in the loader, so every path that obtains a script URL passes
  // through it — there is no way to reach renderPage with an unchecked value.
  assert.match(dniRoute, /isCallRailScriptUrl\(config\.scriptUrl\)/);
  const loader = block(dniRoute, "async function loadConnection(");
  assert.ok(loader, "the connection loader exists");
  assert.match(loader, /isCallRailScriptUrl\(config\.scriptUrl\)/);
  assert.match(loader, /return null/);
  // Both entry paths refuse before doing anything with an unusable connection.
  assert.match(dniRoute, /await loadConnection\(claim\.organizationId, claim\.clientId\)/);
  assert.match(dniRoute, /if \(!connection\) return notFound\(\)/);
  const guardAt = dniRoute.indexOf("isCallRailScriptUrl(config.scriptUrl)");
  const renderAt = dniRoute.indexOf("renderDniPage(");
  assert.ok(guardAt < renderAt, "validated before rendering");
  // Exact host match, so suffix confusion cannot pass.
  assert.match(dniSource, /parsed\.hostname === CALLRAIL_SCRIPT_HOST/);
  // Everything interpolated into the page is escaped, in the module that
  // builds it.
  assert.match(dniPage, /function escapeHtml\(/);
  assert.match(dniPage, /escapeHtml\(companyName\)/);
  assert.match(dniPage, /const safeScript = escapeHtml\(scriptUrl\)/);
});

test("the install snippet is generated from the connected company's own script", () => {
  const ui = read("app/crm/WebsitesView.tsx");
  assert.match(ui, /buildDniSnippet\(connection\.scriptUrl as string\)/);
  assert.match(ui, /isCallRailScriptUrl\(connection\.scriptUrl\)/);
  // Only a finished connection offers install instructions.
  assert.match(ui, /connection\.setupStatus !== "ready"/);
  // script_url has to survive to the UI for any of this to work.
  assert.match(crmSource, /scriptUrl: company\?\.scriptUrl \?\? null/);
  assert.match(crmSource, /scriptUrl: nullable\(publicConfig\.scriptUrl\)/);
});

test("every DNI response is uncacheable, including the refusals", () => {
  // One header set, spread into every response the route can produce, so a new
  // response cannot be added without it.
  assert.match(dniRoute, /const BASE_HEADERS = DNI_NO_STORE_HEADERS;/);
  const responses = dniRoute.split("new Response(").length - 1;
  const spreads = dniRoute.split("...BASE_HEADERS").length - 1;
  assert.equal(
    spreads,
    responses,
    "every Response carries the no-store headers",
  );
  assert.ok(responses >= 3, "exchange, redirect and page are all covered");
  // And the values themselves are asserted in the DNI unit tests.
  const dni = read("lib/callrail-dni.ts");
  assert.match(
    dni,
    /"Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate"/,
  );
  assert.match(dni, /Pragma: "no-cache"/);
});

test("the credential is bound to a tenant and read back scoped to it", () => {
  const dni = read("lib/callrail-dni.ts");
  // Both halves travel inside the signature.
  assert.match(dni, /export type DniClaim = \{\s*\n\s*organizationId: string;\s*\n\s*clientId: string;/);
  // And the row lookup is constrained by both.
  const loader = block(dniRoute, "async function loadConnection(");
  assert.ok(loader, "the connection loader exists");
  assert.match(loader, /\.eq\("organization_id", organizationId\)/);
  assert.match(loader, /\.eq\("client_id", clientId\)/);
  // The mint action binds the organization the operator was authorized for.
  const mint = block(crmSource, 'if (action === "create_callrail_dni_test_link")');
  assert.match(mint, /signDniCredential\(\s*\n?\s*context\.organizationId,\s*\n?\s*clientId,/);
});

test("expiry is verified server-side rather than trusted to the browser", () => {
  const dni = read("lib/callrail-dni.ts");
  const verify = block(dni, "export async function verifyDniClaim(");
  assert.ok(verify, "the verifier exists");
  // The deadline is checked after the signature, against the signed value.
  assert.match(verify, /isDniClaimExpired\(claim, now\)/);
  const signatureAt = verify.indexOf("crypto.subtle.verify");
  const expiryAt = verify.indexOf("isDniClaimExpired");
  assert.ok(signatureAt < expiryAt, "signature first, then the deadline");
  // Max-Age is a courtesy to the browser, not the control.
  assert.match(dni, /Max-Age=\$\{Math\.max\(0, Math\.floor\(maxAgeSeconds\)\)\}/);
});

test("the swap targets are prepared before CallRail's script runs", () => {
  // The first version of this page created its number when someone typed,
  // which is after swap.js has already scanned the document — it loaded, it
  // reported attribution, and it never swapped. The ordering below is what
  // fixed it, and these keep it fixed.
  const linkAt = dniPage.indexOf("DNI_SWAP_LINK_ID +");
  const bootstrapAt = dniPage.indexOf("DNI_BOOTSTRAP_ID +");
  const scriptAt = dniPage.indexOf("DNI_SCRIPT_ID +");
  assert.ok(linkAt > -1 && bootstrapAt > -1 && scriptAt > -1);
  assert.ok(linkAt < bootstrapAt, "targets are emitted before the bootstrap");
  assert.ok(bootstrapAt < scriptAt, "the bootstrap is emitted before CallRail");
  // The absence of async on the emitted tag is proved against real rendered
  // HTML in tests/callrail-dni-page.test.mjs, which can read the finished
  // attribute rather than guess at the expression that produced it.
  assert.match(dniPage, /export const DNI_SCRIPT_ORIGIN = "https:\/\/cdn\.callrail\.com"/);
});

test("the destination number never reaches the server", () => {
  // It is typed into the browser, kept in sessionStorage and used to write the
  // DOM before CallRail loads. A round trip would both miss that window and
  // put a customer phone number in a request log.
  assert.match(dniPage, /sessionStorage/);
  for (const forbidden of ["fetch(", "XMLHttpRequest", "sendBeacon", "<form"]) {
    assert.equal(dniPage.includes(forbidden), false, forbidden);
  }
  // The route reads one query parameter and no body at all.
  assert.equal(/request\.(json|text|formData|body)/.test(dniRoute), false);
  // Code only: the route's header comment explains that it never receives the
  // destination, and that sentence is not a violation of itself.
  assert.equal(
    /destination/i.test(codeOnly(dniRoute)),
    false,
    "the route knows nothing of it",
  );
});

test("the permission exists in both permission files", () => {
  const d1Source = read("db/crm.ts");
  assert.match(d1Source, /"call_tracking\.manage"/);
  assert.match(crmSource, /"call_tracking\.manage"/);
  // The union is declared once, in db/crm.ts, and imported by the Supabase
  // backend. A role list that drifts between the two is the failure this
  // guards against.
  assert.match(d1Source, /\|\s*"call_tracking\.manage"/);
});
