// Choosing the amount to report on a won deal.
//
// Dependency-free so the precedence rules can be unit tested directly. Both
// `leads.final_revenue_cents` and `leads.estimated_value_cents` are NOT NULL
// DEFAULT 0, so an unset amount arrives as zero rather than null. Nullish
// coalescing therefore never falls through, and "is it set?" has to mean
// "is it greater than zero?".

function toPositiveCents(value: unknown): number | null {
  // Only genuine numerics. Coercing anything else invents an amount: Number
  // turns true into 1 and an empty array into 0.
  if (typeof value !== "number" && typeof value !== "string") return null;
  const cents = Number(value);
  if (!Number.isFinite(cents)) return null;
  // Round before the test, not after: a sub-cent amount passes `> 0` and then
  // rounds to zero, which would report a customer as worth nothing.
  const rounded = Math.round(cents);
  return rounded > 0 ? rounded : null;
}

/**
 * Closed revenue wins; an estimate stands in when there is no closed figure;
 * otherwise there is no amount to report.
 */
export function resolveWonValueCents(
  finalRevenueCents: unknown,
  estimatedValueCents: unknown,
): number | null {
  return (
    toPositiveCents(finalRevenueCents) ?? toPositiveCents(estimatedValueCents)
  );
}

/**
 * Meta expects a major-unit amount. With no value, both keys are omitted
 * rather than sent as zero — a zero-value Purchase would tell Meta the
 * customer was worth nothing, which is worse than telling it nothing at all.
 */
export function wonValueCustomData(
  valueCents: number | null,
): Record<string, unknown> {
  if (valueCents === null) return {};
  return { value: valueCents / 100, currency: "USD" };
}
