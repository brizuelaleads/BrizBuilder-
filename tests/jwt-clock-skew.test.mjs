import assert from "node:assert/strict";
import test from "node:test";

import { SignJWT } from "jose";
import {
  JWT_CLOCK_SKEW_TOLERANCE_SECONDS,
  verifyJwtWithClockSkew,
  withJwtClockSkewRetry,
} from "../lib/jwt-clock-skew.ts";

const NOW_SECONDS = 1_788_149_600;
const NOW = new Date(NOW_SECONDS * 1_000);
const SIGNING_KEY = new TextEncoder().encode(
  "brizbuilder-clock-skew-regression-key-32-bytes",
);
const WRONG_KEY = new TextEncoder().encode(
  "brizbuilder-clock-skew-regression-wrong-key",
);

async function tokenAt({
  issuedAt = NOW_SECONDS,
  notBefore = issuedAt,
  expiresAt = NOW_SECONDS + 300,
} = {}) {
  return new SignJWT({ scope: "push-sweep" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(issuedAt)
    .setNotBefore(notBefore)
    .setExpirationTime(expiresAt)
    .sign(SIGNING_KEY);
}

test("a JWT issued at the verifier's current time succeeds", async () => {
  const result = await verifyJwtWithClockSkew(await tokenAt(), SIGNING_KEY, {
    currentDate: NOW,
  });
  assert.equal(result.payload.iat, NOW_SECONDS);
});

test("a JWT appearing five to ten seconds in the future succeeds", async () => {
  for (const secondsAhead of [5, 10]) {
    const result = await verifyJwtWithClockSkew(
      await tokenAt({ issuedAt: NOW_SECONDS + secondsAhead }),
      SIGNING_KEY,
      { currentDate: NOW },
    );
    assert.equal(result.payload.iat, NOW_SECONDS + secondsAhead);
  }
});

test("a JWT outside the allowed skew still fails", async () => {
  await assert.rejects(
    verifyJwtWithClockSkew(
      await tokenAt({
        issuedAt: NOW_SECONDS + JWT_CLOCK_SKEW_TOLERANCE_SECONDS + 1,
      }),
      SIGNING_KEY,
      { currentDate: NOW },
    ),
  );
});

test("an expired JWT still fails without an expiration grace period", async () => {
  await assert.rejects(
    verifyJwtWithClockSkew(
      await tokenAt({
        issuedAt: NOW_SECONDS - 60,
        notBefore: NOW_SECONDS - 60,
        expiresAt: NOW_SECONDS - 1,
      }),
      SIGNING_KEY,
      { currentDate: NOW },
    ),
    /expired/i,
  );
});

test("a JWT with an invalid signature still fails", async () => {
  await assert.rejects(
    verifyJwtWithClockSkew(await tokenAt(), WRONG_KEY, { currentDate: NOW }),
    /signature/i,
  );
});

test("the push sweep retries the precise future-JWT error within the bound", async () => {
  const waits = [];
  let attempts = 0;
  const result = await withJwtClockSkewRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("JWT issued at future");
      return "healthy";
    },
    { sleep: async (milliseconds) => waits.push(milliseconds) },
  );

  assert.equal(result, "healthy");
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [5_000, 10_000]);
});

test("the push sweep never retries expiration or signature failures", async () => {
  for (const message of ["JWT expired", "JWT signature verification failed"]) {
    let attempts = 0;
    await assert.rejects(
      withJwtClockSkewRetry(
        async () => {
          attempts += 1;
          throw new Error(message);
        },
        { sleep: async () => assert.fail("non-skew errors must not sleep") },
      ),
      new RegExp(message, "i"),
    );
    assert.equal(attempts, 1);
  }
});

test("the push sweep stops retrying at the 30-second tolerance boundary", async () => {
  const waits = [];
  let attempts = 0;
  await assert.rejects(
    withJwtClockSkewRetry(
      async () => {
        attempts += 1;
        throw new Error("JWT issued at future");
      },
      { sleep: async (milliseconds) => waits.push(milliseconds) },
    ),
    /issued at future/i,
  );
  assert.deepEqual(waits, [5_000, 10_000, 15_000]);
  assert.equal(attempts, 4);
  assert.equal(
    waits.reduce((total, milliseconds) => total + milliseconds, 0),
    JWT_CLOCK_SKEW_TOLERANCE_SECONDS * 1_000,
  );
});
