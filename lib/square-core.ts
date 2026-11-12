// Square invoicing rules with no runtime dependencies: input validation, the
// mapping from Square's payloads to what BrizBuilder stores, webhook signature
// checks and token encryption. Kept free of imports so it can be exercised
// directly by the test suite; lib/square.ts adds configuration and network.

export type SquareEnvironment = "sandbox" | "production";

/**
 * The least Square access that lets BrizBuilder send an invoice and watch it
 * get paid. Nothing here can move money, read card data or see other sales.
 */
export const SQUARE_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "CUSTOMERS_READ",
  "CUSTOMERS_WRITE",
  "ORDERS_WRITE",
  "INVOICES_READ",
  "INVOICES_WRITE",
] as const;

export const SQUARE_API_VERSION = "2025-01-23";

export const SQUARE_INVOICE_STATUSES = [
  "draft",
  "unpaid",
  "scheduled",
  "partially_paid",
  "paid",
  "partially_refunded",
  "refunded",
  "canceled",
  "failed",
  "payment_pending",
] as const;

export type SquareInvoiceStatus = (typeof SQUARE_INVOICE_STATUSES)[number];

/** States Square can still move on from, so they are worth asking about again. */
export const SQUARE_OPEN_STATUSES: SquareInvoiceStatus[] = [
  "draft",
  "unpaid",
  "scheduled",
  "partially_paid",
  "payment_pending",
];

export const MAX_INVOICE_LINE_ITEMS = 20;
export const MAX_INVOICE_TOTAL_CENTS = 99_999_999;
export const MIN_INVOICE_TOTAL_CENTS = 100;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type InvoiceLineItem = {
  name: string;
  quantity: number;
  unitCents: number;
};

export type InvoiceInput = {
  recipientName: string;
  recipientEmail: string;
  recipientId: string | null;
  title: string;
  message: string | null;
  dueDate: string;
  lineItems: InvoiceLineItem[];
  totalCents: number;
  send: boolean;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max)
    : "";
}

export function squareHosts(environment: SquareEnvironment) {
  const host =
    environment === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";
  return { api: `${host}/v2`, oauth: `${host}/oauth2` };
}

/**
 * Reads a money amount typed by a person ("1,250", "1250.5", "$40.00") as
 * whole cents. Returns null for anything that is not a plain positive amount
 * with at most two decimals, rather than guessing.
 */
export function parseMoneyToCents(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const cents = Math.round(value * 100);
    return Math.abs(cents - value * 100) < 1e-6 ? cents : null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(value);
}

/** YYYY-MM-DD for a date in UTC. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && isoDay(parsed) === value;
}

/**
 * Validates an invoice request from the browser. Every amount is recomputed
 * here from whole cents: a total sent by the client is never trusted.
 */
export function normalizeInvoiceInput(raw: unknown, now = new Date()): InvoiceInput {
  const source = asRecord(raw);

  const recipientName = text(source.recipientName, 120);
  if (!recipientName) throw new Error("Enter who the invoice is for.");

  const recipientEmail = text(source.recipientEmail, 254).toLowerCase();
  if (!isValidEmail(recipientEmail))
    throw new Error("Enter a valid email address for the recipient.");

  const title = text(source.title, 120);
  if (!title) throw new Error("Give the invoice a title.");

  const message = text(source.message, 1000) || null;

  const dueDate = text(source.dueDate, 10);
  if (!isRealDay(dueDate)) throw new Error("Choose a due date.");
  // A day of grace covers a browser that is behind UTC.
  const earliest = isoDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const latest = isoDay(new Date(now.getTime() + 730 * 24 * 60 * 60 * 1000));
  if (dueDate < earliest) throw new Error("The due date cannot be in the past.");
  if (dueDate > latest) throw new Error("Choose a due date within two years.");

  const rows = asArray(source.lineItems);
  if (!rows.length) throw new Error("Add at least one line item.");
  if (rows.length > MAX_INVOICE_LINE_ITEMS)
    throw new Error(`An invoice can have up to ${MAX_INVOICE_LINE_ITEMS} line items.`);

  const lineItems = rows.map((row, index) => {
    const item = asRecord(row);
    const name = text(item.name, 200);
    if (!name) throw new Error(`Describe line item ${index + 1}.`);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999)
      throw new Error(`Line item ${index + 1} needs a whole quantity from 1 to 999.`);
    const unitCents =
      typeof item.unitCents === "number" && Number.isInteger(item.unitCents)
        ? item.unitCents
        : parseMoneyToCents(item.unitPrice);
    if (unitCents === null || unitCents < 1 || unitCents > MAX_INVOICE_TOTAL_CENTS)
      throw new Error(`Enter a price for line item ${index + 1}.`);
    return { name, quantity, unitCents };
  });

  const totalCents = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitCents,
    0,
  );
  if (totalCents < MIN_INVOICE_TOTAL_CENTS)
    throw new Error("Square needs an invoice total of at least 1.00.");
  if (totalCents > MAX_INVOICE_TOTAL_CENTS)
    throw new Error("That invoice total is too large to send through Square.");

  const recipientId = text(source.recipientId, 64);
  return {
    recipientName,
    recipientEmail,
    recipientId: /^[0-9a-f-]{36}$/i.test(recipientId) ? recipientId : null,
    title,
    message,
    dueDate,
    lineItems,
    totalCents,
    send: source.send !== false,
  };
}

/** Splits "Jordan Chen" into the given and family names Square stores. */
export function splitRecipientName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { givenName: parts[0] ?? "", familyName: "" };
  return { givenName: parts[0], familyName: parts.slice(1).join(" ") };
}

export function isPdf(bytes: Uint8Array): boolean {
  // "%PDF-"
  return (
    bytes.byteLength > 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/** A file name safe to show and to hand to Square, always ending in .pdf. */
export function safePdfName(name: string): string {
  const base = name
    .replace(/\.pdf$/i, "")
    .replace(/[^A-Za-z0-9 ._()-]/g, "")
    .trim()
    .slice(0, 80);
  return `${base || "contract"}.pdf`;
}

export function normalizeSquareStatus(value: unknown): SquareInvoiceStatus | null {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  return (SQUARE_INVOICE_STATUSES as readonly string[]).includes(status)
    ? (status as SquareInvoiceStatus)
    : null;
}

function moneyAmount(value: unknown): number {
  const amount = Number(asRecord(value).amount);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : 0;
}

export type SquareInvoiceSummary = {
  squareInvoiceId: string;
  version: number;
  status: SquareInvoiceStatus;
  invoiceNumber: string | null;
  publicUrl: string | null;
  orderId: string | null;
  customerId: string | null;
  amountCents: number;
  paidCents: number;
  currency: string | null;
  dueDate: string | null;
};

/**
 * Reduces a Square invoice object to the fields BrizBuilder keeps. Returns
 * null when the payload is not a recognisable invoice, so a malformed or
 * unexpected body can never overwrite a stored row.
 */
export function summarizeSquareInvoice(raw: unknown): SquareInvoiceSummary | null {
  const invoice = asRecord(raw);
  const squareInvoiceId = text(invoice.id, 255);
  const status = normalizeSquareStatus(invoice.status);
  const version = Number(invoice.version);
  if (!squareInvoiceId || !status || !Number.isInteger(version) || version < 0)
    return null;

  const requests = asArray(invoice.payment_requests).map(asRecord);
  const amountCents = requests.reduce(
    (sum, request) => sum + moneyAmount(request.computed_amount_money),
    0,
  );
  const paidCents = requests.reduce(
    (sum, request) => sum + moneyAmount(request.total_completed_amount_money),
    0,
  );
  const dueDates = requests
    .map((request) => text(request.due_date, 10))
    .filter(isRealDay)
    .sort();
  const currency =
    requests
      .map((request) => text(asRecord(request.computed_amount_money).currency, 3))
      .find(Boolean) ?? null;
  const publicUrl = text(invoice.public_url, 500);

  return {
    squareInvoiceId,
    version,
    status,
    invoiceNumber: text(invoice.invoice_number, 60) || null,
    publicUrl: /^https:\/\//.test(publicUrl) ? publicUrl : null,
    orderId: text(invoice.order_id, 255) || null,
    customerId: text(asRecord(invoice.primary_recipient).customer_id, 255) || null,
    amountCents,
    paidCents,
    currency,
    dueDate: dueDates.length ? dueDates[dueDates.length - 1] : null,
  };
}

export type InvoiceDisplayState = {
  label: string;
  tone: "neutral" | "green" | "orange" | "red" | "blue";
  overdue: boolean;
};

/** What a person should read for an invoice, including "Overdue". */
export function invoiceDisplayState(
  status: string,
  dueDate: string | null,
  today: string,
): InvoiceDisplayState {
  const overdue =
    Boolean(dueDate) &&
    (dueDate as string) < today &&
    (status === "unpaid" || status === "partially_paid");
  if (overdue)
    return {
      label: status === "partially_paid" ? "Overdue · partly paid" : "Overdue",
      tone: "red",
      overdue: true,
    };
  const table: Record<string, [string, InvoiceDisplayState["tone"]]> = {
    draft: ["Draft", "neutral"],
    unpaid: ["Sent · unpaid", "orange"],
    scheduled: ["Scheduled", "blue"],
    partially_paid: ["Partly paid", "orange"],
    paid: ["Paid", "green"],
    partially_refunded: ["Partly refunded", "blue"],
    refunded: ["Refunded", "blue"],
    canceled: ["Canceled", "neutral"],
    failed: ["Not sent", "red"],
    payment_pending: ["Payment pending", "blue"],
  };
  const [label, tone] = table[status] ?? ["Unknown", "neutral"];
  return { label, tone, overdue: false };
}

/** Deterministic per step, so a retry can never create a second invoice. */
export function invoiceIdempotencyKey(invoiceId: string, step: string): string {
  return `bb:${invoiceId}:${step}`.slice(0, 128);
}

/**
 * A message safe to show a person, built from Square's error body. Square's
 * `detail` text describes the problem and never carries credentials; anything
 * else falls back to a generic line.
 */
export function squareErrorMessage(payload: unknown, httpStatus: number): string {
  const first = asRecord(asArray(asRecord(payload).errors)[0]);
  const code = text(first.code, 80);
  const detail = text(first.detail, 300);
  if (httpStatus === 401 || code === "UNAUTHORIZED" || code === "ACCESS_TOKEN_EXPIRED" || code === "ACCESS_TOKEN_REVOKED")
    return "Square no longer accepts this connection. Reconnect Square to continue.";
  if (code === "INSUFFICIENT_SCOPES")
    return "This Square connection is missing a permission. Reconnect Square to continue.";
  if (code === "MERCHANT_SUBSCRIPTION_NOT_FOUND")
    return "This needs a Square Invoices Plus subscription on the connected account.";
  if (httpStatus === 429 || code === "RATE_LIMITED")
    return "Square is busy right now. Wait a moment and try again.";
  if (httpStatus >= 500) return "Square had a problem on its side. Try again shortly.";
  if (detail) return `Square: ${detail}`;
  return "Square could not complete that request.";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** A 32-byte key given as 64 hex characters or base64url. */
export function parseKeyBytes(configured: string, name: string): Uint8Array {
  let bytes: Uint8Array;
  if (/^[0-9a-f]{64}$/i.test(configured)) {
    bytes = Uint8Array.from(configured.match(/.{2}/g) ?? [], (pair) =>
      Number.parseInt(pair, 16),
    );
  } else {
    try {
      bytes = base64UrlToBytes(configured);
    } catch {
      throw new Error(`${name} must be a 32-byte key.`);
    }
  }
  if (bytes.byteLength !== 32) throw new Error(`${name} must be a 32-byte key.`);
  return bytes;
}

export type SquareEncryptedValue = { ciphertext: string; iv: string };

/**
 * The tenant scope a token belongs to is bound into the ciphertext, so a token
 * copied onto another business's row will not decrypt.
 */
function tokenScope(organizationId: string, clientId: string | null, kind: string) {
  return new TextEncoder().encode(
    `brizbuilder:square:${organizationId}:${clientId ?? "agency"}:${kind}:v1`,
  );
}

async function aesKey(keyBytes: Uint8Array) {
  return crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSquareSecret(
  keyBytes: Uint8Array,
  plaintext: string,
  organizationId: string,
  clientId: string | null,
  kind: "access" | "refresh",
): Promise<SquareEncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: tokenScope(organizationId, clientId, kind) as BufferSource,
    },
    await aesKey(keyBytes),
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

export async function decryptSquareSecret(
  keyBytes: Uint8Array,
  encrypted: SquareEncryptedValue,
  organizationId: string,
  clientId: string | null,
  kind: "access" | "refresh",
): Promise<string> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(encrypted.iv) as BufferSource,
        additionalData: tokenScope(organizationId, clientId, kind) as BufferSource,
      },
      await aesKey(keyBytes),
      base64UrlToBytes(encrypted.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("The saved Square authorization could not be read. Reconnect Square.");
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.byteLength ^ right.byteLength;
  for (let index = 0; index < Math.max(left.byteLength, right.byteLength); index++)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

/**
 * Square signs each webhook with HMAC-SHA256 over the notification URL
 * followed by the exact request body.
 */
export async function verifySquareSignature(input: {
  signatureKey: string;
  notificationUrl: string;
  body: string;
  signature: string | null;
}): Promise<boolean> {
  if (!input.signatureKey || !input.notificationUrl || !input.signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.signatureKey) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(input.notificationUrl + input.body) as BufferSource,
  );
  return timingSafeEqual(bytesToBase64(new Uint8Array(mac)), input.signature.trim());
}

export type SquareWebhookEvent = {
  eventId: string;
  type: string;
  merchantId: string;
  invoice: SquareInvoiceSummary | null;
  /** Set for invoice.deleted, which carries only the id. */
  deletedInvoiceId: string | null;
};

/** Parses a verified webhook body. Throws on anything that is not an event. */
export function parseSquareWebhook(body: string): SquareWebhookEvent {
  let payload: UnknownRecord;
  try {
    payload = asRecord(JSON.parse(body));
  } catch {
    throw new Error("Square webhook event is not valid JSON.");
  }
  const eventId = text(payload.event_id, 255);
  const type = text(payload.type, 80);
  const merchantId = text(payload.merchant_id, 255);
  if (!eventId || !type || !merchantId)
    throw new Error("Square webhook event is missing its identifiers.");
  const data = asRecord(payload.data);
  const object = asRecord(data.object);
  const invoice = type.startsWith("invoice.")
    ? summarizeSquareInvoice(object.invoice)
    : null;
  return {
    eventId,
    type,
    merchantId,
    invoice,
    deletedInvoiceId:
      type === "invoice.deleted" && data.deleted === true ? text(data.id, 255) || null : null,
  };
}
