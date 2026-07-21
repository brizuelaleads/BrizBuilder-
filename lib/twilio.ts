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
    connectAuthorizeUrl: readRuntimeValue("TWILIO_CONNECT_AUTHORIZE_URL"),
    connectAppSid: readRuntimeValue("TWILIO_CONNECT_APP_SID"),
  };
}

export function getTwilioConnectStatus() {
  const config = runtime();
  return {
    ready: Boolean(config.accountSid && config.authToken),
    authorizeUrl: config.connectAuthorizeUrl,
  };
}

type TwilioConnectApp = {
  sid?: string;
  friendly_name?: string;
  authorize_redirect_url?: string;
  permissions?: string[] | string;
};

const TWILIO_CONNECT_CALLBACK_PATH = "/api/integrations/twilio/callback";
const TWILIO_CONNECT_SID = /^CN[0-9a-f]{32}$/i;
let discoveredConnectAuthorizeUrl: string | undefined;

function twilioAuthorizeUrl(value: string) {
  const url = new URL(value);
  const sid = url.pathname.match(/^\/authorize\/(CN[0-9a-f]{32})\/?$/i)?.[1];
  if (url.protocol !== "https:" || url.hostname !== "www.twilio.com" || !sid)
    throw new Error("BrizBuilder's Twilio Connect authorization URL is invalid.");
  return `https://www.twilio.com/authorize/${sid}`;
}

function hasRequiredConnectPermissions(app: TwilioConnectApp) {
  const permissions = (Array.isArray(app.permissions)
    ? app.permissions
    : String(app.permissions ?? "").split(/[\s,]+/)
  ).map((permission) => permission.toLowerCase());
  return permissions.includes("get-all") && permissions.includes("post-all");
}

function hasBrizBuilderCallback(app: TwilioConnectApp) {
  if (!app.authorize_redirect_url) return false;
  try {
    return new URL(app.authorize_redirect_url).pathname === TWILIO_CONNECT_CALLBACK_PATH;
  } catch {
    return false;
  }
}

async function resolveTwilioConnectAuthorizeUrl() {
  const config = runtime();
  if (config.connectAuthorizeUrl)
    return twilioAuthorizeUrl(config.connectAuthorizeUrl);
  if (TWILIO_CONNECT_SID.test(config.connectAppSid))
    return twilioAuthorizeUrl(
      `https://www.twilio.com/authorize/${config.connectAppSid}`,
    );
  if (discoveredConnectAuthorizeUrl) return discoveredConnectAuthorizeUrl;
  if (!config.accountSid || !config.authToken)
    throw new Error("BrizBuilder's Twilio platform account is not configured yet.");

  const result = await twilioApi<{ connect_apps?: TwilioConnectApp[] }>(
    config.accountSid,
    `/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/ConnectApps.json?PageSize=1000`,
  );
  const apps = (result.connect_apps ?? []).filter(
    (app) =>
      TWILIO_CONNECT_SID.test(app.sid ?? "") &&
      hasRequiredConnectPermissions(app),
  );
  const exactNames = apps.filter(
    (app) => app.friendly_name?.trim().toLowerCase() === "brizbuilder",
  );
  const namedCallbacks = apps.filter(
    (app) =>
      app.friendly_name?.toLowerCase().includes("brizbuilder") &&
      hasBrizBuilderCallback(app),
  );
  const callbackMatches = apps.filter(hasBrizBuilderCallback);
  const exactCallbackNames = exactNames.filter(hasBrizBuilderCallback);
  const unique = (matches: TwilioConnectApp[]) =>
    matches.length === 1 ? matches[0] : undefined;
  const app =
    unique(exactCallbackNames) ??
    unique(namedCallbacks) ??
    unique(callbackMatches) ??
    unique(exactNames);
  if (!app?.sid)
    throw new Error(
      "BrizBuilder could not uniquely identify its Twilio Connect app. Check Twilio Console > Settings > Connect applications.",
    );
  discoveredConnectAuthorizeUrl = twilioAuthorizeUrl(
    `https://www.twilio.com/authorize/${app.sid}`,
  );
  return discoveredConnectAuthorizeUrl;
}

export async function buildTwilioConnectUrl(state: string) {
  const url = new URL(await resolveTwilioConnectAuthorizeUrl());
  url.searchParams.set("state", state);
  return url.toString();
}

async function twilioApi<T>(accountSid: string, path: string, init?: { method?: "GET" | "POST"; body?: Record<string, string> }) {
  const config = runtime();
  if (!config.authToken) throw new Error("The BrizBuilder Twilio connection is not configured.");
  const response = await fetch(`https://api.twilio.com${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Basic ${btoa(`${accountSid}:${config.authToken}`)}`, ...(init?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: init?.body ? encodeForm(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || "Twilio request failed.");
  return payload;
}

async function optionalTwilioApi<T>(request: Promise<T>) {
  try {
    return await request;
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function checkTwilioConnectedAccount(accountSid: string) {
  const basePath = `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}`;
  type UsageRecord = {
    category?: string;
    count?: string;
    price?: number | string;
    price_unit?: string;
    usage?: string;
  };
  const account = await twilioApi<{
    sid: string;
    friendly_name?: string;
    status?: string;
    type?: string;
    owner_account_sid?: string;
  }>(accountSid, `${basePath}.json`);
  const isSubaccount =
    /^AC[0-9a-f]{32}$/i.test(account.owner_account_sid ?? "") &&
    account.owner_account_sid?.toLowerCase() !== account.sid.toLowerCase();
  const [balance, today, month] = await Promise.all([
    isSubaccount
      ? Promise.resolve(null)
      : optionalTwilioApi(
          twilioApi<{ balance?: string; currency?: string }>(
            accountSid,
            `${basePath}/Balance.json`,
          ),
        ),
    optionalTwilioApi(
      twilioApi<{ usage_records?: UsageRecord[] }>(
        accountSid,
        `${basePath}/Usage/Records/Today.json?PageSize=1000&IncludeSubaccounts=false`,
      ),
    ),
    optionalTwilioApi(
      twilioApi<{ usage_records?: UsageRecord[] }>(
        accountSid,
        `${basePath}/Usage/Records/ThisMonth.json?PageSize=1000&IncludeSubaccounts=false`,
      ),
    ),
  ]);
  const summarize = (records: UsageRecord[] | undefined) => {
    if (!Array.isArray(records))
      return { spend: null, currency: null, calls: null, messages: null };
    const find = (category: string) => records.find((item) => item.category === category);
    const total = find("totalprice");
    const calls = find("calls");
    const messages = find("sms");
    return {
      spend: total
        ? finiteNumber(Math.abs(Number(total.price ?? total.usage)))
        : 0,
      currency: total?.price_unit
        ? String(total.price_unit).toUpperCase()
        : null,
      calls: calls ? finiteNumber(calls.count) : 0,
      messages: messages ? finiteNumber(messages.count) : 0,
    };
  };
  const todaySummary = summarize(today?.usage_records);
  const monthSummary = summarize(month?.usage_records);
  const balanceValue = finiteNumber(balance?.balance);
  const currency =
    (balance?.currency ? String(balance.currency).toUpperCase() : null) ??
    monthSummary.currency ??
    todaySummary.currency;
  return {
    sid: account.sid,
    name: account.friendly_name || "Customer Twilio account",
    status: account.status || "unknown",
    accountType: account.type || "Unknown",
    balance: balanceValue,
    balanceStatus: isSubaccount
      ? "shared"
      : balanceValue === null
        ? "unavailable"
        : "available",
    currency,
    today: todaySummary,
    month: monthSummary,
  };
}

export async function searchTwilioNumbers(accountSid: string, areaCode: string) {
  const query = new URLSearchParams({ VoiceEnabled: "true", SmsEnabled: "true", PageSize: "12" });
  if (/^\d{3}$/.test(areaCode)) query.set("AreaCode", areaCode);
  const result = await twilioApi<{ available_phone_numbers?: Array<{ phone_number: string; friendly_name?: string; locality?: string; region?: string; capabilities?: Record<string, boolean> }> }>(accountSid, `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/AvailablePhoneNumbers/US/Local.json?${query}`);
  return (result.available_phone_numbers ?? []).map((item) => ({ phoneNumber: item.phone_number, label: item.friendly_name || item.phone_number, locality: item.locality || "", region: item.region || "" }));
}

export async function listTwilioNumbers(accountSid: string) {
  const result = await twilioApi<{
    incoming_phone_numbers?: Array<{
      sid: string;
      phone_number: string;
      friendly_name?: string;
    }>;
  }>(
    accountSid,
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PageSize=50`,
  );
  return (result.incoming_phone_numbers ?? []).map((item) => ({
    sid: item.sid,
    phoneNumber: item.phone_number,
    label: item.friendly_name || item.phone_number,
  }));
}

export async function configureTwilioNumber(
  accountSid: string,
  phoneNumberSid: string,
) {
  const config = runtime();
  const result = await twilioApi<{
    sid: string;
    phone_number: string;
    friendly_name?: string;
  }>(
    accountSid,
    `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(phoneNumberSid)}.json`,
    {
      method: "POST",
      body: {
        VoiceUrl: `${config.webhookBaseUrl}/api/twilio/voice`,
        VoiceMethod: "POST",
        SmsUrl: `${config.webhookBaseUrl}/api/twilio/messages/incoming`,
        SmsMethod: "POST",
      },
    },
  );
  return {
    sid: result.sid,
    phoneNumber: result.phone_number,
    label: result.friendly_name || result.phone_number,
  };
}

export async function purchaseTwilioNumber(accountSid: string, phoneNumber: string) {
  const config = runtime();
  const result = await twilioApi<{ sid: string; phone_number: string }>(accountSid, `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json`, { method: "POST", body: { PhoneNumber: phoneNumber, VoiceUrl: `${config.webhookBaseUrl}/api/twilio/voice`, VoiceMethod: "POST", SmsUrl: `${config.webhookBaseUrl}/api/twilio/messages/incoming`, SmsMethod: "POST" } });
  return { sid: result.sid, phoneNumber: result.phone_number };
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
