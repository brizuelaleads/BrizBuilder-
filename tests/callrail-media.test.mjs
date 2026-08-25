import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CALLRAIL_MEDIA_REDIRECTS,
  allowedCallRailMediaUrl,
  callRailMediaRequestHeaders,
  decideCallRailMediaResponse,
  isAudioContentType,
  isCallRailApiHost,
  isCallRailMediaHost,
  readCallRailRecordingLocation,
} from "../lib/callrail-media.ts";

const API = "https://api.callrail.com/v3/a/ACC1/calls/CAL1/recording.json";
const S3 =
  "https://calltrk-production.s3.amazonaws.com/calls/recordings/000/700/x.mp3";
const KEY = "an-api-key-that-must-not-travel";

/**
 * Walks a whole recording fetch through the decisions, given a scripted set of
 * responses. Records the hosts contacted and every header sent, so a
 * credential going somewhere it should not is visible rather than implied.
 */
function fetchRecording(script, { range = null } = {}) {
  // Step one is the authenticated request, and the only one that carries the
  // key. Recorded here so the assertions below can count it.
  const contacted = [
    {
      url: API,
      headers: { Authorization: `Token token="${KEY}"` },
      authenticated: true,
    },
  ];
  let target = allowedCallRailMediaUrl(
    readCallRailRecordingLocation(script.metadata),
  );
  if (!target) return { outcome: "refused", reason: "bad_location", contacted };

  for (let hop = 0; hop <= MAX_CALLRAIL_MEDIA_REDIRECTS; hop += 1) {
    const headers = callRailMediaRequestHeaders({ range });
    contacted.push({ url: target, headers, authenticated: false });

    const response = script.responses[hop];
    if (!response) return { outcome: "exhausted", contacted };
    const decision = decideCallRailMediaResponse({
      status: response.status,
      contentType: response.contentType,
      location: response.location,
      currentUrl: target,
      hop,
    });
    if (decision.action === "follow") {
      target = decision.url;
      continue;
    }
    return {
      outcome: decision.action,
      reason: decision.action === "refuse" ? decision.reason : undefined,
      contacted,
      finalStatus: response.status,
    };
  }
  return { outcome: "refused", reason: "too_many_redirects", contacted };
}

/** The hops that actually fetched media, excluding the authenticated ask. */
const mediaHops = (walk) => walk.contacted.filter((hop) => !hop.authenticated);

// ------------------------------------------------- the JSON metadata step

test("only the url field is read out of CallRail's metadata", () => {
  assert.equal(
    readCallRailRecordingLocation({ url: S3, account_id: "ACC1", secret: "x" }),
    S3,
  );
  // A body that names nothing usable is no recording, not an error.
  for (const body of [
    {},
    null,
    undefined,
    [],
    "a string",
    42,
    { url: "" },
    { url: "   " },
    { url: null },
    { url: 12345 },
    { recording: S3 },
    { URL: S3 },
  ]) {
    assert.equal(
      readCallRailRecordingLocation(body),
      null,
      JSON.stringify(body),
    );
  }
});

test("the JSON metadata is never itself streamed as audio", () => {
  // This is the bug: a 200 carrying application/json was forwarded to an
  // audio element, which reported success and played nothing.
  const decision = decideCallRailMediaResponse({
    status: 200,
    contentType: "application/json; charset=utf-8",
    currentUrl: API,
    hop: 0,
  });
  assert.deepEqual(decision, { action: "refuse", reason: "not_audio" });

  // Nor any other non-audio type that happens to arrive with a 200.
  for (const type of [
    "text/html",
    "application/xml",
    "text/plain",
    "application/octet-stream",
    "video/mp4",
    "",
    null,
    undefined,
    "audio",
    "audio-mpeg",
    "xaudio/mpeg",
    "text/html; audio/mpeg",
  ]) {
    assert.deepEqual(
      decideCallRailMediaResponse({
        status: 200,
        contentType: type,
        currentUrl: S3,
        hop: 0,
      }),
      { action: "refuse", reason: "not_audio" },
      JSON.stringify(type),
    );
  }
});

test("real audio is streamed", () => {
  for (const type of [
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg; charset=binary",
    "  audio/mpeg  ",
    "AUDIO/MPEG",
  ]) {
    assert.deepEqual(
      decideCallRailMediaResponse({
        status: 200,
        contentType: type,
        currentUrl: S3,
        hop: 0,
      }),
      { action: "stream" },
      type,
    );
  }
  assert.equal(isAudioContentType("audio/mpeg"), true);
  assert.equal(isAudioContentType("application/json"), false);
});

// --------------------------------------------------------- range playback

test("a partial response is streamed, and the range travels with it", () => {
  assert.deepEqual(
    decideCallRailMediaResponse({
      status: 206,
      contentType: "audio/mpeg",
      currentUrl: S3,
      hop: 0,
    }),
    { action: "stream" },
  );

  const walk = fetchRecording(
    {
      metadata: { url: S3 },
      responses: [{ status: 206, contentType: "audio/mpeg" }],
    },
    { range: "bytes=1024-2047" },
  );
  assert.equal(walk.outcome, "stream");
  assert.equal(walk.finalStatus, 206);
  assert.equal(mediaHops(walk)[0].headers.Range, "bytes=1024-2047");
});

test("a range is forwarded across a redirect to the media host", () => {
  const walk = fetchRecording(
    {
      metadata: { url: "https://app.callrail.com/calls/CAL1/recording/redirect" },
      responses: [
        { status: 302, location: S3 },
        { status: 206, contentType: "audio/mpeg" },
      ],
    },
    { range: "bytes=0-1023" },
  );
  assert.equal(walk.outcome, "stream");
  const hops = mediaHops(walk);
  assert.equal(hops.length, 2);
  for (const hop of hops) {
    assert.equal(hop.headers.Range, "bytes=0-1023", "every media hop carries it");
  }
});

test("no range header is invented when the browser did not send one", () => {
  const headers = callRailMediaRequestHeaders({ range: null });
  assert.equal("Range" in headers, false);
  for (const empty of ["", "   ", undefined]) {
    assert.equal(
      "Range" in callRailMediaRequestHeaders({ range: empty }),
      false,
      JSON.stringify(empty),
    );
  }
});

// ------------------------------------------------- hosts and redirects

test("only CallRail's own hosts and its recording bucket are fetched", () => {
  for (const good of [
    S3,
    "https://api.callrail.com/v3/a/ACC1/calls/CAL1/recording.json",
    "https://app.callrail.com/calls/x/recording/redirect?access_key=abc",
    "https://calltrk-production.s3.us-east-1.amazonaws.com/x.mp3",
  ]) {
    assert.ok(allowedCallRailMediaUrl(good), good);
  }

  for (const hostile of [
    // Somewhere else entirely.
    "https://evil.example.com/x.mp3",
    // Another bucket on the same provider.
    "https://not-calltrk.s3.amazonaws.com/x.mp3",
    "https://evil.s3.amazonaws.com/x.mp3",
    // A lookalike that merely ends with the right words.
    "https://callrail.com.evil.example.com/x.mp3",
    "https://notcallrail.com/x.mp3",
    "https://s3.amazonaws.com/calltrk-production/x.mp3",
    // Downgraded, or not a web URL at all.
    "http://api.callrail.com/x.mp3",
    "file:///etc/passwd",
    "ftp://api.callrail.com/x.mp3",
    // Loopback and link-local, the usual SSRF targets.
    "https://127.0.0.1/x.mp3",
    "https://localhost/x.mp3",
    "https://169.254.169.254/latest/meta-data/",
    "",
    "   ",
    null,
    undefined,
    12345,
  ]) {
    assert.equal(
      allowedCallRailMediaUrl(hostile),
      null,
      JSON.stringify(hostile),
    );
  }
});

test("a redirect somewhere hostile is refused, not followed", () => {
  const walk = fetchRecording({
    metadata: { url: S3 },
    responses: [
      { status: 302, location: "https://evil.example.com/steal" },
      { status: 200, contentType: "audio/mpeg" },
    ],
  });
  assert.equal(walk.outcome, "refuse");
  assert.equal(walk.reason, "hostile_redirect");
  assert.equal(
    mediaHops(walk).length,
    1,
    "the hostile host is never contacted",
  );
  assert.equal(
    walk.contacted.some((hop) => hop.url.includes("evil.example.com")),
    false,
  );
});

test("a relative redirect is judged against the same rules", () => {
  const ok = decideCallRailMediaResponse({
    status: 302,
    location: "/calls/CAL1/audio.mp3",
    currentUrl: "https://app.callrail.com/calls/CAL1/recording",
    hop: 0,
  });
  assert.equal(ok.action, "follow");
  assert.equal(ok.url, "https://app.callrail.com/calls/CAL1/audio.mp3");

  // A protocol-relative location can leave the host entirely.
  assert.deepEqual(
    decideCallRailMediaResponse({
      status: 302,
      location: "//evil.example.com/x.mp3",
      currentUrl: "https://app.callrail.com/calls/CAL1/recording",
      hop: 0,
    }),
    { action: "refuse", reason: "hostile_redirect" },
  );
  // A redirect with no location goes nowhere.
  assert.deepEqual(
    decideCallRailMediaResponse({
      status: 302,
      location: null,
      currentUrl: API,
      hop: 0,
    }),
    { action: "refuse", reason: "hostile_redirect" },
  );
});

test("a redirect loop ends rather than running forever", () => {
  const walk = fetchRecording({
    metadata: { url: S3 },
    responses: Array.from({ length: 12 }, () => ({ status: 302, location: S3 })),
  });
  assert.equal(walk.outcome, "refuse");
  assert.equal(walk.reason, "too_many_redirects");
  assert.ok(
    mediaHops(walk).length <= MAX_CALLRAIL_MEDIA_REDIRECTS + 1,
    `stopped after ${mediaHops(walk).length} media hops`,
  );
});

// ------------------------------------------------------ credential safety

test("a media fetch carries no credential, to any host at all", () => {
  // The key belongs to exactly one request: the authenticated call to
  // api.callrail.com that asks where the recording is. A media URL is
  // expected to carry its own signed access, so nothing on a media hop
  // attaches ours — not to the S3 bucket, and not to a callrail.com host
  // either. A location handed back by a provider, or a redirect chain, is
  // somebody else choosing where our credential would go.
  for (const hostname of [
    "api.callrail.com",
    "app.callrail.com",
    "callrail.com",
    "media.callrail.com",
    "calltrk-production.s3.amazonaws.com",
    "calltrk-production.s3.us-east-1.amazonaws.com",
    "evil.example.com",
  ]) {
    const headers = callRailMediaRequestHeaders({ range: "bytes=0-1" });
    assert.equal("Authorization" in headers, false, hostname);
    assert.equal("Request-From" in headers, false, hostname);
    assert.deepEqual(Object.keys(headers), ["Range"], hostname);
  }

  // And the helper cannot leak a key because it is never given one: passing
  // the shape the old signature took adds nothing to the result.
  const stray = callRailMediaRequestHeaders({
    range: "bytes=0-1",
    apiKey: KEY,
    hostname: "api.callrail.com",
    requestFrom: "BrizBuilder",
  });
  assert.deepEqual(Object.keys(stray), ["Range"]);
  assert.equal(JSON.stringify(stray).includes(KEY), false);
});

test("metadata pointing at another CallRail host is fetched without the key", () => {
  // The documented flow returns an S3 URL, but a location on app.callrail.com
  // is equally plausible and must be treated no differently.
  const walk = fetchRecording({
    metadata: { url: "https://app.callrail.com/calls/CAL1/recording.mp3" },
    responses: [{ status: 200, contentType: "audio/mpeg" }],
  });
  assert.equal(walk.outcome, "stream");

  const mediaHops = walk.contacted.filter((hop) => !hop.authenticated);
  assert.equal(mediaHops.length, 1);
  assert.match(mediaHops[0].url, /^https:\/\/app\.callrail\.com\//);
  assert.equal(
    JSON.stringify(mediaHops[0].headers).includes(KEY),
    false,
    "a CallRail media host gets no more credential than S3 does",
  );
  assert.equal("Authorization" in mediaHops[0].headers, false);
});

test("a redirect to another CallRail host is fetched without the key", () => {
  const walk = fetchRecording({
    metadata: { url: "https://api.callrail.com/v3/calls/CAL1/recording/redirect" },
    responses: [
      { status: 302, location: "https://app.callrail.com/media/CAL1.mp3" },
      { status: 200, contentType: "audio/mpeg" },
    ],
  });
  assert.equal(walk.outcome, "stream");

  const mediaHops = walk.contacted.filter((hop) => !hop.authenticated);
  assert.equal(mediaHops.length, 2, "both media hops are recorded");
  for (const hop of mediaHops) {
    assert.equal(
      JSON.stringify(hop.headers).includes(KEY),
      false,
      `${hop.url} must not receive the key`,
    );
    assert.equal("Authorization" in hop.headers, false, hop.url);
  }
  // Even the first media hop, which is on api.callrail.com itself, is
  // unauthenticated: it is a media fetch, not the authenticated request.
  assert.match(mediaHops[0].url, /^https:\/\/api\.callrail\.com\//);
});

test("a whole successful fetch sends the key exactly once", () => {
  const walk = fetchRecording({
    metadata: { url: "https://app.callrail.com/calls/CAL1/recording/redirect" },
    responses: [
      { status: 302, location: S3 },
      { status: 200, contentType: "audio/mpeg" },
    ],
  });
  assert.equal(walk.outcome, "stream");
  const carrying = walk.contacted.filter((hop) =>
    JSON.stringify(hop.headers).includes(KEY),
  );
  assert.equal(carrying.length, 1, "one request carries the credential");
  assert.equal(carrying[0].authenticated, true);
  assert.match(carrying[0].url, /^https:\/\/api\.callrail\.com\//);
  // Three hosts were contacted; only the first was authenticated.
  assert.equal(walk.contacted.length, 3);
  for (const hop of walk.contacted.slice(1)) {
    assert.equal(JSON.stringify(hop.headers).includes(KEY), false, hop.url);
  }
});


// -------------------------------------------------------- other outcomes

test("a call with no recording is absent, not an error", () => {
  assert.deepEqual(
    decideCallRailMediaResponse({ status: 404, currentUrl: S3, hop: 0 }),
    { action: "absent" },
  );
  // And metadata naming nowhere is the same answer.
  const walk = fetchRecording({ metadata: {}, responses: [] });
  assert.equal(walk.outcome, "refused");
  assert.equal(walk.reason, "bad_location");
});

test("a provider error is refused rather than passed off as audio", () => {
  for (const status of [400, 401, 403, 429, 500, 502, 503]) {
    assert.deepEqual(
      decideCallRailMediaResponse({
        status,
        contentType: "audio/mpeg",
        currentUrl: S3,
        hop: 0,
      }),
      { action: "refuse", reason: "provider_error" },
      String(status),
    );
  }
});

test("host predicates do not accept anything that is not a string", () => {
  for (const value of [null, undefined, 12345, {}, [], true]) {
    assert.equal(isCallRailApiHost(value), false, JSON.stringify(value));
    assert.equal(isCallRailMediaHost(value), false, JSON.stringify(value));
  }
});
