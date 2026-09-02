import {
  buildMetaErrorDetail,
  formatMetaErrorDetail,
  type MetaErrorDetail,
} from "./meta-redaction";
import { readRuntimeValue } from "./supabase/env";
import { normalizeAdAccountId } from "./meta-ads-ids.ts";

// Re-exported so callers reach every Meta Ads helper through one module.
export { normalizeAdAccountId };

// Server-side Meta Marketing API client: reading spend and delivery out of an
// ad account. The mirror image of meta-conversions.ts, which writes conversions
// in. They share the encryption key and the redaction rules and nothing else --
// a Conversions dataset token cannot read an ad account, and an ads_read token
// has no permission to post events.
//
// Every request is a read. Nothing here mutates a customer's advertising.

const META_GRAPH_VERSION = "v26.0";
const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
// Longer than the conversions client's 5s. An insights query over a multi-day
// window is genuinely slower than posting one event, and this runs on a cron
// rather than in front of a waiting admin.
const META_REQUEST_TIMEOUT_MS = 20_000;
// Meta pages insights at 25 by default. A busy account over a three-day window
// is a few hundred ad-days, so the page size keeps that to a couple of round
// trips, and the page cap stops a misconfigured window from looping forever.
const META_INSIGHTS_PAGE_SIZE = 500;
const MAX_INSIGHT_PAGES = 20;

export type MetaAdsAccount = {
  id: string;
  name: string;
  currency: string | null;
  accountStatus: number | null;
};

export type MetaAdsCampaign = {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
};

export type MetaAdInsightRow = {
  dateStart: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adId: string;
  adName: string;
  spendCents: number;
  impressions: number;
  clicks: number;
};

export type MetaAdsFailureStatus = "unauthorized" | "rate_limited" | "error";

/** A Meta refusal, carrying only the sanitized detail safe to show an admin. */
export class MetaAdsError extends Error {
  readonly status: MetaAdsFailureStatus;
  readonly detail: MetaErrorDetail | null;

  constructor(
    status: MetaAdsFailureStatus,
    message: string,
    detail: MetaErrorDetail | null,
  ) {
    super(message);
    this.name = "MetaAdsError";
    this.status = status;
    this.detail = detail;
  }
}

export function getMetaAdsRuntimeStatus() {
  const missing = ["META_TOKEN_ENCRYPTION_KEY"].filter(
    (name) => !readRuntimeValue(name),
  );
  return { ready: missing.length === 0, missing };
}

async function fetchMeta(url: URL, accessToken: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), META_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "GET",
      // The token travels in the header, never the query string: a URL can end
      // up in a log line or an error message, and a header does not.
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new MetaAdsError("error", "Meta did not respond in time.", null);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads one Graph response, turning a refusal into a typed error.
 *
 * The three outcomes are distinguished because they need different handling: a
 * revoked token needs the customer to reconnect, a rate limit needs the sync to
 * back off and try later, and everything else is worth surfacing once.
 */
async function readJson(
  response: Response,
  summary: string,
): Promise<Record<string, unknown>> {
  if (response.ok) {
    const body = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body) {
      throw new MetaAdsError("error", "Meta returned an unreadable response.", null);
    }
    return body;
  }

  const body = await response.json().catch(() => null);
  const detail = buildMetaErrorDetail(response.status, body);
  const status: MetaAdsFailureStatus =
    response.status === 401 || response.status === 403
      ? "unauthorized"
      : // 429 is the documented throttle; code 4 and 17 are Meta's application
        // and account rate limits, which arrive as a 400.
        response.status === 429 || detail.code === 4 || detail.code === 17
        ? "rate_limited"
        : "error";
  throw new MetaAdsError(status, formatMetaErrorDetail(summary, detail), detail);
}

function graphUrl(path: string, params: Record<string, string>): URL {
  const url = new URL(`${META_GRAPH_URL}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Meta reports spend as a decimal string in the account currency. */
function spendToCents(value: unknown): number {
  const amount = Number(text(value) || 0);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

function count(value: unknown): number {
  const parsed = Number(text(value) || 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

/**
 * The ad accounts this token can see.
 *
 * Drives the picker on the connection form, so an admin chooses an account
 * instead of transcribing an id out of Ads Manager.
 */
export async function listMetaAdAccounts(
  accessToken: string,
): Promise<MetaAdsAccount[]> {
  const url = graphUrl("me/adaccounts", {
    fields: "id,name,currency,account_status",
    limit: "200",
  });
  const body = await readJson(
    await fetchMeta(url, accessToken),
    "Meta would not list the ad accounts for that token.",
  );
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.map((row) => {
    const record = (row ?? {}) as Record<string, unknown>;
    return {
      id: text(record.id),
      name: text(record.name) || text(record.id),
      currency: text(record.currency) || null,
      accountStatus:
        typeof record.account_status === "number" ? record.account_status : null,
    };
  });
}

/**
 * Confirms the token can actually read this account, before anything is saved.
 *
 * The conversions connection verifies the same way. A bad paste otherwise fails
 * silently on every future sync instead of at the moment of setup, where the
 * person who can fix it is still looking at the screen.
 */
export async function verifyMetaAdAccount(
  adAccountId: string,
  accessToken: string,
): Promise<MetaAdsAccount> {
  const id = normalizeAdAccountId(adAccountId);
  const url = graphUrl(id, { fields: "id,name,currency,account_status" });
  const body = await readJson(
    await fetchMeta(url, accessToken),
    "Meta rejected that token for this ad account. Check the System User has ads_read on it, then try again.",
  );
  return {
    id: text(body.id) || id,
    name: text(body.name) || id,
    currency: text(body.currency) || null,
    accountStatus:
      typeof body.account_status === "number" ? body.account_status : null,
  };
}

/** Campaigns on the account, newest activity first as Meta returns them. */
export async function listMetaCampaigns(
  adAccountId: string,
  accessToken: string,
): Promise<MetaAdsCampaign[]> {
  const url = graphUrl(`${normalizeAdAccountId(adAccountId)}/campaigns`, {
    fields: "id,name,status,effective_status",
    limit: "500",
  });
  const body = await readJson(
    await fetchMeta(url, accessToken),
    "Meta would not list campaigns for this ad account.",
  );
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.map((row) => {
    const record = (row ?? {}) as Record<string, unknown>;
    return {
      id: text(record.id),
      name: text(record.name) || text(record.id),
      status: text(record.status) || null,
      effectiveStatus: text(record.effective_status) || null,
    };
  });
}

/**
 * Daily spend and delivery, one row per ad per day.
 *
 * `level=ad` with `time_increment=1` is asked for deliberately: it is the finest
 * grain Meta will return in a single call, and every rollup the product shows --
 * by campaign, by month, by client -- is an aggregate over it. Asking per
 * campaign instead would multiply the request count by the campaign count for
 * strictly less information.
 */
export async function fetchMetaAdInsights(input: {
  adAccountId: string;
  accessToken: string;
  since: string;
  until: string;
}): Promise<MetaAdInsightRow[]> {
  let url: URL | null = graphUrl(
    `${normalizeAdAccountId(input.adAccountId)}/insights`,
    {
      level: "ad",
      time_increment: "1",
      time_range: JSON.stringify({ since: input.since, until: input.until }),
      fields:
        "date_start,campaign_id,campaign_name,adset_id,ad_id,ad_name,spend,impressions,clicks",
      limit: String(META_INSIGHTS_PAGE_SIZE),
    },
  );

  const rows: MetaAdInsightRow[] = [];
  for (let page = 0; url && page < MAX_INSIGHT_PAGES; page += 1) {
    const body = await readJson(
      await fetchMeta(url, input.accessToken),
      "Meta would not return ad performance for this account.",
    );
    const data = Array.isArray(body.data) ? body.data : [];
    for (const entry of data) {
      const record = (entry ?? {}) as Record<string, unknown>;
      const adId = text(record.ad_id);
      const dateStart = text(record.date_start);
      // The unique key is (client, date, ad). A row missing either half cannot
      // be stored or corrected on a later pass, so it is dropped rather than
      // written under a placeholder that would collide with the next one.
      if (!adId || !dateStart) continue;
      rows.push({
        dateStart,
        campaignId: text(record.campaign_id),
        campaignName: text(record.campaign_name),
        adsetId: text(record.adset_id),
        adId,
        adName: text(record.ad_name),
        spendCents: spendToCents(record.spend),
        impressions: count(record.impressions),
        clicks: count(record.clicks),
      });
    }

    const paging = (body.paging ?? {}) as Record<string, unknown>;
    const next = text(paging.next);
    // Meta's next cursor is a fully-formed URL carrying the access token in the
    // query string. It is refetched through fetchMeta, which supplies the token
    // as a header, so the URL is rebuilt rather than followed verbatim.
    url = next ? safeNextUrl(next) : null;
  }

  return rows;
}

/**
 * Rebuilds Meta's paging cursor without the credentials it embeds.
 *
 * Following `paging.next` as-is would put the access token in a URL, which is
 * exactly what fetchMeta avoids. Only the host and the pagination parameters are
 * kept, and anything off graph.facebook.com ends the walk.
 */
function safeNextUrl(next: string): URL | null {
  try {
    const parsed = new URL(next);
    if (parsed.hostname !== "graph.facebook.com") return null;
    parsed.searchParams.delete("access_token");
    return parsed;
  } catch {
    return null;
  }
}
