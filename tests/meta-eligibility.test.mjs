import assert from "node:assert/strict";
import test from "node:test";

import {
  decideMetaEligibility,
  isValidFbclid,
  META_ELIGIBILITY_REASONS,
} from "../lib/meta-eligibility.ts";
import { normalizeAttribution } from "../lib/meta-eligibility.ts";

// The capture endpoint is public, so these run the real rules against payloads
// a stranger could actually POST.

const VALID_FBCLID = "IwAR0abcdefghijklmnopqrstuvwxyz0123456789";

test("a valid Meta click id is the only thing that qualifies", () => {
  const decision = decideMetaEligibility({ fbclid: VALID_FBCLID });
  assert.deepEqual(decision, { eligible: true, reason: "meta_fbclid" });
});

test("non-Meta traffic never qualifies", () => {
  const cases = {
    google: { utm_source: "google", utm_medium: "cpc", gclid: "abc123" },
    organic: { utm_source: "google", utm_medium: "organic" },
    referral: { utm_source: "yelp.com", utm_medium: "referral" },
    direct: {},
    unattributed: { service: "Termite inspection", phone: "555-0100" },
  };
  for (const [name, payload] of Object.entries(cases)) {
    const decision = decideMetaEligibility(payload);
    assert.equal(decision.eligible, false, `${name} must not qualify`);
    assert.ok(
      META_ELIGIBILITY_REASONS.includes(decision.reason),
      `${name} reason is in the closed vocabulary`,
    );
  }
});

test("Meta and Instagram UTMs alone never qualify", () => {
  for (const payload of [
    { utm_source: "facebook", utm_medium: "paid" },
    { utm_source: "instagram", utm_medium: "cpc" },
    { utm_source: "meta", utm_campaign: "spring" },
    { utm_source: "ig", utm_medium: "paid_social" },
    { utm_campaign: "facebook-retargeting" },
  ]) {
    const decision = decideMetaEligibility(payload);
    assert.equal(decision.eligible, false, JSON.stringify(payload));
    assert.equal(decision.reason, "utm_only");
  }
});

test("a spoofed source label is not evidence", () => {
  for (const payload of [
    { source: "Meta" },
    { source: "Facebook Ads" },
    { leadSource: "instagram" },
    { channel: "FB" },
    { campaign: "Meta - spring promo" },
  ]) {
    const decision = decideMetaEligibility(payload);
    assert.equal(decision.eligible, false, JSON.stringify(payload));
    assert.equal(decision.reason, "unverified_label");
  }
});

test("fbp alone is not proof of an ad click", () => {
  const decision = decideMetaEligibility({ fbp: "fb.1.1700000000000.1234567890" });
  assert.deepEqual(decision, { eligible: false, reason: "fbp_only" });
});

test("a caller-supplied fbc cannot buy eligibility", () => {
  const decision = decideMetaEligibility({
    fbc: `fb.1.1700000000000.${VALID_FBCLID}`,
  });
  assert.deepEqual(decision, { eligible: false, reason: "client_supplied_fbc" });
});

test("a malformed click id is rejected rather than trusted", () => {
  for (const fbclid of [
    "x",
    "short",
    "has spaces in it aaaaaaaaaaaa",
    "punctuation!!!!!!!!!!!!!!!!!!",
    "a".repeat(513),
    "<script>alert(1)</script>aaaa",
  ]) {
    const decision = decideMetaEligibility({ fbclid });
    assert.equal(decision.eligible, false, `fbclid ${fbclid.slice(0, 20)}`);
    assert.equal(decision.reason, "invalid_fbclid");
  }
});

test("a Meta click id still qualifies alongside other traffic labels", () => {
  // Real Meta traffic usually carries UTMs too; they neither help nor hurt.
  const decision = decideMetaEligibility({
    fbclid: VALID_FBCLID,
    utm_source: "facebook",
    source: "Meta",
    fbp: "fb.1.1700000000000.1",
  });
  assert.deepEqual(decision, { eligible: true, reason: "meta_fbclid" });
});

test("fbc is derived only from a valid click id, never from a caller", () => {
  // Valid: derived.
  const good = normalizeAttribution({ fbclid: VALID_FBCLID });
  assert.ok(good.fbc?.startsWith("fb.1."), "derived from a valid fbclid");
  assert.ok(good.fbc?.endsWith(VALID_FBCLID));

  // Malformed: kept for diagnosis, but no match key is manufactured from it.
  const bad = normalizeAttribution({ fbclid: "x" });
  assert.equal(bad.fbclid, "x");
  assert.equal(bad.fbc, undefined, "a malformed fbclid must never produce fbc");

  // Caller-supplied fbc with no fbclid is discarded outright.
  const forged = normalizeAttribution({ fbc: "fb.1.1700000000000.forged" });
  assert.equal(forged.fbc, undefined, "a caller-supplied fbc is dropped");

  // A stored fbc is preserved when it accompanies a valid fbclid, so a
  // conversion sent days later keeps the original click time.
  const stored = normalizeAttribution({
    fbclid: VALID_FBCLID,
    fbc: "fb.1.1699999999999.original",
  });
  assert.equal(stored.fbc, "fb.1.1699999999999.original");
});

test("isValidFbclid accepts only well-formed values", () => {
  assert.equal(isValidFbclid(VALID_FBCLID), true);
  assert.equal(isValidFbclid("A".repeat(16)), true);
  for (const bad of ["A".repeat(15), "", null, undefined, 12345, {}, [], "a b c d e f g h"]) {
    assert.equal(isValidFbclid(bad), false, `rejects ${String(bad)}`);
  }
});
