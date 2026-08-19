import assert from "node:assert/strict";
import test from "node:test";

import {
  ABANDONED_SETUP_TTL_MS,
  abandonedSetupFilter,
  matchesAbandonedSetup,
} from "../lib/callrail-cleanup.ts";

// Two clients in one organization. `call_tracking.manage` is granted to client
// owners, so Client A acting on their own connection must never be able to
// reach Client B's row — and the scoping rules are what stop it.

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const daysAgo = (days) =>
  new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

const row = (overrides) => ({
  organization_id: ORG,
  client_id: CLIENT_A,
  company_id: null,
  updated_at: daysAgo(30),
  ...overrides,
});

test("the window is 14 days", () => {
  assert.equal(ABANDONED_SETUP_TTL_MS, 14 * 24 * 60 * 60 * 1000);
  const filter = abandonedSetupFilter(ORG, CLIENT_A, NOW);
  assert.equal(filter.updatedBefore, daysAgo(14));
});

test("a filter always carries both the organization and the client", () => {
  const filter = abandonedSetupFilter(ORG, CLIENT_A, NOW);
  assert.equal(filter.organizationId, ORG);
  assert.equal(filter.clientId, CLIENT_A);
});

test("a blank organization or client is refused rather than widening the scope", () => {
  // An empty string reaching a query builder would match every row in the
  // table, so it is rejected here instead of trusted to be non-empty.
  assert.throws(() => abandonedSetupFilter("", CLIENT_A, NOW), /organization/i);
  assert.throws(() => abandonedSetupFilter(ORG, "", NOW), /client/i);
});

test("Client A's cleanup cannot match Client B's row", () => {
  const filterA = abandonedSetupFilter(ORG, CLIENT_A, NOW);
  // Same organization, equally abandoned, equally old — and still untouchable.
  const clientBRow = row({ client_id: CLIENT_B });
  assert.equal(matchesAbandonedSetup(clientBRow, filterA), false);
  // A's own row of exactly the same shape is matched, so the only difference
  // that decided the outcome was the client.
  assert.equal(matchesAbandonedSetup(row({}), filterA), true);
});

test("Client B's cleanup cannot match Client A's row either", () => {
  const filterB = abandonedSetupFilter(ORG, CLIENT_B, NOW);
  assert.equal(matchesAbandonedSetup(row({}), filterB), false);
  assert.equal(
    matchesAbandonedSetup(row({ client_id: CLIENT_B }), filterB),
    true,
  );
});

test("no filter matches across organizations", () => {
  const otherOrg = "22222222-2222-4222-8222-222222222222";
  const filterA = abandonedSetupFilter(ORG, CLIENT_A, NOW);
  assert.equal(
    matchesAbandonedSetup(row({ organization_id: otherOrg }), filterA),
    false,
  );
});

test("a completed setup is never swept, however old", () => {
  const filterA = abandonedSetupFilter(ORG, CLIENT_A, NOW);
  assert.equal(
    matchesAbandonedSetup(
      row({ company_id: "COM8154748ae6bd4e278a7cddd38a662f4f", updated_at: daysAgo(400) }),
      filterA,
    ),
    false,
  );
});

test("only setups past the window are swept", () => {
  const filterA = abandonedSetupFilter(ORG, CLIENT_A, NOW);
  assert.equal(matchesAbandonedSetup(row({ updated_at: daysAgo(13) }), filterA), false);
  assert.equal(matchesAbandonedSetup(row({ updated_at: daysAgo(15) }), filterA), true);
  // Exactly at the boundary is not yet past it.
  assert.equal(matchesAbandonedSetup(row({ updated_at: daysAgo(14) }), filterA), false);
});

test("a whole-organization sweep is not reachable through this module", () => {
  // Every entry point requires a client. There is no variant that takes an
  // organization alone, because that reach belongs to a trusted scheduled
  // process or an agency-admin-only action — so asking for one has to fail.
  assert.throws(() => abandonedSetupFilter(ORG), /client/i);
  assert.throws(() => abandonedSetupFilter(ORG, undefined, NOW), /client/i);
  assert.throws(() => abandonedSetupFilter(ORG, null, NOW), /client/i);
  // And a filter that was built correctly cannot be widened after the fact:
  // the predicate compares the client on every row it is given.
  const filterA = abandonedSetupFilter(ORG, CLIENT_A, NOW);
  const everyClientInTheOrg = [CLIENT_A, CLIENT_B].map((id) =>
    matchesAbandonedSetup(row({ client_id: id }), filterA),
  );
  assert.deepEqual(everyClientInTheOrg, [true, false]);
});

test("a mixed-tenant table is filtered to exactly one client's row", () => {
  const table = [
    row({ client_id: CLIENT_A }),
    row({ client_id: CLIENT_B }),
    row({ client_id: CLIENT_B, updated_at: daysAgo(400) }),
    row({ organization_id: "22222222-2222-4222-8222-222222222222" }),
    row({ company_id: "COM8154748ae6bd4e278a7cddd38a662f4f" }),
  ];
  const filterA = abandonedSetupFilter(ORG, CLIENT_A, NOW);
  const matched = table.filter((candidate) =>
    matchesAbandonedSetup(candidate, filterA),
  );
  assert.equal(matched.length, 1);
  assert.equal(matched[0].client_id, CLIENT_A);
  assert.equal(matched[0].organization_id, ORG);
});
