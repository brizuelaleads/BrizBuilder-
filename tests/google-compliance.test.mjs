import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { disconnectGoogleAccess } from "../lib/google-disconnect.ts";
import { GOOGLE_CALENDAR_SCOPE, hasGoogleCalendarScope,
  googleCalendarAuthorizationScopes, shouldUseOwnedGoogleCalendarScope } from "../lib/google-calendar-scopes.ts";
import { verifyGoogleCalendarAccess, syncGoogleCalendarAppointment } from "../lib/google-calendar.ts";

test("new Calendar consent is owned-only while existing grants remain usable", () => {
  assert.deepEqual(googleCalendarAuthorizationScopes(), ["https://www.googleapis.com/auth/calendar.events.owned"]);
  assert.ok(hasGoogleCalendarScope([GOOGLE_CALENDAR_SCOPE]));
  assert.ok(hasGoogleCalendarScope(["https://www.googleapis.com/auth/calendar.events"]));
  assert.equal(hasGoogleCalendarScope(["https://www.googleapis.com/auth/business.manage"]), false);
});

test("unverified owned scope is limited to designated review clients", () => {
  assert.equal(shouldUseOwnedGoogleCalendarScope("customer", "", ""), false);
  assert.equal(shouldUseOwnedGoogleCalendarScope("customer", "false", "demo"), false);
  assert.equal(shouldUseOwnedGoogleCalendarScope("demo", "false", " other, demo "), true);
  assert.equal(shouldUseOwnedGoogleCalendarScope("customer", "true", ""), true);
  assert.deepEqual(googleCalendarAuthorizationScopes(false), ["https://www.googleapis.com/auth/calendar.events"]);
});

test("revocation failure still deletes local data after stopping sync", async () => {
  const calls = [];
  const result = await disconnectGoogleAccess({
    stopSync: async () => { calls.push("stop"); },
    loadRefreshTokens: async () => { calls.push("load"); return ["token", "token"]; },
    revoke: async () => { calls.push("revoke"); throw new Error("provider unavailable"); },
    deleteLocalData: async () => { calls.push("delete"); },
  });
  assert.deepEqual(calls, ["stop", "load", "revoke", "delete"]);
  assert.equal(result.disconnected, true);
  assert.equal(result.googleRevocationConfirmed, false);
  assert.match(result.revocationWarning, /Google Account permissions/);
});

test("unreadable credentials cannot prevent local deletion", async () => {
  let deleted = false;
  const result = await disconnectGoogleAccess({
    stopSync: async () => {},
    loadRefreshTokens: async () => { throw new Error("decryption failed"); },
    revoke: async () => { assert.fail("No token should be transmitted"); },
    deleteLocalData: async () => { deleted = true; },
  });
  assert.ok(deleted);
  assert.equal(result.googleRevocationConfirmed, false);
});

test("successful revocation clears local data and database failures are not hidden", async () => {
  const operations = {
    stopSync: async () => {}, loadRefreshTokens: async () => ["a", "b"],
    revoke: async () => {}, deleteLocalData: async () => {},
  };
  assert.equal((await disconnectGoogleAccess(operations)).revocationWarning, null);
  await assert.rejects(disconnectGoogleAccess({ ...operations,
    deleteLocalData: async () => { throw new Error("database unavailable"); },
  }), /database unavailable/);
});

test("Calendar verification and sync read only identifiers and preserve write behavior", async () => {
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return Response.json(init.method === "POST" ? { id: "linked-event" } : { items: [] });
  };
  try {
    await verifyGoogleCalendarAccess("test-access-token");
    assert.equal(requests[0].url.searchParams.get("fields"), "items(id)");
    assert.equal(requests[0].url.searchParams.get("privateExtendedProperty"), "brizbuilderConnectionCheck=true");
    const result = await syncGoogleCalendarAppointment("test-access-token", {
      id: "test-appointment", contactName: "Demo Customer", serviceType: "Service",
      startsAt: "2026-12-01T15:00:00Z", endsAt: "2026-12-01T16:00:00Z", notes: "Demo", status: "SCHEDULED",
    });
    assert.equal(result.eventId, "linked-event");
    assert.equal(requests[1].url.searchParams.get("fields"), "items(id)");
    assert.match(requests[1].url.searchParams.get("privateExtendedProperty"), /^brizbuilderAppointmentId=/);
    assert.equal(requests[2].url.searchParams.get("fields"), "id");
    assert.equal(requests[2].init.method, "POST");
    const event = JSON.parse(requests[2].init.body);
    assert.equal(event.summary, "Scheduled · Service — Demo Customer");
    assert.equal(event.status, "tentative");
  } finally { globalThis.fetch = previous; }
});

test("Calendar consent is independent and credential migration denies browser access", () => {
  const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const crm = read("db/supabase-crm.ts");
  const begin = crm.slice(crm.indexOf("export async function beginSupabaseGoogleCalendarConnect"),
    crm.indexOf("export async function finishSupabaseGoogleConnect"));
  assert.match(begin, /googleCalendarAuthorizationScopes\(useOwnedScope\), false/);
  assert.doesNotMatch(begin, /GOOGLE_BUSINESS_SCOPE/);
  const disconnect = crm.slice(crm.indexOf("export async function disconnectSupabaseGoogleProfile"),
    crm.indexOf("export async function getSupabaseCallRailRecording"));
  assert.ok(disconnect.indexOf("requireClient(context, clientId)") < disconnect.indexOf("disconnectStoredGoogleAccess("));
  assert.match(disconnect, /"calendar.connect" : "profiles.connect"/);
  const migration = read("supabase/migrations/20261117000000_separate_google_calendar_credentials.sql");
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all[^;]+from public, anon, authenticated/);
  assert.match(migration, /on conflict \(organization_id, client_id\) do nothing/);
});

test("pre-migration compatibility only falls back when the Calendar table is missing", () => {
  const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
  for (const file of ["db/supabase-crm.ts", "lib/google-calendar-store.ts", "lib/google-disconnect-store.ts"]) {
    const source = read(file);
    assert.match(source, /PGRST205/);
    assert.match(source, /42P01/);
    assert.match(source, /google_business_credentials/);
    assert.match(source, /google_calendar_credentials/);
  }
});
