// Date arithmetic and range rules for Meta ad reporting.
//
// Dependency-free on purpose, matching meta-ads-ids.ts and callrail-ids.ts:
// these decide what an operator is allowed to ask Meta for, so they are
// exercised directly in tests rather than through a module that needs a Worker
// runtime.

// One Meta request per window. Seven days of ad-level daily rows is a
// predictable response size and keeps paging to a couple of round trips.
export const DEFAULT_CHUNK_DAYS = 7;
// Windows advanced per invocation. Four weeks of history per pass finishes a
// ninety-day backfill in three ticks without monopolising a Worker's budget.
export const CHUNKS_PER_PASS = 4;
// Meta serves insights for roughly 37 months; a year is the useful span for
// cost-per-lead and keeps a mistyped date from requesting a decade.
export const MAX_BACKFILL_DAYS = 366;
// The scheduled sync owns the most recent days and re-fetches them every tick
// as Meta restates. A backfill that also wrote them would race it for the same
// keys, so it stops here and lets the sync finish the range.
export const RESTATEMENT_RESERVED_DAYS = 3;

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

/** Inclusive day count, so a single day is 1 rather than 0. */
export function daysBetween(since: string, until: string): number {
  const from = Date.parse(`${since}T00:00:00Z`);
  const to = Date.parse(`${until}T00:00:00Z`);
  return Math.floor((to - from) / DAY_MS) + 1;
}

/** The last day a backfill may claim, leaving the restatement window alone. */
export function latestBackfillDay(today = new Date()): string {
  return addDays(dateKey(today), -RESTATEMENT_RESERVED_DAYS);
}

/**
 * Validates and clamps an operator-supplied range.
 *
 * Returns the range actually fetchable, or throws the reason it is not. The
 * tail is clamped rather than rejected: "last 30 days" is a sensible thing to
 * ask for, and the right answer is to fetch the days the sync does not already
 * own instead of refusing the whole request over three of them.
 *
 * A real calendar date is required, not merely a well-shaped string: Date.parse
 * accepts 2026-02-31 and rolls it forward, which would silently fetch a
 * different range than the one typed.
 */
export function resolveBackfillRange(
  since: unknown,
  until: unknown,
  today = new Date(),
): { since: string; until: string } {
  const from = typeof since === "string" ? since.trim() : "";
  const to = typeof until === "string" ? until.trim() : "";
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    throw new Error("Enter both dates as YYYY-MM-DD.");
  }
  // Validity first, then round-trip. An impossible date like 2026-13-45 yields
  // an Invalid Date whose toISOString throws, so checking the time value has to
  // come before formatting it; the round-trip then catches the ones that are
  // merely wrong, such as 2026-02-31 rolling forward to March.
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  if (
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(toDate.getTime()) ||
    dateKey(fromDate) !== from ||
    dateKey(toDate) !== to
  ) {
    throw new Error("Enter two real calendar dates.");
  }
  if (from > to) {
    throw new Error("The start date must be on or before the end date.");
  }

  const latest = latestBackfillDay(today);
  const clampedUntil = to > latest ? latest : to;
  if (from > clampedUntil) {
    throw new Error(
      "That range is inside the window the automatic sync already covers, so there is nothing to backfill.",
    );
  }
  if (daysBetween(from, clampedUntil) > MAX_BACKFILL_DAYS) {
    throw new Error(`A backfill covers at most ${MAX_BACKFILL_DAYS} days.`);
  }
  return { since: from, until: clampedUntil };
}
