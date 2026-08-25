import assert from "node:assert/strict";
import test from "node:test";

import {
  DNI_AUTH_FIELDS,
  DNI_COOKIE_NAME,
  DNI_EXCHANGE_PARAM,
  DNI_EXCHANGE_TTL_MS,
  DNI_NO_STORE_HEADERS,
  DNI_REPORTED_PARAMS,
  DNI_SESSION_TTL_MS,
  assertNoAuthFieldsReported,
  buildDniCookie,
  buildDniSnippet,
  cleanDniRedirect,
  clearDniCookie,
  deriveDniSigningKey,
  encodeDniClaim,
  isCallRailScriptUrl,
  isDniClaimExpired,
  normalizeCallRailScriptUrl,
  parseDniClaim,
  readDniCookie,
  signDniClaim,
  verifyDniClaim,
} from "../lib/callrail-dni.ts";

// CallRail's own documented form for a company's swap script.
const OFFICIAL = "//cdn.callrail.com/companies/123456789/abcdef0123456789/12/swap.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT_A = "00000000-0000-4000-8000-00000000b101";
const CLIENT_B = "fd026525-d33f-4884-a805-e1d5b681fbe4";
const OTHER_ORG = "11111111-1111-4111-8111-111111111111";

const KEY_BYTES = new Uint8Array(32).fill(7);
const OTHER_KEY_BYTES = new Uint8Array(32).fill(9);
const key = await deriveDniSigningKey(KEY_BYTES);
const otherKey = await deriveDniSigningKey(OTHER_KEY_BYTES);

const claimFor = (organizationId, clientId, ttl = DNI_SESSION_TTL_MS, now = Date.now()) => ({
  organizationId,
  clientId,
  expiresAt: now + ttl,
});

// ---------------------------------------------------------------- script url

test("CallRail's own script URL form is accepted", () => {
  assert.equal(isCallRailScriptUrl(OFFICIAL), true);
  assert.equal(isCallRailScriptUrl(`https:${OFFICIAL}`), true);
  assert.equal(normalizeCallRailScriptUrl(OFFICIAL), `https:${OFFICIAL}`);
});

test("a script URL that is not CallRail's is refused", () => {
  for (const value of [
    "//evil.example.com/swap.js",
    "https://evil.example.com/swap.js",
    // Suffix confusion: the real host must be the whole host, not the tail.
    "https://cdn.callrail.com.evil.example.com/swap.js",
    "https://a.cdn.callrail.com/x.js",
    "http://cdn.callrail.com/companies/1/a/12/swap.js",
    "javascript:alert(1)",
    "data:text/javascript,alert(1)",
    "",
    "   ",
    null,
    undefined,
    42,
  ]) {
    assert.equal(isCallRailScriptUrl(value), false, String(value));
  }
});

test("the snippet is the plain documented tag and nothing more", () => {
  const snippet = buildDniSnippet(OFFICIAL);
  assert.equal(
    snippet,
    `<script type="text/javascript" src="https:${OFFICIAL}"></script>`,
  );
  assert.equal(snippet.includes("brizbuilder"), false);
});

test("the snippet builder refuses anything it would not load", () => {
  assert.throws(
    () => buildDniSnippet("https://evil.example.com/swap.js"),
    /CallRail tracking script/,
  );
});

// ------------------------------------------------------------ cache headers

test("every DNI response is uncacheable, everywhere", () => {
  assert.equal(
    DNI_NO_STORE_HEADERS["Cache-Control"],
    "private, no-store, no-cache, max-age=0, must-revalidate",
  );
  assert.equal(DNI_NO_STORE_HEADERS["Pragma"], "no-cache");
  assert.equal(
    DNI_NO_STORE_HEADERS["X-Robots-Tag"],
    "noindex, nofollow, noarchive, nosnippet",
  );
  assert.equal(DNI_NO_STORE_HEADERS["Referrer-Policy"], "no-referrer");
});

test("the caching directives cover shared caches and revalidation", () => {
  const control = DNI_NO_STORE_HEADERS["Cache-Control"];
  // private keeps proxies out; no-store forbids writing it down at all.
  for (const directive of [
    "private",
    "no-store",
    "no-cache",
    "max-age=0",
    "must-revalidate",
  ]) {
    assert.ok(control.includes(directive), `missing ${directive}`);
  }
  // A public directive would undo the rest.
  assert.equal(/\bpublic\b/.test(control), false);
});

// ------------------------------------------------------------------- cookie

test("the cookie is HttpOnly, Secure, SameSite=Strict and path-scoped", () => {
  const cookie = buildDniCookie("value", DNI_SESSION_TTL_MS / 1000);
  assert.match(cookie, /^__Secure-callrail-dni=value/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api\/callrail\/dni-test/);
  assert.match(cookie, /Max-Age=900/);
  assert.ok(DNI_COOKIE_NAME.startsWith("__Secure-"));
});

test("clearing the cookie expires it immediately", () => {
  assert.match(clearDniCookie(), /Max-Age=0/);
});

test("the cookie is read only under its own exact name", () => {
  assert.equal(readDniCookie(DNI_COOKIE_NAME + "=abc"), "abc");
  assert.equal(readDniCookie("other=x; " + DNI_COOKIE_NAME + "=abc; y=z"), "abc");
  assert.equal(readDniCookie("callrail-dni=abc"), null);
  assert.equal(readDniCookie("x" + DNI_COOKIE_NAME + "=abc"), null);
  assert.equal(readDniCookie(DNI_COOKIE_NAME + "="), null);
  assert.equal(readDniCookie(null), null);
  assert.equal(readDniCookie(""), null);
});

// ------------------------------------------------------- redirect scrubbing

test("the redirect strips the credential and keeps attribution", () => {
  const target = cleanDniRedirect(
    "https://example.com/api/callrail/dni-test?t=SECRET&fbclid=ABC123&utm_source=facebook&gclid=G1",
  );
  assert.equal(target.includes("SECRET"), false);
  assert.match(target, /fbclid=ABC123/);
  assert.match(target, /utm_source=facebook/);
  assert.match(target, /gclid=G1/);
  // Path-and-query only, so this can never become an open redirect.
  assert.ok(target.startsWith("/api/callrail/dni-test?"));
  assert.equal(target.includes("example.com"), false);
});

test("every authorization field name is stripped, not just the current one", () => {
  const query = DNI_AUTH_FIELDS.map((field) => field + "=SECRET").join("&");
  const target = cleanDniRedirect(
    "https://example.com/api/callrail/dni-test?" + query + "&fbclid=KEEP",
  );
  assert.equal(target.includes("SECRET"), false);
  assert.match(target, /fbclid=KEEP/);
});

test("no authorization field can ever reach the display allowlist", () => {
  assert.doesNotThrow(() => assertNoAuthFieldsReported());
  const reported = new Set(DNI_REPORTED_PARAMS.map((k) => k.toLowerCase()));
  for (const field of DNI_AUTH_FIELDS) {
    assert.equal(reported.has(field.toLowerCase()), false, field);
  }
  assert.equal(reported.has(DNI_EXCHANGE_PARAM), false);
  assert.equal(reported.has(DNI_COOKIE_NAME.toLowerCase()), false);
});

// -------------------------------------------------- claim shape and binding

test("a claim carries both halves of the tenant and round-trips", () => {
  const claim = claimFor(ORG, CLIENT_A);
  const parsed = parseDniClaim(encodeDniClaim(claim));
  assert.equal(parsed.organizationId, ORG);
  assert.equal(parsed.clientId, CLIENT_A);
  assert.equal(parsed.expiresAt, Math.floor(claim.expiresAt));
});

test("a claim missing either half of the tenant is refused", () => {
  assert.throws(
    () => encodeDniClaim({ organizationId: "", clientId: CLIENT_A, expiresAt: 1 }),
    /organization/i,
  );
  assert.throws(
    () => encodeDniClaim({ organizationId: ORG, clientId: "", expiresAt: 1 }),
    /client/i,
  );
  // The separator is a dot, so a dot in either id would change the shape.
  assert.throws(() =>
    encodeDniClaim({ organizationId: "a.b", clientId: CLIENT_A, expiresAt: 1 }),
  );
  assert.throws(() =>
    encodeDniClaim({ organizationId: ORG, clientId: "a.b", expiresAt: 1 }),
  );
  assert.throws(() =>
    encodeDniClaim({ organizationId: ORG, clientId: CLIENT_A, expiresAt: Number.NaN }),
  );
});

test("a malformed claim is rejected rather than guessed at", () => {
  for (const value of [
    "",
    "dni2",
    "dni2.org",
    "dni2.org.client",
    "dni2.org.client.notanumber",
    // The previous claim format must not be accepted after the shape changed.
    "dni1.client.123",
    "dni2..client.123",
    "dni2.org..123",
    "dni2.org.client.0",
    "dni2.org.client.-5",
    "a.b.c.d.e",
    null,
    undefined,
    12345,
  ]) {
    assert.equal(parseDniClaim(value), null, String(value));
  }
});

// ------------------------------------------------ signing, binding, expiry

test("a credential this key signed verifies, and carries its tenant back", async () => {
  const token = await signDniClaim(key, claimFor(ORG, CLIENT_A));
  const claim = await verifyDniClaim(key, token);
  assert.ok(claim, "a live credential verifies");
  assert.equal(claim.organizationId, ORG);
  assert.equal(claim.clientId, CLIENT_A);
});

test("a credential signed by a different key is refused", async () => {
  const token = await signDniClaim(otherKey, claimFor(ORG, CLIENT_A));
  assert.equal(await verifyDniClaim(key, token), null);
});

test("the client cannot be swapped without breaking the signature", async () => {
  const token = await signDniClaim(key, claimFor(ORG, CLIENT_A));
  const forged = token.replace(CLIENT_A, CLIENT_B);
  assert.notEqual(forged, token, "the token really was rewritten");
  assert.equal(await verifyDniClaim(key, forged), null);
});

test("the organization cannot be swapped without breaking the signature", async () => {
  const token = await signDniClaim(key, claimFor(ORG, CLIENT_A));
  const forged = token.replace(ORG, OTHER_ORG);
  assert.notEqual(forged, token);
  assert.equal(await verifyDniClaim(key, forged), null);
});

test("a credential for one client never authorizes another", async () => {
  const forA = await verifyDniClaim(key, await signDniClaim(key, claimFor(ORG, CLIENT_A)));
  const forB = await verifyDniClaim(key, await signDniClaim(key, claimFor(ORG, CLIENT_B)));
  assert.equal(forA.clientId, CLIENT_A);
  assert.equal(forB.clientId, CLIENT_B);
  assert.notEqual(forA.clientId, forB.clientId);
});

test("expiry is enforced on the server from the signed deadline", async () => {
  const now = Date.now();
  // Validly signed, but already past its deadline. The signature is intact —
  // only the server-side clock check rejects it, which is the point: a browser
  // that ignores Max-Age and keeps presenting the cookie gets nowhere.
  const stale = await signDniClaim(key, {
    organizationId: ORG,
    clientId: CLIENT_A,
    expiresAt: now - 1,
  });
  assert.equal(await verifyDniClaim(key, stale, now), null);

  // The same credential was good a moment before it lapsed.
  const shortLived = await signDniClaim(key, {
    organizationId: ORG,
    clientId: CLIENT_A,
    expiresAt: now + 1000,
  });
  assert.ok(await verifyDniClaim(key, shortLived, now));
  assert.equal(await verifyDniClaim(key, shortLived, now + 1001), null);
});

test("a session credential lapses fifteen minutes after it is minted", async () => {
  const now = Date.now();
  const token = await signDniClaim(key, claimFor(ORG, CLIENT_A, DNI_SESSION_TTL_MS, now));
  // Alive throughout the window.
  assert.ok(await verifyDniClaim(key, token, now + DNI_SESSION_TTL_MS - 1000));
  // And refused the moment it passes, without the browser being consulted.
  assert.equal(await verifyDniClaim(key, token, now + DNI_SESSION_TTL_MS), null);
  assert.equal(await verifyDniClaim(key, token, now + DNI_SESSION_TTL_MS + 1), null);
});

test("an exchange link lapses after two minutes", async () => {
  const now = Date.now();
  const token = await signDniClaim(key, claimFor(ORG, CLIENT_A, DNI_EXCHANGE_TTL_MS, now));
  assert.ok(await verifyDniClaim(key, token, now + DNI_EXCHANGE_TTL_MS - 1));
  assert.equal(await verifyDniClaim(key, token, now + DNI_EXCHANGE_TTL_MS), null);
  assert.ok(DNI_EXCHANGE_TTL_MS < DNI_SESSION_TTL_MS);
});

test("the deadline cannot be extended by editing the credential", async () => {
  const now = Date.now();
  const expiresAt = now + 1000;
  const token = await signDniClaim(key, {
    organizationId: ORG,
    clientId: CLIENT_A,
    expiresAt,
  });
  // Rewrite the expiry to a year out, leaving the signature untouched.
  const forged = token.replace(
    String(Math.floor(expiresAt)),
    String(Math.floor(now + 365 * 24 * 60 * 60 * 1000)),
  );
  assert.notEqual(forged, token);
  assert.equal(await verifyDniClaim(key, forged, now), null);
});

// --------------------------------------------------------- cookie tampering

test("a tampered credential is refused whichever part was altered", async () => {
  const token = await signDniClaim(key, claimFor(ORG, CLIENT_A));
  const split = token.lastIndexOf(".");
  const body = token.slice(0, split);
  const signature = token.slice(split + 1);

  const tampered = {
    "flipped signature character":
      body + "." + (signature[0] === "A" ? "B" : "A") + signature.slice(1),
    "truncated signature": body + "." + signature.slice(0, -4),
    "extended signature": body + "." + signature + "AAAA",
    "empty signature": body + ".",
    "signature only": signature,
    "body only": body,
    "version bumped": token.replace("dni2", "dni3"),
    "extra segment": body + ".extra." + signature,
    "whitespace padded": " " + token + " ",
    "empty string": "",
    "not a string": 12345,
    "null": null,
  };
  for (const [name, value] of Object.entries(tampered)) {
    assert.equal(await verifyDniClaim(key, value, Date.now()), null, name);
  }
});

test("a signature lifted from one credential does not validate another", async () => {
  const now = Date.now();
  const a = await signDniClaim(key, claimFor(ORG, CLIENT_A, DNI_SESSION_TTL_MS, now));
  const b = await signDniClaim(key, claimFor(ORG, CLIENT_B, DNI_SESSION_TTL_MS, now));
  const bodyOfB = b.slice(0, b.lastIndexOf("."));
  const signatureOfA = a.slice(a.lastIndexOf(".") + 1);
  assert.equal(await verifyDniClaim(key, bodyOfB + "." + signatureOfA, now), null);
});

test("verification never throws, whatever it is handed", async () => {
  for (const value of [undefined, null, 0, {}, [], "...", "....", "a".repeat(5000)]) {
    assert.equal(await verifyDniClaim(key, value), null, String(value));
  }
});

test("isDniClaimExpired treats the deadline itself as past", () => {
  const now = Date.now();
  assert.equal(isDniClaimExpired(claimFor(ORG, CLIENT_A, 1000, now), now), false);
  assert.equal(
    isDniClaimExpired({ organizationId: ORG, clientId: CLIENT_A, expiresAt: now }, now),
    true,
  );
});
