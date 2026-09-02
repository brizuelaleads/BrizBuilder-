import { decryptMetaSecret } from "./meta-conversions";
import {
  fetchMetaAdInsights,
  MetaAdsError,
  type MetaAdInsightRow,
} from "./meta-ads";
import { getSupabaseAdminClient } from "./supabase/server";

// Pulling each connected client's ad spend on the scheduled tick.
//
// Rides the same */15 cron as CallRail reconciliation. One Meta call per client
// per run covering a rolling window, upserted onto (client, date, ad) so a
// restated number corrects itself instead of accumulating.

// Meta keeps adjusting the last few days after the fact -- attribution settles,
// invalid clicks are refunded. Re-fetching three days every run means the
// numbers converge on their own; a one-day window would freeze whatever was
// true at the moment of the first read.
const RESTATEMENT_WINDOW_DAYS = 3;
// A claim older than this is treated as abandoned. Longer than any healthy run
// and shorter than the gap between ticks, so a Worker killed mid-sync frees the
// client on the next pass rather than stranding it.
const CLAIM_STALE_AFTER_MS = 20 * 60_000;
// Upserts go in batches so one client with a large account cannot build a
// single statement big enough to be refused.
const UPSERT_BATCH = 500;

type MetaAdsCredentialRow = {
  id: string;
  organization_id: string;
  client_id: string;
  ad_account_id: string;
  access_token_ciphertext: string;
  access_token_iv: string;
};

export type MetaAdsSyncOutcome = {
  clientId: string;
  status: "ok" | "skipped" | "unauthorized" | "rate_limited" | "error";
  rows: number;
};

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The reason a sync failed, in a form that is safe to store and show.
 *
 * MetaAdsError messages are already built through the redaction helpers. Any
 * other throw is reported as a generic transport failure, because an arbitrary
 * exception can carry a URL, a payload fragment, or customer data.
 */
function describeFailure(error: unknown): {
  status: "unauthorized" | "rate_limited" | "error";
  message: string;
} {
  if (error instanceof MetaAdsError) {
    return { status: error.status, message: error.message };
  }
  return { status: "error", message: "Meta could not be reached." };
}

/**
 * Takes exclusive ownership of one client's sync.
 *
 * The guard is the WHERE clause, not a read followed by a write: two isolates
 * on the same tick both issue this UPDATE, and Postgres lets exactly one of
 * them match. The loser gets no row back and moves on.
 */
async function claim(row: MetaAdsCredentialRow): Promise<boolean> {
  const staleBefore = new Date(Date.now() - CLAIM_STALE_AFTER_MS).toISOString();
  const result = await getSupabaseAdminClient()
    .from("meta_ads_credentials")
    .update({ sync_started_at: new Date().toISOString() })
    .eq("id", row.id)
    .or(`sync_started_at.is.null,sync_started_at.lt.${staleBefore}`)
    .select("id")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return Boolean(result.data);
}

async function release(
  row: MetaAdsCredentialRow,
  status: "ok" | "unauthorized" | "rate_limited" | "error",
  lastError: string | null,
) {
  const now = new Date().toISOString();
  await getSupabaseAdminClient()
    .from("meta_ads_credentials")
    .update({
      sync_started_at: null,
      // Only a successful pass advances last_sync_at, so the connection card
      // shows when the numbers were last known good rather than when something
      // last tried.
      ...(status === "ok" ? { last_sync_at: now } : {}),
      last_status: status,
      last_error: lastError,
      updated_at: now,
    })
    .eq("id", row.id);
}

async function storeInsights(
  row: MetaAdsCredentialRow,
  insights: MetaAdInsightRow[],
): Promise<number> {
  const supabase = getSupabaseAdminClient();
  const syncedAt = new Date().toISOString();
  let written = 0;

  for (let start = 0; start < insights.length; start += UPSERT_BATCH) {
    const batch = insights.slice(start, start + UPSERT_BATCH).map((insight) => ({
      organization_id: row.organization_id,
      client_id: row.client_id,
      date_start: insight.dateStart,
      campaign_id: insight.campaignId,
      campaign_name: insight.campaignName,
      adset_id: insight.adsetId,
      ad_id: insight.adId,
      ad_name: insight.adName,
      spend_cents: insight.spendCents,
      impressions: insight.impressions,
      clicks: insight.clicks,
      synced_at: syncedAt,
    }));
    const result = await supabase
      .from("meta_ad_insights")
      .upsert(batch, {
        onConflict: "organization_id,client_id,date_start,ad_id",
      });
    if (result.error) throw new Error(result.error.message);
    written += batch.length;
  }

  return written;
}

/**
 * Publishes this month's spend onto the connection row.
 *
 * The dashboard reads spend from provider_connections alongside every other
 * provider, so the rollup is written where that code already looks instead of
 * teaching the dashboard a second shape. Dollars, matching the units the tile
 * formats.
 */
async function publishMonthSpend(row: MetaAdsCredentialRow) {
  const supabase = getSupabaseAdminClient();
  const now = new Date();
  const monthStart = dateKey(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  );

  const result = await supabase
    .from("meta_ad_insights")
    .select("spend_cents,impressions,clicks")
    .eq("organization_id", row.organization_id)
    .eq("client_id", row.client_id)
    .gte("date_start", monthStart);
  if (result.error) throw new Error(result.error.message);

  const totals = (result.data ?? []).reduce(
    (sum, entry) => ({
      spendCents: sum.spendCents + Number(entry.spend_cents ?? 0),
      impressions: sum.impressions + Number(entry.impressions ?? 0),
      clicks: sum.clicks + Number(entry.clicks ?? 0),
    }),
    { spendCents: 0, impressions: 0, clicks: 0 },
  );

  const existing = await supabase
    .from("provider_connections")
    .select("public_config")
    .eq("organization_id", row.organization_id)
    .eq("client_id", row.client_id)
    .eq("provider", "meta_ads")
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const publicConfig =
    existing.data?.public_config &&
    typeof existing.data.public_config === "object"
      ? (existing.data.public_config as Record<string, unknown>)
      : {};

  await supabase
    .from("provider_connections")
    .update({
      public_config: {
        ...publicConfig,
        monthSpend: Math.round(totals.spendCents) / 100,
        monthImpressions: totals.impressions,
        monthClicks: totals.clicks,
      },
      last_health_check_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", row.organization_id)
    .eq("client_id", row.client_id)
    .eq("provider", "meta_ads");
}

async function syncOne(row: MetaAdsCredentialRow): Promise<MetaAdsSyncOutcome> {
  if (!(await claim(row))) {
    return { clientId: row.client_id, status: "skipped", rows: 0 };
  }

  try {
    const accessToken = await decryptMetaSecret(
      {
        ciphertext: row.access_token_ciphertext,
        iv: row.access_token_iv,
      },
      row.organization_id,
      row.client_id,
    );

    const until = new Date();
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - (RESTATEMENT_WINDOW_DAYS - 1));

    const insights = await fetchMetaAdInsights({
      adAccountId: row.ad_account_id,
      accessToken,
      since: dateKey(since),
      until: dateKey(until),
    });

    const written = await storeInsights(row, insights);
    await publishMonthSpend(row);
    await release(row, "ok", null);
    return { clientId: row.client_id, status: "ok", rows: written };
  } catch (error) {
    const failure = describeFailure(error);
    await release(row, failure.status, failure.message).catch(() => {
      // The claim expires on its own after CLAIM_STALE_AFTER_MS, so a failure
      // to record the failure must not also strand the client.
    });
    return { clientId: row.client_id, status: failure.status, rows: 0 };
  }
}

/**
 * Syncs one client on demand, for the Refresh control on the connection card.
 *
 * Takes the same claim as the scheduled pass, so pressing Refresh while the
 * cron is mid-sync reports that it is already running instead of racing it.
 */
export async function syncMetaAdsForClient(
  organizationId: string,
  clientId: string,
): Promise<MetaAdsSyncOutcome> {
  const result = await getSupabaseAdminClient()
    .from("meta_ads_credentials")
    .select(
      "id,organization_id,client_id,ad_account_id,access_token_ciphertext,access_token_iv",
    )
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) {
    throw new Error("Connect Meta Ads for this client first.");
  }
  return syncOne(result.data as MetaAdsCredentialRow);
}

/**
 * Syncs every connected client, one at a time.
 *
 * Sequential on purpose. These calls share one Meta application rate limit, so
 * running them in parallel converts a slow sync into a throttled one, and a
 * client that fails is isolated by its own try/catch rather than by isolation
 * between requests.
 */
export async function syncMetaAdsInsights(): Promise<MetaAdsSyncOutcome[]> {
  const result = await getSupabaseAdminClient()
    .from("meta_ads_credentials")
    .select(
      "id,organization_id,client_id,ad_account_id,access_token_ciphertext,access_token_iv",
    );
  if (result.error) throw new Error(result.error.message);

  const outcomes: MetaAdsSyncOutcome[] = [];
  for (const row of (result.data ?? []) as MetaAdsCredentialRow[]) {
    outcomes.push(await syncOne(row));
  }
  return outcomes;
}
