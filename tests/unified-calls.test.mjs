import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { callNeedsFollowUp } from "../lib/call-attention.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260904000000_unified_calls.sql");
const app = read("app/CrmApp.tsx");
const resolver = read("lib/outbound-calls.ts");
const adapters = read("lib/call-provider-adapters.ts");
const leads = read("app/crm/LeadsViews.tsx");
const calls = read("app/crm/CallsView.tsx");
const twilioHooks = read("lib/twilio-webhooks.ts");

function call(overrides = {}) {
  return {
    id: "call-1",
    clientId: "client-a",
    contactId: "contact-a",
    leadId: "lead-a",
    provider: "callrail",
    providerConnectionId: "connection-a",
    providerCallId: "provider-call-1",
    businessPhoneNumberId: "number-a",
    status: "no-answer",
    callrailCallId: "provider-call-1",
    direction: "inbound",
    answered: false,
    durationSeconds: 0,
    startedAt: "2026-09-01T12:00:00.000Z",
    endedAt: "2026-09-01T12:00:05.000Z",
    trackingPhoneNumber: "+19035559001",
    businessPhoneNumber: "+19035559001",
    customerPhone: "+19035551111",
    customerName: "Customer",
    source: null,
    sourceName: null,
    medium: null,
    campaign: null,
    classification: null,
    callSummary: null,
    transcript: null,
    recordingAvailable: false,
    recordingDurationSeconds: null,
    ingestStatus: null,
    transcriptStatus: "pending",
    appointmentStatus: null,
    handledAt: null,
    handledByCallId: null,
    ...overrides,
  };
}

test("primary CRM navigation is the requested seven tabs in order", () => {
  const nav = app.slice(app.indexOf("const nav:"), app.indexOf("const viewChangeEvent"));
  const labels = [...nav.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, [
    "Dashboard",
    "Leads",
    "Pipeline",
    "Calls",
    "Calendar",
    "Ads",
    "Connections",
  ]);
});

test("provider calls project into one tenant-keyed call ledger", () => {
  assert.match(migration, /create table if not exists public\.phone_numbers/);
  assert.match(migration, /unique \(organization_id, client_id, provider, normalized_phone_number\)/);
  assert.match(migration, /phone_calls_tenant_provider_call_uidx/);
  assert.match(migration, /sync_callrail_call_to_phone_calls/);
  assert.match(migration, /find_or_create_phone_contact/);
  assert.match(migration, /find_or_create_phone_lead/);
});

test("a retried Twilio event reuses the call's existing lead", () => {
  const helper = twilioHooks.slice(
    twilioHooks.indexOf("async function contactAndLeadForCall"),
    twilioHooks.indexOf("async function conversationFor"),
  );
  assert.match(helper, /\.eq\("organization_id", String\(config\.organization_id\)\)/);
  assert.match(helper, /\.eq\("client_id", String\(config\.client_id\)\)/);
  assert.match(helper, /\.eq\("provider_call_sid", callSid\)/);
  assert.match(helper, /existing\.data\?\.contact_id && existing\.data\.lead_id/);
  assert.match(helper, /leadId: String\(existing\.data\.lead_id\)/);
});

test("callback resolver takes a call id and scopes every route to its tenant", () => {
  assert.match(resolver, /callId: string/);
  assert.doesNotMatch(resolver, /input\.provider/);
  assert.doesNotMatch(resolver, /input\.fromNumber/);
  assert.match(resolver, /\.eq\("organization_id", input\.organizationId\)/);
  assert.match(resolver, /allowedClientIds\.includes\(clientId\)/);
  assert.match(resolver, /recentInbound[\s\S]*last_inbound_phone_number_id[\s\S]*campaignNumber[\s\S]*is_default/);
});

test("providers implement one outbound adapter contract", () => {
  assert.match(adapters, /export type CallProviderAdapter/);
  assert.match(adapters, /const callRailAdapter: CallProviderAdapter/);
  assert.match(adapters, /const twilioAdapter: CallProviderAdapter/);
  assert.match(resolver, /callProviderAdapter\(provider\)\.placeOutbound/);
  assert.doesNotMatch(resolver, /if \(provider ===/);
});

test("Leads and Calls render the same transcript component", () => {
  assert.match(leads, /<CallTranscriptCard/);
  assert.match(calls, /<CallTranscriptCard/);
});

test("missed calls stop needing attention after a successful later call", () => {
  const missed = call();
  assert.equal(callNeedsFollowUp(missed, [missed]), true);
  assert.equal(
    callNeedsFollowUp(missed, [
      missed,
      call({
        id: "call-2",
        direction: "outbound",
        answered: true,
        status: "completed",
        startedAt: "2026-09-01T13:00:00.000Z",
      }),
    ]),
    false,
  );
  assert.equal(callNeedsFollowUp(call({ handledAt: "2026-09-01T13:00:00.000Z" }), []), false);
});

test("the Calls browser action never submits provider or business number", () => {
  assert.match(calls, /action: "place_outbound_call", callId: call\.id/);
  assert.doesNotMatch(calls, /action: "place_outbound_call"[\s\S]{0,100}(provider|fromNumber)/);
});
