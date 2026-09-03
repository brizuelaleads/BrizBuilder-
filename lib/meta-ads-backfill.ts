import { decryptMetaSecret } from "./meta-conversions";
import { fetchMetaAdInsights } from "./meta-ads";
import {
  CHUNKS_PER_PASS,
  DEFAULT_CHUNK_DAYS,
  addDays,
  daysBetween,
  latestBackfillDay,
  resolveBackfillRange,
} from "./meta-ads-range.ts";
import {
  claim,
  describeFailure,
  publishMonthSpend,
  release,
  storeInsights,
  type MetaAdsCredentialRow,
} from "./meta-ads-sync";
import { getSupabaseAdminClient } from "./supabase/server";

// Filling in Meta ad spend from before the connection existed.
//
// The scheduled sync only ever looks at the last three days, so a client
// connected today has no history and every cost-per-lead figure is computed
// against a partial denominator. A backfill walks backwards through the range
// the operator asks for and writes the same rows the sync writes.
//
// It is chunked and resumable for two reasons. A Worker invocation has a fixed
// budget of CPU and subrequests, and ninety days of ad-level daily rows can
// exceed it; and Meta rate-limits an application, not a request, so spending
// the whole budget in one burst punishes every other client on the same tick.

export { latestBackfillDay, resolveBackfillRange };

export type MetaAdsBackfillRun = {
  id: string;
  organization_id: string;
  client_id: string;
  requested_since: string;
  requested_until: string;
  cursor_date: string | null;
  status: "running" | "completed" | "failed" | "canceled";
  chunk_days: number;
  days_total: number;
  days_done: number;
  rows_written: number;
  last_error: string | null;
};

export type MetaAdsBackfillProgress = {
  runId: string | null;
  status: MetaAdsBackfillRun["status"] | "idle";
  daysTotal: number;
  daysDone: number;
  rowsWritten: number;
  lastError: string | null;
};

async function loadCredential(
  organizationId: string,
  clientId: string,
): Promise<MetaAdsCredentialRow> {
  const result = await getSupabaseAdminClient()
    .from("meta_ads_credentials")
    .select(
      "id,organization_id,client_id,ad_account_id,access_token_ciphertext,access_token_iv",
    )
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Connect Meta Ads for this client first.");
  return result.data as MetaAdsCredentialRow;
}

export async function activeBackfill(
  organizationId: string,
  clientId: string,
): Promise<MetaAdsBackfillRun | null> {
  const result = await getSupabaseAdminClient()
    .from("meta_ads_backfill_runs")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .eq("status", "running")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return (result.data as MetaAdsBackfillRun | null) ?? null;
}

function toProgress(run: MetaAdsBackfillRun | null): MetaAdsBackfillProgress {
  if (!run) {
    return {
      runId: null,
      status: "idle",
      daysTotal: 0,
      daysDone: 0,
      rowsWritten: 0,
      lastError: null,
    };
  }
  return {
    runId: run.id,
    status: run.status,
    daysTotal: Number(run.days_total),
    daysDone: Number(run.days_done),
    rowsWritten: Number(run.rows_written),
    lastError: run.last_error,
  };
}

/**
 * Opens a backfill for one client.
 *
 * The unique index on (organization, client) where status = 'running' is what
 * stops a second one existing; a duplicate insert is reported as the conflict
 * it is rather than silently starting a parallel walk of the same account.
 */
export async function startMetaAdsBackfill(input: {
  organizationId: string;
  clientId: string;
  // Untyped on purpose: these arrive from the action API, and
  // resolveBackfillRange is the single place that decides what a date is.
  since: unknown;
  until: unknown;
  requestedByEmail: string;
}): Promise<MetaAdsBackfillProgress> {
  await loadCredential(input.organizationId, input.clientId);
  const range = resolveBackfillRange(input.since, input.until);

  const existing = await activeBackfill(input.organizationId, input.clientId);
  if (existing) {
    throw new Error(
      "A backfill is already running for this client. Wait for it to finish or cancel it first.",
    );
  }

  const inserted = await getSupabaseAdminClient()
    .from("meta_ads_backfill_runs")
    .insert({
      organization_id: input.organizationId,
      client_id: input.clientId,
      requested_since: range.since,
      requested_until: range.until,
      cursor_date: range.since,
      status: "running",
      chunk_days: DEFAULT_CHUNK_DAYS,
      days_total: daysBetween(range.since, range.until),
      days_done: 0,
      rows_written: 0,
      requested_by_email: input.requestedByEmail,
    })
    .select("*")
    .maybeSingle();
  if (inserted.error) throw new Error(inserted.error.message);

  // First windows run now, so the operator sees movement rather than an empty
  // progress bar waiting on a tick up to fifteen minutes away.
  return advanceMetaAdsBackfill(input.organizationId, input.clientId);
}

export async function cancelMetaAdsBackfill(
  organizationId: string,
  clientId: string,
): Promise<MetaAdsBackfillProgress> {
  const now = new Date().toISOString();
  const result = await getSupabaseAdminClient()
    .from("meta_ads_backfill_runs")
    .update({ status: "canceled", finished_at: now, updated_at: now })
    .eq("organization_id", organizationId)
    .eq("client_id", clientId)
    .eq("status", "running")
    .select("*")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return toProgress(result.data as MetaAdsBackfillRun | null);
}

/**
 * Advances one client's backfill by a bounded number of windows.
 *
 * Takes the same claim the scheduled sync takes, so the two can never call Meta
 * for one account at the same time. A client already claimed is left alone and
 * picked up on the next pass.
 *
 * Rows are written before the cursor moves. A crash between the two costs a
 * repeated window, which the upsert absorbs; moving the cursor first would cost
 * a silently missing one.
 */
export async function advanceMetaAdsBackfill(
  organizationId: string,
  clientId: string,
): Promise<MetaAdsBackfillProgress> {
  const supabase = getSupabaseAdminClient();
  const run = await activeBackfill(organizationId, clientId);
  if (!run) return toProgress(null);

  const credential = await loadCredential(organizationId, clientId);
  if (!(await claim(credential))) return toProgress(run);

  let cursor = run.cursor_date ?? run.requested_since;
  let daysDone = Number(run.days_done);
  let rowsWritten = Number(run.rows_written);

  try {
    const accessToken = await decryptMetaSecret(
      {
        ciphertext: credential.access_token_ciphertext,
        iv: credential.access_token_iv,
      },
      organizationId,
      clientId,
    );

    for (let pass = 0; pass < CHUNKS_PER_PASS; pass += 1) {
      if (cursor > run.requested_until) break;
      const windowEnd = addDays(cursor, run.chunk_days - 1);
      const until =
        windowEnd > run.requested_until ? run.requested_until : windowEnd;

      const insights = await fetchMetaAdInsights({
        adAccountId: credential.ad_account_id,
        accessToken,
        since: cursor,
        until,
      });
      rowsWritten += await storeInsights(credential, insights);
      daysDone += daysBetween(cursor, until);
      cursor = addDays(until, 1);

      const progressed = await supabase
        .from("meta_ads_backfill_runs")
        .update({
          cursor_date: cursor > run.requested_until ? null : cursor,
          days_done: daysDone,
          rows_written: rowsWritten,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .eq("status", "running");
      if (progressed.error) throw new Error(progressed.error.message);
    }

    const finished = cursor > run.requested_until;
    if (finished) {
      const now = new Date().toISOString();
      await supabase
        .from("meta_ads_backfill_runs")
        .update({ status: "completed", finished_at: now, updated_at: now })
        .eq("id", run.id)
        .eq("status", "running");
      // The dashboard reads month spend off the connection row, and a backfill
      // that reached into this month has just changed it.
      await publishMonthSpend(credential);
    }

    await release(credential, "ok", null);
    return {
      runId: run.id,
      status: finished ? "completed" : "running",
      daysTotal: Number(run.days_total),
      daysDone,
      rowsWritten,
      lastError: null,
    };
  } catch (error) {
    const failure = describeFailure(error);
    const now = new Date().toISOString();
    // A rate limit is not a failed backfill -- the run stays open at the cursor
    // it reached and the next tick carries on. Anything else stops it, so an
    // operator is told rather than watching a bar that never moves.
    const status = failure.status === "rate_limited" ? "running" : "failed";
    await supabase
      .from("meta_ads_backfill_runs")
      .update({
        status,
        last_error: failure.message,
        ...(status === "failed" ? { finished_at: now } : {}),
        updated_at: now,
      })
      .eq("id", run.id)
      .eq("status", "running")
      .then(() => undefined, () => undefined);
    await release(credential, failure.status, failure.message).catch(() => {
      // The claim expires on its own; failing to record a failure must not also
      // strand the client.
    });
    return {
      runId: run.id,
      status: status === "failed" ? "failed" : "running",
      daysTotal: Number(run.days_total),
      daysDone,
      rowsWritten,
      lastError: failure.message,
    };
  }
}

/**
 * Carries every open backfill forward one pass, for the scheduled tick.
 *
 * Sequential, like the sync: these share one Meta application rate limit, so
 * running them together converts a slow backfill into a throttled one.
 */
export async function advanceMetaAdsBackfills(): Promise<
  MetaAdsBackfillProgress[]
> {
  const result = await getSupabaseAdminClient()
    .from("meta_ads_backfill_runs")
    .select("organization_id,client_id")
    .eq("status", "running");
  if (result.error) throw new Error(result.error.message);

  const progress: MetaAdsBackfillProgress[] = [];
  for (const row of (result.data ?? []) as Array<{
    organization_id: string;
    client_id: string;
  }>) {
    try {
      progress.push(
        await advanceMetaAdsBackfill(row.organization_id, row.client_id),
      );
    } catch {
      // One client's backfill failing must not stop the others. The failure is
      // already recorded against its own run row.
    }
  }
  return progress;
}
