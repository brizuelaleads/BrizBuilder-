import assert from "node:assert/strict";
import test from "node:test";

import {
  CALLRAIL_OPEN_LEAD_STATUSES,
  DEFAULT_RE_INQUIRY_WINDOW_DAYS,
  MAX_RE_INQUIRY_WINDOW_DAYS,
  MIN_RE_INQUIRY_WINDOW_DAYS,
  decideReInquiry,
  isOpenLeadStatus,
  isReInquiryWindowDays,
  normalizeReInquiryWindowDays,
  reInquiryCutoff,
  selectNewestLead,
} from "../lib/callrail-reinquiry.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const daysAgo = (days) => new Date(NOW - days * DAY).toISOString();

const lead = (status, days) => ({ status, createdAt: daysAgo(days) });

// ------------------------------------------------------------- the window

test("the default window is thirty days", () => {
  assert.equal(DEFAULT_RE_INQUIRY_WINDOW_DAYS, 30);
  assert.equal(normalizeReInquiryWindowDays(undefined), 30);
  assert.equal(normalizeReInquiryWindowDays(null), 30);
});

test("a configured window is honoured inside its bounds", () => {
  for (const days of [1, 7, 14, 30, 90, 365]) {
    assert.equal(normalizeReInquiryWindowDays(days), days, String(days));
    assert.equal(isReInquiryWindowDays(days), true, String(days));
  }
});

test("a window outside the bounds falls back rather than failing a call", () => {
  // A misconfigured setting must not stop a lead being recorded.
  for (const bad of [0, -1, 366, 10000, Number.NaN, "", "abc", {}, []]) {
    assert.equal(
      normalizeReInquiryWindowDays(bad),
      DEFAULT_RE_INQUIRY_WINDOW_DAYS,
      String(bad),
    );
    assert.equal(isReInquiryWindowDays(bad), false, String(bad));
  }
  // A fraction is refused outright rather than truncated. The window is a
  // stored integer, so a value that is not one did not come from the column
  // and is not honoured as though it had.
  for (const fraction of [2.5, 0.5, 30.1, 29.999, -0.5, 365.5]) {
    assert.equal(
      normalizeReInquiryWindowDays(fraction),
      DEFAULT_RE_INQUIRY_WINDOW_DAYS,
      String(fraction),
    );
    assert.equal(isReInquiryWindowDays(fraction), false, String(fraction));
  }
  assert.equal(normalizeReInquiryWindowDays(Number.POSITIVE_INFINITY), 30);
  assert.equal(MIN_RE_INQUIRY_WINDOW_DAYS, 1);
  assert.equal(MAX_RE_INQUIRY_WINDOW_DAYS, 365);
});

test("the cutoff is the oldest lead a call may still attach to", () => {
  assert.equal(reInquiryCutoff(NOW, 30), daysAgo(30));
  assert.equal(reInquiryCutoff(NOW, 7), daysAgo(7));
  // An unusable window uses the default, so the query is still bounded.
  assert.equal(reInquiryCutoff(NOW, 0), daysAgo(30));
});

// ------------------------------------------------------- same-day repeats

test("a second call the same day joins the lead already open", () => {
  const decision = decideReInquiry(lead("NEW", 0), NOW, 30);
  assert.deepEqual(decision, { reuse: true, reason: "within_window" });
});

test("a call minutes after the first joins it too", () => {
  const decision = decideReInquiry(
    { status: "NEW", createdAt: new Date(NOW - 5 * 60 * 1000).toISOString() },
    NOW,
    30,
  );
  assert.equal(decision.reuse, true);
});

// ---------------------------------------------------------- the boundary

test("a call exactly one window after the lead was raised still joins it", () => {
  // Inclusive by choice: a window is a period during which reuse applies, so
  // its final instant is inside it.
  const decision = decideReInquiry(lead("NEW", 30), NOW, 30);
  assert.deepEqual(decision, { reuse: true, reason: "within_window" });
});

test("one millisecond past the window opens a new lead", () => {
  const decision = decideReInquiry(
    { status: "NEW", createdAt: new Date(NOW - (30 * DAY + 1)).toISOString() },
    NOW,
    30,
  );
  assert.deepEqual(decision, { reuse: false, reason: "outside_window" });
});

test("the boundary moves with the configured window", () => {
  assert.equal(decideReInquiry(lead("NEW", 7), NOW, 7).reuse, true);
  assert.equal(decideReInquiry(lead("NEW", 8), NOW, 7).reuse, false);
  assert.equal(decideReInquiry(lead("NEW", 8), NOW, 14).reuse, true);
});

// ------------------------------------------------------- after the window

test("a call long after the window opens a new lead", () => {
  for (const days of [31, 45, 90, 400]) {
    assert.deepEqual(
      decideReInquiry(lead("NEW", days), NOW, 30),
      { reuse: false, reason: "outside_window" },
      `${days} days`,
    );
  }
});

test("with no open lead at all there is nothing to reuse", () => {
  assert.deepEqual(decideReInquiry(null, NOW, 30), {
    reuse: false,
    reason: "no_open_lead",
  });
  assert.deepEqual(decideReInquiry(undefined, NOW, 30), {
    reuse: false,
    reason: "no_open_lead",
  });
});

// ------------------------------------------------------------ closed leads

test("a WON lead is never reused, however recent", () => {
  // The job was sold. A later call is new business, not the same enquiry.
  for (const days of [0, 1, 29, 30]) {
    assert.deepEqual(
      decideReInquiry(lead("WON", days), NOW, 30),
      { reuse: false, reason: "lead_closed" },
      `${days} days`,
    );
  }
});

test("a LOST lead is never reused, however recent", () => {
  for (const days of [0, 1, 29, 30]) {
    assert.deepEqual(
      decideReInquiry(lead("LOST", days), NOW, 30),
      { reuse: false, reason: "lead_closed" },
      `${days} days`,
    );
  }
});

test("SPAM is closed; the active statuses are not", () => {
  assert.equal(decideReInquiry(lead("SPAM", 1), NOW, 30).reuse, false);
  for (const status of CALLRAIL_OPEN_LEAD_STATUSES) {
    assert.equal(
      decideReInquiry(lead(status, 1), NOW, 30).reuse,
      true,
      status,
    );
  }
});

test("the open set is the active pipeline plus unresponsive", () => {
  // UNRESPONSIVE sits on the open side deliberately: nobody could be reached,
  // so the opportunity was never resolved and a call back continues it.
  assert.deepEqual(
    [...CALLRAIL_OPEN_LEAD_STATUSES],
    [
      "NEW",
      "CONTACTED",
      "QUALIFIED",
      "APPOINTMENT_BOOKED",
      "ESTIMATE_SENT",
      "UNRESPONSIVE",
    ],
  );
  for (const closed of ["WON", "LOST", "SPAM"]) {
    assert.equal(isOpenLeadStatus(closed), false, closed);
  }
  for (const bad of ["", "new", "Won", null, undefined, 1, {}]) {
    assert.equal(isOpenLeadStatus(bad), false, String(bad));
  }
});

// --------------------------------------------------------------- oddities

test("a lead with an unreadable date is not reused", () => {
  for (const createdAt of [null, undefined, "", "not a date", {}, []]) {
    assert.deepEqual(
      decideReInquiry({ status: "NEW", createdAt }, NOW, 30),
      { reuse: false, reason: "unreadable_lead" },
      String(createdAt),
    );
  }
});

test("a lead dated in the future is not reused", () => {
  // Clock skew must not let one lead capture every call that follows.
  const decision = decideReInquiry(
    { status: "NEW", createdAt: new Date(NOW + DAY).toISOString() },
    NOW,
    30,
  );
  assert.deepEqual(decision, { reuse: false, reason: "outside_window" });
});

// ------------------------------------------- the newest lead, any status

const withId = (id, status, days) => ({ id, status, createdAt: daysAgo(days) });

test("the candidate is the newest lead, not the newest open one", () => {
  // The regression: an older open lead used to win because the query filtered
  // to open statuses before ordering. A customer whose job was won last week,
  // ringing today, would have joined the open lead from a month ago.
  const leads = [
    withId("older-open", "NEW", 20),
    withId("newer-won", "WON", 2),
  ];
  const newest = selectNewestLead(leads);
  assert.equal(newest.id, "newer-won");
  assert.deepEqual(decideReInquiry(newest, NOW, 30), {
    reuse: false,
    reason: "lead_closed",
  });
});

test("an older open lead behind a newer LOST lead creates a new lead", () => {
  const newest = selectNewestLead([
    withId("older-open", "CONTACTED", 25),
    withId("newer-lost", "LOST", 3),
  ]);
  assert.equal(newest.id, "newer-lost");
  assert.equal(decideReInquiry(newest, NOW, 30).reuse, false);
});

test("an older open lead behind a newer SPAM lead creates a new lead", () => {
  const newest = selectNewestLead([
    withId("older-open", "QUALIFIED", 28),
    withId("newer-spam", "SPAM", 1),
  ]);
  assert.equal(newest.id, "newer-spam");
  assert.equal(decideReInquiry(newest, NOW, 30).reuse, false);
});

test("order of the rows does not change which lead is chosen", () => {
  const a = withId("older-open", "NEW", 20);
  const b = withId("newer-won", "WON", 2);
  assert.equal(selectNewestLead([a, b]).id, "newer-won");
  assert.equal(selectNewestLead([b, a]).id, "newer-won");
});

test("a newer open lead is still reused when it is genuinely newest", () => {
  const newest = selectNewestLead([
    withId("older-won", "WON", 40),
    withId("newer-open", "NEW", 3),
  ]);
  assert.equal(newest.id, "newer-open");
  assert.deepEqual(decideReInquiry(newest, NOW, 30), {
    reuse: true,
    reason: "within_window",
  });
});

test("ties on the timestamp are broken deterministically by id", () => {
  const a = { id: "aaa", status: "NEW", createdAt: daysAgo(1) };
  const b = { id: "bbb", status: "WON", createdAt: daysAgo(1) };
  assert.equal(selectNewestLead([a, b]).id, "bbb");
  assert.equal(selectNewestLead([b, a]).id, "bbb", "stable whatever the order");
});

test("no leads at all yields no candidate", () => {
  assert.equal(selectNewestLead([]), null);
  assert.equal(selectNewestLead(null), null);
  assert.equal(selectNewestLead(undefined), null);
  assert.deepEqual(decideReInquiry(selectNewestLead([]), NOW, 30), {
    reuse: false,
    reason: "no_open_lead",
  });
});

test("a lead with an unreadable date never outranks a readable one", () => {
  const newest = selectNewestLead([
    { id: "broken", status: "NEW", createdAt: "not a date" },
    withId("real", "NEW", 5),
  ]);
  assert.equal(newest.id, "real");
});
