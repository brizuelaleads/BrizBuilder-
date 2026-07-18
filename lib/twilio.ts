import { readRuntimeValue } from "./supabase/env";

export type TwilioRuntimeStatus = {
  configured: boolean;
  webhookBaseUrl: string;
};

function runtime() {
  return {
    accountSid: readRuntimeValue("TWILIO_ACCOUNT_SID"),
    authToken: readRuntimeValue("TWILIO_AUTH_TOKEN"),
    fromNumber: readRuntimeValue("TWILIO_FROM_NUMBER"),
    webhookBaseUrl: (readRuntimeValue("TWILIO_WEBHOOK_BASE_URL") || "https://brizbuilder-leads.brizuelaleads.workers.dev").replace(/\/$/, ""),
  };
}

export function getTwilioRuntimeStatus(): TwilioRuntimeStatus {
  const config = runtime();
  return { configured: Boolean(config.accountSid && config.authToken), webhookBaseUrl: config.webhookBaseUrl };
}

export function getTwilioWebhookBaseUrl() {
  return runtime().webhookBaseUrl;
}

function encodeForm(values: Record<string, string>) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

export async function sendTwilioMessage(input: {
  accountSid?: string | null;
  fromNumber?: string | null;
  messagingServiceSid?: string | null;
  to: string;
  body: string;
}) {
  const config = runtime();
  const accountSid = input.accountSid?.trim() || config.accountSid;
  if (!accountSid || !config.authToken) throw new Error("Twilio is not connected. Add the Twilio Account SID and Auth Token in Cloudflare first.");
  const fromNumber = input.fromNumber?.trim() || config.fromNumber;
  if (!fromNumber && !input.messagingServiceSid) throw new Error("A Twilio phone number or Messaging Service is required.");

  const statusCallback = `${config.webhookBaseUrl}/api/twilio/messages/status`;
  const body: Record<string, string> = {
    To: input.to,
    Body: input.body.slice(0, 1600),
    StatusCallback: statusCallback,
  };
  if (input.messagingServiceSid) body.MessagingServiceSid = input.messagingServiceSid;
  else body.From = fromNumber;

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${config.authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(body),
  });
  const payload = await response.json() as { sid?: string; status?: string; message?: string; code?: number };
  if (!response.ok || !payload.sid) throw new Error(payload.message || "Twilio could not send the message.");
  return { sid: payload.sid, status: payload.status || "queued" };
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function validateTwilioFormRequest(url: string, form: URLSearchParams, signature: string | null) {
  const authToken = runtime().authToken;
  if (!authToken || !signature) return false;
  const sorted = [...form.entries()].sort(([left], [right]) => left.localeCompare(right));
  const payload = sorted.reduce((value, [key, entry]) => `${value}${key}${entry}`, url);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return constantTimeEqual(toBase64(new Uint8Array(digest)), signature);
}

export function renderMessageTemplate(template: string, values: Record<string, string>) {
  return template.slice(0, 1600).replace(/\{\{\s*([a-z][a-z0-9_.]{0,79})\s*\}\}/gi, (_match, key: string) => values[key.toLowerCase()] ?? "");
}

export function escapeTwiml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export const SMS_STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"]);
