// Deciding, once and from server-derived evidence, whether a lead may ever be
// reported to Meta.
//
// The lead capture endpoint is public and unauthenticated, so every field in a
// submission is caller-controlled. Only one signal survives that: a Meta-issued
// click id. Meta validates it on receipt, so a forged one degrades into an
// unmatched conversion rather than crediting a real campaign. A utm_source or a
// "source: Meta" label has no such backstop — anyone could set it and
// manufacture conversions in a customer's ad account.
//
// The cost is under-reporting: a genuine click whose fbclid was stripped by a
// redirect or a privacy extension is never reported. That is the intended
// trade. Teaching Meta's optimizer from leads it never produced is worse than
// missing some it did.
//
// Dependency-free so the rules can be exercised directly in tests.

export const META_ELIGIBILITY_REASONS = [
  "meta_fbclid",
  "invalid_fbclid",
  "client_supplied_fbc",
  "fbp_only",
  "utm_only",
  "unverified_label",
  "no_meta_attribution",
  "backfill_no_evidence",
] as const;

export type MetaEligibilityReason = (typeof META_ELIGIBILITY_REASONS)[number];

export type MetaEligibilityDecision = {
  eligible: boolean;
  reason: MetaEligibilityReason;
};

// URL-safe charset, long enough to exclude trivial values, generous enough to
// survive Meta changing its format. A shape check, never proof of a real click.
const FBCLID_PATTERN = /^[A-Za-z0-9_-]{16,512}$/u;

const META_LABEL_PATTERN = /\b(meta|facebook|fb|instagram|ig)\b/iu;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The single gate on deriving fbc, storing it, and granting eligibility. */
export function isValidFbclid(value: unknown): boolean {
  return FBCLID_PATTERN.test(asText(value));
}

function hasMetaUtm(source: Record<string, unknown>): boolean {
  return [source.utm_source, source.utm_medium, source.utm_campaign].some(
    (value) => META_LABEL_PATTERN.test(asText(value)),
  );
}

function claimsMeta(source: Record<string, unknown>): boolean {
  return [source.source, source.leadSource, source.campaign, source.channel].some(
    (value) => META_LABEL_PATTERN.test(asText(value)),
  );
}

/**
 * Decides eligibility from a raw capture payload.
 *
 * Only a well-formed fbclid qualifies. Every other branch is a distinct reason
 * so an ineligible lead can be explained later without guessing — the ordering
 * below is diagnostic only, since none of those branches grants eligibility.
 */
export function decideMetaEligibility(input: unknown): MetaEligibilityDecision {
  const source = asRecord(input);

  const fbclid = asText(source.fbclid);
  if (fbclid) {
    return isValidFbclid(fbclid)
      ? { eligible: true, reason: "meta_fbclid" }
      : { eligible: false, reason: "invalid_fbclid" };
  }
  // fbc arriving without an fbclid is caller-supplied and proves nothing; a
  // forged one would otherwise look identical to a derived one.
  if (asText(source.fbc)) {
    return { eligible: false, reason: "client_supplied_fbc" };
  }
  // The Pixel sets fbp for any visitor, advert or not.
  if (asText(source.fbp)) return { eligible: false, reason: "fbp_only" };
  if (hasMetaUtm(source)) return { eligible: false, reason: "utm_only" };
  if (claimsMeta(source)) return { eligible: false, reason: "unverified_label" };
  return { eligible: false, reason: "no_meta_attribution" };
}

// Only these keys are ever persisted from a landing page URL. Anything else the
// page sends is dropped rather than stored.
const ATTRIBUTION_KEYS = [
  "fbclid",
  "fbc",
  "fbp",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

const MAX_ATTRIBUTION_VALUE = 512;

export type MetaAttribution = Partial<
  Record<(typeof ATTRIBUTION_KEYS)[number], string>
>;

/**
 * Keeps only the attribution keys we recognize, bounded in length, and derives
 * the Meta match key.
 *
 * A landing page is untrusted input, so unknown keys are dropped rather than
 * stored. fbc is derived only from a well-formed fbclid: once stored, a
 * caller-supplied fbc is indistinguishable from a derived one, so accepting it
 * would let anyone hand this endpoint a match key of their choosing. A
 * malformed fbclid is kept for diagnosis but never produces one.
 */
export function normalizeAttribution(input: unknown): MetaAttribution {
  const source = asRecord(input);
  const attribution: MetaAttribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = asText(source[key]).slice(0, MAX_ATTRIBUTION_VALUE);
    if (value) attribution[key] = value;
  }
  if (isValidFbclid(attribution.fbclid)) {
    // An existing fbc is preserved, so a conversion sent days later keeps the
    // original click time rather than being restamped to now.
    if (!attribution.fbc) {
      attribution.fbc = `fb.1.${Date.now()}.${attribution.fbclid}`;
    }
  } else {
    delete attribution.fbc;
  }
  return attribution;
}
