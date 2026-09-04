// Turning synced ad rows and attributed leads into the numbers the Ads tab
// shows.
//
// Dependency-free on purpose, like meta-ads-ids.ts and meta-ads-range.ts: this
// is where spend meets pipeline, and every figure it produces is one a client
// may act on. It is exercised directly rather than through a React tree.
//
// Two rules run through all of it. A ratio is null, never zero, when its
// denominator is missing -- "no leads yet" and "costs nothing per lead" are
// different answers and only one of them is true. And only leads carrying a
// Meta campaign id count against Meta spend, because dividing by every lead
// credits Meta with referrals and organic calls.

export type AdsReportInsight = {
  date: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adId: string;
  adName: string;
  spendCents: number;
  impressions: number;
  clicks: number;
};

export type AdsReportLead = {
  id: string;
  metaCampaignId: string | null;
  metaAdsetId: string | null;
  metaAdId: string | null;
  status: string;
  finalRevenueCents: number;
};

/**
 * Statuses that mean the lead reached a booking.
 *
 * WON is included deliberately: a job that was won was booked first, and
 * leaving it out would make cost-per-booked-job rise as more jobs closed --
 * a metric that gets worse the better you do is worse than no metric.
 */
export const BOOKED_STATUSES = [
  "APPOINTMENT_BOOKED",
  "ESTIMATE_SENT",
  "WON",
] as const;

export type AdsMetrics = {
  spendCents: number;
  impressions: number;
  clicks: number;
  leads: number;
  booked: number;
  won: number;
  revenueCents: number;
  /** null when there are no leads to divide by. */
  costPerLeadCents: number | null;
  costPerBookedCents: number | null;
  costPerWonCents: number | null;
  /** null without both spend and revenue. */
  roas: number | null;
  /** null without impressions. */
  ctr: number | null;
  cpcCents: number | null;
};

export type AdsReportAd = AdsMetrics & {
  adId: string;
  adName: string;
};

export type AdsReportAdset = AdsMetrics & {
  adsetId: string;
  ads: AdsReportAd[];
};

export type AdsReportCampaign = AdsMetrics & {
  campaignId: string;
  campaignName: string;
  adsets: AdsReportAdset[];
};

export type AdsSetupState =
  | "not_connected"
  | "no_data"
  | "missing_url_parameters"
  | "ready";

export type AdsReport = {
  totals: AdsMetrics;
  campaigns: AdsReportCampaign[];
  setupState: AdsSetupState;
  /** True when history is thinner than the range being viewed. */
  backfillAvailable: boolean;
  /** Leads in range with no Meta campaign id; excluded from every ratio. */
  unattributedLeads: number;
  /** Earliest day with spend, so the UI can say how far history reaches. */
  earliestSpendDate: string | null;
};

function emptyMetrics(): AdsMetrics {
  return {
    spendCents: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    booked: 0,
    won: 0,
    revenueCents: 0,
    costPerLeadCents: null,
    costPerBookedCents: null,
    costPerWonCents: null,
    roas: null,
    ctr: null,
    cpcCents: null,
  };
}

/** Divides only when the denominator is real, so a ratio is never a fake zero. */
function per(totalCents: number, count: number): number | null {
  return count > 0 ? Math.round(totalCents / count) : null;
}

function derive(metrics: AdsMetrics): AdsMetrics {
  return {
    ...metrics,
    costPerLeadCents: per(metrics.spendCents, metrics.leads),
    costPerBookedCents: per(metrics.spendCents, metrics.booked),
    costPerWonCents: per(metrics.spendCents, metrics.won),
    roas:
      metrics.spendCents > 0 && metrics.revenueCents > 0
        ? metrics.revenueCents / metrics.spendCents
        : null,
    ctr:
      metrics.impressions > 0 ? metrics.clicks / metrics.impressions : null,
    cpcCents: per(metrics.spendCents, metrics.clicks),
  };
}

function addSpend(target: AdsMetrics, insight: AdsReportInsight) {
  target.spendCents += insight.spendCents;
  target.impressions += insight.impressions;
  target.clicks += insight.clicks;
}

function addLead(target: AdsMetrics, lead: AdsReportLead) {
  target.leads += 1;
  if ((BOOKED_STATUSES as readonly string[]).includes(lead.status)) {
    target.booked += 1;
  }
  if (lead.status === "WON") {
    target.won += 1;
    target.revenueCents += lead.finalRevenueCents;
  }
}

/**
 * Builds the whole report in one pass over each input.
 *
 * Campaign, ad set and ad totals are accumulated together rather than derived
 * from one another, so an ad whose spend arrived before its campaign name did
 * still lands under the right parent.
 */
export function buildAdsReport(input: {
  insights: AdsReportInsight[];
  leads: AdsReportLead[];
  connected: boolean;
  /** Earliest day the viewer is asking about; null for all time. */
  rangeStart?: string | null;
}): AdsReport {
  const totals = emptyMetrics();
  const campaigns = new Map<
    string,
    {
      campaignId: string;
      campaignName: string;
      metrics: AdsMetrics;
      adsets: Map<
        string,
        {
          adsetId: string;
          metrics: AdsMetrics;
          ads: Map<string, { adId: string; adName: string; metrics: AdsMetrics }>;
        }
      >;
    }
  >();

  const campaignOf = (id: string, name: string) => {
    let entry = campaigns.get(id);
    if (!entry) {
      entry = {
        campaignId: id,
        campaignName: name,
        metrics: emptyMetrics(),
        adsets: new Map(),
      };
      campaigns.set(id, entry);
    }
    // The newest name Meta reported wins, so renaming a campaign in Ads Manager
    // does not leave the old label attached to its spend.
    if (name) entry.campaignName = name;
    return entry;
  };
  const adsetOf = (campaign: ReturnType<typeof campaignOf>, id: string) => {
    let entry = campaign.adsets.get(id);
    if (!entry) {
      entry = { adsetId: id, metrics: emptyMetrics(), ads: new Map() };
      campaign.adsets.set(id, entry);
    }
    return entry;
  };

  let earliestSpendDate: string | null = null;
  for (const insight of input.insights) {
    if (insight.spendCents > 0) {
      if (!earliestSpendDate || insight.date < earliestSpendDate) {
        earliestSpendDate = insight.date;
      }
    }
    addSpend(totals, insight);
    const campaign = campaignOf(insight.campaignId, insight.campaignName);
    addSpend(campaign.metrics, insight);
    const adset = adsetOf(campaign, insight.adsetId);
    addSpend(adset.metrics, insight);
    let ad = adset.ads.get(insight.adId);
    if (!ad) {
      ad = { adId: insight.adId, adName: insight.adName, metrics: emptyMetrics() };
      adset.ads.set(insight.adId, ad);
    }
    if (insight.adName) ad.adName = insight.adName;
    addSpend(ad.metrics, insight);
  }

  let unattributedLeads = 0;
  for (const lead of input.leads) {
    if (!lead.metaCampaignId) {
      unattributedLeads += 1;
      continue;
    }
    addLead(totals, lead);
    // A lead can name a campaign that has no spend in this range -- clicked
    // last month, converted today. It still belongs in the campaign's row.
    const campaign = campaignOf(lead.metaCampaignId, "");
    addLead(campaign.metrics, lead);
    if (lead.metaAdsetId) {
      const adset = adsetOf(campaign, lead.metaAdsetId);
      addLead(adset.metrics, lead);
      if (lead.metaAdId) {
        let ad = adset.ads.get(lead.metaAdId);
        if (!ad) {
          ad = { adId: lead.metaAdId, adName: "", metrics: emptyMetrics() };
          adset.ads.set(lead.metaAdId, ad);
        }
        addLead(ad.metrics, lead);
      }
    }
  }

  const built: AdsReportCampaign[] = [...campaigns.values()]
    .map((campaign) => ({
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName || campaign.campaignId,
      ...derive(campaign.metrics),
      adsets: [...campaign.adsets.values()]
        .map((adset) => ({
          adsetId: adset.adsetId,
          ...derive(adset.metrics),
          ads: [...adset.ads.values()]
            .map((ad) => ({
              adId: ad.adId,
              adName: ad.adName || ad.adId,
              ...derive(ad.metrics),
            }))
            .sort((a, b) => b.spendCents - a.spendCents),
        }))
        .sort((a, b) => b.spendCents - a.spendCents),
    }))
    .sort((a, b) => b.spendCents - a.spendCents);

  const hasSpend = totals.spendCents > 0;
  const setupState: AdsSetupState = !input.connected
    ? "not_connected"
    : input.insights.length === 0
      ? "no_data"
      : // Spend is arriving but nothing can be costed: the ad URLs are not
        // carrying the labels, so every lead lands as unattributed.
        hasSpend && totals.leads === 0 && unattributedLeads > 0
        ? "missing_url_parameters"
        : "ready";

  return {
    totals: derive(totals),
    campaigns: built,
    setupState,
    // History does not reach the start of what is being asked about, so there
    // is older spend a backfill could still fetch.
    backfillAvailable: Boolean(
      input.connected &&
        (!earliestSpendDate ||
          (input.rangeStart != null && earliestSpendDate > input.rangeStart)),
    ),
    unattributedLeads,
    earliestSpendDate,
  };
}
