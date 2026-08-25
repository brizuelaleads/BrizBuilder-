// Deciding whether a call is a fresh enquiry or a continuation of one already
// in the pipeline.
//
// Somebody who rings three times about the same job should not leave three open
// leads behind them. Somebody who rings a year after a closed job is a new
// enquiry and should. The window between those two is a per-client setting,
// because how long a job stays "the same job" is a property of the trade rather
// than of this code.
//
// Every call keeps its own record regardless. Reuse decides which lead a call
// is attached to, never whether the call itself is written down.
//
// Dependency-free so the rules can be exercised directly in tests.

/**
 * @deprecated The re-enquiry window no longer decides anything.
 *
 * An open lead is reused at any age, so nothing reads this to gate reuse and
 * nothing writes it from the interface. The constant, the guards below and
 * the stored column are all kept so that removing them can be its own change
 * rather than a destructive edit riding along with a feature.
 */
export const DEFAULT_RE_INQUIRY_WINDOW_DAYS = 30;
export const MIN_RE_INQUIRY_WINDOW_DAYS = 1;
export const MAX_RE_INQUIRY_WINDOW_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lead statuses a repeat call may attach itself to.
 *
 * UNRESPONSIVE is deliberately on this side of the line: it means nobody could
 * be reached, so the opportunity was never resolved, and a call back is that
 * same opportunity continuing rather than a new one. WON, LOST and SPAM are
 * resolved — a call after any of them starts something new.
 */
export const CALLRAIL_OPEN_LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "APPOINTMENT_BOOKED",
  "ESTIMATE_SENT",
  "UNRESPONSIVE",
] as const;

export type CallRailOpenLeadStatus =
  (typeof CALLRAIL_OPEN_LEAD_STATUSES)[number];

export function isOpenLeadStatus(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (CALLRAIL_OPEN_LEAD_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Reads a configured window, refusing anything outside the supported range.
 *
 * Bounded rather than clamped at the edges only: a window of zero would make
 * every call its own lead and a window of ten years would attach a call to an
 * enquiry nobody remembers. An unusable value falls back to the default rather
 * than failing the call, because a misconfigured window must not stop a lead
 * being recorded.
 */
/** @deprecated See DEFAULT_RE_INQUIRY_WINDOW_DAYS. */
export function normalizeReInquiryWindowDays(value: unknown): number {
  const days =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  // A fraction is refused rather than truncated. Truncating turns 2.5 into 2
  // without saying so, and a window is a stored integer: a value that is not
  // one did not come from the column, so it is not honoured as if it had.
  if (!Number.isInteger(days)) return DEFAULT_RE_INQUIRY_WINDOW_DAYS;
  if (days < MIN_RE_INQUIRY_WINDOW_DAYS) return DEFAULT_RE_INQUIRY_WINDOW_DAYS;
  if (days > MAX_RE_INQUIRY_WINDOW_DAYS) return DEFAULT_RE_INQUIRY_WINDOW_DAYS;
  return days;
}

/** @deprecated See DEFAULT_RE_INQUIRY_WINDOW_DAYS. */
export function isReInquiryWindowDays(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RE_INQUIRY_WINDOW_DAYS &&
    value <= MAX_RE_INQUIRY_WINDOW_DAYS
  );
}

/** The oldest lead a call arriving now may still attach itself to. */
export function reInquiryCutoff(now: number, windowDays: unknown): string {
  const days = normalizeReInquiryWindowDays(windowDays);
  return new Date(now - days * DAY_MS).toISOString();
}

export type ReInquiryLead = {
  id: string;
  status: unknown;
  createdAt: unknown;
};

/**
 * The one lead a repeat call is judged against: the newest, whatever its
 * status.
 *
 * Not the newest *open* lead. Picking the newest open one would step over a
 * more recent closed lead and attach a call to an enquiry that has since been
 * superseded — a customer whose job was won last week, ringing today, would
 * join the open lead from a month ago rather than starting the new job they
 * are actually ringing about.
 *
 * Ties on the timestamp are broken by id so the choice is stable rather than
 * whatever the database happened to return first.
 */
export function selectNewestLead(
  leads: readonly ReInquiryLead[] | null | undefined,
): ReInquiryLead | null {
  if (!leads || leads.length === 0) return null;
  let newest: ReInquiryLead | null = null;
  let newestAt = Number.NEGATIVE_INFINITY;
  for (const lead of leads) {
    const at = new Date(lead.createdAt as string).getTime();
    const usable = Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
    if (!newest || usable > newestAt) {
      newest = lead;
      newestAt = usable;
      continue;
    }
    if (usable === newestAt && String(lead.id) > String(newest.id)) {
      newest = lead;
    }
  }
  return newest;
}

export type ReInquiryCandidate = {
  status: unknown;
  /** When the lead was raised, not when it was last touched. */
  createdAt: unknown;
};

export type ReInquiryDecision = {
  reuse: boolean;
  /**
   * Closed vocabulary.
   *
   * The window-based reasons are gone. A lead's age no longer decides
   * anything; only whether it is still open.
   */
  reason: "no_open_lead" | "lead_closed" | "open_lead";
};

/**
 * Whether this call continues an existing lead.
 *
 * One question: is the newest lead for this contact still open? A repeat
 * caller with an open lead is continuing it, however long ago it was raised
 * — a job nobody has closed is a job still in progress. A won, lost or spam
 * lead is a finished conversation, and the call starts a new one.
 *
 * Which lead is "newest" is selectNewestLead's job, and it looks at every
 * status. Filtering to open leads before choosing would step over a more
 * recent closed one and attach today's call to last month's enquiry.
 */
export function decideReInquiry(
  candidate: ReInquiryCandidate | null | undefined,
): ReInquiryDecision {
  if (!candidate) return { reuse: false, reason: "no_open_lead" };
  // Open means open. Somebody ringing back about a job nobody has closed is
  // still talking about that job, whether they last called on Tuesday or in
  // March, so age does not enter into it. A closed lead is a finished
  // conversation and the new call starts a new one.
  return isOpenLeadStatus(candidate.status)
    ? { reuse: true, reason: "open_lead" }
    : { reuse: false, reason: "lead_closed" };
}
