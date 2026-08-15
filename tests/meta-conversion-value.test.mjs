import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveWonValueCents,
  wonValueCustomData,
} from "../lib/meta-conversion-value.ts";

// Both source columns are NOT NULL DEFAULT 0, so an unset amount arrives as
// zero. These run the real precedence rules rather than inspecting source.

test("closed revenue takes priority over the estimate", () => {
  assert.equal(resolveWonValueCents(100000, 25000), 100000);
  // Even when the estimate is the larger figure.
  assert.equal(resolveWonValueCents(5000, 900000), 5000);
});

test("the estimate is used when there is no closed revenue", () => {
  // Zero, not null, is how an unset closed revenue actually arrives.
  assert.equal(resolveWonValueCents(0, 100000), 100000);
  assert.equal(resolveWonValueCents(null, 100000), 100000);
  assert.equal(resolveWonValueCents(undefined, 100000), 100000);
});

test("no amount at all is reported as absent, not as zero", () => {
  for (const pair of [
    [0, 0],
    [null, null],
    [undefined, undefined],
    [0, null],
    [null, 0],
  ]) {
    assert.equal(
      resolveWonValueCents(pair[0], pair[1]),
      null,
      `expected null for ${JSON.stringify(pair)}`,
    );
  }
});

test("negative and unparseable amounts count as absent", () => {
  assert.equal(resolveWonValueCents(-5000, 0), null);
  // A negative closed revenue must not suppress a real estimate.
  assert.equal(resolveWonValueCents(-5000, 100000), 100000);
  for (const junk of [NaN, Infinity, -Infinity, "abc", {}, [], true]) {
    assert.equal(resolveWonValueCents(junk, junk), null, `junk: ${String(junk)}`);
  }
});

test("cents convert to the major unit Meta expects", () => {
  // The value on the test lead: $1,000.
  assert.deepEqual(wonValueCustomData(resolveWonValueCents(100000, 0)), {
    value: 1000,
    currency: "USD",
  });
  assert.deepEqual(wonValueCustomData(12345), { value: 123.45, currency: "USD" });
  assert.deepEqual(wonValueCustomData(1), { value: 0.01, currency: "USD" });
});

test("with no value, both keys are omitted rather than sent as zero", () => {
  const custom = wonValueCustomData(null);
  assert.deepEqual(custom, {});
  assert.ok(!("value" in custom), "value key omitted");
  assert.ok(!("currency" in custom), "currency key omitted");
  // Spreading it into a payload adds nothing.
  const payload = { event_source: "crm", ...custom };
  assert.deepEqual(Object.keys(payload), ["event_source"]);
});

test("a fractional cent cannot leak through", () => {
  assert.equal(resolveWonValueCents(100000.4, 0), 100000);
  assert.equal(resolveWonValueCents(0.4, 0), null, "rounds below one cent to absent");
});
