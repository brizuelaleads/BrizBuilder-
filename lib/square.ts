// Square configuration, OAuth and the handful of API calls invoicing needs.
// The rules these calls rely on (validation, payload mapping, signatures,
// encryption) live in ./square-core, which has no runtime dependencies.

import { readRuntimeValue } from "./supabase/env";
import {
  SQUARE_API_VERSION,
  SQUARE_SCOPES,
  decryptSquareSecret,
  encryptSquareSecret,
  parseKeyBytes,
  splitRecipientName,
  squareErrorMessage,
  squareHosts,
  summarizeSquareInvoice,
  verifySquareSignature,
  type InvoiceLineItem,
  type SquareEncryptedValue,
  type SquareEnvironment,
  type SquareInvoiceSummary,
} from "./square-core";

const SQUARE_REQUEST_TIMEOUT_MS = 15_000;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Carries Square's HTTP status so callers can tell a dead token from a bad request. */
export class SquareApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "SquareApiError";
    this.status = status;
    this.code = code;
  }
  /** Square has stopped honouring this connection's tokens. */
  get unauthorized() {
    return (
      this.status === 401 ||
      this.code === "ACCESS_TOKEN_EXPIRED" ||
      this.code === "ACCESS_TOKEN_REVOKED" ||
      this.code === "UNAUTHORIZED"
    );
  }
}

export function squareEnvironment(): SquareEnvironment {
  // Anything other than an explicit "production" stays in the sandbox, where
  // no real money can move.
  return readRuntimeValue("SQUARE_ENVIRONMENT").toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

const REQUIRED_SETTINGS = [
  "SQUARE_APPLICATION_ID",
  "SQUARE_APPLICATION_SECRET",
  "SQUARE_REDIRECT_URI",
  "SQUARE_TOKEN_ENCRYPTION_KEY",
] as const;

export function getSquareRuntimeStatus() {
  const missing = REQUIRED_SETTINGS.filter((name) => !readRuntimeValue(name));
  return {
    ready: missing.length === 0,
    missing: [...missing] as string[],
    environment: squareEnvironment(),
    webhookReady: Boolean(
      readRuntimeValue("SQUARE_WEBHOOK_SIGNATURE_KEY") &&
        readRuntimeValue("SQUARE_WEBHOOK_URL"),
    ),
  };
}

function squareConfig() {
  const status = getSquareRuntimeStatus();
  if (!status.ready)
    throw new Error("Square is not configured on BrizBuilder yet.");
  return {
    environment: status.environment,
    hosts: squareHosts(status.environment),
    applicationId: readRuntimeValue("SQUARE_APPLICATION_ID"),
    applicationSecret: readRuntimeValue("SQUARE_APPLICATION_SECRET"),
    redirectUri: readRuntimeValue("SQUARE_REDIRECT_URI"),
  };
}

function encryptionKey() {
  const configured = readRuntimeValue("SQUARE_TOKEN_ENCRYPTION_KEY");
  if (!configured) throw new Error("Square is not configured on BrizBuilder yet.");
  return parseKeyBytes(configured, "SQUARE_TOKEN_ENCRYPTION_KEY");
}

export function encryptSquareToken(
  plaintext: string,
  organizationId: string,
  clientId: string | null,
  kind: "access" | "refresh",
) {
  return encryptSquareSecret(encryptionKey(), plaintext, organizationId, clientId, kind);
}

export function decryptSquareToken(
  encrypted: SquareEncryptedValue,
  organizationId: string,
  clientId: string | null,
  kind: "access" | "refresh",
) {
  return decryptSquareSecret(encryptionKey(), encrypted, organizationId, clientId, kind);
}

async function fetchSquare(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SQUARE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted)
      throw new SquareApiError("Square did not respond in time. Try again.", 504, null);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readSquareResponse(response: Response): Promise<UnknownRecord> {
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    const first = asRecord((payload.errors as unknown[] | undefined)?.[0]);
    throw new SquareApiError(
      squareErrorMessage(payload, response.status),
      response.status,
      asString(first.code),
    );
  }
  return payload;
}

async function squareApi(
  accessToken: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<UnknownRecord> {
  const { hosts } = squareConfig();
  const response = await fetchSquare(`${hosts.api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": SQUARE_API_VERSION,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return readSquareResponse(response);
}

export function buildSquareAuthorizationUrl(state: string): string {
  const config = squareConfig();
  const url = new URL(`${config.hosts.oauth}/authorize`);
  url.searchParams.set("client_id", config.applicationId);
  url.searchParams.set("scope", SQUARE_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", config.redirectUri);
  // Make the owner sign in to Square rather than silently reusing whichever
  // Square account the browser last used. The sandbox does not support this.
  if (config.environment === "production") url.searchParams.set("session", "false");
  return url.toString();
}

export type SquareTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  merchantId: string;
};

async function tokenRequest(
  body: UnknownRecord,
  /** Kept when a refresh response leaves the refresh token out. */
  knownRefreshToken: string | null = null,
): Promise<SquareTokenSet> {
  const config = squareConfig();
  const response = await fetchSquare(`${config.hosts.oauth}/token`, {
    method: "POST",
    headers: {
      "Square-Version": SQUARE_API_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: config.applicationId,
      client_secret: config.applicationSecret,
      ...body,
    }),
  });
  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    throw new SquareApiError(
      response.status === 401 || response.status === 400
        ? "Square did not accept this authorization. Connect Square again."
        : "Square authorization failed. Try connecting again.",
      response.status,
      null,
    );
  }
  const accessToken = asString(payload.access_token);
  // Code-flow refresh tokens do not expire and are reused, so a refresh may
  // hand back only a new access token.
  const refreshToken = asString(payload.refresh_token) ?? knownRefreshToken;
  const expiresAt = asString(payload.expires_at);
  const merchantId = asString(payload.merchant_id);
  if (!accessToken || !refreshToken || !expiresAt || !merchantId)
    throw new SquareApiError("Square returned an incomplete authorization.", 502, null);
  return { accessToken, refreshToken, expiresAt, merchantId };
}

export function exchangeSquareCode(code: string) {
  return tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: squareConfig().redirectUri,
  });
}

export function refreshSquareToken(refreshToken: string) {
  return tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" }, refreshToken);
}

/** Revokes every token this app holds for the seller. Never throws. */
export async function revokeSquareAccess(accessToken: string): Promise<boolean> {
  try {
    const config = squareConfig();
    const response = await fetchSquare(`${config.hosts.oauth}/revoke`, {
      method: "POST",
      headers: {
        Authorization: `Client ${config.applicationSecret}`,
        "Square-Version": SQUARE_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: config.applicationId,
        access_token: accessToken,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export type SquareMerchantProfile = {
  merchantId: string;
  name: string | null;
  country: string | null;
  currency: string | null;
  locationId: string | null;
  locationName: string | null;
};

/** The seller's business profile and the location invoices will be issued from. */
export async function getSquareMerchantProfile(
  accessToken: string,
): Promise<SquareMerchantProfile> {
  const merchant = asRecord(
    (await squareApi(accessToken, "GET", "/merchants/me")).merchant,
  );
  const merchantId = asString(merchant.id);
  if (!merchantId)
    throw new SquareApiError("Square did not return this account's profile.", 502, null);

  const locations = (
    ((await squareApi(accessToken, "GET", "/locations")).locations as unknown[]) ?? []
  ).map(asRecord);
  const active = locations.filter((location) => location.status === "ACTIVE");
  const mainId = asString(merchant.main_location_id);
  const location =
    active.find((item) => item.id === mainId) ?? active[0] ?? null;

  return {
    merchantId,
    name: asString(merchant.business_name),
    country: asString(location?.country) ?? asString(merchant.country),
    currency: asString(location?.currency) ?? asString(merchant.currency),
    locationId: asString(location?.id),
    locationName: asString(location?.name),
  };
}

/** Finds the seller's customer with this email, or adds one. Returns its id. */
export async function findOrCreateSquareCustomer(
  accessToken: string,
  input: { name: string; email: string; idempotencyKey: string },
): Promise<string> {
  const search = await squareApi(accessToken, "POST", "/customers/search", {
    limit: 1,
    query: { filter: { email_address: { exact: input.email } } },
  });
  const existing = asString(asRecord((search.customers as unknown[] | undefined)?.[0]).id);
  if (existing) return existing;

  const { givenName, familyName } = splitRecipientName(input.name);
  const created = await squareApi(accessToken, "POST", "/customers", {
    idempotency_key: input.idempotencyKey,
    given_name: givenName,
    ...(familyName ? { family_name: familyName } : {}),
    email_address: input.email,
  });
  const customerId = asString(asRecord(created.customer).id);
  if (!customerId)
    throw new SquareApiError("Square did not save the customer.", 502, null);
  return customerId;
}

export async function createSquareOrder(
  accessToken: string,
  input: {
    locationId: string;
    customerId: string;
    currency: string;
    lineItems: InvoiceLineItem[];
    idempotencyKey: string;
  },
): Promise<string> {
  const created = await squareApi(accessToken, "POST", "/orders", {
    idempotency_key: input.idempotencyKey,
    order: {
      location_id: input.locationId,
      customer_id: input.customerId,
      line_items: input.lineItems.map((item) => ({
        name: item.name,
        quantity: String(item.quantity),
        base_price_money: { amount: item.unitCents, currency: input.currency },
      })),
    },
  });
  const orderId = asString(asRecord(created.order).id);
  if (!orderId) throw new SquareApiError("Square did not create the order.", 502, null);
  return orderId;
}

function requireInvoice(payload: UnknownRecord): SquareInvoiceSummary {
  const summary = summarizeSquareInvoice(payload.invoice);
  if (!summary)
    throw new SquareApiError("Square returned an invoice BrizBuilder could not read.", 502, null);
  return summary;
}

export async function createSquareInvoice(
  accessToken: string,
  input: {
    locationId: string;
    orderId: string;
    customerId: string;
    title: string;
    message: string | null;
    dueDate: string;
    acceptBankTransfer: boolean;
    idempotencyKey: string;
  },
): Promise<SquareInvoiceSummary> {
  return requireInvoice(
    await squareApi(accessToken, "POST", "/invoices", {
      idempotency_key: input.idempotencyKey,
      invoice: {
        location_id: input.locationId,
        order_id: input.orderId,
        primary_recipient: { customer_id: input.customerId },
        delivery_method: "EMAIL",
        title: input.title,
        ...(input.message ? { description: input.message } : {}),
        payment_requests: [
          {
            request_type: "BALANCE",
            due_date: input.dueDate,
            automatic_payment_source: "NONE",
          },
        ],
        accepted_payment_methods: {
          card: true,
          bank_account: input.acceptBankTransfer,
          square_gift_card: false,
          buy_now_pay_later: false,
          cash_app_pay: false,
        },
      },
    }),
  );
}

export async function getSquareInvoice(accessToken: string, invoiceId: string) {
  return requireInvoice(
    await squareApi(accessToken, "GET", `/invoices/${encodeURIComponent(invoiceId)}`),
  );
}

export async function publishSquareInvoice(
  accessToken: string,
  invoiceId: string,
  version: number,
  idempotencyKey: string,
) {
  return requireInvoice(
    await squareApi(
      accessToken,
      "POST",
      `/invoices/${encodeURIComponent(invoiceId)}/publish`,
      { version, idempotency_key: idempotencyKey },
    ),
  );
}

export async function cancelSquareInvoice(
  accessToken: string,
  invoiceId: string,
  version: number,
) {
  return requireInvoice(
    await squareApi(
      accessToken,
      "POST",
      `/invoices/${encodeURIComponent(invoiceId)}/cancel`,
      { version },
    ),
  );
}

export async function deleteSquareInvoice(
  accessToken: string,
  invoiceId: string,
  version: number,
) {
  await squareApi(
    accessToken,
    "DELETE",
    `/invoices/${encodeURIComponent(invoiceId)}?version=${version}`,
  );
}

/** Sends a PDF to Square to travel with the invoice. BrizBuilder keeps no copy. */
export async function attachSquareInvoicePdf(
  accessToken: string,
  input: {
    invoiceId: string;
    fileName: string;
    bytes: Uint8Array;
    description: string;
    idempotencyKey: string;
  },
): Promise<void> {
  const { hosts } = squareConfig();
  const form = new FormData();
  form.set(
    "request",
    JSON.stringify({
      idempotency_key: input.idempotencyKey,
      description: input.description.slice(0, 128),
    }),
  );
  form.set(
    "file",
    new Blob([input.bytes as BlobPart], { type: "application/pdf" }),
    input.fileName,
  );
  const response = await fetchSquare(
    `${hosts.api}/invoices/${encodeURIComponent(input.invoiceId)}/attachments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": SQUARE_API_VERSION,
        Accept: "application/json",
      },
      body: form,
    },
  );
  await readSquareResponse(response);
}

/** True only for a body Square signed for this app's webhook subscription. */
export function verifySquareWebhook(body: string, signature: string | null) {
  const signatureKey = readRuntimeValue("SQUARE_WEBHOOK_SIGNATURE_KEY");
  const notificationUrl = readRuntimeValue("SQUARE_WEBHOOK_URL");
  if (!signatureKey || !notificationUrl)
    throw new Error("Square webhook is not configured.");
  return verifySquareSignature({ signatureKey, notificationUrl, body, signature });
}
