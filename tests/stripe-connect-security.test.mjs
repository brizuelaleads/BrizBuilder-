import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const stripeLibSource = fs.readFileSync(path.join(root, "lib/stripe.ts"), "utf8");
const supabaseCrmSource = fs.readFileSync(path.join(root, "db/supabase-crm.ts"), "utf8");
const d1CrmSource = fs.readFileSync(path.join(root, "db/crm.ts"), "utf8");
const connectRouteSource = fs.readFileSync(
  path.join(root, "app/api/integrations/stripe/connect/route.ts"),
  "utf8",
);
const callbackRouteSource = fs.readFileSync(
  path.join(root, "app/api/integrations/stripe/callback/route.ts"),
  "utf8",
);

function rolePermissionBlock(source, role) {
  const match = source.match(new RegExp(`${role}:\\s*\\[([\\s\\S]*?)\\]`));
  assert.ok(match, `${role} permission array exists`);
  return match[1];
}

test("Stripe Standard accounts never receive a stored per-customer bearer token", () => {
  const body = stripeLibSource.match(
    /export async function exchangeStripeConnectCode\([\s\S]*?\n}/,
  )?.[0];
  assert.ok(body, "exchangeStripeConnectCode exists");
  const returnStatement = body.match(/return \{[^}]*\};/)?.[0];
  assert.ok(returnStatement, "exchangeStripeConnectCode has a return statement");
  assert.equal(
    returnStatement,
    "return { accountId: String(payload.stripe_user_id) };",
    "only the connected account id is returned — Stripe's OAuth access/refresh token is discarded",
  );
  assert.match(
    body,
    /STRIPE_ACCOUNT_ID\.test\(payload\.stripe_user_id/,
    "the connected account id is validated before use",
  );
});

test("Stripe account ids are validated with an acct_ prefix pattern before any API call", () => {
  assert.match(stripeLibSource, /const STRIPE_ACCOUNT_ID = \/\^acct_\[A-Za-z0-9\]\{8,\}\$\//);
  assert.match(
    stripeLibSource,
    /export async function checkStripeConnectedAccount\(accountId: string\) \{\s*if \(!STRIPE_ACCOUNT_ID\.test\(accountId\)\)/,
  );
});

test("Stripe Connect authorization URL only ever targets Stripe's own OAuth endpoint", () => {
  assert.match(
    stripeLibSource,
    /new URL\("https:\/\/connect\.stripe\.com\/oauth\/authorize"\)/,
  );
  assert.match(stripeLibSource, /url\.searchParams\.set\("state", state\)/);
});

test("beginSupabaseStripeConnect requires payments.manage and client access before creating a state row", () => {
  const body = supabaseCrmSource.match(
    /export async function beginSupabaseStripeConnect\([\s\S]*?\n}/,
  )?.[0];
  assert.ok(body, "beginSupabaseStripeConnect exists");
  const permissionIndex = body.indexOf('requirePermission(context, "payments.manage")');
  const clientIndex = body.indexOf("requireClient(context, clientId)");
  const insertIndex = body.indexOf('.from("provider_authorization_states")');
  assert.ok(permissionIndex >= 0, "permission check present");
  assert.ok(clientIndex > permissionIndex, "client access checked after permission");
  assert.ok(insertIndex > clientIndex, "state row only created after both checks pass");
  assert.match(body, /provider: "stripe"/);
  assert.match(body, /state_hash: await stateHash\(state\)/);
});

test("finishSupabaseStripeConnect enforces single-use, expiring, provider-scoped authorization state", () => {
  const body = supabaseCrmSource.match(
    /export async function finishSupabaseStripeConnect\([\s\S]*?\n}/,
  )?.[0];
  assert.ok(body, "finishSupabaseStripeConnect exists");
  assert.match(body, /\.eq\("provider", "stripe"\)/);
  assert.match(body, /\.is\("used_at", null\)/, "unused-only lookup (no replay of a consumed state)");
  assert.match(body, /\.gt\("expires_at", now\)/, "expired states are rejected");
  assert.match(body, /\.update\(\{ used_at: now \}\)/, "the state is marked used after a successful exchange");
  assert.doesNotMatch(
    body,
    /phone_system_configs/,
    "Stripe connect must not touch the Twilio-specific phone system config table",
  );
  assert.match(body, /onConflict: "organization_id,client_id,provider"/);
});

test("disconnect_provider and check_provider_connection are provider-aware and default to twilio", () => {
  assert.match(
    supabaseCrmSource,
    /if \(action === "disconnect_provider"\) \{\s*const provider = optionalText\(input\.provider, 40\) \?\? "twilio";/,
  );
  assert.match(
    supabaseCrmSource,
    /if \(action === "check_provider_connection"\) \{\s*const provider = optionalText\(input\.provider, 40\) \?\? "twilio";/,
  );

  const disconnectBody = supabaseCrmSource.match(
    /if \(action === "disconnect_provider"\) \{[\s\S]*?\n {2}\}\n/,
  )?.[0];
  assert.ok(disconnectBody, "disconnect_provider handler exists");
  assert.match(
    disconnectBody,
    /requirePermission\(\s*context,\s*provider === "stripe" \? "payments\.manage" : "phone_system\.manage",\s*\)/,
  );
  assert.match(
    disconnectBody,
    /if \(provider === "twilio"\) \{[\s\S]*phone_system_configs/,
    "Twilio-only side effects are guarded behind a provider check",
  );
  assert.match(disconnectBody, /\.eq\("provider", provider\)/);

  const checkBody = supabaseCrmSource.match(
    /if \(action === "check_provider_connection"\) \{[\s\S]*?\n {2}\}\n\n {2}if \(action === "search_twilio_numbers"\)/,
  )?.[0];
  assert.ok(checkBody, "check_provider_connection handler exists");
  assert.match(
    checkBody,
    /requirePermission\(\s*context,\s*provider === "stripe" \? "payments\.manage" : "phone_system\.manage",\s*\)/,
  );
  assert.match(checkBody, /if \(provider === "stripe"\) \{/, "a dedicated Stripe branch exists");
  assert.match(checkBody, /checkStripeConnectedAccount\(/);
  assert.match(checkBody, /checkTwilioConnectedAccount\(/, "the Twilio branch is preserved unchanged");
});

test("payments.manage exists and is restricted to owner-tier roles, matching billing.read_shared", () => {
  assert.match(d1CrmSource, /"billing\.read_shared"\s*\n\s*\|\s*"payments\.manage"/);

  for (const role of ["SUPER_ADMIN", "AGENCY_OWNER", "AGENCY_ADMIN", "CLIENT_OWNER"]) {
    assert.match(
      rolePermissionBlock(supabaseCrmSource, role),
      /"payments\.manage"/,
      `${role} should have payments.manage`,
    );
  }
  for (const role of ["AGENCY_MEMBER", "CLIENT_MANAGER", "CLIENT_EMPLOYEE"]) {
    assert.doesNotMatch(
      rolePermissionBlock(supabaseCrmSource, role),
      /"payments\.manage"/,
      `${role} should not have payments.manage`,
    );
  }
});

test("the Stripe connect route rejects anonymous requests and never trusts a client-supplied clientId without going through beginSupabaseStripeConnect", () => {
  assert.match(
    connectRouteSource,
    /const user = await getChatGPTUser\(\);\s*if \(!user\) return Response\.redirect\(new URL\("\/", request\.url\)\);/,
  );
  assert.match(connectRouteSource, /beginSupabaseStripeConnect\(user, clientId\)/);
});

test("the Stripe callback route authorizes via the one-time state token, not a trusted client identity", () => {
  assert.match(callbackRouteSource, /finishSupabaseStripeConnect\(/);
  assert.doesNotMatch(
    callbackRouteSource,
    /getChatGPTUser/,
    "the callback is a provider redirect with no browser session; authorization comes from the state row",
  );
  assert.match(callbackRouteSource, /Stripe connection was canceled/);
});
