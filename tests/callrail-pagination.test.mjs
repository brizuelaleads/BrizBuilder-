import assert from "node:assert/strict";
import test from "node:test";

import {
  collectCallRailPages,
  hasMoreCallRailPages,
} from "../lib/callrail-pagination.ts";

/**
 * A stand-in for CallRail's offset pagination.
 *
 * Records which page numbers were asked for, so a walk that quietly stops
 * early is visible as a gap rather than only as missing ids.
 */
function pager(total, perPage, { statesTotalPages = true } = {}) {
  const rows = Array.from({ length: total }, (_, index) => ({
    id: `CAL${String(index).padStart(4, "0")}`,
    // Present on the wire, and deliberately never read by a discovery walk.
    customer_phone_number: `+1555000${String(index).padStart(4, "0")}`,
    duration: 30 + index,
  }));
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const asked = [];
  return {
    asked,
    rows,
    totalPages,
    read: async (pageNumber) => {
      asked.push(pageNumber);
      const from = (pageNumber - 1) * perPage;
      return {
        rows: rows.slice(from, from + perPage),
        totalPages: statesTotalPages ? totalPages : null,
      };
    },
  };
}

const takeId = (row) => row.id;

// ------------------------------------------------------- every page is read

test("a walk reads every page and returns every id", async () => {
  for (const [total, perPage] of [
    [0, 10],
    [1, 10],
    [9, 10],
    [10, 10],
    [11, 10],
    [20, 10],
    [21, 10],
    [250, 100],
  ]) {
    const source = pager(total, perPage);
    const walk = await collectCallRailPages(source.read, takeId, {
      perPage,
      maxPages: 50,
    });
    const label = `${total} calls at ${perPage} per page`;

    assert.equal(walk.ids.length, total, `${label}: every id returned`);
    assert.deepEqual(
      walk.ids,
      source.rows.map((row) => row.id),
      `${label}: in order, none dropped`,
    );
    assert.equal(walk.truncated, false, `${label}: not truncated`);

    // Every page from the first to the last, once each, with no gaps. A walk
    // that stopped after page one would still have returned ids.
    const expected = Array.from(
      { length: source.totalPages },
      (_, index) => index + 1,
    );
    assert.deepEqual(source.asked, expected, `${label}: pages asked for`);
    assert.equal(walk.pagesRead, source.totalPages, `${label}: pages read`);
  }
});

test("a walk still reaches the end when CallRail states no page count", async () => {
  // Without a count, a full page is the only hint another exists.
  for (const [total, perPage] of [
    [0, 10],
    [10, 10],
    [25, 10],
    [30, 10],
  ]) {
    const source = pager(total, perPage, { statesTotalPages: false });
    const walk = await collectCallRailPages(source.read, takeId, {
      perPage,
      maxPages: 50,
    });
    assert.equal(walk.ids.length, total, `${total} at ${perPage}: all ids`);
    // An exact multiple costs one extra, empty page to discover the end.
    const expectedPages =
      total % perPage === 0 && total > 0
        ? total / perPage + 1
        : Math.max(1, Math.ceil(total / perPage));
    assert.deepEqual(
      source.asked,
      Array.from({ length: expectedPages }, (_, index) => index + 1),
    );
  }
});

test("the cap stops a walk and says that it did", async () => {
  const source = pager(100, 10);
  const walk = await collectCallRailPages(source.read, takeId, {
    perPage: 10,
    maxPages: 3,
  });
  assert.equal(walk.truncated, true, "a stopped walk reports itself");
  assert.equal(walk.pagesRead, 3);
  assert.equal(walk.ids.length, 30, "only what it actually read");
  assert.deepEqual(source.asked, [1, 2, 3], "and it stops asking");
});

test("a walk that finishes exactly at the cap is not called truncated", async () => {
  const source = pager(30, 10);
  const walk = await collectCallRailPages(source.read, takeId, {
    perPage: 10,
    maxPages: 3,
  });
  assert.equal(walk.truncated, false, "there was nothing left to read");
  assert.equal(walk.ids.length, 30);
  assert.deepEqual(source.asked, [1, 2, 3]);
});

// --------------------------------------------- only the id leaves the list

test("nothing but the id is taken from a row", async () => {
  const source = pager(3, 10);
  const seen = [];
  const walk = await collectCallRailPages(
    source.read,
    (row) => {
      seen.push(row);
      return row.id;
    },
    { perPage: 10, maxPages: 5 },
  );
  // The walk returns strings, not records: there is nothing else to mistake
  // for a source of truth downstream.
  assert.deepEqual(walk.ids, ["CAL0000", "CAL0001", "CAL0002"]);
  for (const id of walk.ids) assert.equal(typeof id, "string");
  // The rows did carry more, and it went nowhere.
  assert.ok(seen[0].customer_phone_number, "the row had other fields");
  assert.equal(
    JSON.stringify(walk).includes("+1555"),
    false,
    "and none of them are in the result",
  );
});

test("rows with no id are not counted as discovered", async () => {
  const read = async () => ({
    rows: [{ id: "CAL1" }, { id: "" }, { id: null }, {}, { id: "CAL2" }],
    totalPages: 1,
  });
  const walk = await collectCallRailPages(read, (row) => row.id ?? "", {
    perPage: 10,
    maxPages: 5,
  });
  assert.deepEqual(walk.ids, ["CAL1", "CAL2"]);
});

test("an id repeated across pages is fetched once", async () => {
  // CallRail can shift rows between pages while a walk is in flight, so the
  // same call can appear twice. Refetching it twice would be wasted work.
  const pages = [
    { rows: [{ id: "CAL1" }, { id: "CAL2" }], totalPages: 2 },
    { rows: [{ id: "CAL2" }, { id: "CAL3" }], totalPages: 2 },
  ];
  const walk = await collectCallRailPages(
    async (pageNumber) => pages[pageNumber - 1],
    takeId,
    { perPage: 2, maxPages: 5 },
  );
  assert.deepEqual(walk.ids, ["CAL1", "CAL2", "CAL3"]);
});

test("a page that is not a list is survived, not thrown on", async () => {
  const walk = await collectCallRailPages(
    async () => ({ rows: undefined, totalPages: 1 }),
    takeId,
    { perPage: 10, maxPages: 5 },
  );
  assert.deepEqual(walk.ids, []);
  assert.equal(walk.truncated, false);
});

// ----------------------------------------------------- the decision itself

test("a stated page count is trusted over the size of a page", () => {
  // A short page in the middle of a stated range does not end the walk.
  assert.equal(
    hasMoreCallRailPages({ pageNumber: 1, rowsOnPage: 3, perPage: 100, totalPages: 4 }),
    true,
  );
  assert.equal(
    hasMoreCallRailPages({ pageNumber: 4, rowsOnPage: 100, perPage: 100, totalPages: 4 }),
    false,
    "the last stated page ends it even when full",
  );
});

test("without a count, only a full page suggests another", () => {
  assert.equal(
    hasMoreCallRailPages({ pageNumber: 1, rowsOnPage: 100, perPage: 100, totalPages: null }),
    true,
  );
  assert.equal(
    hasMoreCallRailPages({ pageNumber: 1, rowsOnPage: 99, perPage: 100, totalPages: null }),
    false,
  );
  assert.equal(
    hasMoreCallRailPages({ pageNumber: 1, rowsOnPage: 0, perPage: 100, totalPages: null }),
    false,
  );
});

test("an unusable page count falls back rather than ending the walk", () => {
  for (const totalPages of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      hasMoreCallRailPages({
        pageNumber: 1,
        rowsOnPage: 100,
        perPage: 100,
        totalPages,
      }),
      true,
      `totalPages=${totalPages} must not be read as "one page"`,
    );
  }
});
