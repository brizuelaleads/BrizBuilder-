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
const webhookSource = read("lib/callrail-webhook.ts");
const ingestionSource = read("lib/callrail-ingestion.ts");
const crmSource = read("db/supabase-crm.ts");
const migrationSource = read(
  "supabase/migrations/20260819000000_callrail_connection.sql",
);
const ingestionMigrationSource = read(
  "supabase/migrations/20260825000000_callrail_ingestion.sql",
);
const outcomeMigrationSource = read(
  "supabase/migrations/20260826000000_callrail_delivery_outcomes.sql",
);
const syncClaimMigrationSource = read(
  "supabase/migrations/20260826010000_callrail_sync_run_claim.sql",
);
const viteConfigSource = read("vite.config.ts");
const workerSource = read("worker/index.ts");
const leadWorkerSource = read("lead-worker/src/index.ts");
const connectionsUi = read("app/crm/WorkflowViews.tsx");
const dniRoute = read("app/api/callrail/dni-test/route.ts");
const dniSource = read("lib/callrail-dni.ts");
const dniPage = read("lib/callrail-dni-page.ts");
const stateSource = read("lib/callrail-ingestion-state.ts");
const recordingRoute = read("app/api/callrail/recordings/[callId]/route.ts");
const callsUi = read("app/crm/CallsSection.tsx");
const leadsUi = read("app/crm/LeadsViews.tsx");
const contactsUi = read("app/crm/FoundationViews.tsx");
const mediaMigrationSource = read(
  "supabase/migrations/20260827000000_callrail_call_media.sql",
);

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

/**
 * The body of a declaration, from its keyword to its closing brace.
 *
 * Skips the parameter list before it starts counting braces. A signature that
 * declares an inline object type — `options: { startDate: string }` — closes
 * that brace before the body opens, and a naive matcher stops there and
 * returns the signature alone. That produced three separate false passes
 * before it was worth fixing here rather than at each call site.
 */
const block = (source, needle) => {
  const start = source.indexOf(needle);
  if (start < 0) return undefined;

  // Walk past the parameter list first, if there is one.
  let index = start;
  let parens = 0;
  let sawParen = false;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      parens += 1;
      sawParen = true;
    } else if (char === ")") {
      parens -= 1;
      if (parens === 0) {
        index += 1;
        break;
      }
    } else if (!sawParen && char === "{") {
      // A declaration with no parameter list at all.
      break;
    }
  }

  // Then find the brace that opens the body.
  const bodyStart = source.indexOf("{", index);
  if (bodyStart < 0) return undefined;

  let depth = 0;
  for (let cursor = bodyStart; cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    if (source[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, cursor + 1);
    }
  }
  return undefined;
};

const section = (source, startNeedle, endNeedle) => {
  const start = source.indexOf(startNeedle);
  if (start < 0) return undefined;
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end < 0 ? undefined : end);
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
    'if (action === "enable_callrail_ingestion")',
    'if (action === "disable_callrail_ingestion")',
    'if (action === "recover_callrail_calls")',
    'if (action === "refresh_callrail_call_media")',
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
    'if (action === "enable_callrail_ingestion")',
    'if (action === "disable_callrail_ingestion")',
    'if (action === "recover_callrail_calls")',
    'if (action === "refresh_callrail_call_media")',
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

test("webhook ingress is public only through brizbuilder-leads", () => {
  assert.match(
    leadWorkerSource,
    /url\.pathname\.startsWith\("\/api\/callrail\/webhook\/"\)/,
  );
  assert.match(leadWorkerSource, /isCallRailWebhook[\s\S]*request\.method !== "POST"/);
  assert.match(
    workerSource,
    /url\.pathname\.startsWith\("\/api\/callrail\/webhook\/"\)/,
  );
  assert.match(workerSource, /handleCallRailWebhook\(request, ctx\)/);
  assert.match(workerSource, /ctx\.waitUntil\(\s*\n\s*reconcileCallRailIngestion\(\)/);
});

test("webhook path ids, not payload tenants, resolve CallRail clients", () => {
  assert.match(ingestionMigrationSource, /webhook_path_id text/);
  assert.match(
    ingestionMigrationSource,
    /callrail_credentials_webhook_path_uidx[\s\S]*where webhook_path_id is not null/,
  );
  assert.match(webhookSource, /crypto\.getRandomValues\(new Uint8Array/);
  assert.match(storeSource, /\.eq\("webhook_path_id", pathId\)/);
  const receiver = block(ingestionSource, "async function receiveCallRailWebhook");
  assert.ok(receiver, "receiver exists");
  assert.match(receiver, /readCallRailWebhookRoute\(request\.url\)/);
  assert.equal(/searchParams\.get\(["'](organization|client|tenant)/.test(receiver), false);
  assert.equal(/payload\.(organization|client|tenant)/.test(receiver), false);
});

test("CallRail signatures are verified over raw bytes before parsing", () => {
  const receiver = block(ingestionSource, "async function receiveCallRailWebhook");
  assert.ok(receiver);
  const verifyAt = receiver.indexOf("verifyCallRailSignature(");
  const parseAt = receiver.indexOf("JSON.parse(");
  assert.ok(verifyAt > -1, "signature verification exists");
  assert.ok(parseAt > -1, "JSON parsing exists");
  assert.ok(verifyAt < parseAt, "verification happens before parsing");
  assert.match(ingestionSource, /new Uint8Array\(await request\.arrayBuffer\(\)\)/);
  assert.match(webhookSource, /crypto\.subtle\.verify/);
});

test("invalid CallRail signatures cannot create CRM records", () => {
  const receiver = block(ingestionSource, "async function receiveCallRailWebhook");
  assert.ok(receiver);
  const invalid = receiver.slice(
    receiver.indexOf("if (!signatureValid)"),
    receiver.indexOf("let body: unknown"),
  );
  assert.match(invalid, /outcome: "rejected_signature"/);
  assert.equal(/from\("contacts"\)|from\("leads"\)|from\("callrail_calls"\)/.test(invalid), false);
});

test("enabling ingestion lists integrations with signing_key and appends only", () => {
  const enable = block(crmSource, 'if (action === "enable_callrail_ingestion")');
  assert.ok(enable);
  assert.match(enable, /requirePermission\(context, "call_tracking\.manage"\)/);
  assert.match(enable, /await requireClient\(context, clientId\)/);
  assert.match(enable, /ensureCallRailWebhookIntegration\(/);
  assert.match(enable, /encryptCallRailSecret\(\s*\n\s*integration\.signingKey/);
  assert.match(enable, /webhook_signing_key_ciphertext/);
  assert.match(enable, /ingest_enabled: true/);
  assert.match(enable, /"provider\.ingestion_enabled"/);

  const list = block(providerSource, "export async function listCallRailIntegrations");
  assert.ok(list);
  assert.match(list, /fields: "signing_key"/);
  assert.match(list, /company_id: safeCompanyId/);
  const ensure = block(providerSource, "export async function ensureCallRailWebhookIntegration");
  assert.ok(ensure);
  assert.match(ensure, /listCallRailIntegrations\(accountId, companyId, apiKey\)/);
  assert.match(ensure, /integration\.type === "Webhooks"/);
  assert.match(ensure, /appendCallRailWebhookUrls\(current\.config, urls\)/);
  assert.equal(/pre_call_webhook/.test(ensure), false, "initial enable does not configure pre-call");
});

test("disconnect removes only BrizBuilder webhook URLs before deleting the key", () => {
  const disconnect = block(crmSource, 'if (action === "disconnect_callrail")');
  assert.ok(disconnect);
  const removeAt = disconnect.indexOf("removeCallRailWebhooksForClient(");
  const deleteAt = disconnect.indexOf('.from("callrail_credentials")');
  assert.ok(removeAt > -1, "disconnect removes URLs");
  assert.ok(removeAt < deleteAt, "URLs are removed before the key is destroyed");
  const helper = block(storeSource, "export async function removeCallRailWebhooksForClient");
  assert.ok(helper);
  assert.match(helper, /buildCallRailWebhookUrls\(getCallRailWebhookBaseUrl\(\), row\.webhook_path_id\)/);
  assert.match(helper, /removeCallRailWebhookIntegrationUrls\(/);
  const api = section(
    providerSource,
    "export async function removeCallRailWebhookIntegrationUrls",
    "export async function getCallRailCall",
  );
  assert.ok(api);
  assert.match(api, /removeCallRailWebhookUrls\(current\.config, urls\)/);
  assert.equal(/deleteCallRail|method: "DELETE"/.test(api), false);
});

test("ingestion and reconciliation are idempotent around CallRail call ids", () => {
  assert.match(
    ingestionMigrationSource,
    /unique \(organization_id, client_id, callrail_call_id\)/,
  );
  assert.match(ingestionMigrationSource, /claim_callrail_call_for_ingestion/);
  assert.match(ingestionMigrationSource, /ingest_status <> 'enriching'/);
  const ingest = block(ingestionSource, "export async function ingestFetchedCall");
  assert.ok(ingest);
  assert.match(ingest, /saveCallSnapshot\(organizationId, clientId, call, kind\)/);
  assert.match(ingest, /claimCall\(String\(snapshot\.id\)\)/);
  assert.match(ingest, /ensureContact\(/);
  assert.match(ingest, /ensureLead\(/);
  const reconcile = section(
    ingestionSource,
    "export async function reconcileCallRailIngestion",
    "__end_of_file__",
  );
  assert.ok(reconcile);
  assert.match(reconcile, /listCallRailCallIds\(/);
  assert.match(reconcile, /ingestCallRailCall\(/);
  assert.match(ingestionSource, /callrail_sync_runs/);
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

test("the signing key never leaves the server", () => {
  const enable = block(crmSource, 'if (action === "enable_callrail_ingestion")');
  assert.ok(enable, "the enable action exists");
  // Encrypted the moment it is in hand, tenant-bound like the API key.
  assert.match(enable, /encryptCallRailSecret\(\s*\n?\s*integration\.signingKey,/);
  // What is written is ciphertext, never the key.
  assert.match(enable, /webhook_signing_key_ciphertext: encryptedSigningKey\.ciphertext/);
  // It is in no audit payload, no return value, and no thrown message.
  const audited = enable.slice(enable.indexOf("provider.ingestion_enabled"));
  assert.equal(/signingKey/.test(audited), false, "not in the audit or return");
  for (const line of enable.split("\n")) {
    if (line.includes("throw new Error")) {
      assert.equal(/signingKey|signing_key/.test(line), false, line.trim());
    }
  }
});

test("a database failure after CallRail was changed puts CallRail back", () => {
  // The write to CallRail happens first, so a failure between the two would
  // otherwise leave a customer posting to a URL BrizBuilder has no key for.
  const enable = block(crmSource, 'if (action === "enable_callrail_ingestion")');
  assert.match(enable, /try \{[\s\S]*callrail_credentials[\s\S]*\} catch \{/);
  assert.match(enable, /restoreCallRailWebhookIntegration\(/);
  assert.match(enable, /integration\.previousConfig/);
  // The outcome is audited either way, and the operator is told which it was.
  assert.match(enable, /"provider\.ingestion_enable_failed"/);
  assert.match(enable, /callrailRestored: restored/);
  assert.match(enable, /put back exactly as it was/);
  assert.match(enable, /could not be put back/);
  // And the restore itself is the previous configuration, not a guess.
  const restore = block(
    providerSource,
    "export async function restoreCallRailWebhookIntegration",
  );
  assert.ok(restore, "the restore helper exists");
  assert.match(restore, /if \(previousConfig\)/);
  assert.match(restore, /removeCallRailWebhookIntegrationUrls\(/);
});

test("disconnect keeps the connection recoverable when cleanup fails", () => {
  const disconnect = block(crmSource, 'if (action === "disconnect_callrail")');
  assert.ok(disconnect, "the disconnect action exists");
  // Cleanup is attempted before the credential is destroyed.
  const cleanupAt = disconnect.indexOf("removeCallRailWebhooksForClient");
  const deleteAt = disconnect.indexOf(".delete()");
  assert.ok(cleanupAt > -1 && deleteAt > -1);
  assert.ok(cleanupAt < deleteAt, "CallRail is cleaned up before the key is destroyed");
  // A failure marks the connection and leaves it intact.
  assert.match(disconnect, /catch \{[\s\S]*status: "attention"/);
  assert.match(disconnect, /"provider\.disconnect_cleanup_failed"/);
  assert.match(disconnect, /throw new Error\(/);
  // The delete must sit after the catch, so a failed cleanup cannot reach it.
  const catchAt = disconnect.indexOf("} catch {");
  assert.ok(catchAt > -1 && catchAt < deleteAt);
});

test("a sync run records a reason, never a raw message", () => {
  // A thrown message can quote a row, a URL or a provider payload; a sync run
  // is stored and read back later.
  assert.match(ingestionSource, /export const CALLRAIL_SYNC_FAILURES = \[/);
  assert.match(ingestionSource, /export function classifySyncFailure/);
  assert.match(ingestionSource, /error: classifySyncFailure\(error\)/);
  // What is *persisted* and what is *logged* both carry the classification.
  // An exception may still carry a message: it is held in memory and shown to
  // the authenticated operator, never written to a sync run.
  const finish = block(ingestionSource, "async function finishSyncRun(");
  assert.ok(finish, "finishSyncRun exists");
  assert.equal(
    /error\.message/.test(finish),
    false,
    "a sync run never stores a raw message",
  );
  for (const line of ingestionSource.split("\n")) {
    if (line.includes("error:") && line.includes("SyncRun")) {
      assert.equal(/error\.message/.test(line), false, line.trim());
    }
    if (line.includes("console.")) {
      assert.equal(
        /error\.message|rawBytes|body/.test(line),
        false,
        `a log line must not carry provider material: ${line.trim()}`,
      );
    }
  }
  assert.equal(/console\.(log|info|warn)\(/.test(ingestionSource), false);
});

test("a failed background task is recoverable at any age", () => {
  // Reconciliation re-lists a time window, so a waitUntil that died on an
  // older call would never be retried without this.
  assert.match(ingestionSource, /async function unfinishedCalls\(/);
  const sweep = block(ingestionSource, "async function unfinishedCalls(");
  assert.match(sweep, /\.eq\("organization_id", organizationId\)/);
  assert.match(sweep, /\.eq\("client_id", clientId\)/);
  assert.match(sweep, /\.in\("ingest_status", \["received", "enriching", "failed"\]\)/);
  // It runs inside reconciliation, and converges with the window sweep rather
  // than repeating its work.
  // Sliced rather than brace-matched: the signature declares an inline object
  // type, so the first closing brace ends the parameter, not the body.
  const reconcile = ingestionSource.slice(
    ingestionSource.indexOf("export async function reconcileCallRailIngestion"),
  );
  assert.match(reconcile, /unfinishedCalls\(organizationId, clientId/);
  assert.match(reconcile, /seenIds\.has\(callId\)/);
  assert.match(reconcile, /summary\.callsRecovered/);
});

test("reconciliation is scoped, bounded and paginated by cursor", () => {
  const reconcile = ingestionSource.slice(
    ingestionSource.indexOf("export async function reconcileCallRailIngestion"),
  );
  assert.match(reconcile, /const organizationId = String\(connection\.organization_id\)/);
  assert.match(reconcile, /const clientId = String\(connection\.client_id\)/);
  assert.match(reconcile, /windowStart/);
  assert.match(reconcile, /windowEnd/);
  // Offset pagination over a filtered window, walked to the end.
  const list = block(providerSource, "export async function listCallRailCallIds");
  assert.match(list, /collectCallRailPages\(/);
  assert.match(list, /page: String\(pageNumber\)/);
  assert.match(list, /per_page: String\(CALLRAIL_CALL_PAGE_SIZE\)/);
});

test("the webhook resolves its tenant from the path, never the payload", () => {
  const receive = block(ingestionSource, "async function receiveCallRailWebhook(");
  assert.ok(receive, "the receiver exists");
  const routeAt = receive.indexOf("readCallRailWebhookRoute(request.url)");
  const verifyAt = receive.indexOf("verifyCallRailSignature(");
  const parseAt = receive.indexOf("JSON.parse(");
  assert.ok(routeAt > -1 && verifyAt > -1 && parseAt > -1);
  // Path first, signature second, parse third. Never any other order.
  assert.ok(routeAt < verifyAt, "the tenant comes from the path");
  assert.ok(verifyAt < parseAt, "the raw body is verified before it is parsed");
  // The signature covers the bytes as received.
  assert.match(receive, /verifyCallRailSignature\(\s*\n?\s*verifier\.signingKey,\s*\n?\s*rawBytes,/);
  // And the payload's own company is checked against the connection rather
  // than believed.
  assert.match(receive, /envelope\.companyId !== verifier\.companyId/);
});

test("an unauthentic delivery cannot create CRM data", () => {
  const receive = block(ingestionSource, "async function receiveCallRailWebhook(");
  // Every refusal returns process:false, so nothing downstream ever runs.
  const refusals = receive.split("process: false").length - 1;
  assert.ok(refusals >= 5, `every rejection stops processing (${refusals})`);
  assert.match(receive, /outcome: "rejected_signature"/);
  // The rejection is recorded, but with a digest rather than the body.
  assert.match(ingestionSource, /body_sha256/);
  assert.equal(
    /raw_body|body_text|payload:/.test(ingestionSource),
    false,
    "no provider body is stored",
  );
});

test("one contact per caller is enforced by a lock, not by a constraint", () => {
  // Contacts legitimately share a number outside this path — a household, a
  // switchboard, a spouse — so the exclusion is scoped to the operation
  // rather than imposed on the column.
  const fn = section(
    ingestionMigrationSource,
    "create or replace function public.find_or_create_callrail_contact",
    "revoke all on function public.find_or_create_callrail_contact",
  );
  assert.ok(fn, "the function exists");

  // Transaction-scoped, so it is released however the transaction ends.
  assert.match(fn, /pg_advisory_xact_lock\(/);
  // Keyed on the tenant and the number, so unrelated callers never queue.
  assert.match(fn, /p_organization_id::text \|\| ':' \|\| p_client_id::text \|\| ':' \|\| v_phone/);

  // The recheck must happen after the lock, or the lock buys nothing.
  const lockAt = fn.indexOf("pg_advisory_xact_lock(");
  const selectAt = fn.indexOf("select c.id");
  const insertAt = fn.indexOf("insert into public.contacts");
  assert.ok(lockAt > -1 && selectAt > -1 && insertAt > -1);
  assert.ok(lockAt < selectAt, "the lock is taken before the recheck");
  assert.ok(selectAt < insertAt, "the recheck happens before the insert");

  // Scoped to the tenant on the way in and on the way out.
  assert.match(fn, /where c\.organization_id = p_organization_id/);
  assert.match(fn, /and c\.client_id = p_client_id/);
  assert.match(fn, /and c\.phone = v_phone/);

  // Pre-existing duplicates resolve to the same survivor every time, so a
  // stray pair does not oscillate depending on what the planner returned.
  assert.match(fn, /order by c\.created_at asc, c\.id asc/);
  assert.match(fn, /limit 1/);

  // A missing tenant, or a number that is not canonical E.164, is refused
  // rather than keying the lock on one string and matching rows on another.
  assert.match(fn, /requires an organization and a client/);
  assert.match(fn, /requires a canonical E\.164 phone number/);
  assert.match(fn, /\^\\\+\[1-9\]\[0-9\]\{7,14\}\$/);
});

test("the definer function resolves no name through a caller's path", () => {
  const fn = section(
    ingestionMigrationSource,
    "create or replace function public.find_or_create_callrail_contact",
    "revoke all on function public.find_or_create_callrail_contact",
  );
  // Empty, not 'public': a definer function runs with the owner's rights.
  assert.match(fn, /set search_path = ''/);
  assert.equal(
    /set search_path = public/.test(fn),
    false,
    "a writable schema must not be on a definer function's path",
  );
  // Every table reference is qualified, and so is every function call that
  // is not a SQL construct.
  assert.equal(
    /(?<!public\.)\bcontacts\b/.test(fn.replace(/--[^\n]*/g, "")),
    false,
    "every contacts reference is schema-qualified",
  );
  for (const builtin of [
    "pg_catalog.btrim",
    "pg_catalog.now",
    "pg_catalog.pg_advisory_xact_lock",
    "pg_catalog.hashtextextended",
  ]) {
    assert.ok(fn.includes(builtin), `${builtin} is qualified`);
  }
});

test("shared phone numbers stay legal outside CallRail ingestion", () => {
  // The explicit instruction was to add no unique index on the contact phone.
  // Nothing in any CallRail migration may introduce one.
  for (const [name, sql] of Object.entries({
    connection: migrationSource,
    ingestion: ingestionMigrationSource,
  })) {
    assert.equal(
      /unique[\s\S]{0,80}contacts[\s\S]{0,80}phone/i.test(sql),
      false,
      `${name} must not constrain the contact phone`,
    );
    assert.equal(
      /create unique index[^;]*on public\.contacts/i.test(sql),
      false,
      `${name} must not add a unique index to contacts`,
    );
  }
  // And the lock is the only thing this pipeline adds: no other code path
  // takes it, so writers elsewhere are unaffected.
  assert.equal(
    (ingestionMigrationSource.match(/pg_advisory_xact_lock\(/g) ?? []).length,
    1,
    "exactly one advisory lock, in the contact function",
  );
});

test("the contact function is reachable only by the service role", () => {
  assert.match(
    ingestionMigrationSource,
    /revoke all on function public\.find_or_create_callrail_contact\([\s\S]*?\) from public, anon, authenticated;/,
  );
  assert.match(
    ingestionMigrationSource,
    /grant execute on function public\.find_or_create_callrail_contact\([\s\S]*?\) to service_role;/,
  );
  // It runs as its owner, so its reach is fixed rather than the caller's.
  const fn = section(
    ingestionMigrationSource,
    "create or replace function public.find_or_create_callrail_contact",
    "revoke all on function public.find_or_create_callrail_contact",
  );
  assert.match(fn, /security definer/);
  // Hardened to an empty path; the dedicated test below covers why.
  assert.match(fn, /set search_path = ''/);
});

test("ingestion finds or creates a contact in one locked call", () => {
  const ensure = block(ingestionSource, "async function ensureContact(");
  assert.ok(ensure, "ensureContact exists");
  assert.match(ensure, /rpc\("find_or_create_callrail_contact"/);
  // The select-then-insert that could double up is gone from the keyed path.
  const keyed = ensure.slice(0, ensure.indexOf("No usable number"));
  assert.equal(
    /\.from\("contacts"\)[\s\S]{0,120}\.select\(/.test(keyed),
    false,
    "no unlocked lookup before the insert",
  );
});

test("a repeat call joins the newest lead when that lead is open", () => {
  const ensure = block(ingestionSource, "async function ensureLead(");
  assert.ok(ensure, "ensureLead exists");
  // The newest lead of ANY status, then judged. Filtering to open statuses
  // here would step over a more recent closed lead.
  assert.equal(
    /\.in\("status"/.test(ensure),
    false,
    "the candidate query must not filter by status",
  );
  assert.equal(
    /\.gte\("created_at"/.test(ensure),
    false,
    "the candidate query must not filter by the window either",
  );
  assert.match(ensure, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(ensure, /\.order\("id", \{ ascending: false \}\)/);
  assert.match(ensure, /selectNewestLead\(/);
  assert.match(ensure, /decideReInquiry\(/);
  // Scoped to the tenant and the matched contact.
  assert.match(ensure, /\.eq\("organization_id", organizationId\)/);
  assert.match(ensure, /\.eq\("client_id", clientId\)/);
  assert.match(ensure, /\.eq\("contact_id", contactId\)/);
  // Age is not consulted. An open lead is reused however old it is, so
  // nothing here may read a window, a cutoff or a clock.
  assert.equal(
    /reInquiryWindowDays|reInquiryCutoff|Date\.now\(\)/.test(ensure),
    false,
    "the reuse decision must not depend on time",
  );
  const decide = block(read("lib/callrail-reinquiry.ts"), "export function decideReInquiry");
  assert.ok(decide);
  assert.match(decide, /isOpenLeadStatus\(candidate\.status\)/);
  assert.match(decide, /reuse: true, reason: "open_lead"/);
  assert.equal(
    /windowDays|DAY_MS|now/.test(decide),
    false,
    "the decision takes a candidate and nothing else",
  );
});

test("reusing a lead never skips recording the call", () => {
  // Reuse decides which lead a call attaches to, not whether the call is
  // written down: the call row is saved before any lead work begins.
  const ingest = block(ingestionSource, "export async function ingestFetchedCall(");
  assert.ok(ingest, "ingestFetchedCall exists");
  const snapshotAt = ingest.indexOf("saveCallSnapshot(");
  const leadAt = ingest.indexOf("ensureLead(");
  assert.ok(snapshotAt > -1 && leadAt > -1);
  assert.ok(snapshotAt < leadAt, "the call is recorded before the lead decision");
  // And every call keeps its own row, keyed on CallRail's call id.
  assert.match(
    ingestionMigrationSource,
    /unique \(organization_id, client_id, callrail_call_id\)/,
  );
});

test("the re-enquiry window is stored per connection and bounded", () => {
  assert.match(
    ingestionMigrationSource,
    /add column if not exists re_inquiry_window_days integer not null default 30/,
  );
  assert.match(
    ingestionMigrationSource,
    /check \(re_inquiry_window_days between 1 and 365\)/,
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


// --------------------------------------------- switching ingestion off

test("disabling ingestion withdraws only BrizBuilder's URLs", () => {
  const disable = block(crmSource, 'if (action === "disable_callrail_ingestion")');
  assert.ok(disable, "the disable action exists");
  const code = codeOnly(disable);

  // The same helper disconnect uses: it rebuilds this connection's own two
  // URLs from its path id and writes every other URL back untouched, so a
  // third party's webhook survives somebody switching ingestion off here.
  assert.match(
    code,
    /removeCallRailWebhooksForClient\(context\.organizationId, clientId\)/,
  );
  assert.equal(
    /method: "DELETE"|deleteCallRailIntegration|integrations\/.*delete/i.test(code),
    false,
    "the CallRail integration itself is never deleted",
  );

  // The API connection survives. Nothing is destroyed, and the key, account,
  // company and path id are all absent from the update — this is reversible
  // from the same card without re-entering anything.
  assert.equal(/\.delete\(\)/.test(code), false, "no row is destroyed");
  for (const kept of [
    "api_key_ciphertext",
    "api_key_iv",
    "account_id",
    "company_id",
    "webhook_path_id",
  ]) {
    assert.equal(
      new RegExp(`\\b${kept}:`).test(code),
      false,
      `${kept} is left alone so the connection stays usable`,
    );
  }

  // What does change: the switch, and — once the URLs are confirmed gone —
  // the key that only ever authenticated them.
  assert.match(code, /ingest_enabled: false/);
  const confirmed = code.slice(code.indexOf("if (cleanupOk) {"));
  assert.match(confirmed, /webhook_signing_key_ciphertext: null/);
  assert.match(confirmed, /webhook_signing_key_iv: null/);
  assert.match(confirmed, /webhook_integration_id: null/);
});

test("ingestion is switched off locally before CallRail is called", () => {
  const disable = block(crmSource, 'if (action === "disable_callrail_ingestion")');
  const code = codeOnly(disable);
  const switchAt = code.indexOf("ingest_enabled: false");
  const providerAt = code.indexOf("removeCallRailWebhooksForClient");
  assert.ok(switchAt > -1, "the local switch exists");
  assert.ok(providerAt > -1, "the provider call exists");
  assert.ok(
    switchAt < providerAt,
    "the row must read disabled before anything slower is attempted",
  );
  // It is its own awaited write against this tenant's row, not something
  // batched in behind the network call.
  const prefix = code.slice(0, providerAt);
  assert.match(prefix, /await assertOk\([\s\S]*\.from\("callrail_credentials"\)/);
  assert.match(prefix, /\.update\(\{ ingest_enabled: false, updated_at: now \}\)/);
  assert.match(prefix, /\.eq\("organization_id", context\.organizationId\)/);
  assert.match(prefix, /\.eq\("client_id", clientId\)/);
});

test("a failed local disable makes no CallRail request at all", () => {
  const disable = block(crmSource, 'if (action === "disable_callrail_ingestion")');
  const code = codeOnly(disable);
  const switchAt = code.indexOf("ingest_enabled: false");
  const tryAt = code.indexOf("try {");
  const providerAt = code.indexOf("removeCallRailWebhooksForClient");

  // The action has exactly one try/catch, it opens after the local write, and
  // it wraps the provider call. So a rejected update propagates out of the
  // action with CallRail untouched and the connection as it started.
  assert.equal(code.split("try {").length - 1, 1, "exactly one try block");
  assert.equal(code.split("catch").length - 1, 1, "exactly one catch");
  assert.ok(switchAt > -1 && tryAt > -1 && providerAt > -1);
  assert.ok(switchAt < tryAt, "the local write sits outside the catch");
  assert.ok(tryAt < providerAt, "the catch is there for the provider call");
  assert.match(code.slice(0, tryAt), /await assertOk\(/);
  // assertOk is the throwing wrapper, so awaiting it really is a precondition.
  const helper = block(crmSource, "async function assertOk");
  assert.ok(helper, "assertOk exists");
  assert.match(helper, /if \(error\) throw new Error\(error\.message\)/);
});

test("a failed CallRail cleanup leaves ingestion off and retryable", () => {
  const disable = block(crmSource, 'if (action === "disable_callrail_ingestion")');
  const code = codeOnly(disable);
  // The catch records the failure and does nothing else: no revert, no retry
  // of the local write, no re-enable.
  assert.match(code, /catch \{\s*cleanupOk = false;\s*\}/);
  assert.equal(/ingest_enabled: true/.test(code), false, "never switched back on");
  assert.equal(
    code.split("ingest_enabled").length - 1,
    1,
    "the flag is written once, before the provider call, and not revisited",
  );
  // The connection stays recoverable, so pressing the button again repeats
  // only the remote step.
  for (const kept of [
    "api_key_ciphertext",
    "api_key_iv",
    "account_id",
    "company_id",
    "webhook_path_id",
  ]) {
    assert.equal(
      new RegExp(`\\b${kept}:`).test(code),
      false,
      `${kept} survives a failed cleanup`,
    );
  }
  assert.equal(/\.delete\(\)/.test(code), false, "no row is destroyed");
  // The signing key is dropped only once the URLs are actually gone. While
  // they are still live, keeping it means a delivery verifies and is refused
  // as ingest_disabled; without it loadCallRailWebhookVerifier returns null
  // and the same delivery is filed as rejected_unknown_client instead.
  assert.match(
    code,
    /if \(cleanupOk\) \{[\s\S]*webhook_signing_key_ciphertext: null/,
  );
  const verifier = block(storeSource, "export async function loadCallRailWebhookVerifier");
  assert.ok(verifier);
  assert.match(
    verifier,
    /if \(!row\?\.webhook_signing_key_ciphertext \|\| !row\.webhook_signing_key_iv\) \{\s*\n\s*return null;/,
  );
  // Marked for attention, audited, and reported to the caller.
  assert.match(code, /status: cleanupOk \? "connected" : "attention"/);
  assert.match(disable, /Use Retry cleanup, or remove them there/);
  assert.match(code, /"provider\.ingestion_disabled"/);
  assert.match(code, /callrailCleanupConfirmed: cleanupOk/);
  assert.match(code, /return \{ enabled: false, cleanupConfirmed: cleanupOk \}/);
});

test("a locally disabled connection is skipped wherever ingestion begins", () => {
  // Reconciliation never selects it in the first place.
  const enabled = block(ingestionSource, "async function enabledConnections");
  assert.ok(enabled, "the reconciliation query exists");
  assert.match(enabled, /\.eq\("ingest_enabled", true\)/);

  // Both ingestion entry points reread the flag and stop before writing.
  for (const name of [
    "export async function ingestCallRailCall",
    "export async function ingestFetchedCall",
  ]) {
    const fn = block(ingestionSource, name);
    assert.ok(fn, `${name} exists`);
    const stateAt = fn.indexOf("await ingestionState(");
    const guardAt = fn.indexOf("if (!state.enabled");
    assert.ok(stateAt > -1, `${name} rereads the flag`);
    assert.ok(guardAt > stateAt, `${name} guards on what it just read`);
    assert.match(fn.slice(guardAt), /^if \(!state\.enabled[\s\S]*?return \{ status: "skipped"/);
    // Nothing is written, and no provider request is made, before the guard.
    const prefix = fn.slice(0, guardAt);
    assert.equal(
      /\.insert\(|\.update\(|\.upsert\(|ensureContact\(|ensureLead\(|saveCallSnapshot\(|getCallRailCall\(/.test(
        prefix,
      ),
      false,
      `${name} writes nothing and fetches nothing before rechecking`,
    );
  }

  // The flag is read from the row each time, not carried in from the caller,
  // so a disable that landed after the delivery was accepted is still seen.
  const state = block(ingestionSource, "async function ingestionState");
  assert.ok(state);
  assert.match(state, /\.from\("callrail_credentials"\)/);
  assert.match(state, /select\("account_id,company_id,ingest_enabled/);
  assert.match(state, /enabled: data\?\.ingest_enabled === true/);

  // And intake refuses a delivery outright, before any duplicate check.
  const receiver = block(ingestionSource, "async function receiveCallRailWebhook");
  assert.ok(receiver);
  const disabledAt = receiver.indexOf("if (!verifier.ingestEnabled)");
  assert.ok(disabledAt > -1, "intake checks the flag");
  assert.match(receiver.slice(disabledAt), /outcome: "rejected_ingest_disabled"/);
  assert.ok(
    disabledAt < receiver.indexOf("previousDelivery("),
    "the refusal comes before the delivery is treated as work",
  );
});

test("switching ingestion off preserves the rest of the public config", () => {
  const disable = block(crmSource, 'if (action === "disable_callrail_ingestion")');
  const code = codeOnly(disable);
  // The account label, company name and DNI state share that JSON column.
  // Replacing it wholesale would blank the card it is read back into.
  assert.match(code, /\.select\("public_config"\)/);
  assert.match(code, /public_config: \{\s*\.\.\.config,/);
  // The ingestion flags come from the one module the card reads back through,
  // rather than being spelled out again here where they could drift.
  assert.match(code, /\.\.\.callRailIngestionFlags\(cleanupOk\)/);
  const flags = block(stateSource, "export function callRailIngestionFlags");
  assert.ok(flags, "the shared flags exist");
  assert.match(flags, /callIngestionEnabled: false/);
  assert.match(flags, /callIngestionConfigured: !cleanupConfirmed/);
  assert.match(flags, /callIngestionCleanupPending: !cleanupConfirmed/);
  assert.match(flags, /callIngestionEvents: \[\] as string\[\]/);
});

// ------------------------------------------------- the ingestion controls

const ingestionSection = () =>
  section(
    connectionsUi,
    "<span>Call ingestion</span>",
    // The end of the fragment, not the next button's label: "Check
    // connection" appears after that button's own click handler, which would
    // otherwise be counted as one of this section's.
    "</>\n                ) : null}",
  );
const ingestionHandler = () =>
  block(connectionsUi, "const runCallRailDisable = async (");
const ingestionUi = () => `${ingestionHandler()}\n${ingestionSection()}`;

test("the CallRail card shows ingestion state and offers all three moves", () => {
  const ui = ingestionSection();
  assert.ok(ui, "the ingestion section is rendered in the CallRail card");
  assert.match(ui, /callRailIngesting \? "On" : "Off"/);
  // Each label is the content of its own button, not prose in the notes.
  assert.match(ui, /: "Enable ingestion"\}\s*\n\s*<\/button>/);
  assert.match(ui, /: "Disable ingestion"\}\s*\n\s*<\/button>/);
  assert.match(ui, /: "Retry cleanup"\}\s*\n\s*<\/button>/);
  // Only once the company is chosen: there is nothing to point a webhook at
  // before that.
  const before = connectionsUi.slice(0, connectionsUi.indexOf("<span>Call ingestion</span>"));
  assert.match(before.slice(before.lastIndexOf("{callRailSetup")), /callRailSetup === "ready" \? \(/);
});

test("ingestion reads as off unless the server says it is on", () => {
  // The card does not decide this itself: it asks the one module the server
  // writes through, so the two cannot drift into disagreeing.
  assert.match(connectionsUi, /callRailIngestionView\(callRailConnection\)/);
  assert.match(
    connectionsUi,
    /callRailIngestion === CALLRAIL_INGESTION_ON/,
  );
  assert.match(
    connectionsUi,
    /callRailIngestion === CALLRAIL_INGESTION_CLEANUP_PENDING/,
  );
  assert.equal(
    /callIngestionEnabled !== false|callIngestionEnabled \?/.test(connectionsUi),
    false,
    "absence of the flag is not consent to ingest",
  );
  // `!== false` or a plain truthiness check would read a connection made
  // before ingestion existed — no such field stored — as switched on.
  const decide = block(stateSource, "export function callRailIngestionView");
  assert.ok(decide, "the shared decision exists");
  assert.match(decide, /facts\?\.callIngestionEnabled === true/);
});

test("no ingestion button acts without an explicit confirmation", () => {
  const ui = ingestionSection();
  // Split on the handlers themselves rather than naming the actions, so a
  // fourth button cannot be added later without meeting the same bar.
  const handlers = ui.split(/onClick=\{(?:async )?\(\) => \{/).slice(1);
  assert.equal(
    handlers.length,
    5,
    "enable, disable, retry cleanup, recover missed calls and refresh recordings",
  );
  for (const handler of handlers) {
    const confirmAt = handler.indexOf("window.confirm(");
    assert.ok(confirmAt > -1, "the handler asks first");
    const acts = [
      ...[...handler.matchAll(/\brunCallRail\w+\(/g)].map((m) => m.index),
      handler.indexOf("mutate("),
    ].filter((at) => at > -1);
    assert.ok(acts.length > 0, "the handler does something");
    assert.ok(
      Math.min(...acts) > confirmAt,
      "it confirms before it acts, not after",
    );
    // And declining returns before the request is made.
    assert.match(handler.slice(confirmAt), /\)\s*\)\s*\n\s*return;/);
  }
  // The confirmations say what will actually happen at CallRail.
  assert.match(ui, /Enable call ingestion\?[\s\S]*?keeping any URLs already there/);
  assert.match(ui, /Turn off call ingestion\?[\s\S]*?removes only its own webhook URLs/);
  assert.match(
    ui,
    /Retry the webhook cleanup\?[\s\S]*?remove only its own webhook URLs/,
  );
});

test("nothing switches ingestion on by itself", () => {
  // No effect, no mount-time call, no retry loop: a business's calls start
  // flowing into the CRM because somebody pressed the button and confirmed.
  for (const fragment of connectionsUi.split("useEffect(").slice(1)) {
    const end = fragment.indexOf("\n  }, [");
    assert.equal(
      /callrail/i.test(end > -1 ? fragment.slice(0, end) : fragment),
      false,
      "no effect in this view touches CallRail",
    );
  }
  for (const action of [
    "enable_callrail_ingestion",
    "disable_callrail_ingestion",
  ]) {
    assert.equal(
      connectionsUi.split(action).length - 1,
      1,
      `${action} has exactly one call site`,
    );
  }
});

test("every ingestion button shows progress and reports failure in place", () => {
  const ui = ingestionUi();
  // Disabled while any request is in flight, so a second click cannot send a
  // second change to CallRail.
  assert.equal(
    ingestionSection().split("disabled={Boolean(callRail.ingestionPending)}")
      .length - 1,
    5,
    "every button is disabled while any is pending",
  );
  assert.match(ui, /ingestionPending === "enable"\s*\?\s*"Enabling/);
  assert.match(ui, /ingestionPending === "disable"\s*\?\s*"Turning off/);
  assert.match(ui, /ingestionPending === "retry"\s*\?\s*"Retrying/);

  // A failure is announced beside the button rather than swallowed, and the
  // pending state is cleared on every path so the button never dies.
  assert.match(ui, /className="crm-inline-error" role="alert"/);
  assert.equal(ui.split("catch (error)").length - 1, 2, "both paths catch");
  assert.equal(
    ui.split('ingestionPending: ""').length - 1,
    4,
    "success and failure both clear the pending state, on both paths",
  );
  for (const message of [
    "Call ingestion could not be enabled.",
    "Call ingestion could not be turned off.",
    "The webhook cleanup could not be retried.",
  ]) {
    assert.ok(ui.includes(message), message);
  }
  // A cleanup CallRail did not confirm is surfaced, not reported as clean.
  assert.match(ui, /cleanupConfirmed === false/);
  assert.match(ui, /did not confirm the webhook URLs were removed/);
});

test("a successful switch refreshes the card that reads the flag", () => {
  const app = read("app/CrmApp.tsx");
  const mutate = block(app, "async function mutate(");
  assert.ok(mutate, "the shared mutate helper exists");
  // The section renders from server state, so the refresh is what turns the
  // status from Off to On. Both handlers rely on it rather than guessing.
  assert.match(mutate, /await refresh\(\);\s*\n\s*setToast\(success\);/);
  // And a failure still reaches the caller, so the section can show it.
  assert.match(mutate, /setError\(message\);\s*\n\s*throw caught;/);
  const ui = ingestionUi();
  assert.equal(
    /setCallRail|callIngestionEnabled: true/.test(ui),
    false,
    "the card must not fake the new state locally",
  );
});


test("the card never reports a cleanup CallRail did not confirm", () => {
  const ui = ingestionUi();
  // The toast states only what is certainly true at that point \u2014 ingestion is
  // off \u2014 and makes no claim about CallRail, because removal is unconfirmed
  // until the returned flag is read.
  const toast = /"Call ingestion turned off\."/.exec(ui);
  assert.ok(toast, "the disable toast exists");
  assert.equal(
    /remov|withdraw|webhook|CallRail/i.test(toast[0]),
    false,
    "the success toast must not assert anything about CallRail",
  );
  // An unconfirmed cleanup is surfaced beside the button rather than dropped.
  assert.match(ui, /result\?\.cleanupConfirmed === false/);
  assert.match(ui, /did not confirm the webhook URLs were removed/);
  // The status cells render from server state, so the card cannot show a
  // removed or not-configured state the database does not hold.
  assert.equal(
    /setCallRailState|callIngestionEnabled: false|callIngestionEvents: \[\]/.test(ui),
    false,
    "the card must not write the post-disable state locally",
  );
});

test("the disable confirmation states the in-flight call race honestly", () => {
  const ui = ingestionUi();
  const confirm = /"Turn off call ingestion\?[\s\S]*?",\n/.exec(ui);
  assert.ok(confirm, "the disable confirmation exists");
  const text = confirm[0];
  // A call already past the recheck will finish, and the dialog says so.
  assert.match(text, /already being processed/i);
  assert.match(text, /may still finish/i);
  assert.match(text, /rechecked immediately before/i);
  assert.match(text, /narrows that window but does not cancel/i);
  // Cancellation must not be claimed while the race is only narrowed.
  assert.equal(
    /\bcancels\b|\bcancelled\b|\baborts\b|will not create|nothing further/i.test(text),
    false,
    "the dialog must not promise a cancellation nothing implements",
  );

  // And the claim about the recheck has to keep matching the code, or this
  // sentence quietly becomes false.
  const fn = block(ingestionSource, "export async function ingestFetchedCall");
  assert.ok(fn);
  const guardAt = fn.indexOf("if (!state.enabled");
  assert.ok(fn.indexOf("await ingestionState(") < guardAt);
  for (const write of ["saveCallSnapshot(", "ensureContact(", "ensureLead("]) {
    const at = fn.indexOf(write);
    assert.ok(at > -1, `${write} is in this function`);
    assert.ok(guardAt < at, `the recheck precedes ${write}`);
  }
});


// ------------------------------------- recovering a cleanup that did not land

test("a stranded cleanup is offered as a retry, never as Enable", () => {
  const ui = ingestionSection();
  // The three buttons are mutually exclusive branches of one expression, so
  // the cleanup state cannot also be showing Enable.
  assert.match(
    ui,
    /\{callRailIngesting \? \([\s\S]*?\) : callRailCleanupPending \? \([\s\S]*?\) : \([\s\S]*?\)\}/,
    "cleanup-pending is its own branch, ahead of the enable branch",
  );
  const cleanupBranch = ui.slice(
    ui.indexOf(") : callRailCleanupPending ? ("),
    ui.indexOf(") : ("),
  );
  assert.ok(cleanupBranch.length > 0);
  assert.match(cleanupBranch, /"Retry cleanup"/);
  assert.equal(
    /Enable ingestion|enable_callrail_ingestion/.test(cleanupBranch),
    false,
    "the stranded state must not offer to switch ingestion back on",
  );

  // It is named on the card, not left to be inferred from a blank.
  assert.match(ui, /"Webhook cleanup needed"/);
  // And the note says the two things the operator most needs to know.
  assert.match(ui, /Retry the cleanup to withdraw them/);
  assert.match(
    ui,
    /Nothing needs re-enabling, and the CallRail connection does not need disconnecting/,
  );
});

test("retry cleanup is the same idempotent action, with ingestion already off", () => {
  const handler = ingestionHandler();
  assert.ok(handler, "disable and retry share one handler");
  // One request, one action name, for both buttons.
  assert.match(handler, /action: "disable_callrail_ingestion"/);
  assert.equal(
    handler.split("disable_callrail_ingestion").length - 1,
    1,
    "retry does not get its own action to drift from",
  );
  assert.equal(
    /enable_callrail_ingestion/.test(handler),
    false,
    "recovering a cleanup never re-enables ingestion",
  );

  // The action rewrites ingest_enabled=false unconditionally, so calling it
  // when it is already false is meaningful work rather than a no-op refusal.
  const disable = block(crmSource, 'if (action === "disable_callrail_ingestion")');
  const code = codeOnly(disable);
  assert.match(code, /\.update\(\{ ingest_enabled: false, updated_at: now \}\)/);
  assert.equal(
    /ingest_enabled", true\)|if \(!?\w*[Ii]ngest_?[Ee]nabled\)/.test(code),
    false,
    "the action must not refuse to run because ingestion is already off",
  );

  // A retry that fails again leaves the state it started in, so the same
  // button is still there.
  assert.match(code, /catch \{\s*cleanupOk = false;\s*\}/);
  assert.match(code, /\.\.\.callRailIngestionFlags\(cleanupOk\)/);
});

test("the local disable proves it changed exactly one row", () => {
  const disable = block(crmSource, 'if (action === "disable_callrail_ingestion")');
  const code = codeOnly(disable);
  // The update asks for the rows back, and the count is checked.
  assert.match(
    code,
    /\.eq\("client_id", clientId\)\s*\n\s*\.select\("client_id"\),/,
  );
  assert.match(code, /if \(!isSingleAffectedRow\(disabled\)\) \{\s*\n\s*throw new Error\(/);

  // A zero-row update must stop the action before CallRail is touched and
  // before anything is reported as done.
  const guardAt = code.indexOf("isSingleAffectedRow(disabled)");
  assert.ok(guardAt > -1);
  for (const later of [
    "removeCallRailWebhooksForClient",
    'from("provider_connections")',
    "await audit(",
    "return { enabled: false",
  ]) {
    const at = code.indexOf(later);
    assert.ok(at > -1, `${later} is in this action`);
    assert.ok(guardAt < at, `the row count is proven before ${later}`);
  }

  // And the count itself refuses zero and refuses two.
  const single = block(stateSource, "export function isSingleAffectedRow");
  assert.ok(single, "the shared row check exists");
  assert.match(single, /Array\.isArray\(rows\) && rows\.length === 1/);
});

test("the stranded-cleanup state survives a reload because the server holds it", () => {
  // Written on the way out...
  const disable = block(crmSource, 'if (action === "disable_callrail_ingestion")');
  assert.match(codeOnly(disable), /\.\.\.callRailIngestionFlags\(cleanupOk\)/);

  // ...recomputed by the health check from the credential row, so a reload or
  // a Check connection agrees with what the disable wrote.
  const check = block(crmSource, 'if (action === "check_callrail_connection")');
  assert.ok(check);
  assert.match(check, /webhook_path_id &&\s*\n?\s*ingestionState\?\.webhook_integration_id/);
  const config = block(crmSource, "function callRailPublicConfig");
  assert.ok(config);
  assert.match(
    config,
    /callIngestionCleanupPending:\s*\n?\s*ingestion\.enabled !== true && ingestion\.configured === true/,
  );

  // ...and read back into the shape the card consumes.
  const mapped = block(crmSource, "function mapProviderConnection");
  assert.ok(mapped);
  assert.match(
    mapped,
    /callIngestionCleanupPending:\s*\n\s*typeof publicConfig\.callIngestionCleanupPending === "boolean"/,
  );
  assert.match(read("db/crm.ts"), /callIngestionCleanupPending: boolean \| null;/);

  // The only thing that clears it is a confirmed cleanup: the integration id
  // is nulled in the same statement as the signing key, and the health check
  // reads configured from that id.
  assert.match(
    codeOnly(disable),
    /if \(cleanupOk\) \{[\s\S]*webhook_integration_id: null/,
  );
});


// ----------------------------- refusals say which refusal, and store no body

test("each way a delivery can be refused is recorded as its own outcome", () => {
  const receiver = block(ingestionSource, "async function receiveCallRailWebhook");
  assert.ok(receiver);

  // An unparseable body, a body with no call id, and a body naming somebody
  // else's company are three different events, and the row says which.
  const unparseableAt = receiver.indexOf('outcome: "rejected_unparseable"');
  const missingIdAt = receiver.indexOf('outcome: "rejected_missing_call_id"');
  const mismatchAt = receiver.indexOf('outcome: "rejected_company_mismatch"');
  for (const [name, at] of [
    ["rejected_unparseable", unparseableAt],
    ["rejected_missing_call_id", missingIdAt],
    ["rejected_company_mismatch", mismatchAt],
  ]) {
    assert.ok(at > -1, `${name} is emitted`);
  }
  // In that order: parse, then read, then compare.
  assert.ok(unparseableAt < missingIdAt, "parsing is refused first");
  assert.ok(missingIdAt < mismatchAt, "the id is required before the company");

  // The collapsed outcome is gone from the code, though the type keeps it so
  // rows written before the split still read back.
  assert.equal(
    /outcome: "rejected_payload"/.test(receiver),
    false,
    "nothing emits the collapsed outcome any more",
  );
  assert.match(ingestionSource, /\| "rejected_payload"/);

  // Every refusal creates no CRM data.
  const refusals = receiver.slice(receiver.indexOf('outcome: "rejected_unparseable"'));
  assert.equal(
    /from\("contacts"\)|from\("leads"\)|from\("callrail_calls"\)/.test(
      refusals.slice(0, refusals.indexOf('outcome: "accepted"') + 1),
    ),
    false,
    "a refused delivery writes nothing but its own row",
  );
});

test("a missing company id is not a refusal", () => {
  const receiver = block(ingestionSource, "async function receiveCallRailWebhook");
  // The comparison is guarded on the body having stated one at all.
  assert.match(
    receiver,
    /if \(envelope\.companyId && envelope\.companyId !== verifier\.companyId\)/,
  );
  // The old form refused whenever either side was absent.
  assert.equal(
    /!verifier\.companyId \|\| envelope\.companyId !== verifier\.companyId/.test(receiver),
    false,
    "absence must not be treated as mismatch",
  );

  // And the strict check still happens where the data is authoritative: on
  // the call refetched from the API, which does request company_id.
  const ingest = block(ingestionSource, "export async function ingestFetchedCall");
  assert.match(
    ingest,
    /if \(!call\.companyId \|\| call\.companyId !== state\.companyId\) \{\s*\n\s*throw new Error\(/,
  );
  assert.match(providerSource, /"company_id",/);
  const fields = section(providerSource, "const CALLRAIL_CALL_FIELDS = [", "];");
  assert.match(fields, /"company_id"/);
});

test("the raw webhook body is never stored, only its digest", () => {
  const record = block(ingestionSource, "async function recordDelivery");
  assert.ok(record);
  assert.match(record, /body_sha256: input\.bodySha256/);
  // No column takes the body, the decoded text, or the parsed object.
  for (const forbidden of ["rawBytes", "body:", "payload", "raw_body", "body_text"]) {
    assert.equal(
      record.includes(forbidden),
      false,
      `${forbidden} must not reach the delivery row`,
    );
  }
  // recordDelivery is only ever handed a digest, never the bytes.
  assert.equal(
    /bodySha256: [^,\n]*(rawBytes|body)\b/.test(ingestionSource),
    false,
    "the digest is computed before it is passed, never the body itself",
  );
  const columns = section(
    ingestionMigrationSource,
    "create table if not exists public.callrail_webhook_deliveries",
    ");",
  );
  assert.ok(columns);
  assert.match(columns, /body_sha256 text not null/);
  assert.equal(
    /\bbody text|payload jsonb|raw_body/.test(columns),
    false,
    "the table has nowhere to put a raw body",
  );
});

test("the delivery outcome constraint admits exactly the new vocabulary", () => {
  assert.match(
    outcomeMigrationSource,
    /drop constraint if exists callrail_webhook_deliveries_outcome_check/,
  );
  const check = section(
    outcomeMigrationSource,
    "add constraint callrail_webhook_deliveries_outcome_check",
    ";",
  );
  assert.ok(check);
  for (const outcome of [
    "accepted",
    "duplicate",
    "rejected_signature",
    "rejected_payload",
    "rejected_unparseable",
    "rejected_missing_call_id",
    "rejected_company_mismatch",
    "rejected_unknown_client",
    "rejected_ingest_disabled",
    "failed",
  ]) {
    assert.ok(check.includes(`'${outcome}'`), `${outcome} is admitted`);
  }
  // The type and the constraint have to agree, or a write throws at runtime.
  const type = section(
    ingestionSource,
    "type CallRailDeliveryOutcome =",
    "type CallRailDeliveryReceipt",
  );
  for (const outcome of check.match(/'([a-z_]+)'/g) ?? []) {
    const bare = outcome.replaceAll("'", "");
    assert.ok(type.includes(`"${bare}"`), `${bare} exists in the type too`);
  }
});


// --------------------------------------- recovering calls the webhooks missed

test("the schedule that drives reconciliation actually exists", () => {
  // The scheduled handler was unreachable for as long as no trigger existed:
  // callrail_sync_runs stayed empty because nothing ever called it.
  assert.match(viteConfigSource, /triggers: \{ crons: \["\*\/15 \* \* \* \*"\] \}/);
  assert.match(workerSource, /async scheduled\(/);
  const scheduled = section(workerSource, "async scheduled(", "\n};");
  assert.ok(scheduled);
  assert.match(scheduled, /ctx\.waitUntil\(\s*\n?\s*reconcileCallRailIngestion\(\)/);
  // The schedule runs unscoped, across every enabled connection.
  assert.equal(
    /reconcileCallRailIngestion\(\{/.test(scheduled),
    false,
    "the scheduled pass takes no scope",
  );
});

test("a person-triggered recovery cannot reach another client", () => {
  const recover = block(crmSource, 'if (action === "recover_callrail_calls")');
  assert.ok(recover, "the action exists");
  const code = codeOnly(recover);
  assert.match(code, /requirePermission\(context, "call_tracking\.manage"\)/);
  assert.match(code, /await requireClient\(context, clientId\)/);

  // Scoped to the client just authorized. call_tracking.manage is held per
  // client, so an unscoped pass would let one client's owner start work
  // against every other client in the organization.
  assert.match(
    code,
    /scope: \{ organizationId: context\.organizationId, clientId \}/,
  );
  assert.match(code, /await audit\(/);
  assert.match(code, /"provider\.ingestion_recovered"/);

  // And the reconciler refuses a half-scope rather than widening it.
  const reconcile = block(ingestionSource, "export async function reconcileCallRailIngestion");
  assert.ok(reconcile);
  assert.match(
    reconcile,
    /if \(options\.scope && !\(options\.scope\.organizationId && options\.scope\.clientId\)\)/,
  );
  assert.match(reconcile, /throw new Error\(/);
  const connections = block(ingestionSource, "async function enabledConnections");
  assert.match(connections, /\.eq\("organization_id", scope\.organizationId\)/);
  assert.match(connections, /\.eq\("client_id", scope\.clientId\)/);
  assert.match(connections, /\.eq\("ingest_enabled", true\)/);
});

test("the recovery window is a bounded whole number of days", () => {
  const code = codeOnly(block(crmSource, 'if (action === "recover_callrail_calls")'));
  assert.match(code, /Number\.isInteger\(lookbackDays\)/);
  assert.match(code, /lookbackDays < 1/);
  assert.match(code, /lookbackDays > MAX_CALLRAIL_RECOVERY_DAYS/);
  assert.match(code, /throw new Error\(/);
  assert.match(crmSource, /const MAX_CALLRAIL_RECOVERY_DAYS = 30;/);
  // Truncating 2.5 into 2 would silently run a window nobody asked for.
  assert.equal(
    /Math\.(floor|round|trunc)\(\s*lookbackDays/.test(code),
    false,
    "a fractional window is refused, never rounded into a real one",
  );
});

test("two reconciliations cannot run over the same connection at once", () => {
  // The slot is the run row: only one can be 'running' per connection.
  assert.match(
    syncClaimMigrationSource,
    /create unique index if not exists callrail_sync_runs_active_uidx\s*\n\s*on public\.callrail_sync_runs \(organization_id, client_id\)\s*\n\s*where status = 'running'/,
  );
  const fn = section(
    syncClaimMigrationSource,
    "create or replace function public.claim_callrail_sync_run",
    "revoke all on function",
  );
  assert.ok(fn, "the claim function exists");
  assert.match(fn, /on conflict do nothing/);
  assert.match(fn, /returning id into v_run_id/);
  // A crashed run must not hold the slot forever, and is recorded rather
  // than deleted.
  assert.match(fn, /started_at < pg_catalog\.now\(\) - p_stale_after/);
  assert.match(fn, /set status = 'failed',\s*\n\s*error = 'abandoned'/);
  // Definer, with no writable schema on its path.
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = ''/);
  assert.equal(/set search_path = public/.test(fn), false);
  assert.match(fn, /raise exception 'claim_callrail_sync_run requires an organization and a client'/);
  assert.match(
    syncClaimMigrationSource,
    /revoke all on function public\.claim_callrail_sync_run[\s\S]*from public, anon, authenticated/,
  );

  // A connection whose slot is taken is skipped, not run anyway.
  const reconcile = block(ingestionSource, "export async function reconcileCallRailIngestion");
  assert.match(reconcile, /const runId = await claimSyncRun\(/);
  assert.match(reconcile, /if \(!runId\) \{\s*\n\s*summary\.skipped \+= 1;\s*\n\s*continue;\s*\n\s*\}/);
  const claim = block(ingestionSource, "async function claimSyncRun");
  assert.match(claim, /db\(\)\.rpc\("claim_callrail_sync_run"/);
  assert.match(claim, /return runId \? String\(runId\) : null;/);
});

test("recovering the same call twice changes nothing the second time", () => {
  // Reconciliation re-walks a window, so it will meet calls it has already
  // ingested. Idempotency is what makes that safe to run every 15 minutes.
  const ingest = block(ingestionSource, "export async function ingestFetchedCall");
  assert.ok(ingest);
  assert.match(ingest, /const claim = await claimCall\(String\(snapshot\.id\)\)/);
  // Losing the claim ends the pass for that call. Without this, two
  // reconciliations meeting the same call would both go on to write.
  assert.match(
    ingest,
    /if \(!claim\) return \{ status: "busy", leadCreated: false, repaired: false \};/,
  );
  const afterClaim = ingest.slice(ingest.indexOf("const claim = await claimCall"));
  assert.ok(
    afterClaim.indexOf("if (!claim) return") <
      Math.min(
        ...["ensureContact(", "ensureLead("]
          .map((needle) => afterClaim.indexOf(needle))
          .filter((at) => at > -1),
      ),
    "the claim is checked before any CRM write",
  );

  // The snapshot is keyed on CallRail's own call id, so a second pass updates
  // one row rather than adding another.
  const callsTable = section(
    ingestionMigrationSource,
    "create table if not exists public.callrail_calls",
    ");",
  );
  assert.ok(callsTable);
  assert.match(
    callsTable,
    /unique \(organization_id, client_id, callrail_call_id\)/,
  );
  const claimFn = section(
    syncClaimMigrationSource,
    "create or replace function public.claim_callrail_call_for_ingestion",
    "revoke all on function public.claim_callrail_call_for_ingestion",
  );
  assert.ok(claimFn);
  // A conditional update, so exactly one caller can take a call: the second
  // one's statement matches no row and it backs off as busy rather than
  // ingesting the same call alongside the first.
  assert.match(claimFn, /set ingest_status = 'enriching'/);
  assert.match(claimFn, /call\.ingest_status <> 'enriching'\s*\n\s*or call\.updated_at < p_stale_before/);
  assert.match(claimFn, /returning call\.id, call\.contact_id, call\.lead_id/);

  // And the window sweep does not redo what it just did in the same pass.
  const reconcile = block(ingestionSource, "export async function reconcileCallRailIngestion");
  assert.match(reconcile, /const seenIds = new Set\(discovered\.callIds\)/);
  assert.match(reconcile, /if \(seenIds\.has\(callId\)\) continue;/);
});

test("the recovery button reports what was found, not that it worked", () => {
  const ui = ingestionUi();
  const handler = block(connectionsUi, "const runCallRailRecovery = async (");
  assert.ok(handler, "the recovery handler exists");

  // Split the success patch into the expression behind each slot, so these
  // assertions are about where a result lands rather than whether a word
  // occurs somewhere in the handler.
  const success = handler.slice(handler.indexOf('ingestionPending: "",'));
  const errorAt = success.indexOf("ingestionError:");
  const noteAt = success.indexOf("ingestionNote:");
  assert.ok(errorAt > -1, "the success patch sets an error slot");
  assert.ok(noteAt > errorAt, "and a separate note slot after it");
  const errorExpr = success.slice(errorAt, noteAt);
  const noteExpr = success.slice(noteAt);

  // Finding nothing is the good outcome: it goes to the note, never the error.
  assert.match(noteExpr, /No missed calls in the last \$\{days\}/);
  assert.equal(
    /No missed calls/.test(errorExpr),
    false,
    "a clean result must not be rendered as a failure",
  );
  assert.match(connectionsUi, /className="crm-connection-note" role="status"/);

  // A skipped or partial pass is the error slot's business, and clears the
  // note so it cannot read as though the pass had completed.
  assert.match(errorExpr, /result\?\.skipped/);
  assert.match(errorExpr, /result\?\.failures/);
  assert.match(errorExpr, /some calls may still be missing/);
  assert.match(noteExpr, /result\?\.skipped \|\| result\?\.failures\s*\n?\s*\? ""/);

  // The toast says only that it looked, because at that point the counts have
  // not been read.
  assert.match(handler, /"Checked CallRail for missed calls\."/);
  assert.equal(
    /"Recovered [^"]*"\s*,\s*\n?\s*\)\)/.test(handler),
    false,
    "the toast must not claim a recovery before the counts are read",
  );

  // Offered only where it can do anything: reconciliation only looks at
  // connections whose ingestion is on.
  assert.match(
    ui,
    /\{callRailIngesting \? \([\s\S]*?"Recover missed calls"[\s\S]*?\) : null\}/,
  );
});


test("no definer function resolves a name through a writable schema", () => {
  // A SECURITY DEFINER function runs with the owner's rights, so anything it
  // resolves through a schema other roles can write to is a way in. Every one
  // of them is checked here rather than one at a time, which is how
  // claim_callrail_call_for_ingestion kept `search_path = public` while the
  // contact function next to it was hardened.
  const migrations = [
    ["20260825000000_callrail_ingestion.sql", ingestionMigrationSource],
    ["20260826010000_callrail_sync_run_claim.sql", syncClaimMigrationSource],
  ];
  const seen = [];
  for (const [name, source] of migrations) {
    for (const match of source.matchAll(
      /create or replace function (public\.\w+)[\s\S]*?\bas \$\$/g,
    )) {
      const header = match[0];
      if (!/security definer/.test(header)) continue;
      seen.push(match[1]);
      // The newest definition of each function wins, so a later migration
      // hardening an earlier one is what this must reflect.
      const latest = migrations
        .map(([, s]) => s)
        .join("\n")
        .lastIndexOf(`create or replace function ${match[1]}`);
      const current = migrations
        .map(([, s]) => s)
        .join("\n")
        .slice(latest);
      const head = current.slice(0, current.indexOf("as $$"));
      assert.match(
        head,
        /set search_path = ''/,
        `${match[1]} (${name}) must not resolve through a writable schema`,
      );
    }
  }
  assert.ok(seen.length >= 3, `expected several definer functions, saw ${seen}`);
});


// ------------------------------- the request CallRail actually documents

test("only field names CallRail documents as selectable are requested", () => {
  const fields = section(providerSource, "const CALLRAIL_CALL_FIELDS = [", "] as const;");
  assert.ok(fields, "the field list exists");
  const requested = [...fields.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(requested.length > 20, `expected a real list, saw ${requested.length}`);

  // CallRail validates `fields`, so one name it does not recognise takes the
  // whole request down with a 400. These two were asked for and are not in
  // the documented "Additional User Requested Response Fields" list.
  for (const undocumented of ["utm_content", "utm_medium"]) {
    assert.equal(
      requested.includes(undocumented),
      false,
      `${undocumented} is not documented as selectable and must not be requested`,
    );
  }

  // Everything the rest of the system depends on is documented, and stays.
  for (const needed of [
    "fbclid",
    "session_uuid",
    "gclid",
    "company_id",
    "transcription",
    "conversational_transcript",
    "call_summary",
    "lead_status",
    "tags",
    "prior_calls",
    "medium",
    "utm_campaign",
    "landing_page_url",
    "keywords",
  ]) {
    assert.ok(requested.includes(needed), `${needed} must still be requested`);
  }

  // Meta eligibility reads two of these off the refetched call, so losing
  // either would silently change what qualifies.
  const decide = block(read("lib/meta-eligibility.ts"), "export function decideCallRailMetaEligibility");
  assert.ok(decide);
  assert.match(decide, /fbclid/);
  assert.match(decide, /sessionUuid/);
});

test("the call window is sent in a shape CallRail documents", () => {
  const format = block(providerSource, "export function callRailDateParam");
  assert.ok(format, "the formatter exists");
  // A plain calendar date. A full timestamp with milliseconds and a zone
  // suffix is neither documented shape, and was rejected with a 400.
  assert.match(format, /toISOString\(\)\.slice\(0, 10\)/);
  assert.match(format, /Number\.isNaN\(instant\.getTime\(\)\)/);

  const reconcile = block(ingestionSource, "export async function reconcileCallRailIngestion");
  assert.match(reconcile, /startDate: callRailDateParam\(windowStart\)/);
  assert.match(reconcile, /endDate: callRailDateParam\(windowEnd\)/);
  assert.equal(
    /startDate: windowStart\.toISOString\(\)/.test(reconcile),
    false,
    "the raw instant must not be sent as a date filter",
  );
});

test("the request diagnostic carries an endpoint label and a number, nothing else", () => {
  const request = block(providerSource, "async function callRailUrlRequest");
  assert.ok(request);
  const logs = [...request.matchAll(/console\.\w+\([\s\S]*?\);/g)].map((m) => m[0]);
  assert.equal(logs.length, 1, "exactly one diagnostic");
  const log = logs[0];

  // Two facts, both safe: which endpoint, and the number CallRail answered.
  assert.match(log, /endpoint,/);
  assert.match(log, /httpStatus: response\.status/);

  // Nothing that identifies anyone or echoes the exchange.
  for (const forbidden of [
    "apiKey",
    "token",
    "Authorization",
    "url",
    "searchParams",
    "responseBody",
    "body",
    "accountId",
    "companyId",
    "callId",
    "organizationId",
    "clientId",
    "headers",
  ]) {
    assert.equal(
      log.includes(forbidden),
      false,
      `${forbidden} must never reach a diagnostic`,
    );
  }
  // And the response is never read before the throw, so no body can leak.
  const beforeThrow = request.slice(0, request.indexOf("console.error"));
  assert.equal(
    /await response\.(json|text)\(\)/.test(beforeThrow),
    false,
    "the body is not read on the failure path",
  );
});

test("an endpoint label is a fixed name, never a path", () => {
  // A real path carries the account id, which is exactly what these logs
  // must not contain. The label set is closed, so a call site cannot invent
  // one that interpolates something.
  const labels = section(providerSource, "type CallRailEndpoint =", ";");
  assert.ok(labels);
  const allowed = [...labels.matchAll(/"([a-z.]+)"/g)].map((m) => m[1]);
  assert.ok(allowed.includes("calls.list"), "the failing endpoint is nameable");
  assert.ok(allowed.length >= 5, `expected a real label set, saw ${allowed}`);
  for (const label of allowed) {
    assert.equal(/\/|\$\{/.test(label), false, `${label} must not look like a path`);
  }

  // Every request the CallRail client makes says which endpoint it is.
  const sites = [...providerSource.matchAll(/await callRail(?:Url)?Request\(/g)];
  assert.ok(sites.length >= 9, `expected every call site, saw ${sites.length}`);
  for (const label of ["accounts.list", "accounts.get", "companies.list", "companies.get", "calls.list", "calls.get"]) {
    assert.ok(
      providerSource.includes(`"${label}",`),
      `${label} is used at its call site`,
    );
  }
});


// ------------------------------- the list names calls; it never describes them

test("the calls list is a discovery request and nothing more", () => {
  const list = block(providerSource, "export async function listCallRailCallIds");
  assert.ok(list, "the discovery request exists");
  const code = codeOnly(list);

  // Exactly the documented default: who, when, and which page.
  for (const param of ["company_id:", "start_date:", "end_date:", "page:", "per_page:"]) {
    assert.ok(code.includes(param), `${param} is sent`);
  }

  // And none of the four that were answered with a 400. Each changed only
  // ordering or packaging, never which calls came back, so losing them costs
  // nothing — and `fields` in particular belongs on the refetch.
  for (const banned of ["sort:", "order:", "relative_pagination", "fields:"]) {
    assert.equal(
      code.includes(banned),
      false,
      `${banned} must not be sent to the list endpoint`,
    );
  }
  assert.equal(
    /CALLRAIL_CALL_FIELDS/.test(code),
    false,
    "the field list belongs to the single-call refetch",
  );
});

test("only the id is read out of a list row", () => {
  const list = block(providerSource, "export async function listCallRailCallIds");
  // One value taken, and it is the id.
  assert.match(list, /\(row\) => asText\(\(row as Record<string, unknown>\)\.id\)/);
  // No row is ever turned into a call record here. mapCall builds those, and
  // it is reachable from the single-call refetch alone.
  assert.equal(/mapCall\(/.test(list), false, "a list row is not mapped to a call");
  // The declaration aside, mapCall is invoked in exactly one place.
  const mapUses = [...providerSource.matchAll(/(?<!function )mapCall\(/g)];
  assert.equal(mapUses.length, 1, "mapCall has exactly one caller");
  const getCall = block(providerSource, "export async function getCallRailCall");
  assert.match(getCall, /const call = mapCall\(body\)/);
  assert.match(getCall, /fields: CALLRAIL_CALL_FIELDS\.join\(","\)/);

  // The returned shape is ids, not records, so nothing downstream can mistake
  // a discovery result for a call.
  const shape = section(providerSource, "export type CallRailCallIdPage = {", "};");
  assert.ok(shape);
  assert.match(shape, /callIds: string\[\]/);
  assert.equal(/CallRailCall\b/.test(shape), false, "no call objects escape discovery");
});

test("every discovered call is refetched before anything is written", () => {
  const reconcile = block(ingestionSource, "export async function reconcileCallRailIngestion");
  assert.ok(reconcile);

  // The window sweep iterates ids and refetches each one. Passing a list row
  // to ingestFetchedCall is what would make the list a source of truth.
  assert.match(reconcile, /for \(const callId of discovered\.callIds\)/);
  assert.match(
    reconcile,
    /await ingestCallRailCall\(\s*\n\s*organizationId,\s*\n\s*clientId,\s*\n\s*callId,/,
  );
  assert.equal(
    /ingestFetchedCall\(/.test(reconcile),
    false,
    "reconciliation must not ingest a list row directly",
  );

  // And the refetch is the one that asks for the full documented field list.
  const refetch = block(ingestionSource, "export async function ingestCallRailCall");
  assert.match(refetch, /await getCallRailCall\(access\.accountId, callId, access\.apiKey\)/);
  assert.match(refetch, /return ingestFetchedCall\(/);
});

test("a partly-read window is recorded as partial, never as complete", () => {
  const reconcile = block(ingestionSource, "export async function reconcileCallRailIngestion");
  assert.match(reconcile, /status: discovered\.truncated \? "partial" : "ok"/);
  assert.match(reconcile, /calls_seen: discovered\.callIds\.length/);
  // The walk is what decides that, and it only says so when it stopped early.
  const walk = read("lib/callrail-pagination.ts");
  assert.match(walk, /return \{ ids, pagesRead: maxPages, truncated: true \};/);
  assert.match(walk, /return \{ ids, pagesRead: pageNumber, truncated: false \};/);
});


// ------------------------------------------------ calls on leads and contacts

test("a recording is served only to someone entitled to that client's calls", () => {
  const loader = block(crmSource, "export async function getSupabaseCallRailRecording");
  assert.ok(loader, "the recording loader exists");
  const code = codeOnly(loader);

  // Who, then which client, then whether the call is theirs — in that order,
  // and all three before CallRail is contacted.
  const contextAt = code.indexOf("await getTenantContext(user)");
  const permissionAt = code.indexOf('requirePermission(context, "opportunities.write")');
  const clientAt = code.indexOf("await requireClient(context, clientId)");
  const lookupAt = code.indexOf('.from("callrail_calls")');
  const fetchAt = code.indexOf("getCallRailRecording(");
  for (const [name, at] of [
    ["tenant context", contextAt],
    ["permission", permissionAt],
    ["client check", clientAt],
    ["call lookup", lookupAt],
    ["provider fetch", fetchAt],
  ]) {
    assert.ok(at > -1, `${name} happens`);
  }
  assert.ok(contextAt < permissionAt, "the caller is identified first");
  assert.ok(permissionAt < clientAt, "then the permission");
  assert.ok(clientAt < lookupAt, "then the client");
  assert.ok(lookupAt < fetchAt, "and CallRail is contacted last");

  // The row is found inside the tenant, not found and then checked.
  assert.match(code, /\.eq\("organization_id", context\.organizationId\)/);
  assert.match(code, /\.eq\("client_id", clientId\)/);
  assert.match(code, /\.eq\("callrail_call_id", callId\)/);
  // A call belonging to another client is indistinguishable from one that
  // never existed. Saying "forbidden" would confirm it exists.
  assert.match(code, /if \(!row\) throw new Error\("Not found"\)/);
});

test("the recording route refuses before it reaches the loader", () => {
  const code = codeOnly(recordingRoute);
  const authAt = code.indexOf("await getChatGPTUser()");
  const loadAt = code.indexOf("getSupabaseCallRailRecording(");
  assert.ok(authAt > -1 && loadAt > authAt, "unauthenticated stops first");
  assert.match(code, /if \(!user\) return refuse\(401, "Unauthorized"\)/);
  assert.match(code, /if \(message === "Forbidden"\) return refuse\(403, message\)/);
  assert.match(code, /if \(message === "Not found"\) return refuse\(404, "Recording unavailable"\)/);

  // Nothing about the exchange is cached where another request could meet it.
  assert.match(code, /"Cache-Control": "private, no-store, max-age=0"/);
  // And nothing from CallRail's own response is passed through except the
  // headers a player needs.
  assert.equal(
    /Set-Cookie|Authorization|apiKey|Token /.test(code),
    false,
    "no credential or provider header is forwarded",
  );
});

test("seeking works, because the range is passed through both ways", () => {
  const code = codeOnly(recordingRoute);
  assert.match(code, /request\.headers\.get\("Range"\)/);
  assert.match(code, /headers\.set\("Accept-Ranges", "bytes"\)/);
  assert.match(code, /for \(const header of \["Content-Length", "Content-Range"\]\)/);
  assert.match(code, /status: recording\.status === 206 \? 206 : 200/);

  // The provider client forwards it upstream rather than fetching the whole
  // file and slicing it here.
  const stream = block(providerSource, "export async function getCallRailRecording");
  assert.ok(stream, "the streamer exists");
  // The range travels on the media fetch, and 206 is a success there.
  assert.match(stream, /callRailMediaRequestHeaders\(\{ range \}\)/);
  const headers = block(read("lib/callrail-media.ts"), "export function callRailMediaRequestHeaders");
  assert.match(headers, /headers\.Range = input\.range/);
  const decide = block(read("lib/callrail-media.ts"), "export function decideCallRailMediaResponse");
  assert.match(decide, /status !== 200 && status !== 206/);
  // The body is handed back untouched: never buffered, never stored.
  assert.match(code, /new Response\(recording\.body,/);
  assert.equal(
    /await .*\.(arrayBuffer|blob|text)\(\)/.test(stream + code),
    false,
    "the audio is streamed, not read into memory",
  );
});

test("the browser is never given a CallRail URL, and none is stored", () => {
  // The player points at this server.
  assert.match(callsUi, /src=\{`\/api\/callrail\/recordings\/\$\{encodeURIComponent\(/);
  assert.equal(
    /callrail\.com/.test(callsUi),
    false,
    "no provider host appears in anything sent to a browser",
  );

  // Ingestion still writes no URL, and the column says so.
  const mapCall = block(providerSource, "function mapCall(row:");
  assert.match(mapCall, /recordingUrl: null,/);
  assert.match(mapCall, /recordingAvailable: asText\(row\.recording\) !== ""/);
  assert.match(mediaMigrationSource, /recording_available boolean not null default false/);
  assert.match(mediaMigrationSource, /comment on column public\.callrail_calls\.recording_url is/);
  assert.match(mediaMigrationSource, /Always null/);

  // The streamer refuses to fetch a URL that is not CallRail's.
  const stream = block(providerSource, "export async function getCallRailRecording");
  assert.match(stream, /allowedCallRailMediaUrl\(location\)/);
  const allow = block(read("lib/callrail-media.ts"), "export function allowedCallRailMediaUrl");
  assert.match(allow, /url\.protocol !== "https:"/);
  assert.match(allow, /!isCallRailApiHost\(url\.hostname\) && !isCallRailMediaHost\(url\.hostname\)/);
});

test("a call with no recording says so instead of offering a player", () => {
  // The server does not spend a request finding out what it already knows.
  const loader = block(crmSource, "export async function getSupabaseCallRailRecording");
  assert.match(loader, /if \(row\.recording_available !== true\) return null;/);
  // The route turns that into an ordinary answer, not a failure.
  assert.match(recordingRoute, /if \(!recording\) return refuse\(404, "Recording unavailable"\)/);
  // And the interface says it in words rather than showing a dead player.
  const player = section(callsUi, "function RecordingPlayer(", "function CallRow(");
  assert.ok(player);
  assert.match(player, /if \(!call\.recordingAvailable \|\| failed\)/);
  assert.match(player, /Recording unavailable/);
  // A player that fails at runtime falls back to the same message.
  assert.match(player, /onError=\{\(\) => setFailed\(true\)\}/);
});

test("the transcript is shown in full, and only when asked for", () => {
  const row = section(callsUi, "function CallRow(", "export function CallsSection(");
  assert.ok(row);
  // Collapsed by default, with the control saying which way it goes.
  assert.match(row, /const \[openTranscript, setOpenTranscript\] = useState\(false\)/);
  assert.match(row, /aria-expanded=\{openTranscript\}/);
  assert.match(row, /openTranscript \? "Hide transcript" : "Show full transcript"/);
  // Rendered as text, never as markup: a transcript is somebody's words.
  assert.match(row, /\{openTranscript \? <pre>\{call\.transcript\}<\/pre> : null\}/);
  assert.equal(
    /dangerouslySetInnerHTML/.test(callsUi),
    false,
    "nothing from a call is rendered as HTML",
  );
  // No transcript is stated rather than left blank.
  assert.match(row, /No transcript for this call\./);

  // Every field the section is meant to show is there.
  for (const shown of [
    "when(call.startedAt)",
    "call.direction",
    "duration(call.durationSeconds)",
    "phone(call.trackingPhoneNumber)",
    "call.source",
    "call.classification",
    "call.callSummary",
  ]) {
    assert.ok(row.includes(shown), `${shown} is rendered`);
  }
  assert.match(row, /answered \? "Answered" : missed \? "Missed" : "Unknown"/);
});

test("calls reach the interface only through the tenant-scoped query", () => {
  // `query` pins the organization and applies the caller's client scope, so a
  // call cannot be loaded outside it.
  const helper = section(crmSource, "const query = <T>(table: string", "const [");
  assert.ok(helper);
  assert.match(helper, /\.eq\("organization_id", context\.organizationId\)/);
  assert.match(helper, /applyClientScope\(context, builder\)/);
  assert.match(crmSource, /query<AnyRecord>\(\s*\n?\s*"callrail_calls",/);

  // Nothing sensitive is selected into the browser payload.
  const select = section(crmSource, '"callrail_calls",', ")\n        .order(");
  assert.ok(select);
  for (const forbidden of ["fbclid", "gclid", "session_uuid", "recording_url", "msclkid"]) {
    assert.equal(
      select.includes(forbidden),
      false,
      `${forbidden} must not be sent to a browser`,
    );
  }
  assert.ok(select.includes("transcript"), "the transcript is shown, and is not a click id");
});

test("a lead shows its own calls; a contact shows all of theirs", () => {
  // One person can ring about several jobs. The lead filters to itself, and
  // the contact record is where the whole history lives.
  assert.match(leadsUi, /const leadCalls = calls\.filter\(\(call\) => call\.leadId === lead\.id\)/);
  assert.match(leadsUi, /\{leadCalls\.map\(\(call, index\) => \(/);
  assert.match(leadsUi, /<LeadTranscriptCard\s*\n\s*key=\{call\.id\}\s*\n\s*call=\{call\}\s*\n\s*lead=\{lead\}/);
  assert.match(contactsUi, /calls\.filter\(\(call\) => call\.contactId === contactId\)/);
  assert.match(contactsUi, /<CallsSection calls=\{contactCalls\}/);

  // Both hand the section the client the record belongs to, which is what the
  // recording route checks against.
  assert.match(leadsUi, /call\.callrailCallId,[\s\S]*lead\.clientId/);
  assert.match(contactsUi, /clientId=\{contact\.clientId\}/);
});

test("every call stays its own record, whichever lead it joins", () => {
  const ingest = block(ingestionSource, "export async function ingestFetchedCall");
  // The snapshot is written before any lead decision is made, so reuse never
  // decides whether a call is recorded — only which lead it points at.
  const snapshotAt = ingest.indexOf("await saveCallSnapshot(");
  const leadAt = ingest.indexOf("await ensureLead(");
  assert.ok(snapshotAt > -1 && leadAt > snapshotAt, "the call is saved first");
  assert.match(ingest, /lead_id: lead\.leadId/);

  // And a second call cannot overwrite the first: the row is keyed on
  // CallRail's own call id.
  const callsTable = section(
    ingestionMigrationSource,
    "create table if not exists public.callrail_calls",
    ");",
  );
  assert.match(callsTable, /unique \(organization_id, client_id, callrail_call_id\)/);
});

test("reusing a lead rewrites nothing about where it came from", () => {
  const ensure = block(ingestionSource, "async function ensureLead");
  assert.ok(ensure);
  const reuse = codeOnly(
    ensure.slice(
      ensure.indexOf("if (decision.reuse"),
      ensure.indexOf("const decisionMeta"),
    ),
  );
  assert.ok(reuse.length > 0, "the reuse branch exists");

  // Touched so it reads as active, and nothing else.
  assert.match(reuse, /\.update\(\{ updated_at: new Date\(\)\.toISOString\(\) \}\)/);
  for (const immutable of [
    "attribution",
    "meta_eligible",
    "meta_eligibility_reason",
    "source:",
    "campaign:",
  ]) {
    assert.equal(
      reuse.includes(immutable),
      false,
      `${immutable} belongs to the call that opened the lead`,
    );
  }
  // The update is tenant-scoped like everything else.
  assert.match(reuse, /\.eq\("organization_id", organizationId\)/);
  assert.match(reuse, /\.eq\("client_id", clientId\)/);
});

test("a repeat caller is matched by canonical phone inside one tenant", () => {
  // The contact lookup is the same function as before, and still refuses a
  // number that is not canonical E.164 rather than matching loosely.
  const fn = section(
    ingestionMigrationSource,
    "create or replace function public.find_or_create_callrail_contact",
    "revoke all on function public.find_or_create_callrail_contact",
  );
  assert.ok(fn);
  assert.match(fn, /requires a canonical E\.164 phone number/);
  assert.match(fn, /\^\\\+\[1-9\]\[0-9\]\{7,14\}\$/);
  assert.match(fn, /where c\.organization_id = p_organization_id/);
  assert.match(fn, /and c\.client_id = p_client_id/);
  assert.match(fn, /and c\.phone = v_phone/);
  // The same number in two tenants is two contacts, and both are found
  // deterministically.
  assert.match(fn, /order by c\.created_at asc, c\.id asc/);

  // Ingestion normalizes before it asks.
  const ensureContact = block(ingestionSource, "async function ensureContact");
  assert.ok(ensureContact);
  assert.match(ensureContact, /find_or_create_callrail_contact/);
});


test("hearing a call needs the permission to work the lead, not to configure CallRail", () => {
  const loader = block(crmSource, "export async function getSupabaseCallRailRecording");
  const code = codeOnly(loader);

  // call_tracking.manage governs the connection — the API key, the webhooks.
  // Gating audio on it would refuse a manager or an employee a recording of a
  // call whose lead and contact they are already reading.
  assert.match(code, /requirePermission\(context, "opportunities\.write"\)/);
  assert.equal(
    /call_tracking\.manage/.test(code),
    false,
    "the connection permission must not gate listening",
  );

  // And the roles bear that out: every role that reaches the CRM can work
  // leads, while only some can configure call tracking.
  const roles = read("db/crm.ts");
  const table = section(roles, "const rolePermissions:", "};");
  assert.ok(table);
  for (const role of [
    "CLIENT_MANAGER",
    "CLIENT_EMPLOYEE",
  ]) {
    const line = table.split("\n").find((row) => row.startsWith(`  ${role}:`));
    assert.ok(line, `${role} is in the table`);
    assert.ok(
      line.includes('"opportunities.write"'),
      `${role} can work leads, so ${role} can hear their calls`,
    );
    assert.equal(
      line.includes('"call_tracking.manage"'),
      false,
      `${role} cannot configure CallRail — which is why it must not be the gate`,
    );
  }
  const teamMember = section(roles, "const lbTeamMemberPermissions:", ";");
  assert.ok(teamMember.includes('"opportunities.write"'));
  assert.equal(teamMember.includes('"call_tracking.manage"'), false);
});

test("call details travel under the same permission as the audio", () => {
  // A transcript is call data. Loading it into the browser payload on weaker
  // terms than the recording would be a way around the recording's check.
  assert.match(
    crmSource,
    /!hasPermission\(context, "opportunities\.write"\)\s*\n\s*\? Promise\.resolve\(\[\] as AnyRecord\[\]\)\s*\n\s*: assertOk\(/,
  );
  const helper = block(crmSource, "function hasPermission(");
  assert.ok(helper, "the non-throwing check exists");
  assert.match(helper, /rolePermissions\[context\.role\]\.includes\(permission\)/);

  // Same permission in both places, named once each and not drifting.
  const loader = block(crmSource, "export async function getSupabaseCallRailRecording");
  assert.match(codeOnly(loader), /requirePermission\(context, "opportunities\.write"\)/);
});

test("the re-enquiry window is deprecated, retained, and read by nothing", () => {
  // Nothing loads it any more.
  assert.equal(
    /re_inquiry_window_days|reInquiryWindowDays/.test(ingestionSource),
    false,
    "ingestion no longer selects or normalizes the window",
  );
  // No interface writes it, and none ever did.
  for (const source of [connectionsUi, leadsUi, contactsUi]) {
    assert.equal(
      /reInquiry|re_inquiry/i.test(source),
      false,
      "the window appears in no interface",
    );
  }
  // No action accepts it as configuration.
  assert.equal(
    /re_inquiry_window_days/.test(crmSource),
    false,
    "no action reads or writes the window",
  );

  // The guards remain, marked, so removing them can be its own decision.
  const reinquiry = read("lib/callrail-reinquiry.ts");
  assert.match(reinquiry, /@deprecated The re-enquiry window no longer decides anything/);
  assert.match(reinquiry, /export function normalizeReInquiryWindowDays/);

  // And nothing destructive rides along with the feature.
  assert.match(mediaMigrationSource, /DEPRECATED\. Unused since repeat callers/);
  assert.equal(
    /drop column|drop constraint callrail_credentials_re_inquiry/i.test(
      mediaMigrationSource,
    ),
    false,
    "the column is not dropped in this migration",
  );
});


test("a media refresh writes two columns and touches nothing else", () => {
  const refresh = block(crmSource, 'if (action === "refresh_callrail_call_media")');
  assert.ok(refresh, "the action exists");
  const code = codeOnly(refresh);

  // Gated like the other maintenance actions that spend the customer's API
  // quota, and scoped to the client that was just authorized.
  assert.match(code, /requirePermission\(context, "call_tracking\.manage"\)/);
  assert.match(code, /await requireClient\(context, clientId\)/);
  assert.match(code, /\.eq\("organization_id", context\.organizationId\)/);

  // Each call is fetched by its own id.
  assert.match(code, /await getCallRailCall\(\s*\n\s*access\.accountId,\s*\n\s*String\(row\.callrail_call_id\),/);

  // The update carries exactly the media fields and the read timestamp.
  const update = code.slice(code.indexOf(".update({"), code.indexOf(".eq(\"id\""));
  assert.match(update, /recording_available: call\.recordingAvailable/);
  assert.match(update, /recording_duration_seconds: call\.recordingDurationSeconds/);
  assert.match(update, /updated_at: new Date\(\)\.toISOString\(\)/);
  const allowed = ["recording_available", "recording_duration_seconds", "updated_at"];
  const written = [...update.matchAll(/^\s*([a-z_]+):/gmu)].map((m) => m[1]);
  assert.deepEqual(
    written.sort(),
    [...allowed].sort(),
    "no other column may be written by a media refresh",
  );

  // It does not go through ingestion, so nothing downstream of a call can be
  // created or rewritten by it.
  for (const forbidden of [
    "ingestCallRailCall",
    "ingestFetchedCall",
    "ensureContact",
    "ensureLead",
    'from("contacts")',
    'from("leads")',
    "meta_eligible",
    "attribution",
  ]) {
    assert.equal(
      code.includes(forbidden),
      false,
      `${forbidden} must be untouched by a media refresh`,
    );
  }

  // Bounded, so one press cannot become a long unattended walk.
  assert.match(code, /\.limit\(MAX_CALLRAIL_MEDIA_REFRESH\)/);
  assert.match(crmSource, /const MAX_CALLRAIL_MEDIA_REFRESH = 200;/);
  // One unanswerable call does not abandon the rest.
  assert.match(code, /\} catch \{\s*\n\s*failed \+= 1;\s*\n\s*\}/);
  assert.match(code, /"provider\.call_media_refreshed"/);
});

test("the recording player appears only when the media fields say so", () => {
  // The flag the refresh writes is the same one the player reads, and the
  // same one the server checks before spending a request on CallRail.
  const player = section(callsUi, "function RecordingPlayer(", "function CallRow(");
  assert.match(player, /if \(!call\.recordingAvailable \|\| failed\)/);
  const loader = block(crmSource, "export async function getSupabaseCallRailRecording");
  assert.match(loader, /if \(row\.recording_available !== true\) return null;/);
  const mapped = block(crmSource, "function mapProviderConnection");
  assert.ok(mapped);
  // And it reaches the browser through the payload's own mapping.
  assert.match(crmSource, /recordingAvailable: row\.recording_available === true/);
});

test("the media refresh reports what CallRail said, not that it worked", () => {
  const handler = block(connectionsUi, "const runCallRailMediaRefresh = async (");
  assert.ok(handler, "the handler exists");
  // Split the success patch by slot, so this is about where a result lands
  // rather than whether a word occurs somewhere in the handler.
  const success = handler.slice(handler.indexOf('ingestionPending: "",'));
  const errorAt = success.indexOf("ingestionError:");
  const noteAt = success.indexOf("ingestionNote:");
  assert.ok(errorAt > -1, "the success patch sets an error slot");
  assert.ok(noteAt > errorAt, "and a separate note slot after it");
  const errorExpr = success.slice(errorAt, noteAt);
  const noteExpr = success.slice(noteAt);

  // Finding no recordings is a real answer: it goes to the note, not the error.
  assert.match(noteExpr, /CallRail has no recordings for any of them/);
  assert.equal(
    /no recordings/.test(errorExpr),
    false,
    "a clean result must not be rendered as a failure",
  );
  // A partial failure is the error slot's business, and clears the note.
  assert.match(errorExpr, /result\?\.failed/);
  assert.match(errorExpr, /did not answer for/);
  assert.match(noteExpr, /result\?\.failed\s*\n?\s*\? ""/);
  // The toast claims only that it looked.
  assert.match(handler, /"Checked CallRail for recordings\."/);
});


// ------------------------------------------- the documented media-fetch flow

test("a recording is fetched in the two documented steps", () => {
  const stream = block(providerSource, "export async function getCallRailRecording");
  assert.ok(stream);
  const code = codeOnly(stream);

  // Step one: the documented endpoint, which answers with JSON.
  assert.match(code, /calls\/\$\{safeCallId\}\/recording\.json/);
  assert.match(code, /"calls\.recording"/);
  // A call with no recording answers 404 there, and that is not a failure.
  assert.match(code, /error\.status === "not_found"[\s\S]*?return null/);

  // Step two: the location it named, fetched by hand so each hop is judged.
  assert.match(code, /readCallRailRecordingLocation\(body\)/);
  assert.match(code, /redirect: "manual"/);
  assert.match(code, /decideCallRailMediaResponse\(\{/);
  assert.equal(
    /redirect: "follow"/.test(code),
    false,
    "redirects must not be followed by the runtime, unchecked",
  );

  // Nothing from the provider's response travels outward.
  const refuse = block(providerSource, "function refuseMedia(");
  assert.ok(refuse, "refusals are centralised");
  assert.match(refuse, /endpoint: "calls\.recording"/);
  assert.match(refuse, /httpStatus,/);
  for (const leak of ["location", "target", "body", "url", "Authorization", "apiKey"]) {
    assert.equal(
      refuse.includes(leak),
      false,
      `${leak} must never reach a log or an error`,
    );
  }
});

test("the recording location is never stored or returned", () => {
  const stream = codeOnly(block(providerSource, "export async function getCallRailRecording"));
  // Read, used, dropped. CallRail's own documentation says never to keep it,
  // because the file moves and the endpoint is the permanent reference.
  assert.equal(
    /\.from\("callrail_calls"\)|\.update\(|\.insert\(/.test(stream),
    false,
    "the streamer writes nothing",
  );
  const loader = block(crmSource, "export async function getSupabaseCallRailRecording");
  assert.equal(
    /recording_url/.test(codeOnly(loader)),
    false,
    "the loader neither reads nor writes a provider URL",
  );
  // And what the route sends on carries no provider URL either.
  assert.equal(
    /Location|recording\.url|body\.url/.test(codeOnly(recordingRoute)),
    false,
    "no provider location reaches the browser",
  );
});

test("a non-audio response cannot reach the browser as 200", () => {
  // Refused in the provider client...
  const decide = block(read("lib/callrail-media.ts"), "export function decideCallRailMediaResponse");
  assert.match(decide, /isAudioContentType\(contentType\)/);
  assert.match(decide, /reason: "not_audio"/);

  // ...and refused again at the route, so a regression in one is not enough.
  const code = codeOnly(recordingRoute);
  assert.match(code, /if \(!isAudioContentType\(upstreamType\)\) \{\s*\n\s*return refuse\(502,/);
  const guardAt = code.indexOf("isAudioContentType(upstreamType)");
  const responseAt = code.indexOf("new Response(recording.body");
  assert.ok(guardAt > -1 && responseAt > guardAt, "the guard precedes the body");
  // And the type the browser is given is the one that was checked.
  assert.match(code, /headers\.set\("Content-Type", upstreamType\)/);
  assert.equal(
    /"audio\/mpeg"/.test(code),
    false,
    "no default type may paper over an unchecked one",
  );
});


test("nothing in the media path can carry the API key", () => {
  const media = read("lib/callrail-media.ts");

  // The helper takes no key, so it cannot pass one on. A conditional would
  // only ever be as good as its condition.
  const headers = block(media, "export function callRailMediaRequestHeaders");
  assert.ok(headers);
  for (const forbidden of ["apiKey", "Authorization", "Token", "Request-From"]) {
    assert.equal(
      headers.includes(forbidden),
      false,
      `${forbidden} must not appear in a media request's headers`,
    );
  }
  assert.match(headers, /input: \{\s*\n?\s*range\?: string \| null;\s*\n?\s*\}/);

  // The whole module is credential-free: it decides where a fetch may go, not
  // what it may carry.
  assert.equal(
    /apiKey|Authorization|Token token/.test(codeOnly(media)),
    false,
    "the media policy module handles no credentials at all",
  );

  // And the fetch loop attaches nothing of its own.
  const stream = codeOnly(
    block(providerSource, "export async function getCallRailRecording"),
  );
  const loop = stream.slice(stream.indexOf("for (let hop"));
  for (const forbidden of ["Authorization", "apiKey", "Token token", "CALLRAIL_REQUEST_FROM"]) {
    assert.equal(
      loop.includes(forbidden),
      false,
      `${forbidden} must not appear on a media hop`,
    );
  }

  // The key is spent once, before the loop, on the authenticated request.
  const beforeLoop = stream.slice(0, stream.indexOf("for (let hop"));
  assert.match(beforeLoop, /callRailRequest\(/);
  assert.match(beforeLoop, /apiKey,/);
  const authAt = beforeLoop.indexOf("callRailRequest(");
  assert.ok(authAt > -1, "the one authenticated request happens first");

  // callRailRequest only ever addresses CallRail's API host.
  assert.match(providerSource, /const CALLRAIL_API_URL = "https:\/\/api\.callrail\.com/);
});
