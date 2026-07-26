import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const authSource = read("app/chatgpt-auth.ts");
const loginRoute = read("app/api/auth/login/route.ts");
const logoutRoute = read("app/api/auth/logout/route.ts");
const crmSource = read("db/supabase-crm.ts");
const proxySource = read("proxy.ts");
const mcpRoute = read("app/mcp/route.ts");
const twilioWebhook = read("app/api/twilio/messages/incoming/route.ts");

test("the session is validated with the auth server, never trusted from the cookie", () => {
  const block = authSource.match(
    /async function verifySupabaseSession\([\s\S]*?\n\}/,
  )?.[0];
  assert.ok(block, "verifySupabaseSession exists");
  assert.match(block, /supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(
    authSource,
    /auth\.getSession\(\)/,
    "getSession trusts the cookie payload and must not gate access",
  );
  // The email is re-normalized rather than taken raw from the token payload.
  assert.match(block, /normalizedEmail\(data\.user\.email\)/);
});

test("sign-in never leaks the password and throttles repeated attempts", () => {
  assert.match(loginRoute, /signInWithPassword\(\{ email, password \}\)/);
  assert.doesNotMatch(loginRoute, /console\.(log|error|warn)/, "no password logging");
  // Failures reveal nothing about which half was wrong.
  assert.match(loginRoute, /"invalid"/);
  assert.doesNotMatch(loginRoute, /no such user|unknown email|wrong password/i);
  assert.match(loginRoute, /MAX_ATTEMPTS_PER_WINDOW/);
  assert.match(loginRoute, /cf-connecting-ip/);
});

test("sign-in and sign-out resist redirect and CSRF abuse", () => {
  // Open-redirect guard on the post-login destination.
  assert.match(loginRoute, /value\.startsWith\("\/\/"\)/);
  assert.match(loginRoute, /function safeReturnTo/);
  // Logout is POST-only: a GET handler would be triggerable by any link.
  assert.match(logoutRoute, /export async function POST/);
  assert.doesNotMatch(logoutRoute, /export async function GET/);
  assert.match(authSource, /return "\/api\/auth\/logout"/);
});

test("passwords must clear a real length bar before they are accepted", () => {
  assert.match(crmSource, /const MIN_PASSWORD_LENGTH = 12/);
  const guard = crmSource.match(/function assertUsablePassword\([\s\S]*?\n\}/)?.[0];
  assert.ok(guard, "assertUsablePassword exists");
  assert.match(guard, /password\.length < MIN_PASSWORD_LENGTH/);
  for (const action of ["invite_member", "set_member_password", "change_own_password"]) {
    const block = crmSource.match(
      new RegExp(`if \\(action === "${action}"\\) \\{[\\s\\S]*?\\n {2}\\}\\n`),
    )?.[0];
    assert.ok(block, `${action} exists`);
    assert.match(block, /assertUsablePassword\(password\)/, `${action} validates strength`);
  }
});

test("changing your own password cannot target anyone else", () => {
  const block = crmSource.match(
    /if \(action === "change_own_password"\) \{[\s\S]*?\n {2}\}\n/,
  )?.[0];
  assert.ok(block, "change_own_password exists");
  // The session client is scoped to the caller; the admin client is not used.
  assert.match(block, /sessionClient\.auth\.updateUser\(\{ password \}\)/);
  assert.doesNotMatch(block, /auth\.admin/, "must not use the admin client");
  assert.doesNotMatch(block, /input\.(memberId|email|profileId)/, "takes no target identifier");
});

test("setting someone else's password keeps the tenant guards", () => {
  const block = crmSource.match(
    /if \(action === "set_member_password"\) \{[\s\S]*?\n {2}\}\n/,
  )?.[0];
  assert.ok(block, "set_member_password exists");
  const permissionIndex = block.indexOf('requirePermission(context, "team.manage")');
  const updateIndex = block.indexOf("auth.admin.updateUserById");
  assert.ok(permissionIndex >= 0 && updateIndex > permissionIndex);
  // A client owner is pinned to the client branch and to their own sub-account.
  assert.match(block, /const scope = context\.clientId\s*\?\s*"client"/);
  assert.match(block, /\.eq\("client_id", context\.clientId\)/);
  assert.match(block, /\.eq\("organization_id", context\.organizationId\)/);
});

test("no password is ever written to the audit trail", () => {
  for (const action of ["set_member_password", "change_own_password", "invite_member"]) {
    const block = crmSource.match(
      new RegExp(`if \\(action === "${action}"\\) \\{[\\s\\S]*?\\n {2}\\}\\n`),
    )?.[0];
    const auditCall = block.match(/await audit\([\s\S]*?\);/)?.[0] ?? "";
    // Strip quoted strings first: action names like "team.password_set"
    // legitimately contain the word. What must never appear is the password
    // *value* being passed through as a variable.
    const withoutStringLiterals = auditCall.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');
    assert.doesNotMatch(
      withoutStringLiterals,
      /\bpassword\b/i,
      `${action} audit metadata must omit the password value`,
    );
  }
});

test("machine-to-machine routes stay outside the human session system", () => {
  for (const [name, source] of [["mcp", mcpRoute], ["twilio webhook", twilioWebhook]]) {
    assert.doesNotMatch(
      source,
      /getChatGPTUser/,
      `${name} must not depend on a browser session`,
    );
  }
  // And they are excluded from the session-refresh middleware.
  for (const fragment of ["mcp", "api/twilio", "api/website-leads", "oauth/token"]) {
    assert.ok(
      proxySource.includes(fragment),
      `proxy matcher should exclude ${fragment}`,
    );
  }
});
