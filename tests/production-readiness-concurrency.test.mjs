import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  googleCalendarEventId,
  syncGoogleCalendarAppointment,
} from "../lib/google-calendar.ts";
import {
  completePushDelivery,
  PUSH_DELIVERY_LEASE_SECONDS,
} from "../lib/push-delivery-state.ts";
import { normalizeVapidSubject } from "../lib/vapid-subject.ts";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8").replaceAll("\r\n", "\n");
const migration = read(
  "supabase/migrations/20260829120000_production_readiness_concurrency.sql",
);
const ingestion = read("lib/callrail-ingestion.ts");

test("VAPID subjects normalize every supported form without double mailto", () => {
  assert.equal(normalizeVapidSubject("alerts@example.com"), "mailto:alerts@example.com");
  assert.equal(
    normalizeVapidSubject("mailto:alerts@example.com"),
    "mailto:alerts@example.com",
  );
  assert.equal(
    normalizeVapidSubject("BrizBuilder Alerts <alerts@example.com>"),
    "mailto:alerts@example.com",
  );
  assert.equal(
    normalizeVapidSubject("https://example.com/push-contact"),
    "https://example.com/push-contact",
  );
  for (const invalid of [
    "",
    "mailto:mailto:alerts@example.com",
    "http://example.com/contact",
    "https://user:secret@example.com/contact",
    "not-an-email",
    "mailto:not-an-email",
  ]) {
    assert.equal(normalizeVapidSubject(invalid), null, invalid);
  }
});

test("out-of-order transcript responses use a monotonic database generation", () => {
  const reserveAt = ingestion.indexOf("reserveTranscriptGeneration(");
  const fetchAt = ingestion.indexOf("call = await getCallRailCall(");
  assert.ok(reserveAt > 0 && reserveAt < fetchAt, "generation is reserved before fetch");
  assert.match(
    ingestion,
    /\.eq\("transcript_requested_generation", transcriptGeneration\)/,
  );
  assert.match(
    ingestion,
    /Number\(snapshot\.transcript_generation\) !== transcriptGeneration[\s\S]+transcript\.stale_response[\s\S]+return \{ status: "busy"/,
  );
  assert.match(migration, /transcript_requested_generation = call\.transcript_requested_generation \+ 1/);
  assert.match(
    migration,
    /transcript_generation <= transcript_requested_generation/,
  );
});

test("stale enrichment is rejected before any CRM or calendar mutation", () => {
  const processAt = ingestion.indexOf("async function processTranscriptEnrichment");
  const claimAt = ingestion.indexOf(
    'rpc("claim_callrail_transcript_enrichment"',
    processAt,
  );
  const contactWriteAt = ingestion.indexOf('.from("contacts")\n          .update', claimAt);
  const appointmentAt = ingestion.indexOf("syncTranscriptAppointment({", claimAt);
  assert.ok(claimAt > processAt);
  assert.ok(contactWriteAt > claimAt, "contact mutation follows the CAS claim");
  assert.ok(appointmentAt > claimAt, "appointment/calendar mutation follows the CAS claim");
  assert.match(
    migration,
    /transcript_sha256 = p_transcript_sha256[\s\S]+transcript_generation = p_transcript_generation[\s\S]+transcript_requested_generation = p_transcript_generation/,
  );
  assert.match(
    migration,
    /ingest_status <> 'enriching'[\s\S]+updated_at < p_stale_before/,
  );
});

test("concurrent Google Calendar creates converge on one deterministic event", async () => {
  const originalFetch = globalThis.fetch;
  const created = new Set();
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    const method = init.method ?? "GET";
    requests.push({ method, url: parsed.toString() });
    if (method === "GET") return Response.json({ items: [] });
    const body = JSON.parse(String(init.body));
    if (method === "POST") {
      if (created.has(body.id)) {
        return Response.json({ error: { message: "duplicate" } }, { status: 409 });
      }
      created.add(body.id);
      return Response.json({ id: body.id });
    }
    if (method === "PUT") {
      created.add(parsed.pathname.split("/").at(-1));
      return Response.json({ id: parsed.pathname.split("/").at(-1) });
    }
    throw new Error(`Unexpected method ${method}`);
  };

  try {
    const appointment = {
      id: "28f0be86-6d25-4eb9-b581-83ee165acc23",
      contactName: "Casey Customer",
      serviceType: "Roof inspection",
      startsAt: "2026-09-01T15:00:00.000Z",
      endsAt: "2026-09-01T16:00:00.000Z",
      notes: "Confirmed",
      status: "CONFIRMED",
    };
    const expected = await googleCalendarEventId(appointment.id);
    const results = await Promise.all([
      syncGoogleCalendarAppointment("token", appointment),
      syncGoogleCalendarAppointment("token", appointment),
    ]);
    assert.equal(created.size, 1);
    assert.deepEqual(results.map((result) => result.eventId), [expected, expected]);
    assert.equal(requests.filter((request) => request.method === "POST").length, 2);
    assert.equal(requests.filter((request) => request.method === "PUT").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("atomic lead matching is tenant/contact locked and has no unlocked decision", () => {
  assert.match(
    migration,
    /pg_advisory_xact_lock\([\s\S]+p_organization_id::text[\s\S]+p_client_id::text[\s\S]+p_contact_id::text/,
  );
  assert.match(
    migration,
    /order by lead\.created_at desc, lead\.id desc[\s\S]+for update/,
  );
  assert.match(migration, /if v_lead\.id is not null[\s\S]+insert into public\.leads/);
  const ensureAt = ingestion.indexOf("async function ensureLead(");
  const markAt = ingestion.indexOf("async function markCall(", ensureAt);
  const ensureBody = ingestion.slice(ensureAt, markAt);
  assert.match(ensureBody, /rpc\("find_or_create_callrail_lead"/);
  assert.ok(
    ensureBody.indexOf('rpc("find_or_create_callrail_lead"') <
      ensureBody.indexOf('from("leads")'),
    "the atomic RPC decides before any legacy fallback can run",
  );
});

test("push delivery state retries failures and stops completed work", () => {
  const success = completePushDelivery(
    [{ endpoint: "one", status: 201, expired: false }],
    1,
    new Date(0),
  );
  assert.equal(success.status, "delivered");
  assert.equal(success.nextAttemptAt, null);

  const retry = completePushDelivery(
    [{ endpoint: "one", status: 503, expired: false }],
    1,
    new Date(0),
  );
  assert.equal(retry.status, "failed");
  assert.ok(Date.parse(retry.nextAttemptAt) > 0);

  const permanent = completePushDelivery(
    [{ endpoint: "one", status: 410, expired: true }],
    1,
    new Date(0),
  );
  assert.equal(permanent.status, "permanently_failed");
});

test("expired push leases are recoverable and duplicate workers are serialized", () => {
  assert.ok(PUSH_DELIVERY_LEASE_SECONDS >= 30);
  assert.match(migration, /status = 'processing' and v_row\.lease_expires_at > v_now/);
  assert.match(migration, /v_row\.status in \('delivered', 'permanently_failed'\)/);
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]+p_client_id::text \|\| ':' \|\| p_event_key/);
  assert.match(migration, /and lease_token = p_claim_token/);
  assert.match(read("lib/notification-sweeps.ts"), /await recoverPushDeliveries\(\)/);
  assert.match(read("db/supabase-push.ts"), /lease_expires_at\.lte/);
});
