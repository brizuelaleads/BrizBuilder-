import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { Miniflare } from "miniflare";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const adminEmail = "admin@brizbuilder.local";
const testAuthHost = "127.0.0.1";
const testAuthSecret = "brizbuilder-worker-test-secret-rotate-2026";
const localAuthToken = "brizbuilder-local-session-test-token-2026";
const accessTeamDomain = "https://brizbuilder-test.cloudflareaccess.com";
const accessAudience = "brizbuilder-test-application-audience";

function collectWorkerModules(serverRoot) {
  function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(entryPath) : [entryPath];
    });
  }

  return walk(serverRoot)
    .filter((file) => file.endsWith(".js") || file.endsWith(".mjs"))
    .sort((left, right) => {
      const leftRelative = path.relative(serverRoot, left);
      const rightRelative = path.relative(serverRoot, right);
      if (leftRelative === "index.js") return -1;
      if (rightRelative === "index.js") return 1;
      return leftRelative.localeCompare(rightRelative);
    })
    .map((file) => ({ type: "ESModule", path: file }));
}

function authHeaders(
  email = adminEmail,
  name = "Luciano Brizuela",
  issuedAt = Math.floor(Date.now() / 1000),
) {
  const normalizedEmail = email.trim().toLowerCase();
  const encodedName = encodeURIComponent(name);
  const timestamp = String(issuedAt);
  const canonical = [
    "brizbuilder-test-auth-v1",
    timestamp,
    testAuthHost,
    normalizedEmail,
    encodedName,
  ].join("\n");
  const signature = createHmac("sha256", testAuthSecret)
    .update(canonical)
    .digest("base64url");

  return {
    "x-brizbuilder-test-email": normalizedEmail,
    "x-brizbuilder-test-name": encodedName,
    "x-brizbuilder-test-timestamp": timestamp,
    "x-brizbuilder-test-signature": signature,
  };
}

test("Reviews migration preserves tenant boundaries without storing Google reviews", () => {
  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/20260722130000_reviews_workspace.sql"),
    "utf8",
  );

  for (const table of ["review_settings", "contact_message_consents", "review_requests"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"),
      `${table} remains server-only`,
    );
  }

  assert.match(
    migration,
    /foreign key \(organization_id, client_id, contact_id\)[\s\S]*references public\.contacts\(organization_id, client_id, id\)/i,
    "review consent and request records enforce a tenant-scoped contact relationship",
  );
  assert.match(
    migration,
    /foreign key \(organization_id, client_id, consent_id\)[\s\S]*references public\.contact_message_consents\(organization_id, client_id, id\)/i,
    "review requests cannot reference another tenant's consent event",
  );
  assert.match(
    migration,
    /foreign key \(organization_id, client_id, message_id\)[\s\S]*references public\.messages\(organization_id, client_id, id\)/i,
    "review requests cannot reference another tenant's message",
  );
  assert.match(
    migration,
    /create or replace function public\.reserve_review_request[\s\S]*pg_advisory_xact_lock[\s\S]*insert into public\.contact_message_consents[\s\S]*insert into public\.review_requests/i,
    "consent evidence and request reservation are created atomically under a database lock",
  );
  assert.match(
    migration,
    /revoke all on function public\.reserve_review_request[\s\S]*from public, anon, authenticated;[\s\S]*grant execute[\s\S]*to service_role;/i,
    "only the trusted Worker service role can reserve review requests",
  );
  assert.doesNotMatch(
    migration,
    /unique\s*\(organization_id, client_id, contact_id, channel, purpose\)/i,
    "consent assertions remain immutable events instead of overwriting one contact row",
  );
  assert.doesNotMatch(
    migration,
    /create table(?: if not exists)? public\.(?:google_)?(?:business_)?reviews\b/i,
    "Google review content is not permanently copied into BrizBuilder",
  );
});

test("Reviews sending keeps the approved preview exact and never uses BrizBuilder's Twilio account", () => {
  const crmSource = fs.readFileSync(path.join(root, "db/supabase-crm.ts"), "utf8");
  const reviewsSource = fs.readFileSync(path.join(root, "app/crm/ReviewsView.tsx"), "utf8");

  assert.match(crmSource, /input\.body !== messageBody/);
  assert.match(crmSource, /\.rpc\("reserve_review_request"/);
  assert.match(crmSource, /allowPlatformFallback: false/);
  assert.match(crmSource, /TwilioMessageDeliveryUnknownError/);
  assert.match(crmSource, /status: deliveryUnknown \? "reconciling" : "failed"/);
  assert.match(
    reviewsSource,
    /const smsReady = twilioActive && phoneConfigured && a2pApproved/,
    "the UI blocks review texts until Twilio, the phone configuration, and carrier approval are ready",
  );
});

test("AI Connector stores only hashed OAuth credentials and exposes bounded CRM tools", () => {
  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/20260722200000_ai_connector.sql"),
    "utf8",
  );
  const mcpSource = fs.readFileSync(
    path.join(root, "lib/ai-connector/mcp.ts"),
    "utf8",
  );
  const connectorUi = fs.readFileSync(
    path.join(root, "app/crm/AiConnectorView.tsx"),
    "utf8",
  );
  const futureUi = fs.readFileSync(
    path.join(root, "app/crm/FutureModuleViews.tsx"),
    "utf8",
  );
  const oauthSource = fs.readFileSync(
    path.join(root, "lib/ai-connector/oauth.ts"),
    "utf8",
  );
  const oauthPolicySource = fs.readFileSync(
    path.join(root, "lib/ai-connector/oauth-policy.ts"),
    "utf8",
  );
  const oauthSecuritySource = fs.readFileSync(
    path.join(root, "lib/ai-connector/http-security.ts"),
    "utf8",
  );
  const authorizeSource = fs.readFileSync(
    path.join(root, "app/oauth/authorize/page.tsx"),
    "utf8",
  );
  const proxySource = fs.readFileSync(path.join(root, "proxy.ts"), "utf8");

  for (const table of [
    "ai_oauth_clients",
    "ai_oauth_consent_requests",
    "ai_authorizations",
    "ai_oauth_authorization_codes",
    "ai_oauth_access_tokens",
    "ai_oauth_refresh_tokens",
  ]) {
    assert.match(
      migration,
      new RegExp(`create table if not exists public\\.${table}\\b`, "i"),
    );
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    );
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i"),
    );
  }

  assert.match(migration, /code_hash text not null unique/i);
  assert.match(migration, /token_hash text not null unique/i);
  assert.doesNotMatch(migration, /\b(?:access|refresh)_token\s+text\b/i);
  assert.doesNotMatch(
    migration,
    /^\s*(?:prompt|conversation|response_body)\s+(?:text|jsonb?)\b/im,
  );

  for (const safeTool of [
    "crm_get_overview",
    "crm_search_contacts",
    "crm_list_opportunities",
    "crm_list_tasks",
    "crm_list_appointments",
    "crm_create_task",
    "crm_add_opportunity_note",
    "crm_move_opportunity_stage",
  ]) {
    assert.match(mcpSource, new RegExp(`\\b${safeTool}\\b`));
  }
  assert.doesNotMatch(mcpSource, /send_(?:sms|email)|delete_(?:contact|lead)|charge_(?:card|payment)/i);
  assert.match(connectorUi, /No BrizBuilder AI usage bill/);
  assert.match(connectorUi, /Customer messages[\s\S]*Blocked/);
  assert.doesNotMatch(futureUi, /AI PLAYGROUND PREVIEW/);
  assert.match(
    mcpSource,
    /supabaseRoleHasPermission\(context, "ai_connector\.manage"\)/,
  );
  assert.match(oauthSource, /isSafeOAuthClientName/);
  assert.match(oauthPolicySource, /\\p\{Cf\}/);
  assert.match(authorizeSource, /identity not verified by BrizBuilder/);
  assert.match(proxySource, /applyAiConsentSecurityHeaders/);
  assert.match(oauthSecuritySource, /frame-ancestors 'none'/);
});

test("Phase 1 CRM authentication, tenant isolation, imports, custom data, companies, and opportunities", async () => {
  const serverRoot = path.join(root, "dist/server");
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const accessJwk = await exportJWK(publicKey);
  accessJwk.alg = "RS256";
  accessJwk.kid = "brizbuilder-access-test-key";
  accessJwk.use = "sig";

  function accessToken(
    email = adminEmail,
    name = "Luciano Brizuela",
    options = {},
  ) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email, name, type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: accessJwk.kid })
      .setIssuer(options.issuer ?? accessTeamDomain)
      .setAudience(options.audience ?? accessAudience)
      .setSubject(options.subject ?? `user:${email}`)
      .setIssuedAt(options.issuedAt ?? now)
      .setNotBefore(options.notBefore ?? now - 1)
      .setExpirationTime(options.expiresAt ?? now + 300)
      .sign(privateKey);
  }

  const mf = new Miniflare({
    modules: collectWorkerModules(serverRoot),
    modulesRoot: serverRoot,
    compatibilityDate: "2026-05-22",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      BRIZBUILDER_TEST_AUTH_ENABLED: "true",
      BRIZBUILDER_TEST_AUTH_HOST: testAuthHost,
      BRIZBUILDER_TEST_AUTH_SECRET: testAuthSecret,
      LOCAL_DEV_SESSION_TOKEN: localAuthToken,
      MAIN_ADMIN_EMAIL: adminEmail,
      MAIN_ADMIN_NAME: "BrizBuilder Test Administrator",
      POLICY_AUD: accessAudience,
      TEAM_DOMAIN: accessTeamDomain,
    },
    d1Databases: { DB: "crm-phase-one-test" },
    outboundService: async (request) => {
      if (
        request.url === `${accessTeamDomain}/cdn-cgi/access/certs`
      ) {
        return Response.json(
          { keys: [accessJwk] },
          { headers: { "Cache-Control": "public, max-age=3600" } },
        );
      }
      return new Response("Unexpected outbound request", { status: 502 });
    },
  });

  try {
    const protectedResource = await mf.dispatchFetch(
      "http://crm.test/.well-known/oauth-protected-resource",
    );
    assert.equal(protectedResource.status, 200);
    const protectedResourceBody = await protectedResource.json();
    assert.match(protectedResourceBody.resource, /\/mcp$/);
    assert.deepEqual(protectedResourceBody.scopes_supported, [
      "crm:read",
      "crm:tasks.write",
      "crm:opportunities.write",
    ]);

    const authorizationMetadata = await mf.dispatchFetch(
      "http://crm.test/.well-known/oauth-authorization-server",
    );
    assert.equal(authorizationMetadata.status, 200);
    const authorizationMetadataBody = await authorizationMetadata.json();
    assert.deepEqual(authorizationMetadataBody.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(authorizationMetadataBody.token_endpoint_auth_methods_supported, ["none"]);

    const initializeMcp = await mf.dispatchFetch("http://crm.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "BrizBuilder test", version: "1" } },
      }),
    });
    assert.equal(initializeMcp.status, 200);
    const initializeMcpBody = await initializeMcp.json();
    assert.equal(initializeMcpBody.result.serverInfo.name, "BrizBuilder CRM Connector");

    const listMcpTools = await mf.dispatchFetch("http://crm.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    assert.equal(listMcpTools.status, 200);
    const listMcpToolsBody = await listMcpTools.json();
    assert.deepEqual(
      listMcpToolsBody.result.tools.map((tool) => tool.name),
      [
        "crm_get_overview",
        "crm_search_contacts",
        "crm_list_opportunities",
        "crm_list_tasks",
        "crm_list_appointments",
        "crm_create_task",
        "crm_add_opportunity_note",
        "crm_move_opportunity_stage",
      ],
    );
    assert.ok(
      listMcpToolsBody.result.tools.every(
        (tool) =>
          tool.annotations?.openWorldHint === false &&
          tool.annotations?.destructiveHint === false &&
          Array.isArray(tool.securitySchemes),
      ),
      "every connector tool declares closed-world safety and OAuth security metadata",
    );

    const unauthenticatedToolCall = await mf.dispatchFetch("http://crm.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "crm_get_overview", arguments: {} },
      }),
    });
    assert.equal(unauthenticatedToolCall.status, 401);
    assert.match(
      unauthenticatedToolCall.headers.get("www-authenticate") ?? "",
      /oauth-protected-resource/,
    );

    const anonymous = await mf.dispatchFetch("http://crm.test/api/crm");
    assert.equal(anonymous.status, 401, "protected API rejects anonymous requests");

    const accessResponse = await mf.dispatchFetch("http://crm.test/api/crm", {
      headers: {
        "cf-access-jwt-assertion": await accessToken(),
      },
    });
    assert.equal(
      accessResponse.status,
      200,
      "a correctly signed and scoped Cloudflare Access JWT is accepted",
    );

    const wrongAudience = await mf.dispatchFetch("http://crm.test/api/crm", {
      headers: {
        "cf-access-jwt-assertion": await accessToken(
          adminEmail,
          "Luciano Brizuela",
          { audience: "some-other-application" },
        ),
      },
    });
    assert.equal(wrongAudience.status, 401, "a JWT for another Access application is rejected");

    const now = Math.floor(Date.now() / 1000);
    const expiredAccessToken = await mf.dispatchFetch("http://crm.test/api/crm", {
      headers: {
        "cf-access-jwt-assertion": await accessToken(
          adminEmail,
          "Luciano Brizuela",
          { issuedAt: now - 600, notBefore: now - 600, expiresAt: now - 300 },
        ),
      },
    });
    assert.equal(expiredAccessToken.status, 401, "an expired Access JWT is rejected");

    const spoofedIdentity = await mf.dispatchFetch("http://crm.test/api/crm", {
      headers: {
        "oai-authenticated-user-email": adminEmail,
        "oai-authenticated-user-full-name": "Spoofed Administrator",
      },
    });
    assert.equal(
      spoofedIdentity.status,
      401,
      "unsigned legacy identity headers are never trusted",
    );

    const tamperedHeaders = authHeaders();
    tamperedHeaders["x-brizbuilder-test-signature"] = "A".repeat(43);
    const tamperedIdentity = await mf.dispatchFetch("http://crm.test/api/crm", {
      headers: tamperedHeaders,
    });
    assert.equal(tamperedIdentity.status, 401, "tampered test identity is rejected");

    const expiredIdentity = await mf.dispatchFetch("http://crm.test/api/crm", {
      headers: authHeaders(
        adminEmail,
        "Luciano Brizuela",
        Math.floor(Date.now() / 1000) - 120,
      ),
    });
    assert.equal(expiredIdentity.status, 401, "expired test identity is rejected");

    const localAdmin = await mf.dispatchFetch("http://crm.test/api/crm", {
      headers: { cookie: `brizbuilder_local_session=${localAuthToken}` },
    });
    assert.equal(localAdmin.status, 200, "configured local admin session remains available");

    const adminResponse = await mf.dispatchFetch("http://crm.test/api/crm", { headers: authHeaders() });
    assert.equal(adminResponse.status, 200);
    const adminBody = await adminResponse.json();
    assert.equal(adminBody.data.organization.name, "Brizuela Leads");
    assert.equal(adminBody.data.viewer.role, "AGENCY_OWNER");
    assert.equal(adminBody.data.demoData, false, "production bootstrap does not inject demo customer data");
    assert.ok(adminBody.data.featureFlags.some((flag) => flag.moduleKey === "crm" && flag.enabled));
    assert.ok(adminBody.data.featureFlags.some((flag) => flag.moduleKey === "communications" && !flag.enabled));
    assert.ok(adminBody.data.viewer.permissions.includes("audit.read"));
    for (const permission of ["reviews.read", "reviews.reply", "reviews.request", "reviews.settings.manage"]) {
      assert.ok(adminBody.data.viewer.permissions.includes(permission), `agency owner has ${permission}`);
    }
    assert.deepEqual(adminBody.data.reviewRequests, [], "a new account has no fabricated review-request history");
    assert.deepEqual(adminBody.data.reviewSettings, [], "a new account has no fabricated review settings");

    const invalidOrigin = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ action: "create_lead" }),
    });
    assert.equal(invalidOrigin.status, 403, "cross-origin writes are rejected");

    const createPrimaryClient = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_client", businessName: "Tenant One Test Services", industry: "Pest control", city: "Round Rock", state: "TX" }),
    });
    assert.equal(createPrimaryClient.status, 200);
    const primaryClientId = (await createPrimaryClient.json()).result.id;

    const afterClientCreate = await mf.dispatchFetch("http://crm.test/api/crm", { headers: authHeaders() });
    const afterClientCreateBody = await afterClientCreate.json();
    const primaryClient = afterClientCreateBody.data.clients.find((client) => client.id === primaryClientId);
    assert.equal(primaryClient?.businessName, "Tenant One Test Services", "test client is created through the public CRM action");

    const createLead = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_lead", clientId: primaryClient.id, firstName: "Test", lastName: "Customer", phone: "(512) 555-0199", serviceRequested: "General pest control", source: "Manual", estimatedValueCents: 15000 }),
    });
    assert.equal(createLead.status, 200);
    const createdLeadId = (await createLead.json()).result.id;

    const moveLead = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "move_lead", leadId: createdLeadId, stageId: "stage_qualified" }),
    });
    assert.equal(moveLead.status, 200);

    const refreshed = await mf.dispatchFetch("http://crm.test/api/crm", { headers: authHeaders() });
    const refreshedBody = await refreshed.json();
    const createdLead = refreshedBody.data.leads.find((lead) => lead.id === createdLeadId);
    assert.equal(createdLead.stageId, "stage_qualified");
    assert.equal(createdLead.status, "QUALIFIED");

    const db = await mf.getD1Database("DB");
    const history = await db.prepare("SELECT COUNT(*) AS total FROM lead_stage_history WHERE lead_id = ?").bind(createdLeadId).first();
    assert.equal(Number(history.total), 1, "pipeline history is recorded");

    const createCompany = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_company", clientId: primaryClient.id, name: "Tenant One Facilities", industry: "Facilities services", email: "office@tenant-one.example" }),
    });
    assert.equal(createCompany.status, 200);

    const importContacts = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "import_contacts", clientId: primaryClient.id, rows: [
        { firstName: "Taylor", lastName: "Morgan", phone: "(512) 555-0198", email: "taylor.morgan@tenant-one.example", company: "Tenant One Facilities", tags: "Commercial; Priority", marketingConsent: "granted" },
        { firstName: "Existing", lastName: "Customer", phone: "(512) 555-0199" },
      ] }),
    });
    assert.equal(importContacts.status, 200);
    const importResult = (await importContacts.json()).result;
    assert.deepEqual(importResult, { imported: 1, skipped: 1, total: 2 });

    const afterImport = await mf.dispatchFetch("http://crm.test/api/crm", { headers: authHeaders() });
    const afterImportBody = await afterImport.json();
    const importedContact = afterImportBody.data.contacts.find((contact) => contact.email === "taylor.morgan@tenant-one.example");
    assert.ok(importedContact, "CSV contact was persisted");
    assert.ok(afterImportBody.data.companies.some((company) => company.name === "Tenant One Facilities" && company.contactCount === 1), "imported company relationship was persisted");

    const createField = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_custom_field", clientId: primaryClient.id, entityType: "CONTACT", label: "Gate code", fieldKey: "gate_code", fieldType: "TEXT" }),
    });
    assert.equal(createField.status, 200);
    const customFieldId = (await createField.json()).result.id;

    const setFieldValue = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "set_custom_field_value", fieldId: customFieldId, entityId: importedContact.id, value: "2468" }),
    });
    assert.equal(setFieldValue.status, 200);

    const upsertValue = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "upsert_custom_value", clientId: primaryClient.id, label: "Seasonal headline", valueKey: "custom.seasonal_headline", value: "Protect your home this season" }),
    });
    assert.equal(upsertValue.status, 200);

    const afterCustomData = await mf.dispatchFetch("http://crm.test/api/crm", { headers: authHeaders() });
    const afterCustomDataBody = await afterCustomData.json();
    assert.ok(afterCustomDataBody.data.customFieldValues.some((value) => value.definitionId === customFieldId && value.entityId === importedContact.id && value.value === "2468"));
    assert.ok(afterCustomDataBody.data.customValues.some((value) => value.valueKey === "custom.seasonal_headline"));
    assert.ok(afterCustomDataBody.data.auditLogs.some((entry) => entry.action === "contacts.imported"), "auditable imports are visible to agency owners");
    const eventCount = await db.prepare("SELECT COUNT(*) AS total FROM domain_events WHERE organization_id = 'org_brizuela_leads'").first();
    assert.ok(Number(eventCount.total) >= 6, "domain outbox events are emitted for future workflows and webhooks");

    const primaryClientAccess = await db.prepare("SELECT legacy_client_id FROM crm_clients WHERE id = ? LIMIT 1").bind(primaryClient.id).first();
    assert.ok(primaryClientAccess?.legacy_client_id, "test client has a legacy access record");
    await db.prepare("INSERT INTO accounts (id, email, display_name, role, client_id, status) VALUES ('account_client_test', 'client@tenant-one.example', 'Tenant One Owner', 'client', ?, 'active')").bind(primaryClientAccess.legacy_client_id).run();
    await db.prepare("INSERT INTO client_members (id, organization_id, client_id, account_id, role, status) VALUES ('client_member_test', 'org_brizuela_leads', ?, 'account_client_test', 'CLIENT_OWNER', 'active')").bind(primaryClient.id).run();

    const secondClient = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_client", businessName: "Tenant Two Test Roofing", industry: "Roofing", city: "Austin", state: "TX" }),
    });
    assert.equal(secondClient.status, 200);
    const secondClientId = (await secondClient.json()).result.id;

    const createSecondClientLead = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_lead", clientId: secondClientId, firstName: "Other", lastName: "Tenant", phone: "(512) 555-0100", serviceRequested: "Roof inspection", source: "Manual", estimatedValueCents: 25000 }),
    });
    assert.equal(createSecondClientLead.status, 200);

    const createSecondClientCompany = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_company", clientId: secondClientId, name: "Tenant Two Property Group", industry: "Property management", email: "office@tenant-two.example" }),
    });
    assert.equal(createSecondClientCompany.status, 200);

    const createSecondClientField = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_custom_field", clientId: secondClientId, entityType: "CONTACT", label: "Roof type", fieldKey: "roof_type", fieldType: "TEXT" }),
    });
    assert.equal(createSecondClientField.status, 200);

    const createSecondClientValue = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "upsert_custom_value", clientId: secondClientId, label: "Service promise", valueKey: "custom.service_promise", value: "Tenant two only" }),
    });
    assert.equal(createSecondClientValue.status, 200);

    const clientResponse = await mf.dispatchFetch("http://crm.test/api/crm", { headers: authHeaders("client@tenant-one.example", "Tenant One Owner") });
    const clientBody = await clientResponse.json();
    assert.equal(clientResponse.status, 200, JSON.stringify(clientBody));
    assert.equal(clientBody.data.viewer.role, "CLIENT_OWNER");
    assert.equal(clientBody.data.clients.length, 1, "client receives only its assigned business");
    assert.equal(clientBody.data.clients[0].id, primaryClient.id);
    assert.equal(clientBody.data.team.length, 0, "client cannot list agency members");
    assert.ok(clientBody.data.leads.length > 0 && clientBody.data.leads.every((lead) => lead.clientId === primaryClient.id), "lead records are tenant scoped");
    assert.ok(clientBody.data.contacts.length > 0 && clientBody.data.contacts.every((contact) => contact.clientId === primaryClient.id), "contacts are tenant scoped");
    assert.ok(clientBody.data.companies.length > 0 && clientBody.data.companies.every((company) => company.clientId === primaryClient.id), "companies are tenant scoped");
    assert.ok(clientBody.data.customFields.length > 0 && clientBody.data.customFields.every((field) => field.clientId === primaryClient.id), "custom fields are tenant scoped");
    assert.ok(clientBody.data.customValues.length > 0 && clientBody.data.customValues.every((value) => value.clientId === primaryClient.id), "custom values are tenant scoped");
    assert.equal(clientBody.data.auditLogs.length, 0, "client roles cannot read agency audit logs");
    assert.ok(!clientBody.data.viewer.permissions.includes("audit.read"));
    for (const permission of ["reviews.read", "reviews.reply", "reviews.request", "reviews.settings.manage"]) {
      assert.ok(clientBody.data.viewer.permissions.includes(permission), `client owner has ${permission}`);
    }
    assert.ok(clientBody.data.reviewRequests.every((request) => request.clientId === primaryClient.id), "review requests are tenant scoped");
    assert.ok(clientBody.data.reviewSettings.every((settings) => settings.clientId === primaryClient.id), "review settings are tenant scoped");

    await db.prepare("INSERT INTO accounts (id, email, display_name, role, client_id, status) VALUES ('account_client_employee_test', 'employee@tenant-one.example', 'Tenant One Employee', 'client', ?, 'active')").bind(primaryClientAccess.legacy_client_id).run();
    await db.prepare("INSERT INTO client_members (id, organization_id, client_id, account_id, role, status) VALUES ('client_member_employee_test', 'org_brizuela_leads', ?, 'account_client_employee_test', 'CLIENT_EMPLOYEE', 'active')").bind(primaryClient.id).run();

    const employeeResponse = await mf.dispatchFetch("http://crm.test/api/crm", { headers: authHeaders("employee@tenant-one.example", "Tenant One Employee") });
    assert.equal(employeeResponse.status, 200);
    const employeeBody = await employeeResponse.json();
    assert.equal(employeeBody.data.clients.length, 1, "client employee receives only the assigned business");
    assert.equal(employeeBody.data.clients[0].id, primaryClient.id);
    assert.deepEqual(
      employeeBody.data.viewer.permissions.filter((permission) => permission.startsWith("reviews.")).sort(),
      ["reviews.read"],
      "client employees can view Reviews but cannot reply, send requests, or change settings",
    );

    const forbiddenClientCreate = await mf.dispatchFetch("http://crm.test/api/crm", {
      method: "POST",
      headers: { ...authHeaders("client@tenant-one.example", "Tenant One Owner"), "content-type": "application/json", origin: "http://crm.test" },
      body: JSON.stringify({ action: "create_client", businessName: "Not Allowed", industry: "HVAC" }),
    });
    assert.equal(forbiddenClientCreate.status, 403, "client roles cannot create clients");
  } finally {
    await mf.dispose();
  }
});
