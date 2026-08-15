import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMetaAcceptanceDetail,
  buildMetaErrorDetail,
  formatMetaErrorDetail,
  isSingleEventRecorded,
  readEventsReceived,
  redactDiagnosticText,
  safeErrorType,
  safeTraceId,
} from "../lib/meta-redaction.ts";

// These run the real redactor against hostile input rather than inspecting the
// source, so a rule that stops working fails the build instead of passing a
// pattern match.

// Values that must never survive redaction, in the shapes Meta actually
// returns them.
const SECRETS = {
  metaUserToken:
    "EAAGm0PX4ZCpsBAJZCZBv8ZCZBQZDZD9xKq7Vn2mZCLc0ZBxYt3ZBqRr8ZDZD",
  systemUserToken:
    "EAAQ7ZBhZCZBZAsBO1ZBZCZBZAZDZDxvZCZBZAZBZCZBZAZDZDZBZAZCZBZAZDZD1234567890abcdef",
  bearerHeader: "Bearer EAAGm0PX4ZCpsBAJZCZBv8ZCZBQZDZD9xKq7Vn2mZCLc0",
  appSecret: "client_secret=8f14e45fceea167a5a36dedd4bea2543",
  encryptionKey:
    "a3f1c9d47b8e20516d0f9c8ab7e3d215f4c6089a1b2e7d3f5a8c9012b4e6d7f8",
  hashedEmail:
    "5d41402abc4b2a76b9719d911017c592aaf4c61ddcc5e8a2dabede0f3b482cd9",
  customerEmail: "jane.doe@segoviapestmanagement.com",
  customerPhone: "15551234567",
  datasetId: "1466246268853513",
  callbackUrl:
    "https://graph.facebook.com/v26.0/1466246268853513/events?access_token=EAAGm0PX4ZCpsB",
};

function assertNothingLeaked(output, label) {
  for (const [name, secret] of Object.entries(SECRETS)) {
    assert.ok(
      !output.includes(secret),
      `${label} leaked ${name}: ${output}`,
    );
  }
}

test("no credential, contact detail or URL survives redaction", () => {
  for (const [name, secret] of Object.entries(SECRETS)) {
    const redacted = redactDiagnosticText(
      `Error validating access token: ${secret} was rejected.`,
    );
    assert.ok(
      !redacted.includes(secret),
      `${name} survived redaction: ${redacted}`,
    );
  }
});

test("a realistic Meta rejection is sanitized but still readable", () => {
  const raw =
    `Error validating access token: The session has been invalidated because ` +
    `the user ${SECRETS.customerEmail} changed their password. ` +
    `Token ${SECRETS.metaUserToken} for dataset ${SECRETS.datasetId}. ` +
    `See ${SECRETS.callbackUrl} for details.`;
  const redacted = redactDiagnosticText(raw);
  assertNothingLeaked(redacted, "redactDiagnosticText");
  // The actionable part of the message is preserved.
  assert.match(redacted, /Error validating access token/);
  assert.match(redacted, /changed their password/);
});

test("redaction is bounded and never returns empty", () => {
  assert.ok(redactDiagnosticText("x".repeat(50_000)).length <= 300);
  for (const empty of ["", "   ", null, undefined, 42, {}, []]) {
    assert.equal(redactDiagnosticText(empty), "(no message provided)");
  }
});

test("trace ids and error types accept only safe shapes", () => {
  assert.equal(safeTraceId("A1b2C3d4E5f"), "A1b2C3d4E5f");
  assert.equal(safeErrorType("OAuthException"), "OAuthException");
  // Anything that could smuggle a payload is dropped entirely.
  for (const hostile of [
    SECRETS.metaUserToken + SECRETS.appSecret,
    "trace with spaces",
    "<script>alert(1)</script>",
    "a".repeat(200),
    { toString: () => "object" },
    null,
    12345,
  ]) {
    assert.equal(safeTraceId(hostile), null, "traceId rejected");
    assert.equal(safeErrorType(hostile), null, "errorType rejected");
  }
});

test("only the six diagnostic fields are lifted out of a Meta body", () => {
  const detail = buildMetaErrorDetail(401, {
    error: {
      message: `Invalid OAuth access token ${SECRETS.systemUserToken}`,
      type: "OAuthException",
      code: 190,
      error_subcode: 463,
      fbtrace_id: "AbCdEf123456",
      // Fields Meta sometimes includes that must not be carried through.
      error_user_msg: `Contact ${SECRETS.customerEmail}`,
      error_data: { token: SECRETS.appSecret },
    },
    request_payload: SECRETS.callbackUrl,
  });

  assert.deepEqual(Object.keys(detail).sort(), [
    "code",
    "message",
    "status",
    "subcode",
    "traceId",
    "type",
  ]);
  assert.equal(detail.status, 401);
  assert.equal(detail.code, 190);
  assert.equal(detail.subcode, 463);
  assert.equal(detail.type, "OAuthException");
  assert.equal(detail.traceId, "AbCdEf123456");
  assertNothingLeaked(JSON.stringify(detail), "buildMetaErrorDetail");
});

test("a malformed or hostile body cannot produce a leaky detail", () => {
  for (const body of [
    null,
    undefined,
    "a string body",
    [SECRETS.appSecret],
    { error: SECRETS.metaUserToken },
    { error: { message: null, code: "190", fbtrace_id: SECRETS.appSecret } },
  ]) {
    const detail = buildMetaErrorDetail(500, body);
    assertNothingLeaked(JSON.stringify(detail), "malformed body");
    assert.equal(typeof detail.message, "string");
  }
  // A non-numeric code is discarded rather than coerced.
  assert.equal(
    buildMetaErrorDetail(500, { error: { code: "190" } }).code,
    null,
  );
});

test("the formatted admin message carries the fields and no secrets", () => {
  const detail = buildMetaErrorDetail(403, {
    error: {
      message: `Permission denied for ${SECRETS.customerEmail} using ${SECRETS.systemUserToken}`,
      type: "OAuthException",
      code: 200,
      error_subcode: 33,
      fbtrace_id: "Zz9Yy8Xx7",
    },
  });
  const formatted = formatMetaErrorDetail("Meta rejected that token.", detail);

  assertNothingLeaked(formatted, "formatMetaErrorDetail");
  assert.match(formatted, /HTTP 403/);
  assert.match(formatted, /code 200/);
  assert.match(formatted, /subcode 33/);
  assert.match(formatted, /type OAuthException/);
  assert.match(formatted, /trace Zz9Yy8Xx7/);
  assert.match(formatted, /Meta rejected that token\./);
});

test("the acceptance count is read only when it is a real number", () => {
  assert.equal(readEventsReceived({ events_received: 1 }), 1);
  assert.equal(readEventsReceived({ events_received: 0 }), 0);
  for (const body of [
    {},
    null,
    undefined,
    "string",
    [1],
    { events_received: "1" },
    { events_received: null },
    { events_received: NaN },
    { events_received: Infinity },
  ]) {
    assert.equal(
      readEventsReceived(body),
      null,
      `expected null for ${JSON.stringify(body)}`,
    );
  }
});

test("exactly one recorded event is the only success", () => {
  assert.equal(isSingleEventRecorded({ events_received: 1 }), true);
  // Zero, more than one, absent, or unparseable are all failures. A missing
  // count is not evidence of success.
  for (const body of [
    { events_received: 0 },
    { events_received: 2 },
    { events_received: "1" },
    { events_received: null },
    { events_received: NaN },
    {},
    null,
    undefined,
    "200 OK",
    [1],
  ]) {
    assert.equal(
      isSingleEventRecorded(body),
      false,
      `expected failure for ${JSON.stringify(body)}`,
    );
  }
});

test("a 2xx that recorded nothing is described without leaking anything", () => {
  const detail = buildMetaAcceptanceDetail(200, {
    events_received: 0,
    messages: [
      `Test event code expired for ${SECRETS.customerEmail}`,
      `token ${SECRETS.systemUserToken} stale`,
    ],
    fbtrace_id: "Qq1Ww2Ee3",
    // Fields that must not be carried through.
    id: SECRETS.datasetId,
    request: SECRETS.callbackUrl,
  });

  assert.deepEqual(Object.keys(detail).sort(), [
    "code",
    "message",
    "status",
    "subcode",
    "traceId",
    "type",
  ]);
  assert.equal(detail.status, 200);
  assert.equal(detail.traceId, "Qq1Ww2Ee3");
  assert.match(detail.message, /recorded 0 of 1 expected events/);
  assertNothingLeaked(JSON.stringify(detail), "buildMetaAcceptanceDetail");
});

test("a missing acceptance count is stated rather than guessed", () => {
  const detail = buildMetaAcceptanceDetail(200, { fbtrace_id: "Tt1Yy2" });
  assert.match(detail.message, /did not report how many events/);
  assert.equal(detail.traceId, "Tt1Yy2");
});

test("advisory messages are bounded and non-strings are dropped", () => {
  const detail = buildMetaAcceptanceDetail(200, {
    events_received: 0,
    messages: [
      "one",
      "two",
      "three",
      "four",
      { nested: SECRETS.appSecret },
      [SECRETS.customerPhone],
    ],
  });
  // Capped, so a flood of messages cannot pad the admin warning.
  assert.ok(detail.message.length <= 300);
  assert.doesNotMatch(detail.message, /four/);
  // A structured entry is never stringified into the message.
  assertNothingLeaked(JSON.stringify(detail), "message array");
  assert.doesNotMatch(detail.message, /nested|object Object/);
});

test("a hostile success body cannot produce a leaky acceptance detail", () => {
  for (const body of [
    null,
    "a string",
    [SECRETS.appSecret],
    { messages: SECRETS.metaUserToken },
    { events_received: 1, fbtrace_id: SECRETS.appSecret },
  ]) {
    const detail = buildMetaAcceptanceDetail(200, body);
    assertNothingLeaked(JSON.stringify(detail), "hostile success body");
    assert.equal(typeof detail.message, "string");
  }
});

test("absent fields are omitted rather than rendered as null", () => {
  const formatted = formatMetaErrorDetail(
    "Summary.",
    buildMetaErrorDetail(500, {}),
  );
  assert.match(formatted, /HTTP 500/);
  assert.doesNotMatch(formatted, /null|undefined|NaN/);
});
