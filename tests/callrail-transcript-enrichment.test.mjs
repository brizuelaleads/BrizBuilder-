import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  enrichCallRailTranscript,
  extractTranscriptAppointment,
  isSystemCallMetadataMessage,
  shouldApplyTranscriptField,
} from "../lib/callrail-enrichment.ts";
import {
  CALLRAIL_TRANSCRIPT_MAX_ATTEMPTS,
  CALLRAIL_TRANSCRIPT_RETRY_DELAYS_MS,
  decideTranscriptRetry,
} from "../lib/callrail-transcript-retry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const callStartedAt = "2026-08-26T20:00:00.000Z"; // 3:00 PM America/Chicago
const timeZone = "America/Chicago";
const enrich = (transcript, providerSummary = null) =>
  enrichCallRailTranscript({ transcript, callStartedAt, timeZone, providerSummary });

test("1. immediately available transcript is successful on its first attempt", () => {
  assert.deepEqual(
    decideTranscriptRetry({ transcriptAvailable: true, attemptCount: 1, attemptedAt: new Date(0) }),
    { status: "available", nextAttemptAt: null, failureReason: null },
  );
});

test("2. a late transcript remains pending on a bounded backoff schedule", () => {
  const attemptedAt = new Date("2026-08-26T20:00:00.000Z");
  for (let attempt = 1; attempt < CALLRAIL_TRANSCRIPT_MAX_ATTEMPTS; attempt += 1) {
    const decision = decideTranscriptRetry({ transcriptAvailable: false, attemptCount: attempt, attemptedAt });
    assert.equal(decision.status, "pending");
    assert.equal(
      Date.parse(decision.nextAttemptAt) - attemptedAt.getTime(),
      CALLRAIL_TRANSCRIPT_RETRY_DELAYS_MS[attempt - 1],
    );
  }
  const source = read("lib/callrail-ingestion.ts");
  assert.match(source, /async function ensureCallPlaceholder/);
  assert.match(source, /transcript_attempt_count: 0/);
  assert.match(source, /await ensureCallPlaceholder\(/);
});

test("3. a transcript that never arrives stops after the limit", () => {
  const decision = decideTranscriptRetry({
    transcriptAvailable: false,
    attemptCount: CALLRAIL_TRANSCRIPT_MAX_ATTEMPTS,
    attemptedAt: new Date(0),
  });
  assert.equal(decision.status, "unavailable");
  assert.equal(decision.nextAttemptAt, null);
  assert.equal(decision.failureReason, "retry_limit");
});

test("a transient provider failure remains observable while retrying", () => {
  const decision = decideTranscriptRetry({
    transcriptAvailable: false,
    attemptCount: 2,
    attemptedAt: new Date(0),
    failureReason: "provider_unavailable",
  });
  assert.equal(decision.status, "pending");
  assert.equal(decision.failureReason, "provider_unavailable");
});

test("4. transcript retry policy has no duration/short-call filter", () => {
  const source = read("lib/callrail-transcript-retry.ts");
  assert.equal(/duration|seconds|short.call/iu.test(source), false);
});

test("5. duplicate webhooks update the same call without consuming an early retry", () => {
  const source = read("lib/callrail-ingestion.ts");
  assert.match(source, /\["accepted", "duplicate"\]\.includes/);
  assert.match(source, /String\(delivery\.outcome\) === "accepted"/);
  assert.match(source, /callrail_call_id", call\.id/);
  assert.match(source, /\.eq\("transcript_status", "pending"\)\s*\.is\("transcript", null\)/);
});

test("6. an existing caller is matched by CallRail person id and then normalized phone", () => {
  const source = read("lib/callrail-ingestion.ts");
  const migration = read("supabase/migrations/20260827010000_callrail_transcript_enrichment.sql");
  assert.match(source, /\.eq\("person_id", call\.personId\)/);
  assert.match(source, /rpc\("find_or_create_callrail_contact"/);
  assert.match(migration, /regexp_replace\(coalesce\(c\.phone, ''\)/);
});

test("7. a phone-only caller gets a placeholder that transcript enrichment may fill", () => {
  const source = read("lib/callrail-ingestion.ts");
  assert.match(source, /firstName: "Phone", lastName: "Caller"/);
  assert.match(source, /placeholderName/);
});

test("8. a clearly self-identified customer name is extracted", () => {
  assert.equal(enrich("Caller: Hi, this is Michael Johnson.").customerName?.value, "Michael Johnson");
  assert.equal(enrich("Caller: I think my brother put the account under Mike.").customerName, null);
});

test("9. a clearly stated email is extracted but uncertain email is rejected", () => {
  assert.equal(enrich("Caller: My email is johnsmith@gmail.com.").email?.value, "johnsmith@gmail.com");
  assert.equal(enrich("Caller: My email might still be oldemail@gmail.com.").email, null);
});

test("10. a complete service address is split into structured fields", () => {
  const result = enrich("Caller: The service address is 512 East Main Street, Sulphur Springs, Texas 75482.");
  assert.deepEqual(
    [result.address?.value, result.city?.value, result.state?.value, result.zip?.value],
    ["512 East Main Street", "Sulphur Springs", "TX", "75482"],
  );
  assert.equal(enrich("Caller: I'm near Walmart.").address, null);
});

test("11. specific requested services are classified conservatively", () => {
  assert.equal(enrich("Caller: I need my water heater replaced.").requestedService?.value, "Water Heater Replacement");
  assert.equal(enrich("Caller: I'm calling because I have termites.").requestedService?.value, "Termite Treatment");
  assert.equal(enrich("Caller: My AC isn't cooling.").requestedService?.value, "AC Repair");
});

test("12. an explicit estimate produces exact cents", () => {
  assert.equal(enrich("Caller: The estimate is $1,500.").estimatedValueCents?.value, 150000);
});

test("13. vague financial language does not produce a value", () => {
  assert.equal(enrich("Caller: It will probably cost me a few thousand.").estimatedValueCents, null);
  assert.equal(enrich("Caller: The budget might be about $2,000.").estimatedValueCents, null);
});

test("14. discussed and rejected dates do not create an appointment", () => {
  const result = extractTranscriptAppointment(
    "Caller: Tuesday at 3 PM might work.\nAgent: How about Tuesday at 3?\nCaller: Actually no, I can't do Tuesday.",
    callStartedAt,
    timeZone,
  );
  assert.equal(result.status, "cancelled");
  assert.equal(result.verified, false);
  assert.equal(result.start, null);
});

test("15. final caller confirmation creates a verified appointment", () => {
  const result = extractTranscriptAppointment(
    "Agent: Does Thursday at 2 PM work?\nCaller: Yes, Thursday at 2 works.\nAgent: Perfect, we'll see you Thursday at 2.",
    callStartedAt,
    timeZone,
  );
  assert.equal(result.status, "confirmed");
  assert.equal(result.verified, true);
  assert.equal(result.start, "2026-08-27T19:00:00.000Z");
});

test("16. an appointment cancelled later in the call has no active time", () => {
  const result = extractTranscriptAppointment(
    "Agent: Friday at 10 AM?\nCaller: Yes, Friday at 10 works.\nCaller: Never mind, I can't do Friday anymore.",
    callStartedAt,
    timeZone,
  );
  assert.equal(result.status, "cancelled");
  assert.equal(result.verified, false);
  assert.equal(result.start, null);
});

test("17. a final confirmed replacement time is marked rescheduled", () => {
  const result = extractTranscriptAppointment(
    "Agent: Thursday at 2 PM?\nCaller: Yes, Thursday at 2 works.\nCaller: Actually, Friday at 3 PM works instead.",
    callStartedAt,
    timeZone,
  );
  assert.equal(result.status, "rescheduled");
  assert.equal(result.verified, true);
  assert.equal(result.start, "2026-08-28T20:00:00.000Z");
});

test("18. tomorrow resolves from call time in the client timezone", () => {
  const result = extractTranscriptAppointment(
    "Agent: Does tomorrow at 2 PM work?\nCaller: Yes, tomorrow at 2 works.",
    "2026-08-27T04:30:00.000Z", // Aug 26, 11:30 PM in Chicago
    timeZone,
  );
  assert.equal(result.start, "2026-08-27T19:00:00.000Z");
  assert.equal(result.verified, true);
});

test("relative appointments reject nonexistent DST times and use the client zone", () => {
  const springGap = extractTranscriptAppointment(
    "Agent: Does tomorrow at 2:30 AM work?\nCaller: Yes, tomorrow at 2:30 AM works.",
    "2026-03-07T18:00:00.000Z",
    timeZone,
  );
  assert.equal(springGap.verified, false);
  assert.equal(springGap.start, null);

  const fallBack = extractTranscriptAppointment(
    "Agent: Does tomorrow at 1:30 AM work?\nCaller: Yes, tomorrow at 1:30 AM works.",
    "2026-10-31T18:00:00.000Z",
    timeZone,
  );
  assert.equal(fallBack.verified, true);
  assert.equal(fallBack.start, "2026-11-01T06:30:00.000Z");
});

test("19. website form messages are stored as customer-authored content", () => {
  const route = read("app/api/website-leads/[key]/route.ts");
  assert.match(route, /message: cleanText\(input\.message, 1200\) \?\? ""/);
  assert.match(route, /source: "form"/);
});

test("20. phone leads use a call summary and never synthesize metadata as a message", () => {
  const source = read("lib/callrail-ingestion.ts");
  assert.match(source, /return text\(call\.callSummary, 1200\) \?\? ""/);
  assert.equal(isSystemCallMetadataMessage("Call started: 2026-08-27T02:05:41.632Z Duration: 22s"), true);
  assert.equal(enrich("Caller: My AC isn't cooling.").summary.includes("Call started"), false);
});

test("21. lower-confidence transcript text cannot replace manually verified email", () => {
  assert.equal(
    shouldApplyTranscriptField(
      "john@gmail.com",
      { value: "jon@gmail.com", confidence: 0.99, source: "transcript" },
      { source: "manual", confidence: 1, verified: true },
      0.94,
    ),
    false,
  );
});

test("22. explicit corrections repair non-manual email and address", () => {
  const corrected = enrich(
    "Caller: My old email doesn't work anymore. Use johnsmith@gmail.com instead. " +
      "My old address is wrong. The service address is 512 East Main Street, Sulphur Springs, Texas 75482 instead.",
  );
  assert.equal(corrected.email?.explicitCorrection, true);
  assert.equal(corrected.address?.explicitCorrection, true);
  assert.equal(
    shouldApplyTranscriptField(
      "old@example.com",
      corrected.email,
      { source: "form", confidence: 1, verified: true },
      0.94,
    ),
    true,
  );
});

test("23. an additional contact stays a note, not the primary name", () => {
  const result = enrich("Caller: My name is John Smith. You can call my wife Sarah if you can't reach me.");
  assert.equal(result.customerName?.value, "John Smith");
  assert.equal(result.additionalContact?.value, "Wife: Sarah");
});

test("24. multiple calls share one open lead and one call row per CallRail id", () => {
  const source = read("lib/callrail-ingestion.ts");
  const migration = read("supabase/migrations/20260825140802_callrail_ingestion.sql");
  assert.match(source, /selectNewestLead/);
  assert.match(source, /lead_id: lead\.leadId/);
  assert.match(migration, /unique \(organization_id, client_id, callrail_call_id\)/);
});

test("25. first contact uses the earliest interaction", () => {
  const source = read("lib/callrail-ingestion.ts");
  assert.match(source, /first_contacted_at: earliestIso/);
});

test("26. last contact uses the latest interaction", () => {
  const source = read("lib/callrail-ingestion.ts");
  assert.match(source, /last_contacted_at: latestIso/);
});

test("calendar appointment writes are idempotent and final-state gated", () => {
  const ingestion = read("lib/callrail-ingestion.ts");
  const calendar = read("lib/google-calendar.ts");
  const migration = read("supabase/migrations/20260827010000_callrail_transcript_enrichment.sql");
  assert.match(
    ingestion,
    /extracted\.status !== "cancelled"\s*&&\s*\(extracted\.status === "tentative" \|\| !extracted\.verified\)/,
  );
  assert.match(calendar, /brizbuilderAppointmentId/);
  assert.match(calendar, /method: existingEventId \? "PUT" : "POST"/);
  assert.match(calendar, /id: deterministicEventId/);
  assert.match(calendar, /error\.status !== 409/);
  assert.match(calendar, /method: "DELETE"/);
  assert.match(migration, /appointments_transcript_lead_uidx/);
  assert.match(ingestion, /\.eq\("starts_at", extracted\.start\)/);
});

test("raw transcript, summary, extracted facts, and appointment state stay separate", () => {
  const migration = read("supabase/migrations/20260827010000_callrail_transcript_enrichment.sql");
  for (const field of ["transcript_sha256", "extracted_data", "appointment_status", "enrichment_status"]) {
    assert.match(migration, new RegExp(field));
  }
});

test("historical transcripts do not self-enrich and changed hashes do", () => {
  const ingestion = read("lib/callrail-ingestion.ts");
  const migration = read("supabase/migrations/20260827010000_callrail_transcript_enrichment.sql");
  assert.match(migration, /Historical transcripts remain evidence/);
  assert.match(migration, /enrichment_status = 'not_ready'/);
  assert.match(migration, /_legacy_customer_message/);
  assert.ok(
    migration.indexOf("'{_legacy_customer_message}'") <
      migration.indexOf("set message = coalesce"),
  );
  assert.doesNotMatch(
    migration,
    /when transcript is not null[^;]+then 'pending'[^;]+else 'not_ready'[^;]+end;/s,
  );
  assert.match(ingestion, /storedTranscript !== existingTranscript/);
  assert.match(ingestion, /\["pending", "processing", "failed"\]\.includes/);
  assert.match(migration, /Every other old value is conservatively\s+-- treated as manual/);
});

test("the per-call claim covers enrichment and stores operational decisions", () => {
  const ingestion = read("lib/callrail-ingestion.ts");
  const functionStart = ingestion.indexOf("export async function ingestFetchedCall");
  const functionEnd = ingestion.indexOf("async function callNeedsRefetch", functionStart);
  const body = ingestion.slice(functionStart, functionEnd);
  assert.ok(body.indexOf("processTranscriptEnrichment") < body.indexOf('ingest_status: "ingested"'));
  assert.match(ingestion, /appliedFields: applied/);
  assert.match(ingestion, /calendarAction: appointmentResult\.calendarAction/);
  assert.match(ingestion, /\.eq\("transcript_sha256", input\.transcriptHash\)/);
});

test("failed enrichment retries from stored evidence without refetching CallRail", () => {
  const ingestion = read("lib/callrail-ingestion.ts");
  const refetch = ingestion.slice(
    ingestion.indexOf("async function callNeedsRefetch"),
    ingestion.indexOf("async function recordTranscriptFetchFailure"),
  );
  assert.match(
    refetch,
    /row\.contact_id[\s\S]+row\.lead_id[\s\S]+row\.transcript_status === "available"[\s\S]+enrichment_status[\s\S]+return false/,
  );
  assert.match(ingestion, /async function retryStoredTranscriptEnrichment/);
  assert.match(ingestion, /for \(const row of await unfinishedEnrichments/);
  assert.match(ingestion, /const transcript = text\(current\.transcript, 20_000\)/);
});
