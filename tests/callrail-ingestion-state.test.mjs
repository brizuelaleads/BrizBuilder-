import assert from "node:assert/strict";
import test from "node:test";

import {
  CALLRAIL_INGESTION_CLEANUP_PENDING,
  CALLRAIL_INGESTION_OFF,
  CALLRAIL_INGESTION_ON,
  callRailIngestionFlags,
  callRailIngestionView,
  isSingleAffectedRow,
} from "../lib/callrail-ingestion-state.ts";

/**
 * A stand-in for the pair of systems this state describes.
 *
 * `disable` is the server action: it always switches ingestion off locally
 * first — which is why it never reports anything but `enabled: false` — and
 * then persists whether CallRail confirmed the URLs were withdrawn. `reload`
 * is what the browser reads back on the next page load, so anything the card
 * needs has to have survived in here.
 */
function connection(initial) {
  let stored = { ...initial };
  return {
    reload: () => ({ ...stored }),
    disable(cleanupConfirmed) {
      stored = { ...stored, ...callRailIngestionFlags(cleanupConfirmed) };
      return { enabled: false, cleanupConfirmed };
    },
  };
}

const ingesting = () =>
  connection({
    callIngestionEnabled: true,
    callIngestionConfigured: true,
    callIngestionCleanupPending: false,
    callIngestionEvents: ["post_call_webhook", "updated_call_webhook"],
  });

// ------------------------------------------------------ which state is shown

test("ingestion reads as on only when the server says exactly true", () => {
  assert.equal(
    callRailIngestionView({ callIngestionEnabled: true }),
    CALLRAIL_INGESTION_ON,
  );
  // A connection made before ingestion existed carries no such field. Absence
  // is not consent, and neither is anything merely truthy.
  for (const facts of [
    null,
    undefined,
    {},
    { callIngestionEnabled: null },
    { callIngestionEnabled: undefined },
    { callIngestionEnabled: false },
  ]) {
    assert.equal(
      callRailIngestionView(facts),
      CALLRAIL_INGESTION_OFF,
      JSON.stringify(facts),
    );
  }
});

test("off while still configured is the stranded cleanup, not plain off", () => {
  assert.equal(
    callRailIngestionView({
      callIngestionEnabled: false,
      callIngestionCleanupPending: true,
    }),
    CALLRAIL_INGESTION_CLEANUP_PENDING,
  );
  // Recognised from the shape as well as the name, so a connection whose
  // config was written by a build that predates the flag is still recovered
  // rather than being offered the wrong button.
  assert.equal(
    callRailIngestionView({
      callIngestionEnabled: false,
      callIngestionConfigured: true,
    }),
    CALLRAIL_INGESTION_CLEANUP_PENDING,
  );
  // While ingestion is on, being configured is simply normal.
  assert.equal(
    callRailIngestionView({
      callIngestionEnabled: true,
      callIngestionConfigured: true,
      callIngestionCleanupPending: true,
    }),
    CALLRAIL_INGESTION_ON,
    "on wins: there is nothing stranded while it is still running",
  );
});

// ---------------------------------------------------------- the whole journey

test("cleanup failure, page reload, retry cleanup, success", () => {
  const server = ingesting();
  assert.equal(callRailIngestionView(server.reload()), CALLRAIL_INGESTION_ON);

  // Disable is pressed. The local switch moves; CallRail does not confirm.
  const first = server.disable(false);
  assert.equal(first.enabled, false, "ingestion is off regardless");
  assert.equal(first.cleanupConfirmed, false);

  // The card must not now offer Enable.
  assert.equal(
    callRailIngestionView(server.reload()),
    CALLRAIL_INGESTION_CLEANUP_PENDING,
  );

  // The page is reloaded. Nothing about this state lived in the browser, so
  // it is all still here.
  const reloaded = server.reload();
  assert.equal(
    callRailIngestionView(reloaded),
    CALLRAIL_INGESTION_CLEANUP_PENDING,
    "the state survives a reload because the server holds it",
  );
  assert.equal(reloaded.callIngestionEnabled, false, "still not ingesting");
  assert.equal(reloaded.callIngestionConfigured, true, "still registered there");

  // Retry cleanup is pressed: the same action, with ingestion already off.
  const second = server.disable(true);
  assert.equal(second.enabled, false, "retrying never switches ingestion on");
  assert.equal(second.cleanupConfirmed, true);

  // And the card is back to the ordinary off state, offering Enable.
  const after = server.reload();
  assert.equal(callRailIngestionView(after), CALLRAIL_INGESTION_OFF);
  assert.equal(after.callIngestionConfigured, false);
  assert.equal(after.callIngestionCleanupPending, false);
  assert.deepEqual(after.callIngestionEvents, []);
});

test("a cleanup that keeps failing stays off and stays retryable", () => {
  const server = ingesting();
  server.disable(false);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal(
      callRailIngestionView(server.reload()),
      CALLRAIL_INGESTION_CLEANUP_PENDING,
      `attempt ${attempt} is still offered the retry`,
    );
    const result = server.disable(false);
    assert.equal(result.enabled, false, `attempt ${attempt} stays disabled`);
    assert.equal(result.cleanupConfirmed, false);
    const state = server.reload();
    assert.equal(state.callIngestionEnabled, false);
    assert.deepEqual(state.callIngestionEvents, []);
  }

  // Never once did it drift to plain off, which would have stranded the URLs
  // behind an Enable button, nor back to on.
  assert.equal(
    callRailIngestionView(server.reload()),
    CALLRAIL_INGESTION_CLEANUP_PENDING,
  );

  // The first success ends it, with no re-enabling and no disconnecting.
  server.disable(true);
  assert.equal(callRailIngestionView(server.reload()), CALLRAIL_INGESTION_OFF);
});

test("a disable that succeeds first time never shows the retry", () => {
  const server = ingesting();
  const result = server.disable(true);
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(callRailIngestionView(server.reload()), CALLRAIL_INGESTION_OFF);
});

// -------------------------------------------------- the single-row precondition

test("only a one-row update counts as having disabled anything", () => {
  assert.equal(isSingleAffectedRow([{ client_id: "abc" }]), true);
  // One row that happens to be empty is still one row.
  assert.equal(isSingleAffectedRow([{}]), true);

  // Zero rows is the case that matters: PostgREST calls it a success, and
  // acting on it would mean changing CallRail for a business whose credential
  // this update never found.
  assert.equal(isSingleAffectedRow([]), false);

  // Two rows means the tenant scope did not identify one row, so nothing here
  // knows which was meant.
  assert.equal(isSingleAffectedRow([{}, {}]), false);

  // Anything that is not a list of rows is not evidence of a row.
  for (const value of [null, undefined, {}, "", "1", 1, 0, true, false]) {
    assert.equal(isSingleAffectedRow(value), false, JSON.stringify(value));
  }
});

test("the flags written after a disable say what is actually true", () => {
  // Confirmed: nothing of BrizBuilder's is left at CallRail.
  assert.deepEqual(callRailIngestionFlags(true), {
    callIngestionEnabled: false,
    callIngestionConfigured: false,
    callIngestionCleanupPending: false,
    callIngestionEvents: [],
  });
  // Unconfirmed: the URLs really are still registered, and saying otherwise
  // is what would hide them behind an Enable button.
  assert.deepEqual(callRailIngestionFlags(false), {
    callIngestionEnabled: false,
    callIngestionConfigured: true,
    callIngestionCleanupPending: true,
    callIngestionEvents: [],
  });
  // Neither outcome ever reports ingestion as on.
  for (const confirmed of [true, false]) {
    assert.equal(callRailIngestionFlags(confirmed).callIngestionEnabled, false);
  }
});
