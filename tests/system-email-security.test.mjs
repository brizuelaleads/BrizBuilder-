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
const exists = (rel) => fs.existsSync(path.join(root, rel));

const emailSource = read("lib/system-email.ts");
const tokenSource = read("lib/system-tokens.ts");
const authSource = read("lib/system-auth.ts");
const supabaseCrmSource = read("db/supabase-crm.ts");
const formsSource = read("app/crm/ActionForms.tsx");
const opsSource = read("app/crm/OperationsViews.tsx");
const forgotRoute = read("app/api/auth/forgot-password/route.ts");
const resetRoute = read("app/api/auth/reset-password/route.ts");
const acceptRoute = read("app/api/auth/accept-invite/route.ts");
const verifyRoute = read("app/api/auth/verify-email/route.ts");
const envExample = read(".env.example");
const packageJson = read("package.json");
const supabaseMigration = read("supabase/migrations/20260812212413_system_email_tokens.sql");

test("system email is transactional-only and stays server-side", () => {
  assert.match(emailSource, /RESEND_API_KEY/);
  assert.match(emailSource, /SYSTEM_EMAIL_FROM/);
  assert.match(emailSource, /https:\/\/api\.resend\.com\/emails/);
  assert.match(emailSource, /category.*account-security/s);
  assert.doesNotMatch(emailSource, /broadcasts|audience|contacts/i);
  assert.doesNotMatch(formsSource, /RESEND_API_KEY|SYSTEM_EMAIL_FROM/);
  assert.doesNotMatch(opsSource, /RESEND_API_KEY|SYSTEM_EMAIL_FROM/);
});

test("all required account email types exist", () => {
  for (const template of [
    "userInvitationEmail",
    "emailVerificationEmail",
    "passwordResetEmail",
    "passwordChangedAlertEmail",
    "newTeamMemberAlertEmail",
  ]) {
    assert.match(emailSource, new RegExp(`function ${template}\\b|const ${template}\\b|export function ${template}\\b`));
  }
  assert.match(supabaseCrmSource, /createInviteTokenAndSendEmail/);
  assert.match(authSource, /requestEmailVerificationEmail/);
  assert.match(authSource, /requestPasswordResetEmail/);
  assert.match(supabaseCrmSource, /sendPasswordChangedAlert\(context\.email\)/);
  assert.match(supabaseCrmSource, /sendNewTeamMemberAlertIfPractical/);
});

test("raw tokens are never stored and token tables are locked down", () => {
  for (const table of [
    "invite_tokens",
    "password_reset_tokens",
    "email_verification_tokens",
  ]) {
    assert.match(supabaseMigration, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
    assert.match(supabaseMigration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(supabaseMigration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i"));
  }
  assert.match(supabaseMigration, /token_hash text not null unique/i);
  assert.doesNotMatch(supabaseMigration, /\braw_?token\b/i);
  assert.doesNotMatch(supabaseMigration, /^\s*token\s+text\b/im);
  assert.match(tokenSource, /generateSystemToken/);
  assert.match(tokenSource, /hashSystemToken/);
  assert.match(authSource, /tokenHash = await hashSystemToken\(rawToken\)/);
});

test("tokens are single-use and expired or used links fail", () => {
  const consumeBlock = authSource.match(/async function consumeToken\([\s\S]*?\n\}/)?.[0];
  assert.ok(consumeBlock, "consumeToken helper exists");
  assert.match(consumeBlock, /\.update\(\{ used_at: now \}\)/);
  assert.match(consumeBlock, /\.eq\("token_hash", tokenHash\)/);
  assert.match(consumeBlock, /\.is\("used_at", null\)/);
  assert.match(consumeBlock, /\.gt\("expires_at", now\)/);
  assert.match(consumeBlock, /throw new SystemAuthTokenError/);
});

test("password reset does not reveal whether an account exists", () => {
  assert.match(forgotRoute, /requestPasswordResetEmail/);
  assert.match(forgotRoute, /forgot-password\?sent=1/);
  assert.match(forgotRoute, /catch \{/);
  assert.doesNotMatch(forgotRoute, /not found|unknown|no account/i);
  assert.doesNotMatch(forgotRoute, /console\.(log|warn|error)/);
});

test("account pages and API routes are present", () => {
  for (const rel of [
    "app/forgot-password/page.tsx",
    "app/reset-password/page.tsx",
    "app/accept-invite/page.tsx",
    "app/verify-email/page.tsx",
    "app/api/auth/forgot-password/route.ts",
    "app/api/auth/reset-password/route.ts",
    "app/api/auth/accept-invite/route.ts",
    "app/api/auth/verify-email/route.ts",
  ]) {
    assert.ok(exists(rel), `${rel} exists`);
  }
  assert.match(resetRoute, /resetPasswordWithToken/);
  assert.match(acceptRoute, /acceptInviteWithToken/);
  assert.match(verifyRoute, /verifyEmailWithToken/);
});

test("admins no longer create or share invite passwords", () => {
  const inviteBlock = supabaseCrmSource.match(
    /if \(action === "invite_member"\) \{[\s\S]*?\n {2}\}\n/,
  )?.[0];
  assert.ok(inviteBlock, "invite_member handler exists");
  assert.doesNotMatch(inviteBlock, /input\.password|assertUsablePassword\(password\)|email_confirm: true/);
  assert.match(inviteBlock, /ensureSupabaseInviteProfile/);
  assert.match(inviteBlock, /createInviteTokenAndSendEmail/);
  assert.doesNotMatch(formsSource, /Starting password|name="password"|cannot email it yet|Give them this password/i);
  assert.match(formsSource, /secure invite link/);
});

test("team resets send email instead of prompting for a password", () => {
  assert.doesNotMatch(opsSource, /window\.prompt\(`Set a new password/);
  assert.match(opsSource, /action: "send_member_password_reset"/);
  assert.match(supabaseCrmSource, /if \(action === "send_member_password_reset"\)/);
  assert.match(supabaseCrmSource, /requestPasswordResetEmail\(member\.email\)/);
});

test("environment and package scripts include system email support", () => {
  for (const name of ["RESEND_API_KEY", "SYSTEM_EMAIL_FROM", "APP_BASE_URL"]) {
    assert.match(envExample, new RegExp(`^${name}=`, "m"));
  }
  assert.match(packageJson, /"test:system-email"/);
  assert.match(packageJson, /npm run test:system-email/);
});
