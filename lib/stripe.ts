import { readRuntimeValue } from "./supabase/env";

export type StripeRuntimeStatus = {
  configured: boolean;
  oauthConfigured: boolean;
  embeddedConfigured: boolean;
  webhookConfigured: boolean;
};

export type StripeConnectPrefill = {
  businessName?: string | null;
  email?: string | null;
  website?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  industry?: string | null;
};

export type StripeSessionCapabilities = {
  accountManagement: boolean;
  onboarding: boolean;
  refunds: boolean;
  disputes: boolean;
  payouts: boolean;
  instantPayouts: boolean;
  paymentsRead: boolean;
  payoutsRead: boolean;
};

export type StripeWebhookEvent = {
  id: string;
  type: string;
  livemode: boolean;
  account?: string | null;
  data?: { object?: Record<string, unknown> };
};

const STRIPE_ACCOUNT_ID = /^acct_[A-Za-z0-9]{8,}$/;
const STRIPE_PUBLISHABLE_KEY = /^pk_(?:test|live)_[A-Za-z0-9_]+$/;
const STRIPE_API_VERSION = "2025-05-28.basil";
const WEBHOOK_TOLERANCE_SECONDS = 300;

function runtime() {
  return {
    secretKey: readRuntimeValue("STRIPE_SECRET_KEY"),
    publishableKey:
      readRuntimeValue("STRIPE_PUBLISHABLE_KEY") ||
      readRuntimeValue("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
    connectClientId: readRuntimeValue("STRIPE_CONNECT_CLIENT_ID"),
    connectRedirectUri: readRuntimeValue("STRIPE_CONNECT_REDIRECT_URI"),
    webhookSecret: readRuntimeValue("STRIPE_WEBHOOK_SECRET"),
    embeddedEnabled:
      readRuntimeValue("STRIPE_EMBEDDED_ENABLED").toLowerCase() === "true",
    paymentsReadEnabled:
      readRuntimeValue("STRIPE_EMBEDDED_PAYMENTS_READ_ENABLED").toLowerCase() ===
      "true",
    payoutsReadEnabled:
      readRuntimeValue("STRIPE_EMBEDDED_PAYOUTS_READ_ENABLED").toLowerCase() ===
      "true",
    onboardingEnabled:
      readRuntimeValue("STRIPE_EMBEDDED_ONBOARDING_ENABLED").toLowerCase() ===
      "true",
    accountManagementEnabled:
      readRuntimeValue(
        "STRIPE_EMBEDDED_ACCOUNT_MANAGEMENT_ENABLED",
      ).toLowerCase() === "true",
    refundsEnabled:
      readRuntimeValue("STRIPE_EMBEDDED_REFUNDS_ENABLED").toLowerCase() ===
      "true",
    disputesEnabled:
      readRuntimeValue("STRIPE_EMBEDDED_DISPUTES_ENABLED").toLowerCase() ===
      "true",
    payoutsEnabled:
      readRuntimeValue("STRIPE_EMBEDDED_PAYOUTS_ENABLED").toLowerCase() ===
      "true",
    liveModeEnabled:
      readRuntimeValue("STRIPE_EMBEDDED_LIVE_MODE_ENABLED").toLowerCase() ===
      "true",
  };
}

function keyIsLive(value: string) {
  return value.startsWith("sk_live_") || value.startsWith("pk_live_");
}

function embeddedKeyModesMatch(config: ReturnType<typeof runtime>) {
  return Boolean(
    config.secretKey &&
      config.publishableKey &&
      keyIsLive(config.secretKey) === keyIsLive(config.publishableKey),
  );
}

export function getStripeConnectStatus() {
  const config = runtime();
  return {
    ready: Boolean(
      config.secretKey && config.connectClientId && config.connectRedirectUri,
    ),
  };
}

export function getStripeRuntimeStatus(): StripeRuntimeStatus {
  const config = runtime();
  const oauthConfigured = getStripeConnectStatus().ready;
  return {
    configured: oauthConfigured,
    oauthConfigured,
    embeddedConfigured: Boolean(
      config.embeddedEnabled &&
        config.secretKey &&
        config.publishableKey &&
        STRIPE_PUBLISHABLE_KEY.test(config.publishableKey) &&
        embeddedKeyModesMatch(config),
    ),
    webhookConfigured: Boolean(config.secretKey && config.webhookSecret),
  };
}

function validEmail(value: string | null | undefined) {
  const candidate = value?.trim() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function validWebsite(value: string | null | undefined) {
  try {
    const url = new URL(value?.trim() ?? "");
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function addPrefill(
  url: URL,
  key: string,
  value: string | null | undefined,
  maxLength = 200,
) {
  const clean = value?.trim().slice(0, maxLength);
  if (clean) url.searchParams.set(`stripe_user[${key}]`, clean);
}

export function buildStripeConnectUrl(
  state: string,
  prefill: StripeConnectPrefill = {},
) {
  const config = runtime();
  if (!config.connectClientId || !config.connectRedirectUri)
    throw new Error("BrizBuilder's Stripe Connect app is not configured yet.");
  const url = new URL("https://connect.stripe.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.connectClientId);
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("redirect_uri", config.connectRedirectUri);
  url.searchParams.set("state", state);

  addPrefill(url, "business_name", prefill.businessName);
  addPrefill(url, "email", validEmail(prefill.email));
  addPrefill(url, "url", validWebsite(prefill.website), 500);
  addPrefill(url, "country", "US");
  addPrefill(url, "currency", "usd");
  addPrefill(url, "street_address", prefill.address);
  addPrefill(url, "city", prefill.city);
  const stateCode = prefill.state?.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(stateCode ?? ""))
    addPrefill(url, "state", stateCode);
  addPrefill(url, "zip", prefill.zip, 20);
  addPrefill(url, "product_description", prefill.industry, 300);
  const phone = prefill.phone?.replace(/\D/g, "") ?? "";
  if (phone.length === 10) addPrefill(url, "phone_number", phone, 10);
  return url.toString();
}

function encodeForm(values: Record<string, string>) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

async function stripeApi<T>(
  path: string,
  init?: {
    body?: Record<string, string>;
    accountId?: string;
    apiVersion?: string;
  },
) {
  const config = runtime();
  if (!config.secretKey)
    throw new Error("BrizBuilder's Stripe platform account is not configured yet.");
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: init?.body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Stripe-Version": init?.apiVersion ?? STRIPE_API_VERSION,
      ...(init?.body
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
      ...(init?.accountId ? { "Stripe-Account": init.accountId } : {}),
    },
    body: init?.body ? encodeForm(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(payload.error?.message || "Stripe request failed.");
  return payload;
}

// Standard Connect accounts are impersonated with BrizBuilder's own platform
// secret key plus this account id (Stripe's documented pattern for Standard
// accounts) - the customer's Stripe secret key is never requested or stored.
export async function exchangeStripeConnectCode(code: string) {
  const config = runtime();
  if (!config.secretKey)
    throw new Error("BrizBuilder's Stripe platform account is not configured yet.");
  const response = await fetch("https://connect.stripe.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: encodeForm({
      client_secret: config.secretKey,
      code,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json()) as {
    stripe_user_id?: string;
    livemode?: boolean;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !STRIPE_ACCOUNT_ID.test(payload.stripe_user_id ?? ""))
    throw new Error(
      payload.error_description || "Stripe did not confirm the connection.",
    );
  if (Boolean(payload.livemode) !== keyIsLive(config.secretKey))
    throw new Error("Stripe returned an account from the wrong payment mode.");
  // OAuth access_token/refresh_token values are intentionally discarded.
  return {
    accountId: String(payload.stripe_user_id),
    livemode: Boolean(payload.livemode),
  };
}

export async function deauthorizeStripeAccount(accountId: string) {
  if (!STRIPE_ACCOUNT_ID.test(accountId))
    throw new Error("Stripe did not return a valid connected account.");
  const config = runtime();
  if (!config.secretKey || !config.connectClientId)
    throw new Error("BrizBuilder's Stripe Connect app is not configured yet.");
  const response = await fetch("https://connect.stripe.com/oauth/deauthorize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm({
      client_id: config.connectClientId,
      stripe_user_id: accountId,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json()) as {
    stripe_user_id?: string;
    error_description?: string;
  };
  if (
    !response.ok ||
    payload.stripe_user_id !== accountId
  )
    throw new Error(
      payload.error_description || "Stripe could not disconnect this account.",
    );
  return { accountId };
}

type StripeAccountPayload = {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  default_currency?: string;
  country?: string;
  business_profile?: { name?: string | null } | null;
  email?: string | null;
  requirements?: {
    currently_due?: unknown[];
    past_due?: unknown[];
    pending_verification?: unknown[];
    disabled_reason?: string | null;
    current_deadline?: number | null;
  } | null;
};

function itemCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function safeDisabledReason(value: string | null | undefined) {
  if (!value) return null;
  if (value.startsWith("requirements.")) return "requirements_due";
  if (value.startsWith("listed.")) return "business_review";
  if (value.startsWith("rejected.")) return "account_review";
  if (value.startsWith("under_review.")) return "under_review";
  return "restricted";
}

export function normalizeStripeAccount(account: StripeAccountPayload) {
  if (!STRIPE_ACCOUNT_ID.test(account.id))
    throw new Error("Stripe did not return a valid connected account.");
  const chargesEnabled = Boolean(account.charges_enabled);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const detailsSubmitted = Boolean(account.details_submitted);
  const currentlyDueCount = itemCount(account.requirements?.currently_due);
  const pastDueCount = itemCount(account.requirements?.past_due);
  const pendingVerificationCount = itemCount(
    account.requirements?.pending_verification,
  );
  const disabledReason = safeDisabledReason(
    account.requirements?.disabled_reason,
  );
  const setupStatus =
    pastDueCount > 0 || disabledReason
      ? "action_required"
      : !detailsSubmitted || currentlyDueCount > 0
        ? "setup_required"
        : pendingVerificationCount > 0
          ? "under_review"
          : chargesEnabled && payoutsEnabled
            ? "ready"
            : chargesEnabled
              ? "payments_ready"
              : "restricted";
  return {
    id: account.id,
    name:
      account.business_profile?.name ||
      account.email ||
      "Connected Stripe account",
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    isEnabled: chargesEnabled && payoutsEnabled,
    setupStatus,
    currentlyDueCount,
    pastDueCount,
    pendingVerificationCount,
    disabledReason,
    currentDeadline: account.requirements?.current_deadline
      ? new Date(account.requirements.current_deadline * 1000).toISOString()
      : null,
    currency: account.default_currency
      ? account.default_currency.toUpperCase()
      : null,
    country: account.country || null,
  };
}

export async function checkStripeConnectedAccount(accountId: string) {
  if (!STRIPE_ACCOUNT_ID.test(accountId))
    throw new Error("Stripe did not return a valid connected account.");
  const account = await stripeApi<StripeAccountPayload>(
    `/v1/accounts/${encodeURIComponent(accountId)}`,
  );
  return normalizeStripeAccount(account);
}

export async function createStripeAccountSession(
  accountId: string,
  capabilities: StripeSessionCapabilities,
  expectedLivemode: boolean,
) {
  if (!STRIPE_ACCOUNT_ID.test(accountId))
    throw new Error("Stripe did not return a valid connected account.");
  const config = runtime();
  if (
    !config.embeddedEnabled ||
    !config.publishableKey ||
    !STRIPE_PUBLISHABLE_KEY.test(config.publishableKey) ||
    !embeddedKeyModesMatch(config)
  )
    throw new Error("BrizBuilder's embedded Stripe tools are not configured yet.");
  if (expectedLivemode !== keyIsLive(config.secretKey))
    throw new Error("This Stripe connection uses a different payment mode.");
  if (expectedLivemode && !config.liveModeEnabled)
    throw new Error("Live Stripe account tools are not enabled yet.");

  const effectiveCapabilities: StripeSessionCapabilities = {
    paymentsRead: capabilities.paymentsRead && config.paymentsReadEnabled,
    payoutsRead: capabilities.payoutsRead && config.payoutsReadEnabled,
    onboarding: capabilities.onboarding && config.onboardingEnabled,
    accountManagement:
      capabilities.accountManagement && config.accountManagementEnabled,
    refunds: capabilities.refunds && config.refundsEnabled,
    disputes: capabilities.disputes && config.disputesEnabled,
    payouts: capabilities.payouts && config.payoutsEnabled,
    instantPayouts: false,
  };

  const enabled = "true";
  const disabled = "false";
  const financialOwner = effectiveCapabilities.payouts;
  const paymentFeatures = {
    "components[payments][enabled]": String(
      effectiveCapabilities.paymentsRead,
    ),
    "components[payments][features][capture_payments]": disabled,
    "components[payments][features][refund_management]": String(
      effectiveCapabilities.refunds,
    ),
    "components[payments][features][dispute_management]": String(
      effectiveCapabilities.disputes,
    ),
    "components[payments][features][destination_on_behalf_of_charge_management]":
      disabled,
    "components[payment_details][enabled]": String(
      effectiveCapabilities.paymentsRead,
    ),
    "components[payment_details][features][capture_payments]": disabled,
    "components[payment_details][features][refund_management]": String(
      effectiveCapabilities.refunds,
    ),
    "components[payment_details][features][dispute_management]": String(
      effectiveCapabilities.disputes,
    ),
    "components[payment_details][features][destination_on_behalf_of_charge_management]":
      disabled,
    "components[disputes_list][enabled]": String(
      effectiveCapabilities.paymentsRead,
    ),
    "components[disputes_list][features][capture_payments]": disabled,
    "components[disputes_list][features][refund_management]": String(
      effectiveCapabilities.refunds,
    ),
    "components[disputes_list][features][dispute_management]": String(
      effectiveCapabilities.disputes,
    ),
    "components[disputes_list][features][destination_on_behalf_of_charge_management]":
      disabled,
  };
  const session = await stripeApi<{
    client_secret?: string;
    expires_at?: number;
    livemode?: boolean;
  }>("/v1/account_sessions", {
    apiVersion: STRIPE_API_VERSION,
    body: {
      account: accountId,
      "components[notification_banner][enabled]": enabled,
      "components[account_onboarding][enabled]": String(
        effectiveCapabilities.onboarding,
      ),
      "components[account_management][enabled]": String(
        effectiveCapabilities.accountManagement,
      ),
      ...paymentFeatures,
      "components[balances][enabled]": String(
        effectiveCapabilities.payoutsRead,
      ),
      "components[balances][features][edit_payout_schedule]": String(
        financialOwner,
      ),
      "components[balances][features][instant_payouts]": String(
        effectiveCapabilities.instantPayouts,
      ),
      "components[balances][features][standard_payouts]": String(
        financialOwner,
      ),
      "components[payouts][enabled]": String(
        effectiveCapabilities.payoutsRead,
      ),
      "components[payouts][features][edit_payout_schedule]": String(
        financialOwner,
      ),
      "components[payouts][features][instant_payouts]": String(
        effectiveCapabilities.instantPayouts,
      ),
      "components[payouts][features][standard_payouts]": String(
        financialOwner,
      ),
      "components[payouts_list][enabled]": String(
        effectiveCapabilities.payoutsRead,
      ),
      "components[documents][enabled]": enabled,
    },
  });
  if (!session.client_secret)
    throw new Error("Stripe did not create a secure account session.");
  if (Boolean(session.livemode) !== expectedLivemode)
    throw new Error("Stripe created an account session in the wrong payment mode.");
  return {
    clientSecret: session.client_secret,
    publishableKey: config.publishableKey,
    capabilities: effectiveCapabilities,
  };
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Promise<StripeWebhookEvent> {
  const secret = runtime().webhookSecret;
  if (!secret)
    throw new Error("Stripe webhook verification is not configured.");
  if (!signatureHeader) throw new Error("Stripe signature is missing.");

  const fields = signatureHeader.split(",").map((value) => value.trim());
  const timestamp = Number(
    fields.find((value) => value.startsWith("t="))?.slice(2),
  );
  const signatures = fields
    .filter((value) => value.startsWith("v1="))
    .map((value) => value.slice(3).toLowerCase())
    .filter((value) => /^[0-9a-f]{64}$/.test(value));
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(timestamp) ||
    Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SECONDS ||
    !signatures.length
  )
    throw new Error("Stripe signature is invalid.");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${rawBody}`),
    ),
  );
  if (!signatures.some((signature) => constantTimeEqual(signature, expected)))
    throw new Error("Stripe signature is invalid.");

  const event = JSON.parse(rawBody) as StripeWebhookEvent;
  if (
    !event ||
    typeof event.id !== "string" ||
    !/^evt_[A-Za-z0-9]+$/.test(event.id) ||
    typeof event.type !== "string" ||
    typeof event.livemode !== "boolean"
  )
    throw new Error("Stripe event is invalid.");
  return event;
}
