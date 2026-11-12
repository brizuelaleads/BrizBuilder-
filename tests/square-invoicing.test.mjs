import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  SQUARE_SCOPES,
  decryptSquareSecret,
  encryptSquareSecret,
  invoiceDisplayState,
  invoiceIdempotencyKey,
  isPdf,
  normalizeInvoiceInput,
  parseKeyBytes,
  parseMoneyToCents,
  parseSquareWebhook,
  safePdfName,
  squareErrorMessage,
  squareHosts,
  summarizeSquareInvoice,
  verifySquareSignature,
} from "../lib/square-core.ts";

const read = (rel) =>
  fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");

const NOW = new Date("2026-11-12T15:00:00Z");
const validInvoice = (over = {}) => ({
  recipientName: "Jordan Chen",
  recipientEmail: "Jordan@Example.com",
  title: "Roof repair",
  dueDate: "2026-11-30",
  lineItems: [
    { name: "Labor", quantity: 2, unitPrice: "250.00" },
    { name: "Materials", quantity: 1, unitPrice: "1,099.5" },
  ],
  ...over,
});

test("money is read exactly in whole cents, never guessed", () => {
  assert.equal(parseMoneyToCents("250"), 25000);
  assert.equal(parseMoneyToCents("$1,099.5"), 109950);
  assert.equal(parseMoneyToCents("0.07"), 7);
  assert.equal(parseMoneyToCents(19.99), 1999);
  for (const bad of ["", "-5", "1.999", "12abc", "1e5", null, undefined, Number.NaN, -1, 0.001])
    assert.equal(parseMoneyToCents(bad), null, `${String(bad)} is rejected`);
});

test("the invoice total is recomputed on the server from the line items", () => {
  const input = normalizeInvoiceInput(validInvoice({ totalCents: 1 }), NOW);
  assert.equal(input.totalCents, 2 * 25000 + 109950, "a total sent by the browser is ignored");
  assert.equal(input.recipientEmail, "jordan@example.com");
  assert.equal(input.send, true);
  assert.equal(normalizeInvoiceInput(validInvoice({ send: false }), NOW).send, false);
});

test("invoice input is rejected rather than repaired", () => {
  const cases = [
    [{ recipientName: "  " }, /who the invoice is for/],
    [{ recipientEmail: "not-an-email" }, /valid email/],
    [{ title: "" }, /title/],
    [{ dueDate: "2026-02-30" }, /due date/],
    [{ dueDate: "2026-11-01" }, /in the past/],
    [{ dueDate: "2029-01-01" }, /within two years/],
    [{ lineItems: [] }, /at least one line item/],
    [{ lineItems: [{ name: "x", quantity: 0, unitPrice: "5" }] }, /whole quantity/],
    [{ lineItems: [{ name: "x", quantity: 1.5, unitPrice: "5" }] }, /whole quantity/],
    [{ lineItems: [{ name: "x", quantity: 1, unitPrice: "-5" }] }, /price/],
    [{ lineItems: [{ name: "", quantity: 1, unitPrice: "5" }] }, /Describe line item 1/],
    [{ lineItems: [{ name: "x", quantity: 1, unitPrice: "0.50" }] }, /at least 1\.00/],
    [{ lineItems: Array.from({ length: 21 }, () => ({ name: "x", quantity: 1, unitPrice: "5" })) }, /up to 20/],
    [{ lineItems: [{ name: "x", quantity: 999, unitPrice: "999999.99" }] }, /too large/],
  ];
  for (const [over, message] of cases)
    assert.throws(() => normalizeInvoiceInput(validInvoice(over), NOW), message, JSON.stringify(over));
});

test("a recipient link is only kept when it is shaped like a record id", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(normalizeInvoiceInput(validInvoice({ recipientId: id }), NOW).recipientId, id);
  assert.equal(normalizeInvoiceInput(validInvoice({ recipientId: "' or 1=1" }), NOW).recipientId, null);
});

test("Square invoices are reduced to stored fields, and junk is refused", () => {
  const summary = summarizeSquareInvoice({
    id: "inv:0-ChAB",
    version: 3,
    status: "PARTIALLY_PAID",
    invoice_number: "000012",
    public_url: "https://squareup.com/pay-invoice/inv:0-ChAB",
    order_id: "ord_1",
    primary_recipient: { customer_id: "cus_1" },
    payment_requests: [
      {
        due_date: "2026-11-30",
        computed_amount_money: { amount: 159950, currency: "USD" },
        total_completed_amount_money: { amount: 50000, currency: "USD" },
      },
    ],
  });
  assert.deepEqual(summary, {
    squareInvoiceId: "inv:0-ChAB",
    version: 3,
    status: "partially_paid",
    invoiceNumber: "000012",
    publicUrl: "https://squareup.com/pay-invoice/inv:0-ChAB",
    orderId: "ord_1",
    customerId: "cus_1",
    amountCents: 159950,
    paidCents: 50000,
    currency: "USD",
    dueDate: "2026-11-30",
  });
  assert.equal(summarizeSquareInvoice({ id: "x", version: 1, status: "MADE_UP" }), null);
  assert.equal(summarizeSquareInvoice({ status: "PAID", version: 1 }), null);
  assert.equal(summarizeSquareInvoice(null), null);
  assert.equal(
    summarizeSquareInvoice({ id: "x", version: 1, status: "UNPAID", public_url: "javascript:alert(1)" }).publicUrl,
    null,
    "only an https payment link is kept",
  );
});

test("status labels tell people what they need to do, including overdue", () => {
  assert.deepEqual(invoiceDisplayState("unpaid", "2026-11-01", "2026-11-12"), { label: "Overdue", tone: "red", overdue: true });
  assert.equal(invoiceDisplayState("partially_paid", "2026-11-01", "2026-11-12").label, "Overdue · partly paid");
  assert.equal(invoiceDisplayState("paid", "2026-11-01", "2026-11-12").label, "Paid");
  assert.equal(invoiceDisplayState("unpaid", "2026-11-30", "2026-11-12").label, "Sent · unpaid");
  assert.equal(invoiceDisplayState("canceled", "2026-11-01", "2026-11-12").overdue, false);
});

test("webhook signatures follow Square's scheme and reject tampering", async () => {
  const signatureKey = "sig-key-123";
  const notificationUrl = "https://brizbuilder-leads.example.dev/api/integrations/square/webhook";
  const body = JSON.stringify({ merchant_id: "M1", type: "invoice.payment_made", event_id: "e1", data: {} });
  const signature = createHmac("sha256", signatureKey).update(notificationUrl + body).digest("base64");
  assert.equal(await verifySquareSignature({ signatureKey, notificationUrl, body, signature }), true);
  assert.equal(await verifySquareSignature({ signatureKey, notificationUrl, body: body + " ", signature }), false);
  assert.equal(await verifySquareSignature({ signatureKey, notificationUrl: notificationUrl + "/", body, signature }), false);
  assert.equal(await verifySquareSignature({ signatureKey: "other", notificationUrl, body, signature }), false);
  assert.equal(await verifySquareSignature({ signatureKey, notificationUrl, body, signature: null }), false);
  assert.equal(await verifySquareSignature({ signatureKey: "", notificationUrl, body, signature }), false);
});

test("webhook bodies are parsed strictly", () => {
  const event = parseSquareWebhook(
    JSON.stringify({
      merchant_id: "M1",
      type: "invoice.payment_made",
      event_id: "e1",
      data: { type: "invoice", id: "inv1", object: { invoice: { id: "inv1", version: 4, status: "PAID", payment_requests: [] } } },
    }),
  );
  assert.equal(event.invoice.status, "paid");
  assert.equal(event.invoice.version, 4);
  const deleted = parseSquareWebhook(
    JSON.stringify({ merchant_id: "M1", type: "invoice.deleted", event_id: "e2", data: { type: "invoice", id: "inv1", deleted: true } }),
  );
  assert.equal(deleted.deletedInvoiceId, "inv1");
  assert.throws(() => parseSquareWebhook("{"), /not valid JSON/);
  assert.throws(() => parseSquareWebhook(JSON.stringify({ type: "invoice.updated" })), /missing/);
});

test("tokens are encrypted per tenant scope and cannot be moved between them", async () => {
  const key = parseKeyBytes("a".repeat(64), "TEST_KEY");
  const org = "00000000-0000-4000-8000-000000000001";
  const client = "11111111-1111-4111-8111-111111111111";
  const sealed = await encryptSquareSecret(key, "EAAAl-secret-token", org, client, "access");
  assert.ok(!sealed.ciphertext.includes("secret"));
  assert.equal(await decryptSquareSecret(key, sealed, org, client, "access"), "EAAAl-secret-token");
  await assert.rejects(decryptSquareSecret(key, sealed, org, null, "access"), /Reconnect Square/, "agency scope");
  await assert.rejects(decryptSquareSecret(key, sealed, org, "22222222-2222-4222-8222-222222222222", "access"), /Reconnect Square/, "other client");
  await assert.rejects(decryptSquareSecret(key, sealed, org, client, "refresh"), /Reconnect Square/, "access token used as refresh");
  assert.throws(() => parseKeyBytes("short", "TEST_KEY"), /32-byte/);
});

test("Square access is limited to what invoicing needs", () => {
  assert.deepEqual([...SQUARE_SCOPES].sort(), [
    "CUSTOMERS_READ",
    "CUSTOMERS_WRITE",
    "INVOICES_READ",
    "INVOICES_WRITE",
    "MERCHANT_PROFILE_READ",
    "ORDERS_WRITE",
  ]);
  for (const scope of SQUARE_SCOPES)
    assert.doesNotMatch(scope, /PAYMENTS_WRITE|BANK|EMPLOYEES|PAYOUTS|SETTLEMENTS/, `${scope} is not needed`);
  assert.equal(squareHosts("sandbox").api, "https://connect.squareupsandbox.com/v2");
  assert.equal(squareHosts("production").api, "https://connect.squareup.com/v2");
});

test("errors shown to people never carry provider internals", () => {
  assert.match(squareErrorMessage({ errors: [{ code: "UNAUTHORIZED" }] }, 401), /Reconnect Square/);
  assert.match(squareErrorMessage({ errors: [{ code: "MERCHANT_SUBSCRIPTION_NOT_FOUND" }] }, 403), /Invoices Plus/);
  assert.match(squareErrorMessage({}, 503), /Square had a problem/);
  assert.equal(squareErrorMessage({ errors: [{ code: "X", detail: "Bad due date" }] }, 400), "Square: Bad due date");
});

test("PDF attachments are checked by content and named safely", () => {
  assert.equal(isPdf(new TextEncoder().encode("%PDF-1.7\n...")), true);
  assert.equal(isPdf(new TextEncoder().encode("<html>")), false);
  assert.equal(safePdfName("../../etc/Contract <v2>.PDF"), "....etcContract v2.pdf");
  assert.equal(safePdfName("***"), "contract.pdf");
  assert.equal(invoiceIdempotencyKey("abc", "order"), "bb:abc:order");
});

// ---- Source contracts: tenant isolation and secret handling. ----

const store = read("db/supabase-square.ts");
const api = read("app/api/square/route.ts");
const callback = read("app/api/integrations/square/callback/route.ts");
const webhook = read("app/api/integrations/square/webhook/route.ts");
const migration = read("supabase/migrations/20261112195619_square_invoicing.sql");

function fnBody(source, name) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end);
}

test("every Square entry point authorizes the caller before touching data", () => {
  for (const name of [
    "getSquareWorkspace",
    "beginSquareConnect",
    "disconnectSquare",
    "createSquareInvoiceForScope",
    "sendSquareInvoice",
    "cancelSquareInvoiceForScope",
    "deleteSquareInvoiceForScope",
    "syncSquareInvoices",
  ]) {
    const body = fnBody(store, name);
    const auth = body.indexOf("await authorize(user, scope,");
    assert.ok(auth > 0, `${name} calls authorize`);
    assert.ok(auth < body.indexOf("supabase()") || !body.includes("supabase()"), `${name} authorizes before querying`);
  }
  // A client id from the browser is only used after the shared tenant check.
  assert.match(store, /await requireSupabaseClientAccess\(context, scope\.clientId\);\s*clientId = scope\.clientId;/);
  // The agency's own account is unreachable from a client login.
  assert.match(store, /context\.clientId !== null \|\| !AGENCY_OWNER_ROLES\.includes\(context\.role\)/);
  assert.match(store, /const AGENCY_OWNER_ROLES: CrmRole\[] = \["LB_OWNER", "SUPER_ADMIN", "AGENCY_OWNER"\];/);
  assert.match(store, /const CONNECT_ROLES: CrmRole\[] = \[\.\.\.AGENCY_OWNER_ROLES, "CLIENT_OWNER"\];/);
  assert.match(store, /const INVOICE_ROLES: CrmRole\[] = \[\.\.\.CONNECT_ROLES, "CLIENT_MANAGER"\];/);
});

test("invoice queries are pinned to the caller's organization and scope", () => {
  assert.match(store, /async function invoiceFor\([\s\S]*?\.eq\("id", invoiceId\)\s*\.eq\("organization_id", organizationId\),\s*clientId,/);
  assert.match(store, /function scoped[\s\S]*?query\.eq\("client_id", clientId\) : query\.is\("client_id", null\)/);
  // A recipient picked in the browser is re-checked against the tenant.
  assert.match(store, /\.from\("contacts"\)[\s\S]{0,120}\.eq\("id", input\.recipientId\)\s*\.eq\("organization_id", context\.organizationId\)\s*\.eq\("client_id", clientId\)/);
});

test("the OAuth callback is single-use and bound to the person who started it", () => {
  const finish = fnBody(store, "finishSquareConnect");
  assert.match(finish, /\.is\("used_at", null\)\s*\.gt\("expires_at", now\)/);
  assert.match(finish, /user\.email\.trim\(\)\.toLowerCase\(\) !==\s*String\(authorization\.requested_by_email\)/);
  assert.match(finish, /await authorize\(user, scope, "connect"\)/);
  assert.match(finish, /already connected somewhere else/);
  assert.match(finish, /finally \{[\s\S]*?\.delete\(\)\.eq\("id", authorization\.id\)/);
  assert.match(callback, /const user = await getChatGPTUser\(\);\s*if \(!user\)/);
  assert.match(store, /state_hash: await sha256Hex\(state\)/, "only a hash of the state is stored");
});

test("the webhook trusts nothing until the signature checks out", () => {
  const verify = webhook.indexOf("verifySquareWebhook(");
  const parse = webhook.indexOf("parseSquareWebhook(rawBody)");
  assert.ok(verify > 0 && parse > verify, "signature is verified before the body is parsed");
  assert.match(webhook, /if \(!verified\)\s*return Response\.json\(\{ error: "Invalid Square webhook\." \}, \{ status: 403/);
  const handler = fnBody(store, "handleSquareWebhook");
  assert.match(handler, /rpc\("claim_provider_webhook_event"/, "duplicate deliveries are claimed once");
  // The tenant comes from stored rows matched on Square's ids, never the body.
  assert.doesNotMatch(handler, /organization_id|client_id/);
  assert.match(handler, /\.eq\("square_invoice_id", event\.invoice\.squareInvoiceId\)\s*\.eq\("merchant_id", event\.merchantId\)/);
});

test("Square's webhook reaches the app only through the public gateway, POST only", () => {
  const gateway = read("lead-worker/src/index.ts");
  assert.match(gateway, /const isSquareWebhook = url\.pathname === "\/api\/integrations\/square\/webhook";/);
  assert.match(gateway, /isSquareWebhook\) && request\.method !== "POST"/);
  // Square signs the URL it delivered to, so the check uses the configured
  // public URL rather than the forwarded request's URL.
  assert.match(read("lib/square.ts"), /readRuntimeValue\("SQUARE_WEBHOOK_URL"\)/);
});

test("state-changing requests need same-origin proof", () => {
  assert.match(api, /if \(!sameOrigin\(request\)\)/);
  assert.match(api, /return fetchSite === "same-origin" \|\| fetchSite === "none";/);
  assert.match(api, /if \(origin\) \{/);
});

test("tokens and tables stay server-side", () => {
  for (const table of ["square_connections", "square_authorization_states", "square_invoices"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated;`));
  }
  assert.doesNotMatch(migration, /create policy/i);
  assert.match(migration, /square_connections_tokens_check/);
  // The workspace sent to the browser never includes token fields.
  const workspace = fnBody(store, "getSquareWorkspace");
  assert.doesNotMatch(workspace.slice(workspace.indexOf("return {")), /token|ciphertext/);
  // Configuration problems name settings only to agency owners.
  assert.match(workspace, /missingSettings: AGENCY_OWNER_ROLES\.includes\(context\.role\) \? runtime\.missing : \[\]/);
  assert.doesNotMatch(read("lib/square.ts"), /console\.(log|error)/);
});

test("a send is only reported as failed when Square itself failed", () => {
  const body = fnBody(store, "createSquareInvoiceForScope");
  const squareTry = body.indexOf("result = await withSquare(connection,");
  const cleanup = body.indexOf("} catch (error) {", squareTry);
  const bookkeeping = body.indexOf("await applySummary(row, result.final);");
  assert.ok(squareTry > 0 && cleanup > squareTry, "Square calls are wrapped");
  assert.ok(bookkeeping > cleanup, "saving the result happens after the cleanup block, so a database error cannot mark a sent invoice as failed");
  // An invoice Square would not delete keeps its id for Refresh status.
  assert.match(body, /leftInSquare && created\s*\? \{ square_invoice_id: created\.squareInvoiceId/);
  assert.match(fnBody(store, "syncSquareInvoices"), /\[\.\.\.SQUARE_OPEN_STATUSES, "paid", "failed"\]/);
  // Publishing uses the version Square reports after the attachment.
  assert.match(body, /const current = file\s*\? await getSquareInvoice\(accessToken, draft\.squareInvoiceId\)/);
});

test("sandbox attachments are refused before anything is created", () => {
  const body = fnBody(store, "createSquareInvoiceForScope");
  const guard = body.indexOf("SANDBOX_ATTACHMENT_LIMIT_BYTES)");
  assert.ok(guard > 0, "the sandbox limit is checked");
  assert.ok(guard < body.indexOf('.from("square_invoices")'), "before a row or a Square draft exists");
});

test("deleting a row Square may have sent asks Square first", () => {
  const body = fnBody(store, "deleteSquareInvoiceForScope");
  assert.match(body, /if \(row\.square_invoice_id\) \{/);
  assert.match(body, /if \(current\.status !== "draft"\)/);
});

test("disconnecting always drops local tokens, even if Square is unreachable", () => {
  const body = fnBody(store, "disconnectSquare");
  assert.match(body, /revoked = await revokeSquareAccess\(accessToken\);/);
  assert.match(body, /access_token_ciphertext: null,\s*access_token_iv: null,\s*refresh_token_ciphertext: null,\s*refresh_token_iv: null,/);
});

test("Stripe stays agency-only while clients get Square invoicing", () => {
  const view = read("app/crm/PaymentsView.tsx");
  assert.match(view, /const activeProvider: Provider = isAgency \? provider : "square";/);
  assert.match(view, /isAgency && AGENCY_OWNER_ROLES\.includes\(viewerRole\) && selectedClientId === "all"/);
});
