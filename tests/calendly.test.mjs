import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  calendlyPkceChallenge,
  calendlyPkceVerifier,
  createCalendlyWebhookPathId,
  decryptCalendlySecret,
  encryptCalendlySecret,
  isCalendlyWebhookPathId,
  normalizeCalendlyBooking,
  parseCalendlyKey,
  parseCalendlyWebhook,
  signCalendlyWebhook,
  verifyCalendlySignature,
} from "../lib/calendly-core.ts";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const KEY = parseCalendlyKey("a".repeat(64));
const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

const event = {
  uri: "https://api.calendly.com/scheduled_events/EVT1",
  name: "Free roof inspection",
  status: "active",
  start_time: "2026-12-03T15:00:00.000000Z",
  end_time: "2026-12-03T15:30:00.000000Z",
  location: { type: "physical", location: "123 Main St, Austin TX" },
};
const invitee = {
  uri: "https://api.calendly.com/scheduled_events/EVT1/invitees/INV1",
  email: "Jane.Doe@Example.com",
  name: "Jane Doe",
  first_name: null,
  last_name: null,
  status: "active",
  timezone: "America/Chicago",
  text_reminder_number: null,
  rescheduled: false,
  old_invitee: null,
  questions_and_answers: [
    { question: "Phone number", answer: "+1 512 555 0100", position: 0 },
    { question: "What do you need?", answer: "Leak over the garage", position: 1 },
  ],
  tracking: { utm_campaign: "fall-promo" },
};

test("the signature check matches Calendly's documented scheme", async () => {
  const body = JSON.stringify({ event: "invitee.created", payload: invitee });
  const key = "app-signing-key";
  const t = 1_800_000_000;
  // Independent implementation: HMAC-SHA256 hex over `${t}.${body}`.
  const expected = createHmac("sha256", key).update(`${t}.${body}`).digest("hex");
  assert.equal(await signCalendlyWebhook(body, key, t), `t=${t},v1=${expected}`);
  assert.equal(await verifyCalendlySignature(body, `t=${t},v1=${expected}`, key, t + 10), true);
});

test("the signature check rejects tampering, the wrong key, stale and malformed headers", async () => {
  const body = '{"event":"invitee.created"}';
  const t = 1_800_000_000;
  const header = await signCalendlyWebhook(body, "k", t);
  assert.equal(await verifyCalendlySignature(`${body} `, header, "k", t), false);
  assert.equal(await verifyCalendlySignature(body, header, "other", t), false);
  assert.equal(await verifyCalendlySignature(body, header, "k", t + 181), false);
  assert.equal(await verifyCalendlySignature(body, null, "k", t), false);
  assert.equal(await verifyCalendlySignature(body, "v1=abc", "k", t), false);
  assert.equal(await verifyCalendlySignature(body, header, "", t), false);
});

test("tokens are encrypted per business and kind", async () => {
  const sealed = await encryptCalendlySecret(KEY, "secret-token", ORG, CLIENT, "access");
  assert.equal(await decryptCalendlySecret(KEY, sealed, ORG, CLIENT, "access"), "secret-token");
  assert.ok(!sealed.ciphertext.includes("secret"));
  await assert.rejects(decryptCalendlySecret(KEY, sealed, ORG, ORG, "access"));
  await assert.rejects(decryptCalendlySecret(KEY, sealed, ORG, CLIENT, "refresh"));
  assert.throws(() => parseCalendlyKey("too-short"));
});

test("the PKCE verifier is stable per state and the challenge is its S256 hash", async () => {
  const state = "s".repeat(64);
  const verifier = await calendlyPkceVerifier(KEY, state);
  assert.equal(verifier, await calendlyPkceVerifier(KEY, state));
  assert.notEqual(verifier, await calendlyPkceVerifier(KEY, `${state}x`));
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  const { createHash } = await import("node:crypto");
  assert.equal(await calendlyPkceChallenge(verifier), createHash("sha256").update(verifier).digest("base64url"));
});

test("webhook path ids are long and unguessable", () => {
  const id = createCalendlyWebhookPathId();
  assert.equal(isCalendlyWebhookPathId(id), true);
  assert.notEqual(id, createCalendlyWebhookPathId());
  assert.equal(isCalendlyWebhookPathId("../etc"), false);
  assert.equal(isCalendlyWebhookPathId("short"), false);
});

test("a booking keeps the details the business needs", () => {
  const booking = normalizeCalendlyBooking(invitee, event);
  assert.equal(booking.email, "jane.doe@example.com");
  assert.equal(booking.firstName, "Jane");
  assert.equal(booking.lastName, "Doe");
  assert.equal(booking.phone, "+1 512 555 0100");
  assert.equal(booking.eventName, "Free roof inspection");
  assert.equal(booking.startsAt, "2026-12-03T15:00:00.000Z");
  assert.equal(booking.endsAt, "2026-12-03T15:30:00.000Z");
  assert.equal(booking.timeZone, "America/Chicago");
  assert.equal(booking.status, "active");
  assert.equal(booking.campaign, "fall-promo");
  assert.match(booking.notes, /Booked through Calendly/);
  assert.match(booking.notes, /In person: 123 Main St/);
  assert.match(booking.notes, /What do you need\?: Leak over the garage/);
});

test("bookings without ids, a start time or any way to reach the person are dropped", () => {
  assert.equal(normalizeCalendlyBooking({ ...invitee, uri: "https://evil.example/x" }, event), null);
  assert.equal(normalizeCalendlyBooking(invitee, { ...event, start_time: "soon" }), null);
  assert.equal(
    normalizeCalendlyBooking({ ...invitee, email: null, questions_and_answers: [] }, event),
    null,
  );
});

test("reschedules and cancellations are recognized", () => {
  const replaced = normalizeCalendlyBooking(
    { ...invitee, uri: `${event.uri}/invitees/INV2`, old_invitee: invitee.uri },
    event,
  );
  assert.equal(replaced.oldInviteeUri, invitee.uri);
  assert.equal(normalizeCalendlyBooking({ ...invitee, status: "canceled", rescheduled: true }, event).rescheduled, true);
  const created = parseCalendlyWebhook(JSON.stringify({ event: "invitee.created", payload: { ...invitee, scheduled_event: event } }));
  assert.equal(created.kind, "created");
  assert.equal(created.event.uri, event.uri);
  assert.equal(parseCalendlyWebhook(JSON.stringify({ event: "invitee.canceled", payload: invitee })).kind, "canceled");
  assert.equal(parseCalendlyWebhook(JSON.stringify({ event: "routing_form_submission.created", payload: {} })).kind, "ignored");
});

test("the webhook verifies the signature before touching the database", () => {
  const source = read("db/supabase-calendly.ts");
  const handler = source.slice(source.indexOf("export async function handleCalendlyWebhook"));
  assert.ok(handler.indexOf("verifyCalendlySignature") < handler.indexOf('.from("calendly_connections")'));
  assert.ok(handler.indexOf("verifyCalendlySignature") < handler.indexOf("parseCalendlyWebhook"));
});

test("Calendly tables are service-role only and appointments accept the calendly source", () => {
  const migration = read("supabase/migrations/20261127000000_calendly.sql");
  for (const table of ["calendly_connections", "calendly_bookings"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
    assert.doesNotMatch(migration, new RegExp(`create policy [^;]*on public\\.${table}`));
  }
  assert.match(migration, /unique \(organization_id, client_id, invitee_uri\)/);
  assert.match(migration, /'ai_summary', 'calendly'/);
});

test("connect and disconnect are permission-checked and bound to the person who started them", () => {
  const source = read("db/supabase-calendly.ts");
  assert.match(source, /supabaseRoleHasPermission\(context, "calendar\.connect"\)/);
  assert.match(source, /requireSupabaseClientAccess\(context, clientId\)/);
  assert.match(source, /requested_by_email\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(source, /\.is\("used_at", null\)/);
  // Refresh tokens are single-use, so refreshing takes a row claim.
  assert.match(source, /refresh_claim_id\.is\.null,refresh_claimed_at\.lt\./);
});

test("the webhook path skips the session proxy and tokens never reach the browser", () => {
  assert.match(read("proxy.ts"), /api\/integrations\/calendly\/webhook/);
  const card = read("app/crm/WorkflowViews.tsx");
  assert.doesNotMatch(card, /access_token|refresh_token/);
});
