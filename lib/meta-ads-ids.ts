// Shape rules for the Meta identifiers that cross a trust boundary.
//
// Dependency-free on purpose, matching callrail-ids.ts: these decide what is
// allowed to be treated as a real Meta object, so they are exercised directly
// in tests rather than through a module that needs a Worker runtime.

/** Meta object ids are digit strings. Long enough to exclude a stray label. */
const META_OBJECT_ID = /^[0-9]{5,32}$/u;

/**
 * Meta writes ad account ids as `act_<digits>`, but Ads Manager shows the bare
 * number in about half the places it appears. Accepting both and normalizing is
 * friendlier than rejecting the form the operator happened to copy.
 */
export function normalizeAdAccountId(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  const digits = text.startsWith("act_") ? text.slice(4) : text;
  if (!/^[0-9]{1,32}$/u.test(digits)) {
    throw new Error(
      "Enter a Meta ad account ID — the number shown in Ads Manager, with or without the act_ prefix.",
    );
  }
  return `act_${digits}`;
}

/**
 * The Meta campaign id a captured click carried, or null.
 *
 * Meta substitutes {{campaign.id}} into an ad's URL parameters at click time and
 * the capture path stores the result as utm_campaign. But utm_campaign is
 * caller-controlled on the public lead endpoint: anyone can post one. Only a
 * value shaped like a Meta object id is returned, so a free-text campaign label
 * is never presented in the interface as a join into somebody's ad account.
 *
 * A forged id degrades into a lead attributed to a campaign that does not exist
 * in the synced insights, which shows as an unresolved name -- not as spend
 * moving between real campaigns.
 */
export function metaCampaignIdFromAttribution(value: unknown): string | null {
  const attribution =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const campaign = attribution.utm_campaign;
  if (typeof campaign !== "string") return null;
  const trimmed = campaign.trim();
  return META_OBJECT_ID.test(trimmed) ? trimmed : null;
}
