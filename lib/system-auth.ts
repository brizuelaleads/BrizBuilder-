import type { CrmRole } from "../db/crm";
import { getSupabaseAdminClient } from "./supabase/server";
import {
  buildAppLink,
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  expiresAt,
  generateSystemToken,
  hashSystemToken,
  INVITE_TOKEN_TTL_MS,
  PASSWORD_RESET_TOKEN_TTL_MS,
} from "./system-tokens";
import {
  emailVerificationEmail,
  newTeamMemberAlertEmail,
  passwordChangedAlertEmail,
  passwordResetEmail,
  sendSystemEmail,
  userInvitationEmail,
} from "./system-email";

type TokenRow = {
  id: string;
  profile_id: string;
  email: string;
};

type InviteInput = {
  profileId: string;
  email: string;
  displayName: string;
  role: CrmRole;
  organizationId: string;
  organizationName: string;
  clientId: string | null;
  clientName: string | null;
  inviterEmail: string;
  inviterName: string;
  request?: Request;
};

type TeamAlertInput = {
  adminEmail: string;
  displayName: string;
  email: string;
  role: CrmRole;
  clientName: string | null;
};

const MIN_PASSWORD_LENGTH = 12;

export class SystemAuthTokenError extends Error {
  constructor() {
    super("This link is invalid or expired.");
  }
}

export function normalizeSystemEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return null;
  }
  return email;
}

export function assertSystemPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
  }
  if (password.length > 200) throw new Error("That password is too long.");
  if (!/\S/.test(password)) throw new Error("Enter a real password.");
}

export async function ensureSupabaseInviteProfile(input: {
  email: string;
  displayName: string;
}): Promise<string> {
  const existing = await selectProfileByEmail(input.email);
  if (existing?.id) {
    await upsertProfile(String(existing.id), input.email, input.displayName);
    return String(existing.id);
  }

  const created = await supabase().auth.admin.createUser({
    email: input.email,
    email_confirm: false,
    user_metadata: { display_name: input.displayName },
  });
  if (created.error && !/already/i.test(created.error.message)) {
    throw new Error(`The sign-in account could not be created: ${created.error.message}`);
  }

  const profileId = created.data.user?.id ?? String((await selectProfileByEmail(input.email))?.id ?? "");
  if (!profileId) throw new Error("The sign-in account was not created.");
  await upsertProfile(profileId, input.email, input.displayName);
  return profileId;
}

export async function createInviteTokenAndSendEmail(input: InviteInput) {
  const rawToken = generateSystemToken();
  const tokenHash = await hashSystemToken(rawToken);
  const now = new Date().toISOString();
  await supabase()
    .from("invite_tokens")
    .update({ used_at: now })
    .eq("profile_id", input.profileId)
    .is("used_at", null);
  await assertOk(
    supabase().from("invite_tokens").insert({
      profile_id: input.profileId,
      organization_id: input.organizationId,
      client_id: input.clientId,
      email: input.email,
      role: input.role,
      token_hash: tokenHash,
      expires_at: expiresAt(INVITE_TOKEN_TTL_MS),
      created_by_email: input.inviterEmail,
    }),
  );
  const link = buildAppLink("/accept-invite", { token: rawToken }, input.request);
  await sendSystemEmail(
    userInvitationEmail({
      to: input.email,
      displayName: input.displayName,
      organizationName: input.organizationName,
      inviterName: input.inviterName,
      clientName: input.clientName,
      role: input.role,
      link,
    }),
  );
}

export async function acceptInviteWithToken(token: string, password: string, request?: Request) {
  assertSystemPassword(password);
  const consumed = await consumeToken("invite_tokens", token);
  const updated = await supabase().auth.admin.updateUserById(consumed.profile_id, {
    password,
    email_confirm: true,
  });
  if (updated.error) throw new Error(`The password could not be set: ${updated.error.message}`);
  await bestEffortSecurityEmail(() => sendPasswordChangedAlert(consumed.email));
  await bestEffortSecurityEmail(() => requestEmailVerificationEmail(consumed.email, request));
}

export async function requestPasswordResetEmail(emailInput: unknown, request?: Request) {
  const email = normalizeSystemEmail(emailInput);
  if (!email) return;
  const profile = await selectProfileByEmail(email);
  if (!profile?.id) return;

  const rawToken = generateSystemToken();
  const tokenHash = await hashSystemToken(rawToken);
  const now = new Date().toISOString();
  await supabase()
    .from("password_reset_tokens")
    .update({ used_at: now })
    .eq("profile_id", String(profile.id))
    .is("used_at", null);
  await assertOk(
    supabase().from("password_reset_tokens").insert({
      profile_id: String(profile.id),
      email,
      token_hash: tokenHash,
      expires_at: expiresAt(PASSWORD_RESET_TOKEN_TTL_MS),
    }),
  );
  const link = buildAppLink("/reset-password", { token: rawToken }, request);
  await sendSystemEmail(passwordResetEmail({ to: email, link }));
}

export async function resetPasswordWithToken(token: string, password: string) {
  assertSystemPassword(password);
  const consumed = await consumeToken("password_reset_tokens", token);
  const updated = await supabase().auth.admin.updateUserById(consumed.profile_id, {
    password,
    email_confirm: true,
  });
  if (updated.error) throw new Error(`The password could not be reset: ${updated.error.message}`);
  await bestEffortSecurityEmail(() => sendPasswordChangedAlert(consumed.email));
}

export async function requestEmailVerificationEmail(emailInput: unknown, request?: Request) {
  const email = normalizeSystemEmail(emailInput);
  if (!email) return;
  const profile = await selectProfileByEmail(email);
  if (!profile?.id) return;

  const rawToken = generateSystemToken();
  const tokenHash = await hashSystemToken(rawToken);
  const now = new Date().toISOString();
  await supabase()
    .from("email_verification_tokens")
    .update({ used_at: now })
    .eq("profile_id", String(profile.id))
    .is("used_at", null);
  await assertOk(
    supabase().from("email_verification_tokens").insert({
      profile_id: String(profile.id),
      email,
      token_hash: tokenHash,
      expires_at: expiresAt(EMAIL_VERIFICATION_TOKEN_TTL_MS),
    }),
  );
  const link = buildAppLink("/api/auth/verify-email", { token: rawToken }, request);
  await sendSystemEmail(emailVerificationEmail({ to: email, link }));
}

export async function verifyEmailWithToken(token: string) {
  const consumed = await consumeToken("email_verification_tokens", token);
  const updated = await supabase().auth.admin.updateUserById(consumed.profile_id, {
    email_confirm: true,
  });
  if (updated.error) throw new Error(`The email could not be verified: ${updated.error.message}`);
}

export async function sendPasswordChangedAlert(emailInput: unknown) {
  const email = normalizeSystemEmail(emailInput);
  if (!email) return;
  await sendSystemEmail(passwordChangedAlertEmail({ to: email }));
}

export async function sendNewTeamMemberAlertIfPractical(input: TeamAlertInput) {
  if (input.adminEmail === input.email) return;
  await sendSystemEmail(
    newTeamMemberAlertEmail({
      to: input.adminEmail,
      displayName: input.displayName,
      role: input.role,
      clientName: input.clientName,
    }),
  );
}

async function consumeToken(table: string, token: string): Promise<TokenRow> {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new SystemAuthTokenError();
  const tokenHash = await hashSystemToken(token);
  const now = new Date().toISOString();
  const row = await assertOk(
    supabase()
      .from(table)
      .update({ used_at: now })
      .eq("token_hash", tokenHash)
      .is("used_at", null)
      .gt("expires_at", now)
      .select("id,profile_id,email")
      .maybeSingle(),
  );
  if (!row) throw new SystemAuthTokenError();
  return row as TokenRow;
}

async function bestEffortSecurityEmail(send: () => Promise<unknown>) {
  try {
    await send();
  } catch {
    // The account/security state change has already succeeded. Avoid surfacing
    // email-provider outages as failed password or invite flows.
  }
}

async function selectProfileByEmail(email: string) {
  return assertOk(
    supabase()
      .from("profiles")
      .select("id,email,display_name,status")
      .eq("email", email)
      .neq("status", "archived")
      .maybeSingle(),
  );
}

async function upsertProfile(profileId: string, email: string, displayName: string) {
  await assertOk(
    supabase()
      .from("profiles")
      .upsert(
        {
          id: profileId,
          email,
          display_name: displayName,
          status: "active",
        },
        { onConflict: "id" },
      ),
  );
}

function supabase() {
  return getSupabaseAdminClient();
}

async function assertOk<T>(
  result: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await result;
  if (error) throw new Error(error.message);
  return data;
}
