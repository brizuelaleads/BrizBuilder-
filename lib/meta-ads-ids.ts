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
 * A Meta object id a captured click carried, or null.
 *
 * Meta substitutes {{campaign.id}}, {{adset.id}} and {{ad.id}} into an ad's URL
 * parameters at click time and the capture path stores them as utm_campaign,
 * utm_term and utm_content. But those fields are caller-controlled on the public
 * lead endpoint: anyone can post one. Only a value shaped like a Meta object id
 * is returned, so a free-text label is never presented in the interface as a
 * join into somebody's ad account.
 *
 * A forged id degrades into a lead attributed to something that does not exist
 * in the synced insights, which shows as an unresolved name -- not as spend
 * moving between real campaigns.
 */
function metaObjectId(value: unknown, key: string): string | null {
  const attribution =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const raw = attribution[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return META_OBJECT_ID.test(trimmed) ? trimmed : null;
}

/** utm_campaign carries {{campaign.id}}. */
export function metaCampaignIdFromAttribution(value: unknown): string | null {
  return metaObjectId(value, "utm_campaign");
}

/** utm_term carries {{adset.id}}. */
export function metaAdsetIdFromAttribution(value: unknown): string | null {
  return metaObjectId(value, "utm_term");
}

/** utm_content carries {{ad.id}}. */
export function metaAdIdFromAttribution(value: unknown): string | null {
  return metaObjectId(value, "utm_content");
}
