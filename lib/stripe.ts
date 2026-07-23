import { readRuntimeValue } from "./supabase/env";

export type StripeRuntimeStatus = {
  configured: boolean;
};

const STRIPE_ACCOUNT_ID = /^acct_[A-Za-z0-9]{8,}$/;

function runtime() {
  return {
    secretKey: readRuntimeValue("STRIPE_SECRET_KEY"),
    connectClientId: readRuntimeValue("STRIPE_CONNECT_CLIENT_ID"),
    connectRedirectUri: readRuntimeValue("STRIPE_CONNECT_REDIRECT_URI"),
  };
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
  return { configured: getStripeConnectStatus().ready };
}

export function buildStripeConnectUrl(state: string) {
  const config = runtime();
  if (!config.connectClientId || !config.connectRedirectUri)
    throw new Error("BrizBuilder's Stripe Connect app is not configured yet.");
  const url = new URL("https://connect.stripe.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.connectClientId);
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("redirect_uri", config.connectRedirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

function encodeForm(values: Record<string, string>) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

async function stripeApi<T>(
  path: string,
  init?: { body?: Record<string, string>; accountId?: string },
) {
  const config = runtime();
  if (!config.secretKey)
    throw new Error("BrizBuilder's Stripe platform account is not configured yet.");
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: init?.body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      ...(init?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(init?.accountId ? { "Stripe-Account": init.accountId } : {}),
    },
    body: init?.body ? encodeForm(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message || "Stripe request failed.");
  return payload;
}

// Standard Connect accounts are impersonated with BrizBuilder's own platform
// secret key plus this account id (Stripe's documented pattern for Standard
// accounts) — the customer's Stripe secret key is never requested or stored.
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
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !STRIPE_ACCOUNT_ID.test(payload.stripe_user_id ?? ""))
    throw new Error(
      payload.error_description || "Stripe did not confirm the connection.",
    );
  // The access_token/refresh_token Stripe also returns here are intentionally
  // discarded: Standard accounts are called with the platform secret key
  // above, not a stored per-customer bearer token.
  return { accountId: String(payload.stripe_user_id) };
}

export async function checkStripeConnectedAccount(accountId: string) {
  if (!STRIPE_ACCOUNT_ID.test(accountId))
    throw new Error("Stripe did not return a valid connected account.");
  const account = await stripeApi<{
    id: string;
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    details_submitted?: boolean;
    default_currency?: string;
    country?: string;
    business_profile?: { name?: string | null } | null;
    email?: string | null;
  }>(`/v1/accounts/${encodeURIComponent(accountId)}`);
  const chargesEnabled = Boolean(account.charges_enabled);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  return {
    id: account.id,
    name:
      account.business_profile?.name ||
      account.email ||
      "Connected Stripe account",
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted: Boolean(account.details_submitted),
    isEnabled: chargesEnabled && payoutsEnabled,
    currency: account.default_currency
      ? account.default_currency.toUpperCase()
      : null,
    country: account.country || null,
  };
}
