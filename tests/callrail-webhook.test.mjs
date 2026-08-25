import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CALLRAIL_SIGNATURE_HEADER,
  CALLRAIL_WEBHOOK_BASE_PATH,
  appendCallRailWebhookUrls,
  assertCallRailWebhookConfigUrls,
  isCallRailWebhookUrl,
  buildCallRailWebhookUrls,
  CALLRAIL_WEBHOOK_KINDS,
  callRailSignature,
  createCallRailWebhookPathId,
  isCallRailSigningKey,
  isCallRailWebhookPathId,
  isCallRailWebhookKind,
  readCallRailWebhookRoute,
  readCallRailWebhook,
  removeCallRailWebhookUrls,
  verifyCallRailSignature,
} from "../lib/callrail-webhook.ts";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

// CallRail publishes this vector in its Webhooks Security documentation: this
// exact body, signed with this exact key, produces this exact signature. The
// fixture is stored byte-for-byte, because the signature covers the bytes as
// sent and any reserialization would change it.
const VECTOR_KEY = "072e77e426f92738a72fe23c4d1953b4";
const VECTOR_SIGNATURE = "UZAHbUdfm3GqL7qzilGozGzWV64=";
const VECTOR_BODY = fs.readFileSync(
  path.join(root, "tests/fixtures/callrail-webhook-vector.json"),
  "utf8",
);

test("CallRail's own published vector verifies", async () => {
  assert.equal(
    await callRailSignature(VECTOR_KEY, VECTOR_BODY),
    VECTOR_SIGNATURE,
    "the documented signature is reproduced exactly",
  );
  assert.equal(
    await verifyCallRailSignature(VECTOR_KEY, VECTOR_BODY, VECTOR_SIGNATURE),
    true,
  );
});

test("the same signature verifies against the exact request bytes", async () => {
  const bytes = new TextEncoder().encode(VECTOR_BODY);
  assert.equal(await callRailSignature(VECTOR_KEY, bytes), VECTOR_SIGNATURE);
  assert.equal(
    await verifyCallRailSignature(VECTOR_KEY, bytes, VECTOR_SIGNATURE),
    true,
  );
});

test("the vector matches an independent HMAC-SHA1 implementation", async () => {
  // node:crypto rather than WebCrypto, so agreement is not two runs of the
  // same code.
  const independent = createHmac("sha1", VECTOR_KEY)
    .update(VECTOR_BODY, "utf8")
    .digest("base64");
  assert.equal(independent, VECTOR_SIGNATURE);
  assert.equal(await callRailSignature(VECTOR_KEY, VECTOR_BODY), independent);
});

test("the header CallRail sends is the one that is read", () => {
  assert.equal(CALLRAIL_SIGNATURE_HEADER, "Signature");
});

test("a body altered by one byte no longer verifies", async () => {
  // The signature covers what was sent. Parsing and re-serializing the JSON
  // would change whitespace and key order and break this, which is why the raw
  // text is verified before anything looks inside it.
  const tampered = VECTOR_BODY.replace('"answered":false', '"answered":true');
  assert.notEqual(tampered, VECTOR_BODY);
  assert.equal(
    await verifyCallRailSignature(VECTOR_KEY, tampered, VECTOR_SIGNATURE),
    false,
  );

  // A reformatting that preserves meaning fails too, as it must. CallRail's
  // fixture happens to already be in canonical compact form, so the point is
  // shown with whitespace rather than with a round trip that changes nothing.
  const pretty = JSON.stringify(JSON.parse(VECTOR_BODY), null, 2);
  assert.notEqual(pretty, VECTOR_BODY, "the bytes really did change");
  assert.equal(
    await verifyCallRailSignature(VECTOR_KEY, pretty, VECTOR_SIGNATURE),
    false,
    "the digest is over the bytes as sent, not over the meaning",
  );
});

test("a different signing key does not verify", async () => {
  const other = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(
    await verifyCallRailSignature(other, VECTOR_BODY, VECTOR_SIGNATURE),
    false,
  );
});

test("a tampered signature is refused however it is malformed", async () => {
  const cases = {
    "flipped first character":
      (VECTOR_SIGNATURE[0] === "A" ? "B" : "A") + VECTOR_SIGNATURE.slice(1),
    truncated: VECTOR_SIGNATURE.slice(0, -4),
    extended: VECTOR_SIGNATURE.slice(0, -1) + "AAAA=",
    empty: "",
    whitespace: "   ",
    "not base64": "!!!!not-a-signature!!!!",
    // A valid base64 string of the wrong length cannot be an HMAC-SHA1 digest.
    "wrong digest length": "AAAA",
    "sha256 length": Buffer.alloc(32).toString("base64"),
  };
  for (const [name, signature] of Object.entries(cases)) {
    assert.equal(
      await verifyCallRailSignature(VECTOR_KEY, VECTOR_BODY, signature),
      false,
      name,
    );
  }
});

test("verification never throws, whatever it is handed", async () => {
  for (const value of [null, undefined, 0, {}, [], true]) {
    assert.equal(
      await verifyCallRailSignature(VECTOR_KEY, VECTOR_BODY, value),
      false,
      `signature ${String(value)}`,
    );
    assert.equal(
      await verifyCallRailSignature(VECTOR_KEY, value, VECTOR_SIGNATURE),
      false,
      `body ${String(value)}`,
    );
    assert.equal(
      await verifyCallRailSignature(value, VECTOR_BODY, VECTOR_SIGNATURE),
      false,
      `key ${String(value)}`,
    );
  }
});

test("an unusable signing key is refused before it can be used", () => {
  assert.equal(isCallRailSigningKey(VECTOR_KEY), true);
  assert.equal(isCallRailSigningKey(VECTOR_KEY.toUpperCase()), true);
  for (const bad of [
    "",
    "   ",
    "072e77e426f92738a72fe23c4d1953b",
    "072e77e426f92738a72fe23c4d1953b44",
    "072e77e426f92738a72fe23c4d1953bZ",
    null,
    undefined,
    123,
  ]) {
    assert.equal(isCallRailSigningKey(bad), false, String(bad));
  }
});

test("an empty key cannot be used to sign anything", async () => {
  // A missing key must not degrade into signing with the empty string, which
  // would produce a digest that a caller could compute for themselves.
  assert.equal(await verifyCallRailSignature("", VECTOR_BODY, VECTOR_SIGNATURE), false);
});

// ------------------------------------------------------------- the envelope

test("only the two initially configured CallRail webhook kinds are accepted", () => {
  assert.deepEqual(
    [...CALLRAIL_WEBHOOK_KINDS],
    ["post_call", "call_modified"],
  );
  for (const kind of CALLRAIL_WEBHOOK_KINDS) {
    assert.equal(isCallRailWebhookKind(kind), true, kind);
  }
  for (const bad of ["", "pre_call", "PRE_CALL", "form_submission", "sms", null, undefined, 1]) {
    assert.equal(isCallRailWebhookKind(bad), false, String(bad));
  }
});

test("the envelope carries only what decides which call to refetch", () => {
  const envelope = readCallRailWebhook("post_call", JSON.parse(VECTOR_BODY));
  assert.ok(envelope);
  // The vector's ids are numeric in JSON; both forms have to be readable.
  assert.equal(envelope.callId, "766970532");
  assert.equal(envelope.companyId, "155920786");
  assert.equal(envelope.kind, "post_call");
  // The body is a notification, not a source of truth: nothing else is taken.
  assert.deepEqual(Object.keys(envelope).sort(), [
    "callId",
    "companyId",
    "kind",
    "resourceId",
  ]);
});

test("string identifiers are read as readily as numeric ones", () => {
  const envelope = readCallRailWebhook("post_call", {
    id: "CAL8154748ae6bd4e278a7cddd38a662f4f",
    company_id: "COM8154748ae6bd4e278a7cddd38a662f4f",
    resource_id: "RES123",
  });
  assert.equal(envelope.callId, "CAL8154748ae6bd4e278a7cddd38a662f4f");
  assert.equal(envelope.companyId, "COM8154748ae6bd4e278a7cddd38a662f4f");
  assert.equal(envelope.resourceId, "RES123");
});

test("a payload without the identifiers is rejected, not half-processed", () => {
  for (const body of [
    {},
    { id: "" },
    { company_id: "COM123" },
    { id: "CAL123" },
    { id: null, company_id: null },
    null,
    "a string",
    [],
    42,
  ]) {
    assert.equal(readCallRailWebhook("post_call", body), null, JSON.stringify(body));
  }
  // And an unrecognized kind is refused whatever the body says.
  assert.equal(
    readCallRailWebhook("form_submission", JSON.parse(VECTOR_BODY)),
    null,
  );
});

// --------------------------------------------------------------- URL config

test("webhook path ids are crypto-random URL-safe tenant resolvers", () => {
  const pathId = createCallRailWebhookPathId();
  assert.equal(isCallRailWebhookPathId(pathId), true);
  assert.equal(pathId.includes("/"), false);
  assert.equal(pathId.includes("+"), false);
  assert.notEqual(createCallRailWebhookPathId(), pathId);
});

test("the webhook URLs live under the public CallRail ingress path", () => {
  const urls = buildCallRailWebhookUrls(
    "https://brizbuilder-leads.brizuelaleads.workers.dev/",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.equal(CALLRAIL_WEBHOOK_BASE_PATH, "/api/callrail/webhook");
  assert.equal(
    urls.post_call.url,
    "https://brizbuilder-leads.brizuelaleads.workers.dev/api/callrail/webhook/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/post-call",
  );
  assert.equal(
    urls.call_modified.url,
    "https://brizbuilder-leads.brizuelaleads.workers.dev/api/callrail/webhook/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/updated-call",
  );
  assert.equal(urls.post_call.configKey, "post_call_webhook");
  assert.equal(urls.call_modified.configKey, "updated_call_webhook");
});

test("the route resolves only the path id and event segment", () => {
  const route = readCallRailWebhookRoute(
    "https://brizbuilder-leads.brizuelaleads.workers.dev/api/callrail/webhook/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/post-call?organization_id=evil&client_id=evil",
  );
  assert.deepEqual(route, {
    pathId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    kind: "post_call",
  });
  assert.equal(
    readCallRailWebhookRoute(
      "https://brizbuilder-leads.brizuelaleads.workers.dev/api/callrail/webhook/tenant/post-call",
    ),
    null,
  );
  assert.equal(
    readCallRailWebhookRoute(
      "https://brizbuilder-leads.brizuelaleads.workers.dev/api/callrail/webhook/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/pre-call",
    ),
    null,
  );
});

test("enabling ingestion appends BrizBuilder URLs without replacing anything", () => {
  const urls = buildCallRailWebhookUrls(
    "https://brizbuilder-leads.brizuelaleads.workers.dev",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  const existing = {
    pre_call_webhook: ["https://zapier.example/pre"],
    post_call_webhook: ["https://zapier.example/post"],
    updated_call_webhook: ["https://analytics.example/updated"],
    sms_received_webhook: ["https://sms.example/in"],
  };
  const merged = appendCallRailWebhookUrls(existing, urls);
  assert.deepEqual(merged.pre_call_webhook, existing.pre_call_webhook);
  assert.deepEqual(merged.sms_received_webhook, existing.sms_received_webhook);
  assert.deepEqual(merged.post_call_webhook, [
    "https://zapier.example/post",
    urls.post_call.url,
  ]);
  assert.deepEqual(merged.updated_call_webhook, [
    "https://analytics.example/updated",
    urls.call_modified.url,
  ]);
  assert.deepEqual(
    appendCallRailWebhookUrls(merged, urls).post_call_webhook,
    merged.post_call_webhook,
    "a second enable does not duplicate the URL",
  );
});

test("disconnect removes only BrizBuilder URLs", () => {
  const urls = buildCallRailWebhookUrls(
    "https://brizbuilder-leads.brizuelaleads.workers.dev",
    "cccccccccccccccccccccccccccccccc",
  );
  const cleaned = removeCallRailWebhookUrls(
    {
      post_call_webhook: [
        "https://zapier.example/post",
        urls.post_call.url,
        "https://analytics.example/post",
      ],
      updated_call_webhook: [urls.call_modified.url, "https://crm.example/update"],
      answered_call_webhook: ["https://someone.example/routing"],
    },
    urls,
  );
  assert.deepEqual(cleaned.post_call_webhook, [
    "https://zapier.example/post",
    "https://analytics.example/post",
  ]);
  assert.deepEqual(cleaned.updated_call_webhook, ["https://crm.example/update"]);
  assert.deepEqual(cleaned.answered_call_webhook, [
    "https://someone.example/routing",
  ]);
});

// ------------------------------------------- other people's configuration

const BASE = "https://leads.example.com";
const PATH_ID = "a".repeat(43);
const URLS = buildCallRailWebhookUrls(BASE, PATH_ID);

test("a webhook URL must be an HTTPS address", () => {
  assert.equal(isCallRailWebhookUrl("https://example.com/hook"), true);
  for (const bad of [
    "http://example.com/hook",
    "ftp://example.com/hook",
    "javascript:alert(1)",
    "not a url",
    "",
    "   ",
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(isCallRailWebhookUrl(bad), false, String(bad));
  }
});

test("appending preserves every existing URL and every other config key", () => {
  const existing = {
    post_call_webhook: ["https://zapier.example.com/post"],
    updated_call_webhook: ["https://crm.example.com/updated"],
    pre_call_webhook: ["https://someone-else.example.com/pre"],
    form_submission_webhook: ["https://forms.example.com/hook"],
    some_other_setting: { nested: true },
  };
  const next = appendCallRailWebhookUrls(existing, URLS);

  // Ours are added.
  assert.ok(next.post_call_webhook.includes(URLS.post_call.url));
  assert.ok(next.updated_call_webhook.includes(URLS.call_modified.url));
  // Theirs survive, in place.
  assert.ok(next.post_call_webhook.includes("https://zapier.example.com/post"));
  assert.ok(next.updated_call_webhook.includes("https://crm.example.com/updated"));
  // Keys this integration does not own are untouched, including non-webhook
  // settings.
  assert.deepEqual(next.pre_call_webhook, ["https://someone-else.example.com/pre"]);
  assert.deepEqual(next.form_submission_webhook, ["https://forms.example.com/hook"]);
  assert.deepEqual(next.some_other_setting, { nested: true });
  // The original object is not mutated.
  assert.deepEqual(existing.post_call_webhook, ["https://zapier.example.com/post"]);
});

test("appending twice adds nothing the second time", () => {
  const once = appendCallRailWebhookUrls({}, URLS);
  const twice = appendCallRailWebhookUrls(once, URLS);
  assert.deepEqual(twice, once, "enabling repeatedly is idempotent");
  assert.equal(twice.post_call_webhook.length, 1);
  assert.equal(twice.updated_call_webhook.length, 1);
});

test("a configuration containing an address we cannot verify is refused", () => {
  // Refused, not repaired: dropping the entry would silently edit configuration
  // this integration does not own, and writing it back would propagate it.
  for (const hostile of [
    { post_call_webhook: ["http://insecure.example.com/hook"] },
    { updated_call_webhook: ["javascript:alert(1)"] },
    { post_call_webhook: ["not a url"] },
    { post_call_webhook: "https://example.com/not-an-array" },
    { updated_call_webhook: [""] },
  ]) {
    assert.throws(
      () => appendCallRailWebhookUrls(hostile, URLS),
      /CallRail/,
      JSON.stringify(hostile),
    );
    assert.throws(() => assertCallRailWebhookConfigUrls(hostile));
  }
});

test("an absent key is not an invalid one", () => {
  assert.doesNotThrow(() => assertCallRailWebhookConfigUrls({}));
  assert.doesNotThrow(() =>
    assertCallRailWebhookConfigUrls({ post_call_webhook: null }),
  );
  assert.doesNotThrow(() => assertCallRailWebhookConfigUrls({ post_call_webhook: [] }));
});

test("removing takes back only our own URLs", () => {
  const config = appendCallRailWebhookUrls(
    {
      post_call_webhook: ["https://zapier.example.com/post"],
      updated_call_webhook: ["https://crm.example.com/updated"],
      pre_call_webhook: ["https://someone-else.example.com/pre"],
    },
    URLS,
  );
  const after = removeCallRailWebhookUrls(config, URLS);
  assert.deepEqual(after.post_call_webhook, ["https://zapier.example.com/post"]);
  assert.deepEqual(after.updated_call_webhook, ["https://crm.example.com/updated"]);
  assert.deepEqual(after.pre_call_webhook, ["https://someone-else.example.com/pre"]);
  assert.equal(
    JSON.stringify(after).includes(PATH_ID),
    false,
    "nothing of ours is left behind",
  );
});

test("removing a URL that was never there changes nothing", () => {
  const theirs = {
    post_call_webhook: ["https://zapier.example.com/post"],
    updated_call_webhook: ["https://crm.example.com/updated"],
  };
  const after = removeCallRailWebhookUrls(theirs, URLS);
  assert.deepEqual(after, theirs);
});

test("our URLs carry the per-connection path id, not a tenant id", () => {
  for (const { url } of Object.values(URLS)) {
    assert.ok(url.startsWith(`${BASE}/api/callrail/webhook/${PATH_ID}/`));
    assert.equal(isCallRailWebhookUrl(url), true);
  }
  assert.notEqual(URLS.post_call.url, URLS.call_modified.url);
  assert.equal(URLS.post_call.configKey, "post_call_webhook");
  assert.equal(URLS.call_modified.configKey, "updated_call_webhook");
});
