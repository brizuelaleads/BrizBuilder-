import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const stripeLibSource = read("lib", "stripe.ts");
const supabaseCrmSource = read("db", "supabase-crm.ts");
const d1CrmSource = read("db", "crm.ts");
const connectRouteSource = read(
  "app",
  "api",
  "integrations",
  "stripe",
  "connect",
  "route.ts",
);
const callbackRouteSource = read(
  "app",
  "api",
  "integrations",
  "stripe",
  "callback",
  "route.ts",
);
const sessionRouteSource = read(
  "app",
  "api",
  "integrations",
  "stripe",
  "account-session",
  "route.ts",
);
const webhookRouteSource = read(
  "app",
  "api",
  "integrations",
  "stripe",
  "webhook",
  "route.ts",
);
const embeddedUiSource = read(
  "app",
  "crm",
  "payments",
  "StripeEmbeddedWorkspace.tsx",
);
const gatewaySource = read("lead-worker", "src", "index.ts");
const migrationSource = read(
  "supabase",
  "migrations",
  "20260723180000_stripe_embedded_security.sql",
);

function rolePermissionBlock(source, role) {
  const match = source.match(new RegExp(`${role}:\\s*\\[([\\s\\S]*?)\\]`));
  assert.ok(match, `${role} permission array exists`);
  return match[1];
}

test("Stripe OAuth stores an account id and mode but never returns customer bearer tokens", () => {
  const body = stripeLibSource.match(
    /export async function exchangeStripeConnectCode\([\s\S]*?\n}/,
  )?.[0];
  assert.ok(body, "exchangeStripeConnectCode exists");
  assert.match(
    body,
    /return \{\s*accountId: String\(payload\.stripe_user_id\),\s*livemode: Boolean\(payload\.livemode\),\s*};/,
  );
  assert.doesNotMatch(body, /return \{[\s\S]*access_token/);
  assert.doesNotMatch(body, /return \{[\s\S]*refresh_token/);
  assert.match(body, /STRIPE_ACCOUNT_ID\.test\(payload\.stripe_user_id/);
});

test("Stripe account ids are format checked before connected-account API calls", () => {
  assert.match(
    stripeLibSource,
    /const STRIPE_ACCOUNT_ID = \/\^acct_\[A-Za-z0-9\]\{8,\}\$\//,
  );
  assert.match(
    stripeLibSource,
    /export async function checkStripeConnectedAccount\(accountId: string\) \{\s*if \(!STRIPE_ACCOUNT_ID\.test\(accountId\)\)/,
  );
  assert.match(
    stripeLibSource,
    /export async function createStripeAccountSession\([\s\S]*?if \(!STRIPE_ACCOUNT_ID\.test\(accountId\)\)/,
  );
});

test("Connect authorization only targets Stripe and prefills safe CRM business fields", () => {
  assert.match(
    stripeLibSource,
    /new URL\("https:\/\/connect\.stripe\.com\/oauth\/authorize"\)/,
  );
  assert.match(stripeLibSource, /url\.searchParams\.set\("state", state\)/);
  assert.match(stripeLibSource, /addPrefill\(url, "business_name"/);
  assert.match(stripeLibSource, /addPrefill\(url, "product_description"/);
  assert.match(stripeLibSource, /if \(phone\.length === 10\)/);
});

test("Connect initiation checks permission and exact client access before state creation", () => {
  const body = supabaseCrmSource.match(
    /export async function beginSupabaseStripeConnect\([\s\S]*?\n}/,
  )?.[0];
  assert.ok(body);
  const permissionIndex = body.indexOf(
    'requirePermission(context, "payments.manage")',
  );
  const clientIndex = body.indexOf("requireClient(context, clientId)");
  const insertIndex = body.indexOf('.from("provider_authorization_states")');
  assert.ok(permissionIndex >= 0);
  assert.ok(clientIndex > permissionIndex);
  assert.ok(insertIndex > clientIndex);
  assert.match(body, /state_hash: await stateHash\(state\)/);
  assert.match(body, /buildStripeConnectUrl\(state, \{/);
});

test("OAuth completion atomically claims state before calling Stripe and rechecks membership", () => {
  const body = supabaseCrmSource.match(
    /export async function finishSupabaseStripeConnect\([\s\S]*?\n}/,
  )?.[0];
  assert.ok(body);
  assert.match(body, /\.eq\("provider", "stripe"\)/);
  assert.match(body, /\.is\("used_at", null\)/);
  assert.match(body, /\.gt\("expires_at", now\)/);
  const claimIndex = body.indexOf(".update({ used_at: now })");
  const exchangeIndex = body.indexOf("exchangeStripeConnectCode(code)");
  assert.ok(claimIndex >= 0 && exchangeIndex > claimIndex);
  assert.match(body, /getTenantContext\(\{/);
  assert.match(body, /requirePermission\(initiatingContext, "payments\.manage"\)/);
  assert.match(body, /requireClient\(initiatingContext/);
  assert.match(body, /already connected to another BrizBuilder business/);
  assert.match(body, /deauthorizeStripeAccount\(accountId\)/);
});

test("a canceled Stripe redirect consumes its authorization state", () => {
  assert.match(
    supabaseCrmSource,
    /export async function cancelSupabaseStripeConnect\(/,
  );
  assert.match(callbackRouteSource, /await cancelSupabaseStripeConnect\(/);
  assert.match(callbackRouteSource, /Stripe connection was canceled/);
});

test("disconnect blocks new sessions before calling Stripe's real deauthorization endpoint", () => {
  assert.match(
    stripeLibSource,
    /fetch\("https:\/\/connect\.stripe\.com\/oauth\/deauthorize"/,
  );
  assert.match(stripeLibSource, /stripe_user_id: accountId/);
  const body = supabaseCrmSource.match(
    /if \(action === "disconnect_provider"\) \{[\s\S]*?return \{ disconnected: true \};\s*}/,
  )?.[0];
  assert.ok(body);
  const blockingIndex = body.indexOf('status: "disconnecting"');
  const deauthorizeIndex = body.indexOf("deauthorizeStripeAccount");
  assert.ok(blockingIndex >= 0 && deauthorizeIndex > blockingIndex);
  assert.match(body, /status: "deauthorization_pending"/);
  assert.match(body, /\.eq\("organization_id", context\.organizationId\)/);
  assert.match(body, /\.eq\("client_id", clientId\)/);
});

test("payments.manage remains owner tier and Account Sessions narrow it to financial owners", () => {
  assert.match(
    d1CrmSource,
    /"billing\.read_shared"\s*\n\s*\|\s*"payments\.manage"/,
  );
  for (const role of [
    "SUPER_ADMIN",
    "AGENCY_OWNER",
    "AGENCY_ADMIN",
    "CLIENT_OWNER",
  ])
    assert.match(rolePermissionBlock(supabaseCrmSource, role), /"payments\.manage"/);
  for (const role of ["AGENCY_MEMBER", "CLIENT_MANAGER", "CLIENT_EMPLOYEE"])
    assert.doesNotMatch(
      rolePermissionBlock(supabaseCrmSource, role),
      /"payments\.manage"/,
    );
  assert.match(
    supabaseCrmSource,
    /function isStripeFinancialOwner\([\s\S]*?"SUPER_ADMIN"[\s\S]*?"AGENCY_OWNER"[\s\S]*?"CLIENT_OWNER"/,
  );
  assert.match(
    supabaseCrmSource,
    /createSupabaseStripeAccountSession[\s\S]*?if \(!isStripeFinancialOwner\(context\)\) throw new Error\("Forbidden"\)/,
  );
});

test("Account Session endpoint requires a human, same-origin JSON, and a bounded client id", () => {
  assert.match(sessionRouteSource, /const user = await getChatGPTUser\(\)/);
  assert.match(sessionRouteSource, /if \(!user\)/);
  assert.match(sessionRouteSource, /if \(!sameOrigin\(request\)\)/);
  assert.match(sessionRouteSource, /Content-Type must be application\/json/);
  assert.match(sessionRouteSource, /contentLength > 4_096/);
  assert.match(
    sessionRouteSource,
    /createSupabaseStripeAccountSession\(user, clientId\)/,
  );
  assert.doesNotMatch(sessionRouteSource, /accountId/);
  assert.match(sessionRouteSource, /"Cache-Control": "private, no-store"/);
});

test("the server derives the Stripe account from the tenant row and fixes component policy", () => {
  const body = supabaseCrmSource.match(
    /export async function createSupabaseStripeAccountSession\([\s\S]*?\n}/,
  )?.[0];
  assert.ok(body);
  assert.match(body, /\.eq\("organization_id", context\.organizationId\)/);
  assert.match(body, /\.eq\("client_id", clientId\)/);
  assert.match(body, /\.eq\("provider", "stripe"\)/);
  assert.match(body, /String\(connection\.external_account_id\)/);
  assert.match(body, /typeof connection\.livemode !== "boolean"/);
  assert.doesNotMatch(body, /input\.account/);
});

test("Account Sessions pin an API version and explicitly control every money mutation", () => {
  assert.match(stripeLibSource, /2025-05-28\.basil/);
  assert.match(
    stripeLibSource,
    /components\[payments\]\[features\]\[capture_payments\].*disabled/,
  );
  assert.match(
    stripeLibSource,
    /components\[payments\]\[features\]\[destination_on_behalf_of_charge_management\][\s\S]*?disabled/,
  );
  assert.match(
    stripeLibSource,
    /instantPayouts: false/,
  );
  assert.doesNotMatch(
    stripeLibSource,
    /components\[[^\]]+\]\[features\]\[disable_stripe_user_authentication\]/,
  );
  assert.doesNotMatch(
    stripeLibSource,
    /components\[[^\]]+\]\[features\]\[external_account_collection\]/,
  );
  assert.match(stripeLibSource, /expectedLivemode !== keyIsLive/);
});

test("embedded capabilities are server flags that default off", () => {
  for (const name of [
    "STRIPE_EMBEDDED_ENABLED",
    "STRIPE_EMBEDDED_PAYMENTS_READ_ENABLED",
    "STRIPE_EMBEDDED_PAYOUTS_READ_ENABLED",
    "STRIPE_EMBEDDED_ONBOARDING_ENABLED",
    "STRIPE_EMBEDDED_ACCOUNT_MANAGEMENT_ENABLED",
    "STRIPE_EMBEDDED_REFUNDS_ENABLED",
    "STRIPE_EMBEDDED_DISPUTES_ENABLED",
    "STRIPE_EMBEDDED_PAYOUTS_ENABLED",
    "STRIPE_EMBEDDED_LIVE_MODE_ENABLED",
  ])
    assert.match(stripeLibSource, new RegExp(name));
  assert.match(stripeLibSource, /instantPayouts: false/);
});

test("switching clients destroys the prior Connect instance and drops late responses", () => {
  assert.match(embeddedUiSource, /let active = true/);
  assert.match(embeddedUiSource, /if \(!active\) return/);
  assert.match(embeddedUiSource, /controller\.abort\(\)/);
  assert.match(embeddedUiSource, /instance\.logout\(\)/);
  assert.doesNotMatch(embeddedUiSource, /localStorage|sessionStorage/);
});

test("signed Stripe webhooks use the raw body, timestamp tolerance, and durable replay protection", () => {
  assert.match(webhookRouteSource, /const rawBody = await request\.text\(\)/);
  assert.match(webhookRouteSource, /request\.headers\.get\("stripe-signature"\)/);
  assert.match(stripeLibSource, /WEBHOOK_TOLERANCE_SECONDS = 300/);
  assert.match(stripeLibSource, /crypto\.subtle\.sign/);
  assert.match(
    supabaseCrmSource,
    /rpc\("claim_provider_webhook_event"/,
  );
  assert.match(
    supabaseCrmSource,
    /"account\.application\.deauthorized"/,
  );
  assert.match(supabaseCrmSource, /"account\.updated"/);
  assert.match(supabaseCrmSource, /\.eq\("livemode", event\.livemode\)/);
});

test("the public gateway exposes only the exact Stripe webhook path and POST method", () => {
  assert.match(
    gatewaySource,
    /url\.pathname === "\/api\/integrations\/stripe\/webhook"/,
  );
  assert.match(
    gatewaySource,
    /\(isTwilioWebhook \|\| isTwilioDeauthorize \|\| isStripeWebhook\) && request\.method !== "POST"/,
  );
  assert.doesNotMatch(
    gatewaySource,
    /startsWith\("\/api\/integrations\/stripe\/"\)/,
  );
});

test("the migration enforces composite tenancy, unique Stripe ownership, private writes, and webhook ids", () => {
  assert.match(
    migrationSource,
    /provider_connections_organization_client_fk/,
  );
  assert.match(
    migrationSource,
    /provider_authorization_states_organization_client_fk/,
  );
  assert.match(
    migrationSource,
    /provider_connections_active_stripe_account_uidx/,
  );
  assert.match(migrationSource, /add column if not exists livemode boolean/);
  assert.match(migrationSource, /primary key \(provider, event_id\)/);
  assert.match(migrationSource, /claim_provider_webhook_event/);
  assert.match(
    migrationSource,
    /revoke insert, update, delete on table public\.provider_connections/,
  );
});

test("the connect route rejects anonymous users and always goes through tenant checks", () => {
  assert.match(
    connectRouteSource,
    /const user = await getChatGPTUser\(\);\s*if \(!user\) return Response\.redirect/,
  );
  assert.match(
    connectRouteSource,
    /beginSupabaseStripeConnect\(user, clientId\)/,
  );
});

test("the callback uses a one-time state rather than trusting browser identity", () => {
  assert.match(callbackRouteSource, /finishSupabaseStripeConnect\(/);
  assert.doesNotMatch(callbackRouteSource, /getChatGPTUser/);
  assert.match(callbackRouteSource, /cancelSupabaseStripeConnect/);
});
