import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCallRailAccountId,
  assertCallRailCompanyId,
  isCallRailAccountId,
  isCallRailCompanyId,
} from "../lib/callrail-ids.ts";

// These ids are interpolated into API paths, so the rules are exercised against
// the values CallRail actually publishes and against the shapes an attacker
// would reach for.

// Verbatim from CallRail's API reference: the Accounts listing sample.
const OFFICIAL_ACCOUNT_IDS = [
  "ACC8154748ae6bd4e278a7cddd38a662f4f",
  "ACC8154748ae6bd4e278a7cddd38a662d4d",
];

// Verbatim from CallRail's API reference, across several endpoint samples.
const OFFICIAL_COMPANY_IDS = [
  "COM8154748ae6bd4e278a7cddd38a662f4f",
  "COM8154748ae6bd4e278a7cddd38a662e4e",
  "COM37221d54e80c4216898d2f857fc69fa0",
];

// Also verbatim from the reference: the Companies listing sample still returns
// bare numeric ids. Both forms have to be accepted until that stops being true.
const OFFICIAL_LEGACY_NUMERIC_IDS = ["196207137", "635837866", "289003184"];

test("official account resource ids are accepted", () => {
  for (const id of OFFICIAL_ACCOUNT_IDS) {
    assert.equal(isCallRailAccountId(id), true, id);
    assert.equal(assertCallRailAccountId(id), id, id);
  }
});

test("official company resource ids are accepted", () => {
  for (const id of OFFICIAL_COMPANY_IDS) {
    assert.equal(isCallRailCompanyId(id), true, id);
    assert.equal(assertCallRailCompanyId(id), id, id);
  }
});

test("the legacy numeric form documented for companies is accepted", () => {
  for (const id of OFFICIAL_LEGACY_NUMERIC_IDS) {
    assert.equal(isCallRailCompanyId(id), true, id);
    assert.equal(isCallRailAccountId(id), true, id);
  }
});

test("the exact resource id length is not hard-coded to 32", () => {
  // A provider owns its identifier format. Validation that pins the current
  // length fails closed on every request the day CallRail extends it, so a
  // longer and a shorter well-formed id must both pass.
  assert.equal(isCallRailCompanyId(`COM${"a".repeat(32)}`), true);
  assert.equal(isCallRailCompanyId(`COM${"a".repeat(40)}`), true);
  assert.equal(isCallRailCompanyId(`COM${"a".repeat(12)}`), true);
  assert.equal(isCallRailAccountId(`ACC${"9".repeat(48)}`), true);
});

test("path traversal cannot be smuggled through an id", () => {
  const traversal = [
    "../../etc/passwd",
    "..",
    "../",
    "COM../../secrets",
    "ACC/../../a.json",
    "COM8154748ae6bd4e278a7cddd38a662f4f/../ACC1234567890",
    "COM8154748ae6bd4e278a7cddd38a662f4f/calls",
    "%2e%2e%2f",
    "COM%2e%2e%2fadmin",
    "COM8154748ae6bd4e278a7cddd38a662f4f?fields=all",
    "COM8154748ae6bd4e278a7cddd38a662f4f#fragment",
    "COM8154748ae6bd4e278a7cddd38a662f4f.json",
  ];
  for (const value of traversal) {
    assert.equal(isCallRailAccountId(value), false, value);
    assert.equal(isCallRailCompanyId(value), false, value);
  }
});

test("numeric junk is rejected", () => {
  // Short numbers are the shape a hand-typed or truncated value takes. The
  // legacy allowance starts at six digits precisely so these still fail.
  for (const value of ["0", "1", "123", "12345", "-1", "1.5", "1e9", " 12 "]) {
    assert.equal(isCallRailAccountId(value), false, value);
    assert.equal(isCallRailCompanyId(value), false, value);
  }
});

test("malformed prefixes are rejected", () => {
  const malformed = [
    "XYZ8154748ae6bd4e278a7cddd38a662f4f", // unknown prefix
    "com8154748ae6bd4e278a7cddd38a662f4f", // lowercase prefix
    "Com8154748ae6bd4e278a7cddd38a662f4f", // mixed-case prefix
    "COM", // prefix with no body
    "ACC", // prefix with no body
    "COM-8154748ae6bd4e278a7cddd38a662f4f", // separator
    "COM_8154748ae6bd4e278a7cddd38a662f4f",
    "COM 8154748ae6bd4e278a7cddd38a662f4f", // internal space
    "COMabc", // body under the minimum
    `COM${"a".repeat(200)}`, // body over the maximum
  ];
  for (const value of malformed) {
    assert.equal(isCallRailCompanyId(value), false, value);
  }
});

test("a well-formed id is accepted even when its body reads like a word", () => {
  // "COMPANY8154748ae6bd4e278a7cddd38a66" is COM followed by a legal body, and
  // nothing about its shape distinguishes it from a real id. Rejecting it would
  // mean constraining the body to hex — an assumption about the provider's
  // charset every bit as brittle as assuming its length. The shape check does
  // what a shape check can; proof that an id exists comes from CallRail
  // answering for it, which is why every id is re-fetched before it is stored.
  assert.equal(isCallRailCompanyId("COMPANY8154748ae6bd4e278a7cddd38a66"), true);
});

test("an account id is not accepted where a company id belongs, and vice versa", () => {
  const account = OFFICIAL_ACCOUNT_IDS[0];
  const company = OFFICIAL_COMPANY_IDS[0];
  assert.equal(isCallRailCompanyId(account), false);
  assert.equal(isCallRailAccountId(company), false);
});

test("the two prefixes cannot be swapped, on every official example", () => {
  // Storing an ACC id as a company (or the reverse) would point every later
  // request at the wrong resource, and both ids are the same shape apart from
  // their prefix — so the prefix is the only thing standing between them.
  for (const account of OFFICIAL_ACCOUNT_IDS) {
    assert.equal(isCallRailAccountId(account), true, `${account} is an account`);
    assert.equal(
      isCallRailCompanyId(account),
      false,
      `${account} must never validate as a company`,
    );
    assert.throws(
      () => assertCallRailCompanyId(account),
      /valid CallRail company ID/,
      `${account} must be rejected by the company assert`,
    );
  }
  for (const company of OFFICIAL_COMPANY_IDS) {
    assert.equal(isCallRailCompanyId(company), true, `${company} is a company`);
    assert.equal(
      isCallRailAccountId(company),
      false,
      `${company} must never validate as an account`,
    );
    assert.throws(
      () => assertCallRailAccountId(company),
      /valid CallRail account ID/,
      `${company} must be rejected by the account assert`,
    );
  }
});

test("other CallRail resource prefixes are rejected by both validators", () => {
  // CAL is a call, FOR a form submission, CRS and CSS other resources. None of
  // them is an account or a company, and a shared body must not let one pass.
  const body = "8154748ae6bd4e278a7cddd38a662f4f";
  for (const prefix of ["CAL", "FOR", "CRS", "CSS", "MFL", "TRK", "USR"]) {
    const id = `${prefix}${body}`;
    assert.equal(isCallRailAccountId(id), false, id);
    assert.equal(isCallRailCompanyId(id), false, id);
  }
});

test("non-string input never validates", () => {
  for (const value of [null, undefined, 0, 42, true, {}, [], () => {}]) {
    assert.equal(isCallRailAccountId(value), false, String(value));
    assert.equal(isCallRailCompanyId(value), false, String(value));
  }
});

test("surrounding whitespace is trimmed rather than rejected", () => {
  const id = OFFICIAL_COMPANY_IDS[0];
  assert.equal(assertCallRailCompanyId(`  ${id}  `), id);
});

test("the assert helpers throw without echoing the rejected value", () => {
  // An error message reaches a UI and often a log. Repeating the input there
  // would put whatever a caller supplied into both.
  const bad = "../../etc/passwd";
  assert.throws(
    () => assertCallRailAccountId(bad),
    (error) => error instanceof Error && !error.message.includes(bad),
  );
  assert.throws(
    () => assertCallRailCompanyId(bad),
    (error) => error instanceof Error && !error.message.includes(bad),
  );
});
