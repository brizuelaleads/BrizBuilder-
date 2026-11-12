// Square invoicing: who may do what, and the storage behind it.
//
// Every entry point resolves the caller's tenant context first and then pins
// each query to that organization and scope. A scope is either one client
// business or the agency itself; a browser-supplied client id is only ever
// used after requireSupabaseClientAccess has accepted it.
//
// Kept apart from db/supabase-crm.ts so the webhook path does not depend on
// the CRM action switch.

import type { ChatGPTUser } from "../app/chatgpt-auth";
import {
  getSupabaseTenantContext,
  requireSupabaseClientAccess,
  writeSupabaseAuditEvent,
  type SupabaseTenantContext,
} from "./supabase-crm";
import type { CrmRole } from "./crm";
import { getSupabaseAdminClient } from "../lib/supabase/server";
import {
  SquareApiError,
  attachSquareInvoicePdf,
  buildSquareAuthorizationUrl,
  cancelSquareInvoice,
  createSquareInvoice,
  createSquareOrder,
  decryptSquareToken,
  deleteSquareInvoice,
  encryptSquareToken,
  exchangeSquareCode,
  findOrCreateSquareCustomer,
  getSquareInvoice,
  getSquareMerchantProfile,
  getSquareRuntimeStatus,
  publishSquareInvoice,
  refreshSquareToken,
  revokeSquareAccess,
  squareEnvironment,
} from "../lib/square";
import {
  SQUARE_OPEN_STATUSES,
  SQUARE_SCOPES,
  invoiceIdempotencyKey,
  isPdf,
  isoDay,
  normalizeInvoiceInput,
  safePdfName,
  type SquareInvoiceSummary,
  type SquareWebhookEvent,
} from "../lib/square-core";

// Supabase rows are dynamic until generated database types are added.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type SquareScope =
  | { kind: "agency" }
  | { kind: "client"; clientId: string };

type Need = "view" | "invoice" | "connect";

// The agency's own money is visible to its owners only. A business's Square
// account can be linked by its owner, and invoiced from by its owner or
// manager; agency admins and team members are deliberately left out, matching
// the owner-tier rule the Stripe tools already follow.
const AGENCY_OWNER_ROLES: CrmRole[] = ["LB_OWNER", "SUPER_ADMIN", "AGENCY_OWNER"];
const CONNECT_ROLES: CrmRole[] = [...AGENCY_OWNER_ROLES, "CLIENT_OWNER"];
const INVOICE_ROLES: CrmRole[] = [...CONNECT_ROLES, "CLIENT_MANAGER"];

const TOKEN_REFRESH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const STATE_LIFETIME_MS = 15 * 60_000;
const MAX_LISTED_INVOICES = 200;
const MAX_SYNCED_INVOICES = 40;
const SANDBOX_ATTACHMENT_LIMIT_BYTES = 1024;

function supabase() {
  return getSupabaseAdminClient();
}

async function assertOk<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function parseSquareScope(kind: unknown, clientId: unknown): SquareScope {
  if (kind === "agency") return { kind: "agency" };
  if (
    kind === "client" &&
    typeof clientId === "string" &&
    /^[0-9a-f-]{36}$/i.test(clientId)
  )
    return { kind: "client", clientId };
  throw new Error("Choose a business first.");
}

type Authorized = {
  context: SupabaseTenantContext;
  /** Null for the agency's own Square account. */
  clientId: string | null;
  canConnect: boolean;
  canInvoice: boolean;
};

async function authorize(
  user: ChatGPTUser,
  scope: SquareScope,
  need: Need,
): Promise<Authorized> {
  const context = await getSupabaseTenantContext(user);
  let clientId: string | null = null;
  let canConnect: boolean;
  let canInvoice: boolean;

  if (scope.kind === "agency") {
    // A client login has context.clientId set and can never reach this branch.
    if (context.clientId !== null || !AGENCY_OWNER_ROLES.includes(context.role))
      throw new Error("Forbidden");
    canConnect = true;
    canInvoice = true;
  } else {
    await requireSupabaseClientAccess(context, scope.clientId);
    clientId = scope.clientId;
    canConnect = CONNECT_ROLES.includes(context.role);
    canInvoice = INVOICE_ROLES.includes(context.role);
  }

  const allowed = need === "connect" ? canConnect : canInvoice;
  if (!allowed) throw new Error("Forbidden");
  return { context, clientId, canConnect, canInvoice };
}

function scoped<T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(
  query: T,
  clientId: string | null,
): T {
  return clientId ? query.eq("client_id", clientId) : query.is("client_id", null);
}

async function connectionFor(organizationId: string, clientId: string | null) {
  return (await assertOk(
    scoped(
      supabase()
        .from("square_connections")
        .select("*")
        .eq("organization_id", organizationId),
      clientId,
    ).maybeSingle(),
  )) as Row | null;
}

function isLive(connection: Row | null): connection is Row {
  return Boolean(
    connection &&
      (connection.status === "connected" || connection.status === "attention") &&
      connection.access_token_ciphertext &&
      connection.refresh_token_ciphertext,
  );
}

async function markAttention(connection: Row, message: string) {
  const now = new Date().toISOString();
  await assertOk(
    supabase()
      .from("square_connections")
      .update({
        status: "attention",
        last_error: message.slice(0, 500),
        last_health_check_at: now,
        updated_at: now,
      })
      .eq("id", connection.id)
      .eq("organization_id", connection.organization_id),
  );
}

/**
 * A usable access token for the connection, refreshed when it is close to
 * expiry. Square access tokens last 30 days; the refresh token does not expire.
 */
async function liveAccessToken(connection: Row | null): Promise<string> {
  if (!isLive(connection)) throw new Error("Connect Square first.");
  if (connection.environment !== squareEnvironment())
    throw new Error(
      "This Square connection was made in a different Square mode. Reconnect Square.",
    );
  const organizationId = String(connection.organization_id);
  const clientId = connection.client_id ? String(connection.client_id) : null;
  const expiresAt = Date.parse(String(connection.access_token_expires_at ?? ""));

  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > TOKEN_REFRESH_WINDOW_MS) {
    return decryptSquareToken(
      { ciphertext: connection.access_token_ciphertext, iv: connection.access_token_iv },
      organizationId,
      clientId,
      "access",
    );
  }

  const refreshToken = await decryptSquareToken(
    { ciphertext: connection.refresh_token_ciphertext, iv: connection.refresh_token_iv },
    organizationId,
    clientId,
    "refresh",
  );
  let tokens;
  try {
    tokens = await refreshSquareToken(refreshToken);
  } catch (error) {
    if (error instanceof SquareApiError && (error.status === 400 || error.status === 401)) {
      await markAttention(
        connection,
        "Square no longer accepts this connection. Reconnect Square to continue.",
      );
      throw new Error("Square no longer accepts this connection. Reconnect Square to continue.");
    }
    throw error;
  }
  if (tokens.merchantId !== connection.merchant_id)
    throw new Error("Square returned a different account. Reconnect Square.");

  const [access, refresh] = await Promise.all([
    encryptSquareToken(tokens.accessToken, organizationId, clientId, "access"),
    encryptSquareToken(tokens.refreshToken, organizationId, clientId, "refresh"),
  ]);
  await assertOk(
    supabase()
      .from("square_connections")
      .update({
        access_token_ciphertext: access.ciphertext,
        access_token_iv: access.iv,
        refresh_token_ciphertext: refresh.ciphertext,
        refresh_token_iv: refresh.iv,
        access_token_expires_at: tokens.expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id)
      .eq("organization_id", organizationId),
  );
  return tokens.accessToken;
}

/** Runs a Square call and records a dead connection instead of hiding it. */
async function withSquare<T>(connection: Row, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof SquareApiError && error.unauthorized)
      await markAttention(connection, error.message);
    throw error;
  }
}

function friendly(error: unknown): string {
  return error instanceof SquareApiError
    ? error.message
    : "BrizBuilder could not finish this with Square. Try again.";
}

export type SquareInvoiceView = {
  id: string;
  invoiceNumber: string | null;
  title: string;
  recipientName: string;
  recipientEmail: string;
  amountCents: number;
  paidCents: number;
  currency: string;
  dueDate: string;
  status: string;
  publicUrl: string | null;
  attachmentName: string | null;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
  paidAt: string | null;
  /** False for invoices from a Square account that is no longer the linked one. */
  actionable: boolean;
};

function invoiceView(row: Row, connection: Row | null): SquareInvoiceView {
  return {
    id: String(row.id),
    invoiceNumber: row.invoice_number ?? null,
    title: String(row.title),
    recipientName: String(row.recipient_name),
    recipientEmail: String(row.recipient_email),
    amountCents: Number(row.amount_cents ?? 0),
    paidCents: Number(row.amount_paid_cents ?? 0),
    currency: String(row.currency),
    dueDate: String(row.due_date),
    status: String(row.status),
    publicUrl: row.public_url ?? null,
    attachmentName: row.attachment_name ?? null,
    lastError: row.last_error ?? null,
    createdAt: String(row.created_at),
    sentAt: row.sent_at ?? null,
    paidAt: row.paid_at ?? null,
    actionable:
      isLive(connection) &&
      row.merchant_id === connection.merchant_id &&
      row.environment === connection.environment,
  };
}

export type SquareWorkspace = {
  scope: "agency" | "client";
  configured: boolean;
  /** Setting names only, and only for agency owners. */
  missingSettings: string[];
  environment: "sandbox" | "production";
  webhookReady: boolean;
  canConnect: boolean;
  canInvoice: boolean;
  connection: {
    status: string;
    merchantName: string | null;
    locationName: string | null;
    currency: string | null;
    environment: string;
    connectedAt: string | null;
    lastError: string | null;
    lastCheckedAt: string | null;
  } | null;
  invoices: SquareInvoiceView[];
  recipients: { id: string; name: string; email: string }[];
  totals: { outstandingCents: number; overdueCents: number; paidLast30DaysCents: number };
};

async function recipientsFor(
  context: SupabaseTenantContext,
  clientId: string | null,
): Promise<SquareWorkspace["recipients"]> {
  if (clientId) {
    const rows = (await assertOk(
      supabase()
        .from("contacts")
        .select("id,first_name,last_name,email")
        .eq("organization_id", context.organizationId)
        .eq("client_id", clientId)
        .is("archived_at", null)
        .not("email", "is", null)
        .order("first_name")
        .limit(500),
    )) as Row[] | null;
    return (rows ?? [])
      .filter((row) => String(row.email ?? "").includes("@"))
      .map((row) => ({
        id: String(row.id),
        name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
        email: String(row.email).trim().toLowerCase(),
      }));
  }
  // The agency bills the businesses it manages.
  const rows = (await assertOk(
    supabase()
      .from("clients")
      .select("id,business_name,email")
      .eq("organization_id", context.organizationId)
      .neq("status", "archived")
      .order("business_name")
      .limit(500),
  )) as Row[] | null;
  return (rows ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.business_name ?? ""),
    email: String(row.email ?? "").trim().toLowerCase(),
  }));
}

export async function getSquareWorkspace(
  user: ChatGPTUser,
  scope: SquareScope,
): Promise<SquareWorkspace> {
  const { context, clientId, canConnect, canInvoice } = await authorize(user, scope, "view");
  const runtime = getSquareRuntimeStatus();
  const connection = await connectionFor(context.organizationId, clientId);
  const visible =
    connection && connection.status !== "disconnected" ? connection : null;

  const rows = ((await assertOk(
    scoped(
      supabase()
        .from("square_invoices")
        .select("*")
        .eq("organization_id", context.organizationId),
      clientId,
    )
      .order("created_at", { ascending: false })
      .limit(MAX_LISTED_INVOICES),
  )) ?? []) as Row[];

  const today = isoDay(new Date());
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const totals = { outstandingCents: 0, overdueCents: 0, paidLast30DaysCents: 0 };
  for (const row of rows) {
    const owed = Math.max(0, Number(row.amount_cents) - Number(row.amount_paid_cents));
    if (["unpaid", "partially_paid", "scheduled", "payment_pending"].includes(row.status)) {
      totals.outstandingCents += owed;
      if (
        String(row.due_date) < today &&
        (row.status === "unpaid" || row.status === "partially_paid")
      )
        totals.overdueCents += owed;
    }
    if (row.status === "paid" && row.paid_at && Date.parse(row.paid_at) >= monthAgo)
      totals.paidLast30DaysCents += Number(row.amount_paid_cents);
  }

  return {
    scope: scope.kind,
    configured: runtime.ready,
    missingSettings: AGENCY_OWNER_ROLES.includes(context.role) ? runtime.missing : [],
    environment: runtime.environment,
    webhookReady: runtime.webhookReady,
    canConnect,
    canInvoice,
    connection: visible
      ? {
          status: String(visible.status),
          merchantName: visible.merchant_name ?? null,
          locationName: visible.location_name ?? null,
          currency: visible.currency ?? null,
          environment: String(visible.environment),
          connectedAt: visible.connected_at ?? null,
          lastError: visible.last_error ?? null,
          lastCheckedAt: visible.last_health_check_at ?? null,
        }
      : null,
    invoices: rows.map((row) => invoiceView(row, connection)),
    recipients: canInvoice ? await recipientsFor(context, clientId) : [],
    totals,
  };
}

export async function beginSquareConnect(
  user: ChatGPTUser,
  scope: SquareScope,
): Promise<string> {
  const { context, clientId } = await authorize(user, scope, "connect");
  if (!getSquareRuntimeStatus().ready)
    throw new Error("Square is not configured on BrizBuilder yet.");

  const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const now = new Date();
  await assertOk(
    supabase()
      .from("square_authorization_states")
      .delete()
      .lt("expires_at", now.toISOString()),
  );
  await assertOk(
    supabase().from("square_authorization_states").insert({
      organization_id: context.organizationId,
      client_id: clientId,
      state_hash: await sha256Hex(state),
      requested_by_email: context.email,
      expires_at: new Date(now.getTime() + STATE_LIFETIME_MS).toISOString(),
    }),
  );
  return buildSquareAuthorizationUrl(state);
}

/**
 * Completes the OAuth round trip. The state is single-use and bound to the
 * person who started it: the callback must arrive in that same person's
 * signed-in session, and their access is checked again before anything is
 * stored, because it may have been removed while they were at Square.
 */
export async function finishSquareConnect(
  user: ChatGPTUser,
  state: string,
  code: string,
): Promise<SquareScope> {
  if (!state || state.length < 40 || !code)
    throw new Error("Square did not return a valid connection request.");
  const now = new Date().toISOString();
  const authorization = (await assertOk(
    supabase()
      .from("square_authorization_states")
      .select("*")
      .eq("state_hash", await sha256Hex(state))
      .is("used_at", null)
      .gt("expires_at", now)
      .maybeSingle(),
  )) as Row | null;
  if (!authorization)
    throw new Error("This Square connection request expired. Start again from BrizBuilder.");

  try {
    if (
      user.email.trim().toLowerCase() !==
      String(authorization.requested_by_email).trim().toLowerCase()
    )
      throw new Error("Forbidden");

    const scope: SquareScope = authorization.client_id
      ? { kind: "client", clientId: String(authorization.client_id) }
      : { kind: "agency" };
    const { context, clientId } = await authorize(user, scope, "connect");
    if (context.organizationId !== String(authorization.organization_id))
      throw new Error("Forbidden");

    const consumed = await assertOk(
      supabase()
        .from("square_authorization_states")
        .update({ used_at: now })
        .eq("id", authorization.id)
        .is("used_at", null)
        .select("id")
        .maybeSingle(),
    );
    if (!consumed)
      throw new Error("This Square connection request was already used. Start again from BrizBuilder.");

    const tokens = await exchangeSquareCode(code);
    const profile = await getSquareMerchantProfile(tokens.accessToken);
    const environment = squareEnvironment();

    // One Square account, one place in BrizBuilder.
    const elsewhere = ((await assertOk(
      supabase()
        .from("square_connections")
        .select("id,organization_id,client_id")
        .eq("environment", environment)
        .eq("merchant_id", profile.merchantId)
        .is("disconnected_at", null),
    )) ?? []) as Row[];
    if (
      elsewhere.some(
        (row) =>
          row.organization_id !== context.organizationId ||
          (row.client_id ?? null) !== clientId,
      )
    )
      throw new Error(
        "This Square account is already connected somewhere else in BrizBuilder. Disconnect it there first.",
      );

    const [access, refresh] = await Promise.all([
      encryptSquareToken(tokens.accessToken, context.organizationId, clientId, "access"),
      encryptSquareToken(tokens.refreshToken, context.organizationId, clientId, "refresh"),
    ]);
    const ready = Boolean(profile.locationId && profile.currency);
    const values = {
      environment,
      merchant_id: profile.merchantId,
      merchant_name: profile.name,
      location_id: profile.locationId,
      location_name: profile.locationName,
      country: profile.country,
      currency: profile.currency,
      scopes: [...SQUARE_SCOPES],
      access_token_ciphertext: access.ciphertext,
      access_token_iv: access.iv,
      refresh_token_ciphertext: refresh.ciphertext,
      refresh_token_iv: refresh.iv,
      access_token_expires_at: tokens.expiresAt,
      status: ready ? "connected" : "attention",
      last_error: ready
        ? null
        : "This Square account has no active location. Add one in Square, then reconnect.",
      last_health_check_at: now,
      connected_by_email: context.email,
      connected_at: now,
      disconnected_at: null,
      updated_at: now,
    };

    const existing = await connectionFor(context.organizationId, clientId);
    const saved = (await assertOk(
      existing
        ? supabase()
            .from("square_connections")
            .update(values)
            .eq("id", existing.id)
            .eq("organization_id", context.organizationId)
            .select("id")
            .single()
        : supabase()
            .from("square_connections")
            .insert({
              organization_id: context.organizationId,
              client_id: clientId,
              ...values,
            })
            .select("id")
            .single(),
    )) as Row;

    await writeSupabaseAuditEvent(
      context,
      "square.connected",
      "square_connection",
      String(saved.id),
      { environment, scope: scope.kind },
      clientId,
    );
    return scope;
  } finally {
    await assertOk(
      supabase().from("square_authorization_states").delete().eq("id", authorization.id),
    );
  }
}

/** Forgets a pending connect request, for when the owner cancels at Square. */
export async function cancelSquareConnect(state: string) {
  if (!state || state.length < 40) return;
  await assertOk(
    supabase()
      .from("square_authorization_states")
      .delete()
      .eq("state_hash", await sha256Hex(state)),
  );
}

export async function disconnectSquare(user: ChatGPTUser, scope: SquareScope) {
  const { context, clientId } = await authorize(user, scope, "connect");
  const connection = await connectionFor(context.organizationId, clientId);
  if (!connection || connection.status === "disconnected") return { disconnected: true };

  // Best effort: the local link is removed whether or not Square answers, so a
  // Square outage can never leave tokens behind that the owner asked to drop.
  let revoked = false;
  if (isLive(connection)) {
    try {
      const accessToken = await decryptSquareToken(
        { ciphertext: connection.access_token_ciphertext, iv: connection.access_token_iv },
        context.organizationId,
        clientId,
        "access",
      );
      revoked = await revokeSquareAccess(accessToken);
    } catch {
      revoked = false;
    }
  }

  const now = new Date().toISOString();
  await assertOk(
    supabase()
      .from("square_connections")
      .update({
        status: "disconnected",
        access_token_ciphertext: null,
        access_token_iv: null,
        refresh_token_ciphertext: null,
        refresh_token_iv: null,
        access_token_expires_at: null,
        disconnected_at: now,
        last_error: null,
        updated_at: now,
      })
      .eq("id", connection.id)
      .eq("organization_id", context.organizationId),
  );
  await writeSupabaseAuditEvent(
    context,
    "square.disconnected",
    "square_connection",
    String(connection.id),
    { revokedAtSquare: revoked },
    clientId,
  );
  return { disconnected: true, revokedAtSquare: revoked };
}

async function applySummary(row: Row, summary: SquareInvoiceSummary) {
  // Square versions only move forward; an older payload is a late delivery.
  if (
    typeof row.square_version === "number" &&
    summary.version < row.square_version
  )
    return;
  const now = new Date().toISOString();
  const wasDraft = row.status === "draft" || row.status === "failed";
  await assertOk(
    supabase()
      .from("square_invoices")
      .update({
        status: summary.status,
        square_invoice_id: summary.squareInvoiceId,
        square_version: summary.version,
        invoice_number: summary.invoiceNumber ?? row.invoice_number ?? null,
        public_url: summary.publicUrl ?? row.public_url ?? null,
        ...(summary.amountCents > 0 ? { amount_cents: summary.amountCents } : {}),
        amount_paid_cents: summary.paidCents,
        ...(summary.dueDate ? { due_date: summary.dueDate } : {}),
        sent_at:
          row.sent_at ?? (summary.status !== "draft" && wasDraft ? now : null),
        paid_at: summary.status === "paid" ? (row.paid_at ?? now) : (row.paid_at ?? null),
        canceled_at:
          summary.status === "canceled" ? (row.canceled_at ?? now) : (row.canceled_at ?? null),
        last_error: null,
        updated_at: now,
      })
      .eq("id", row.id)
      .eq("organization_id", row.organization_id),
  );
}

async function invoiceFor(
  organizationId: string,
  clientId: string | null,
  invoiceId: unknown,
): Promise<Row> {
  if (typeof invoiceId !== "string" || !/^[0-9a-f-]{36}$/i.test(invoiceId))
    throw new Error("Invoice not found.");
  const row = (await assertOk(
    scoped(
      supabase()
        .from("square_invoices")
        .select("*")
        .eq("id", invoiceId)
        .eq("organization_id", organizationId),
      clientId,
    ).maybeSingle(),
  )) as Row | null;
  if (!row) throw new Error("Invoice not found.");
  return row;
}

function requireSameAccount(row: Row, connection: Row | null): asserts connection is Row {
  if (
    !isLive(connection) ||
    row.merchant_id !== connection.merchant_id ||
    row.environment !== connection.environment
  )
    throw new Error(
      "This invoice belongs to a Square account that is no longer connected here.",
    );
}

export type InvoiceFile = { name: string; bytes: Uint8Array };

export async function createSquareInvoiceForScope(
  user: ChatGPTUser,
  scope: SquareScope,
  rawInput: unknown,
  file: InvoiceFile | null,
): Promise<{ invoiceId: string; status: string }> {
  const { context, clientId } = await authorize(user, scope, "invoice");
  const input = normalizeInvoiceInput(rawInput);
  if (file && !isPdf(file.bytes))
    throw new Error("The attachment must be a PDF file.");

  const connection = await connectionFor(context.organizationId, clientId);
  if (!isLive(connection)) throw new Error("Connect Square first.");
  if (!connection.location_id || !connection.currency)
    throw new Error(
      "This Square account has no active location. Add one in Square, then reconnect.",
    );
  // Square's sandbox accepts at most 1 KB of attachments per invoice, which no
  // real contract fits. Refuse before anything is created rather than leave a
  // half-built invoice behind.
  if (file && connection.environment === "sandbox" && file.bytes.byteLength > SANDBOX_ATTACHMENT_LIMIT_BYTES)
    throw new Error(
      "Square's test mode only accepts attachments up to 1 KB. Send this without the PDF while testing; attachments work once Square is in live mode.",
    );

  // The recipient link is checked against the tenant rather than trusted.
  let contactId: string | null = null;
  let billedClientId: string | null = null;
  if (input.recipientId) {
    if (clientId) {
      const contact = await assertOk(
        supabase()
          .from("contacts")
          .select("id")
          .eq("id", input.recipientId)
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .maybeSingle(),
      );
      contactId = contact ? input.recipientId : null;
    } else {
      const billed = await assertOk(
        supabase()
          .from("clients")
          .select("id")
          .eq("id", input.recipientId)
          .eq("organization_id", context.organizationId)
          .maybeSingle(),
      );
      billedClientId = billed ? input.recipientId : null;
    }
  }

  const accessToken = await liveAccessToken(connection);
  const fileName = file ? safePdfName(file.name) : null;
  const row = (await assertOk(
    supabase()
      .from("square_invoices")
      .insert({
        organization_id: context.organizationId,
        connection_id: connection.id,
        client_id: clientId,
        billed_client_id: billedClientId,
        contact_id: contactId,
        environment: connection.environment,
        merchant_id: connection.merchant_id,
        recipient_name: input.recipientName,
        recipient_email: input.recipientEmail,
        title: input.title,
        message: input.message,
        line_items: input.lineItems,
        amount_cents: input.totalCents,
        currency: connection.currency,
        due_date: input.dueDate,
        status: "draft",
        attachment_name: fileName,
        attachment_bytes: file ? file.bytes.byteLength : null,
        created_by_email: context.email,
      })
      .select("*")
      .single(),
  )) as Row;
  const invoiceId = String(row.id);

  let draft: SquareInvoiceSummary | null = null;
  let result: { final: SquareInvoiceSummary; orderId: string; customerId: string };
  try {
    result = await withSquare(connection, async () => {
      const customerId = await findOrCreateSquareCustomer(accessToken, {
        name: input.recipientName,
        email: input.recipientEmail,
        idempotencyKey: invoiceIdempotencyKey(invoiceId, "customer"),
      });
      const orderId = await createSquareOrder(accessToken, {
        locationId: connection.location_id,
        customerId,
        currency: connection.currency,
        lineItems: input.lineItems,
        idempotencyKey: invoiceIdempotencyKey(invoiceId, "order"),
      });
      draft = await createSquareInvoice(accessToken, {
        locationId: connection.location_id,
        orderId,
        customerId,
        title: input.title,
        message: input.message,
        dueDate: input.dueDate,
        // Bank transfer through Square invoices is offered to US sellers only.
        acceptBankTransfer: connection.country === "US",
        idempotencyKey: invoiceIdempotencyKey(invoiceId, "invoice"),
      });
      if (file && fileName)
        await attachSquareInvoicePdf(accessToken, {
          invoiceId: draft.squareInvoiceId,
          fileName,
          bytes: file.bytes,
          description: fileName,
          idempotencyKey: invoiceIdempotencyKey(invoiceId, "attachment"),
        });
      if (!input.send) return { final: draft, orderId, customerId };
      // Publishing needs the invoice's current version; read it back rather
      // than assume the attachment left it unchanged.
      const current = file
        ? await getSquareInvoice(accessToken, draft.squareInvoiceId)
        : draft;
      const final = await publishSquareInvoice(
        accessToken,
        current.squareInvoiceId,
        current.version,
        invoiceIdempotencyKey(invoiceId, "publish"),
      );
      return { final, orderId, customerId };
    });
  } catch (error) {
    // Square did not finish. Remove the half-built draft so the seller is not
    // left with one they did not ask for. If Square will not delete it -- for
    // instance because a publish that timed out actually went through -- keep
    // its id, so Refresh status can find out what really happened.
    const created = draft as SquareInvoiceSummary | null;
    let leftInSquare = false;
    if (created) {
      try {
        await deleteSquareInvoice(accessToken, created.squareInvoiceId, created.version);
      } catch {
        leftInSquare = true;
      }
    }
    const message = friendly(error);
    await assertOk(
      supabase()
        .from("square_invoices")
        .update({
          status: "failed",
          last_error: message.slice(0, 500),
          ...(leftInSquare && created
            ? { square_invoice_id: created.squareInvoiceId, square_version: created.version }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoiceId)
        .eq("organization_id", context.organizationId),
    );
    throw new Error(message);
  }

  // Square has the invoice now. Bookkeeping errors from here on must not be
  // mistaken for a failed send, so they are outside the cleanup above.
  await assertOk(
    supabase()
      .from("square_invoices")
      .update({
        square_order_id: result.orderId,
        square_customer_id: result.customerId,
      })
      .eq("id", invoiceId)
      .eq("organization_id", context.organizationId),
  );
  await applySummary(row, result.final);
  await writeSupabaseAuditEvent(
    context,
    input.send ? "square.invoice.sent" : "square.invoice.drafted",
    "square_invoice",
    invoiceId,
    { amountCents: input.totalCents, currency: connection.currency, attachment: Boolean(file) },
    clientId,
  );
  return { invoiceId, status: result.final.status };
}

export async function sendSquareInvoice(
  user: ChatGPTUser,
  scope: SquareScope,
  invoiceId: unknown,
) {
  const { context, clientId } = await authorize(user, scope, "invoice");
  const row = await invoiceFor(context.organizationId, clientId, invoiceId);
  if (row.status !== "draft" || !row.square_invoice_id)
    throw new Error("Only a draft can be sent.");
  const connection = await connectionFor(context.organizationId, clientId);
  requireSameAccount(row, connection);
  const accessToken = await liveAccessToken(connection);
  try {
    const published = await withSquare(connection, async () => {
      const current = await getSquareInvoice(accessToken, row.square_invoice_id);
      if (current.status !== "draft") return current;
      return publishSquareInvoice(
        accessToken,
        current.squareInvoiceId,
        current.version,
        invoiceIdempotencyKey(String(row.id), `publish:${current.version}`),
      );
    });
    await applySummary(row, published);
    await writeSupabaseAuditEvent(
      context,
      "square.invoice.sent",
      "square_invoice",
      String(row.id),
      {},
      clientId,
    );
    return { status: published.status };
  } catch (error) {
    throw new Error(friendly(error));
  }
}

export async function cancelSquareInvoiceForScope(
  user: ChatGPTUser,
  scope: SquareScope,
  invoiceId: unknown,
) {
  const { context, clientId } = await authorize(user, scope, "invoice");
  const row = await invoiceFor(context.organizationId, clientId, invoiceId);
  if (!["unpaid", "scheduled", "partially_paid"].includes(row.status) || !row.square_invoice_id)
    throw new Error("Only a sent invoice that is not fully paid can be canceled.");
  const connection = await connectionFor(context.organizationId, clientId);
  requireSameAccount(row, connection);
  const accessToken = await liveAccessToken(connection);
  try {
    const canceled = await withSquare(connection, async () => {
      const current = await getSquareInvoice(accessToken, row.square_invoice_id);
      if (!["unpaid", "scheduled", "partially_paid"].includes(current.status))
        return current;
      return cancelSquareInvoice(accessToken, current.squareInvoiceId, current.version);
    });
    await applySummary(row, canceled);
    await writeSupabaseAuditEvent(
      context,
      "square.invoice.canceled",
      "square_invoice",
      String(row.id),
      {},
      clientId,
    );
    return { status: canceled.status };
  } catch (error) {
    throw new Error(friendly(error));
  }
}

export async function deleteSquareInvoiceForScope(
  user: ChatGPTUser,
  scope: SquareScope,
  invoiceId: unknown,
) {
  const { context, clientId } = await authorize(user, scope, "invoice");
  const row = await invoiceFor(context.organizationId, clientId, invoiceId);
  if (row.status !== "draft" && row.status !== "failed")
    throw new Error("Only a draft can be deleted. Cancel a sent invoice instead.");

  // A "failed" row that still carries a Square id may have gone out after all,
  // so Square is asked before anything is forgotten here.
  if (row.square_invoice_id) {
    const connection = await connectionFor(context.organizationId, clientId);
    requireSameAccount(row, connection);
    const accessToken = await liveAccessToken(connection);
    try {
      await withSquare(connection, async () => {
        const current = await getSquareInvoice(accessToken, row.square_invoice_id);
        if (current.status !== "draft")
          throw new SquareApiError(
            "This invoice has already been sent from Square. Refresh to see its status.",
            409,
            null,
          );
        await deleteSquareInvoice(accessToken, current.squareInvoiceId, current.version);
      });
    } catch (error) {
      // A draft already gone from Square is safe to forget here too.
      if (!(error instanceof SquareApiError && error.status === 404))
        throw new Error(friendly(error));
    }
  }

  await assertOk(
    supabase()
      .from("square_invoices")
      .delete()
      .eq("id", row.id)
      .eq("organization_id", context.organizationId),
  );
  await writeSupabaseAuditEvent(
    context,
    "square.invoice.deleted",
    "square_invoice",
    String(row.id),
    {},
    clientId,
  );
  return { deleted: true };
}

/**
 * Asks Square for the current state of invoices that can still change. This is
 * what keeps payment status right when webhooks are not set up, and it is safe
 * to run alongside them: Square's version number decides which state wins.
 */
export async function syncSquareInvoices(user: ChatGPTUser, scope: SquareScope) {
  const { context, clientId } = await authorize(user, scope, "invoice");
  const connection = await connectionFor(context.organizationId, clientId);
  if (!isLive(connection)) throw new Error("Connect Square first.");
  const accessToken = await liveAccessToken(connection);

  const rows = ((await assertOk(
    scoped(
      supabase()
        .from("square_invoices")
        .select("*")
        .eq("organization_id", context.organizationId),
      clientId,
    )
      .eq("merchant_id", connection.merchant_id)
      .eq("environment", connection.environment)
      // "paid" catches refunds; "failed" with a Square id is a send whose
      // outcome was unknown when it was recorded.
      .in("status", [...SQUARE_OPEN_STATUSES, "paid", "failed"])
      .not("square_invoice_id", "is", null)
      .order("updated_at", { ascending: true })
      .limit(MAX_SYNCED_INVOICES),
  )) ?? []) as Row[];

  let updated = 0;
  try {
    await withSquare(connection, async () => {
      for (const row of rows) {
        try {
          const current = await getSquareInvoice(accessToken, row.square_invoice_id);
          await applySummary(row, current);
          updated += 1;
        } catch (error) {
          if (error instanceof SquareApiError && error.status === 404) {
            // Deleted inside Square.
            await assertOk(
              supabase()
                .from("square_invoices")
                .delete()
                .eq("id", row.id)
                .eq("organization_id", context.organizationId)
                .eq("status", "draft"),
            );
            continue;
          }
          throw error;
        }
      }
    });
  } catch (error) {
    throw new Error(friendly(error));
  }

  const now = new Date().toISOString();
  await assertOk(
    supabase()
      .from("square_connections")
      .update({
        status: connection.location_id ? "connected" : "attention",
        ...(connection.location_id ? { last_error: null } : {}),
        last_health_check_at: now,
        updated_at: now,
      })
      .eq("id", connection.id)
      .eq("organization_id", context.organizationId),
  );
  return { checked: rows.length, updated };
}

/**
 * Applies a webhook whose signature has already been verified. Square retries
 * deliveries, so each event id is claimed once; the tenant is found from the
 * stored invoice or connection, never from anything in the request.
 */
export async function handleSquareWebhook(event: SquareWebhookEvent) {
  const environment = squareEnvironment();
  const claimed = await assertOk(
    supabase().rpc("claim_provider_webhook_event", {
      p_provider: "square",
      p_event_id: event.eventId,
      p_event_type: event.type,
      p_external_account_id: event.merchantId,
      p_livemode: environment === "production",
    }),
  );
  if (!claimed) return { duplicate: true };

  try {
    let handled = false;
    const now = new Date().toISOString();

    if (event.type === "oauth.authorization.revoked") {
      await assertOk(
        supabase()
          .from("square_connections")
          .update({
            status: "revoked",
            access_token_ciphertext: null,
            access_token_iv: null,
            refresh_token_ciphertext: null,
            refresh_token_iv: null,
            access_token_expires_at: null,
            disconnected_at: now,
            last_error: "BrizBuilder's access was removed from inside Square.",
            updated_at: now,
          })
          .eq("environment", environment)
          .eq("merchant_id", event.merchantId)
          .is("disconnected_at", null),
      );
      handled = true;
    } else if (event.type === "invoice.deleted" && event.deletedInvoiceId) {
      await assertOk(
        supabase()
          .from("square_invoices")
          .delete()
          .eq("square_invoice_id", event.deletedInvoiceId)
          .eq("merchant_id", event.merchantId)
          .eq("environment", environment)
          .eq("status", "draft"),
      );
      handled = true;
    } else if (event.invoice) {
      const row = (await assertOk(
        supabase()
          .from("square_invoices")
          .select("*")
          .eq("square_invoice_id", event.invoice.squareInvoiceId)
          .eq("merchant_id", event.merchantId)
          .eq("environment", environment)
          .maybeSingle(),
      )) as Row | null;
      // Invoices made directly in Square are not BrizBuilder's to track.
      if (row) {
        await applySummary(row, event.invoice);
        handled = true;
      }
    }

    await assertOk(
      supabase()
        .from("provider_webhook_events")
        .update({
          status: handled ? "processed" : "ignored",
          processed_at: now,
          last_error: null,
          updated_at: now,
        })
        .eq("provider", "square")
        .eq("event_id", event.eventId),
    );
    return { processed: handled };
  } catch (error) {
    await assertOk(
      supabase()
        .from("provider_webhook_events")
        .update({
          status: "failed",
          last_error: "Square webhook processing failed.",
          updated_at: new Date().toISOString(),
        })
        .eq("provider", "square")
        .eq("event_id", event.eventId),
    );
    throw error;
  }
}
