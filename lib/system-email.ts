import { readRuntimeValue } from "./supabase/env";

type SystemEmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

type SystemEmailTemplateInput = {
  to: string;
  displayName?: string | null;
  organizationName?: string | null;
  inviterName?: string | null;
  clientName?: string | null;
  role?: string | null;
  link?: string;
};

const RESEND_SEND_EMAIL_URL = "https://api.resend.com/emails";

export function systemEmailConfigured(): boolean {
  return Boolean(
    readRuntimeValue("RESEND_API_KEY") &&
      readRuntimeValue("SYSTEM_EMAIL_FROM"),
  );
}

export async function sendSystemEmail(message: SystemEmailMessage) {
  const apiKey = readRuntimeValue("RESEND_API_KEY");
  const from = readRuntimeValue("SYSTEM_EMAIL_FROM");
  if (!apiKey || !from) {
    throw new Error(
      "System email is not configured. Add RESEND_API_KEY and SYSTEM_EMAIL_FROM.",
    );
  }

  const response = await fetch(RESEND_SEND_EMAIL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      tags: [{ name: "category", value: "account-security" }],
    }),
  });

  if (!response.ok) {
    throw new Error("System email could not be sent.");
  }
}

export function userInvitationEmail(input: SystemEmailTemplateInput): SystemEmailMessage {
  const organizationName = input.organizationName || "BrizBuilder";
  const role = formatRole(input.role);
  const subject = `You have been invited to ${organizationName}`;
  const intro = input.inviterName
    ? `${input.inviterName} invited you to BrizBuilder.`
    : "You have been invited to BrizBuilder.";
  const details = [
    input.clientName ? `Workspace: ${input.clientName}` : `Workspace: ${organizationName}`,
    role ? `Role: ${role}` : null,
  ].filter(Boolean).join("\n");

  return composeEmail({
    to: input.to,
    subject,
    eyebrow: "Account invitation",
    heading: "Finish setting up your BrizBuilder account",
    body: `${intro} Use the secure invite link below to choose your password and open your workspace.`,
    actionLabel: "Accept invite",
    link: requireLink(input.link),
    footer: `${details}\nThis invite is for account access only. BrizBuilder does not send marketing from this address.`,
  });
}

export function emailVerificationEmail(input: SystemEmailTemplateInput): SystemEmailMessage {
  return composeEmail({
    to: input.to,
    subject: "Verify your BrizBuilder email",
    eyebrow: "Email verification",
    heading: "Verify this email address",
    body: "Confirm that this email belongs to you so BrizBuilder can keep account and security messages going to the right place.",
    actionLabel: "Verify email",
    link: requireLink(input.link),
    footer: "This link is single-use and expires soon.",
  });
}

export function passwordResetEmail(input: SystemEmailTemplateInput): SystemEmailMessage {
  return composeEmail({
    to: input.to,
    subject: "Reset your BrizBuilder password",
    eyebrow: "Password reset",
    heading: "Choose a new password",
    body: "We received a request to reset your BrizBuilder password. If this was you, use the secure link below.",
    actionLabel: "Reset password",
    link: requireLink(input.link),
    footer: "If you did not request this, you can ignore this email. The link is single-use and expires soon.",
  });
}

export function passwordChangedAlertEmail(input: SystemEmailTemplateInput): SystemEmailMessage {
  return composeEmail({
    to: input.to,
    subject: "Your BrizBuilder password was changed",
    eyebrow: "Security alert",
    heading: "Your password was changed",
    body: "The password for your BrizBuilder account was changed. If you made this change, no action is needed.",
    footer: "If you did not make this change, contact your BrizBuilder administrator right away.",
  });
}

export function newTeamMemberAlertEmail(input: SystemEmailTemplateInput): SystemEmailMessage {
  const role = formatRole(input.role);
  const details = [
    `${input.displayName || input.to} was added to BrizBuilder.`,
    role ? `Role: ${role}` : null,
    input.clientName ? `Workspace: ${input.clientName}` : null,
  ].filter(Boolean).join("\n");

  return composeEmail({
    to: input.to,
    subject: "New BrizBuilder team member added",
    eyebrow: "Team security",
    heading: "A team member was added",
    body: details,
    footer: "This is an account/security notification, not a marketing email.",
  });
}

function composeEmail(input: {
  to: string;
  subject: string;
  eyebrow: string;
  heading: string;
  body: string;
  actionLabel?: string;
  link?: string;
  footer: string;
}): SystemEmailMessage {
  const configuredBaseUrl = readRuntimeValue("APP_BASE_URL") || "https://brizbuilder.com";
  const logoUrl = new URL(
    "/brand/brizbuilder-wordmark-white.png",
    configuredBaseUrl,
  ).toString();
  const bodyHtml = input.body
    .split("\n")
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
  const footerHtml = input.footer
    .split("\n")
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
  const actionHtml = input.link
    ? `<p><a href="${escapeAttribute(input.link)}" style="display:inline-block;padding:12px 16px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:700">${escapeHtml(input.actionLabel ?? "Open BrizBuilder")}</a></p>`
    : "";
  const linkText = input.link
    ? `\n\n${input.actionLabel ?? "Open BrizBuilder"}: ${input.link}`
    : "";

  return {
    to: input.to,
    subject: input.subject,
    html: `<!doctype html><html><body style="margin:0;background:#f6f7fb;color:#111827;font-family:Arial,sans-serif"><main style="max-width:560px;margin:0 auto;padding:32px 20px"><section style="overflow:hidden;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px"><header style="padding:22px 28px;background:#08090c"><img src="${escapeAttribute(logoUrl)}" width="190" alt="BrizBuilder" style="display:block;width:190px;max-width:100%;height:auto"></header><div style="padding:28px"><p style="margin:0 0 12px;color:#6d28d9;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(input.eyebrow)}</p><h1 style="margin:0 0 16px;font-size:28px;line-height:1.15">${escapeHtml(input.heading)}</h1>${bodyHtml}${actionHtml}<div style="margin-top:22px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;line-height:1.5">${footerHtml}</div></div></section></main></body></html>`,
    text: `${input.heading}\n\n${input.body}${linkText}\n\n${input.footer}`,
  };
}

function requireLink(value: string | undefined): string {
  if (!value) throw new Error("Email link is required.");
  return value;
}

function formatRole(role: string | null | undefined): string | null {
  return role ? role.toLowerCase().replaceAll("_", " ") : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
