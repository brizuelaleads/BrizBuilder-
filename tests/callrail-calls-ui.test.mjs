import assert from "node:assert/strict";
import test from "node:test";

import {
  decideReInquiry,
  selectNewestLead,
} from "../lib/callrail-reinquiry.ts";

/**
 * The repeat-caller rule, driven rather than read.
 *
 * A contact's calls arrive over months. Which lead each one joins is decided
 * by one question — is the newest lead still open — and these walk whole
 * sequences of calls through that decision the way a real caller would.
 */
const daysAgo = (days) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

/** A stand-in for one contact's leads, in the order they were raised. */
function ledger(initial = []) {
  const leads = [...initial];
  let next = initial.length + 1;
  return {
    leads,
    /** What ensureLead does: reuse the newest open lead, or start one. */
    receiveCall() {
      const newest = selectNewestLead(leads);
      const decision = decideReInquiry(newest);
      if (decision.reuse && newest) {
        return { leadId: newest.id, created: false, reason: decision.reason };
      }
      const lead = {
        id: `lead-${next++}`,
        status: "NEW",
        createdAt: new Date().toISOString(),
      };
      leads.push(lead);
      return { leadId: lead.id, created: true, reason: decision.reason };
    },
    close(id, status) {
      const lead = leads.find((item) => item.id === id);
      if (lead) lead.status = status;
    },
  };
}

// ------------------------------------------------------- open leads are reused

test("an open lead is reused however old it is", () => {
  for (const age of [0, 1, 30, 31, 90, 400, 3650]) {
    const book = ledger([
      { id: "lead-1", status: "NEW", createdAt: daysAgo(age) },
    ]);
    const result = book.receiveCall();
    assert.equal(result.created, false, `a ${age}-day-old open lead is reused`);
    assert.equal(result.leadId, "lead-1");
    assert.equal(result.reason, "open_lead");
    assert.equal(book.leads.length, 1, "no second lead is raised");
  }
});

test("every status the pipeline treats as open is reused", () => {
  for (const status of [
    "NEW",
    "CONTACTED",
    "QUALIFIED",
    "APPOINTMENT_BOOKED",
    "ESTIMATE_SENT",
    "UNRESPONSIVE",
  ]) {
    const book = ledger([
      { id: "lead-1", status, createdAt: daysAgo(200) },
    ]);
    assert.equal(book.receiveCall().created, false, status);
  }
});

test("three calls about the same job leave one lead", () => {
  const book = ledger();
  const first = book.receiveCall();
  const second = book.receiveCall();
  const third = book.receiveCall();
  assert.equal(first.created, true, "the first call opens the lead");
  assert.equal(second.created, false);
  assert.equal(third.created, false);
  assert.equal(second.leadId, first.leadId);
  assert.equal(third.leadId, first.leadId);
  assert.equal(book.leads.length, 1);
});

// ---------------------------------------------------- closed leads are separate

test("a won, lost or spam lead starts a new one", () => {
  for (const status of ["WON", "LOST", "SPAM"]) {
    const book = ledger([
      { id: "lead-1", status, createdAt: daysAgo(2) },
    ]);
    const result = book.receiveCall();
    assert.equal(result.created, true, `${status} starts a new lead`);
    assert.equal(result.reason, "lead_closed");
    assert.notEqual(result.leadId, "lead-1");
    assert.equal(book.leads.length, 2, `${status}: the old lead is untouched`);
    assert.equal(book.leads[0].status, status, "and keeps its status");
  }
});

test("a customer who comes back after a won job gets a second lead", () => {
  const book = ledger();
  const first = book.receiveCall();
  book.close(first.leadId, "WON");
  const second = book.receiveCall();
  assert.equal(second.created, true);
  assert.notEqual(second.leadId, first.leadId);
  // And the new one behaves like any other open lead from then on.
  const third = book.receiveCall();
  assert.equal(third.created, false);
  assert.equal(third.leadId, second.leadId);
  assert.equal(book.leads.length, 2);
});

test("a newer closed lead wins over an older open one", () => {
  // The regression this ordering exists for: filtering to open leads before
  // choosing would attach today's call to last month's enquiry.
  const book = ledger([
    { id: "lead-1", status: "NEW", createdAt: daysAgo(40) },
    { id: "lead-2", status: "WON", createdAt: daysAgo(3) },
  ]);
  const result = book.receiveCall();
  assert.equal(result.created, true, "the newest lead is the closed one");
  assert.equal(book.leads.length, 3);
});

test("a newer open lead wins over an older closed one", () => {
  const book = ledger([
    { id: "lead-1", status: "LOST", createdAt: daysAgo(40) },
    { id: "lead-2", status: "CONTACTED", createdAt: daysAgo(3) },
  ]);
  const result = book.receiveCall();
  assert.equal(result.created, false);
  assert.equal(result.leadId, "lead-2");
});

test("a contact with no leads at all opens one", () => {
  const book = ledger();
  const result = book.receiveCall();
  assert.equal(result.created, true);
  assert.equal(result.reason, "no_open_lead");
});

// ------------------------------------------------------- age no longer decides

test("nothing in the decision depends on when a lead was raised", () => {
  // Same status, wildly different ages, same answer every time. This is what
  // changed: the window used to make the second of these a new lead.
  const young = decideReInquiry({
    id: "a",
    status: "NEW",
    createdAt: daysAgo(1),
  });
  const ancient = decideReInquiry({
    id: "b",
    status: "NEW",
    createdAt: daysAgo(5000),
  });
  assert.deepEqual(young, ancient);
  assert.deepEqual(young, { reuse: true, reason: "open_lead" });

  // An unreadable or absent date cannot change it either.
  for (const createdAt of [null, undefined, "", "not a date", 0]) {
    assert.deepEqual(
      decideReInquiry({ id: "c", status: "NEW", createdAt }),
      { reuse: true, reason: "open_lead" },
      JSON.stringify(createdAt),
    );
  }
  // The decision takes one argument now; a stray second one is ignored rather
  // than being read as a window.
  assert.deepEqual(
    decideReInquiry({ id: "d", status: "WON", createdAt: daysAgo(1) }, 9999),
    { reuse: false, reason: "lead_closed" },
  );
});
