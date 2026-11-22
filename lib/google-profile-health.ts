// Google Business Profile health score and attention items.
// Pure and dependency-free so node:test can load it and the browser and the
// cron share one definition of "needs attention".

export type HealthListing = {
  editable: {
    description: string;
    primaryPhone: string;
    website: string;
    primaryCategory: { name: string } | null;
    additionalCategories: unknown[];
    serviceItems: unknown[];
    openStatus: string;
  };
  hasGoogleUpdated: boolean;
  hasPendingEdits: boolean;
  hours: unknown[];
  specialHours: { date: string | null }[];
  mediaAvailable: boolean;
  media: { kind: string | null; category: string | null; createTime: string | null }[];
};

export type HealthReview = {
  reviewId: string;
  reviewerName: string;
  starRating: number;
  createTime: string | null;
  reply: unknown | null;
};

export type HealthReviews = { reviews: HealthReview[]; totalReviewCount: number };

export type HealthFix =
  | { kind: "edit"; section: "about" | "categories" | "contact" | "hours" | "specialHours" | "services" }
  | { kind: "tab"; tab: "photos" | "settings" }
  | { kind: "reviews" };

export type HealthCheck = {
  id: string;
  label: string;
  detail: string;
  status: "pass" | "fail" | "unknown";
  weight: number;
  fix: HealthFix | null;
};

export type HealthResult = { score: number; checks: HealthCheck[]; grade: "Strong" | "Good" | "Needs work" };

const DAY = 86_400_000;

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nthWeekday(year: number, month: number, weekday: number, n: number) {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number) {
  const last = new Date(year, month + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}

/** Major US holidays when local businesses commonly change hours. */
export function usHolidays(year: number) {
  return [
    { name: "New Year's Day", date: new Date(year, 0, 1) },
    { name: "Memorial Day", date: lastWeekday(year, 4, 1) },
    { name: "Independence Day", date: new Date(year, 6, 4) },
    { name: "Labor Day", date: nthWeekday(year, 8, 1, 1) },
    { name: "Thanksgiving", date: nthWeekday(year, 10, 4, 4) },
    { name: "Christmas Day", date: new Date(year, 11, 25) },
  ];
}

/** Holidays in the next `days` days that have no special hours set. */
export function holidaysMissingHours(specialHours: { date: string | null }[], now: Date, days = 45) {
  const set = new Set(specialHours.map((period) => period.date).filter(Boolean));
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + days * DAY);
  return [...usHolidays(now.getFullYear()), ...usHolidays(now.getFullYear() + 1)]
    .filter((holiday) => holiday.date >= start && holiday.date <= end && !set.has(isoDate(holiday.date)));
}

function ageDays(value: string | null, now: Date) {
  if (!value) return Infinity;
  const time = Date.parse(value);
  return Number.isNaN(time) ? Infinity : (now.getTime() - time) / DAY;
}

export function profileHealth(input: {
  listing: HealthListing;
  reviews: HealthReviews | null;
  hasReviewLink: boolean;
  now: Date;
}): HealthResult {
  const { listing, reviews, now } = input;
  const editable = listing.editable;
  const photos = listing.media.filter((item) => item.kind !== "VIDEO");
  const description = editable.description.trim();
  const missingHolidays = holidaysMissingHours(listing.specialHours, now);
  const newestPhotoAge = Math.min(...photos.map((item) => ageDays(item.createTime, now)));
  const replied = reviews?.reviews.filter((review) => review.reply).length ?? 0;
  const loadedReviews = reviews?.reviews.length ?? 0;
  const replyRate = loadedReviews ? replied / loadedReviews : 1;
  const newestReviewAge = Math.min(...(reviews?.reviews ?? []).map((review) => ageDays(review.createTime, now)));
  const media = listing.mediaAvailable ? "known" : "unknown";
  const check = (
    id: string, label: string, pass: boolean, detail: string, weight: number, fix: HealthFix | null, known = true,
  ): HealthCheck => ({ id, label, detail, status: !known ? "unknown" : pass ? "pass" : "fail", weight, fix });

  const checks: HealthCheck[] = [
    check("description", "Description of 250+ characters", description.length >= 250,
      description ? `${description.length} characters. Describe services, areas served and what makes the business different.` : "No description yet.",
      12, { kind: "edit", section: "about" }),
    check("hours", "Opening hours set", listing.hours.length > 0, "Customers and Google's \"open now\" filter rely on hours.", 12, { kind: "edit", section: "hours" }),
    check("primaryCategory", "Primary category set", Boolean(editable.primaryCategory), "The primary category is the strongest relevance signal on the profile.", 8, { kind: "edit", section: "categories" }),
    check("additionalCategories", "Additional categories", editable.additionalCategories.length > 0, "Add every category that genuinely matches a service offered.", 4, { kind: "edit", section: "categories" }),
    check("phone", "Phone number", Boolean(editable.primaryPhone.trim()), "A listed phone number powers the Call button.", 8, { kind: "edit", section: "contact" }),
    check("website", "Website link", Boolean(editable.website.trim()), "A website link sends traffic and adds trust.", 6, { kind: "edit", section: "contact" }),
    check("holidays", "Holiday hours for upcoming holidays", missingHolidays.length === 0 || listing.hours.length === 0,
      missingHolidays.length ? `${missingHolidays.map((holiday) => `${holiday.name} (${holiday.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`).join(", ")} ${missingHolidays.length === 1 ? "has" : "have"} no holiday hours. Google may show "hours might differ".` : "Upcoming holidays are covered.",
      5, { kind: "edit", section: "specialHours" }),
    check("services", "At least 3 services listed", editable.serviceItems.length >= 3, `${editable.serviceItems.length} listed. Services help the profile match specific searches.`, 7, { kind: "edit", section: "services" }),
    check("photos", "10 or more photos", photos.length >= 10, `${photos.length} ${photos.length === 1 ? "photo" : "photos"} on Google.`, 8, { kind: "tab", tab: "photos" }, media === "known"),
    check("cover", "Cover photo", photos.some((item) => item.category === "COVER"), "The cover is the first image customers see.", 4, { kind: "tab", tab: "photos" }, media === "known"),
    check("logo", "Logo", photos.some((item) => item.category === "PROFILE" || item.category === "LOGO"), "A logo makes the profile recognizable in results.", 4, { kind: "tab", tab: "photos" }, media === "known"),
    check("freshPhotos", "New photo in the last 30 days", newestPhotoAge <= 30,
      Number.isFinite(newestPhotoAge) ? `Last photo added ${Math.floor(newestPhotoAge)} days ago.` : "No photos yet.",
      4, { kind: "tab", tab: "photos" }, media === "known"),
    check("replies", "Replies to 90% of reviews", replyRate >= 0.9,
      loadedReviews ? `${replied} of ${loadedReviews} recent reviews have a reply.` : "No reviews to reply to yet.",
      8, { kind: "reviews" }, Boolean(reviews)),
    check("recentReview", "New review in the last 30 days", newestReviewAge <= 30,
      Number.isFinite(newestReviewAge) ? `Last review ${Math.floor(newestReviewAge)} days ago. Steady new reviews help rankings.` : "No reviews yet. Send review requests to recent customers.",
      6, { kind: "reviews" }, Boolean(reviews)),
    check("reviewLink", "Review link saved", input.hasReviewLink, "Review requests need the official Google review link.", 4, { kind: "tab", tab: "settings" }),
  ];

  const known = checks.filter((item) => item.status !== "unknown");
  const possible = known.reduce((sum, item) => sum + item.weight, 0);
  const earned = known.filter((item) => item.status === "pass").reduce((sum, item) => sum + item.weight, 0);
  const score = possible ? Math.round((earned / possible) * 100) : 0;
  return { score, checks, grade: score >= 85 ? "Strong" : score >= 65 ? "Good" : "Needs work" };
}

export type ProfileAlert = {
  id: string;
  tone: "critical" | "warning" | "info";
  title: string;
  detail: string;
  action: "google" | "reviews" | "edit" | null;
  reviewId?: string;
};

/** Things that need a person now, used by the Overview banner and push alerts. */
export function profileAlerts(input: {
  listing: Pick<HealthListing, "hasGoogleUpdated" | "hasPendingEdits"> & { editable: { openStatus: string } };
  reviews: HealthReviews | null;
  now: Date;
}): ProfileAlert[] {
  const alerts: ProfileAlert[] = [];
  if (input.listing.hasGoogleUpdated) {
    alerts.push({ id: "google-updated", tone: "critical", title: "Google changed this profile", detail: "Google applied or suggested edits (often hours, phone or category). Review them in Google Business Profile so wrong info doesn't stay live.", action: "google" });
  }
  if (input.listing.editable.openStatus === "CLOSED_TEMPORARILY") {
    alerts.push({ id: "temporarily-closed", tone: "warning", title: "Marked temporarily closed", detail: "Google shows this business as closed and ranks it lower. Change the status once it reopens.", action: "edit" });
  }
  if (input.listing.hasPendingEdits) {
    alerts.push({ id: "pending-edits", tone: "info", title: "Edits under review", detail: "Google is reviewing recent changes. They go live once approved.", action: null });
  }
  for (const review of input.reviews?.reviews ?? []) {
    if (review.reply) continue;
    const age = ageDays(review.createTime, input.now);
    if (review.starRating <= 2 && age <= 30) {
      alerts.push({ id: `low-${review.reviewId}`, tone: "critical", title: `${review.starRating}-star review from ${review.reviewerName}`, detail: "A quick, calm public reply shows future customers the business cares.", action: "reviews", reviewId: review.reviewId });
    } else if (age >= 2 && age <= 30) {
      alerts.push({ id: `unanswered-${review.reviewId}`, tone: "warning", title: `${review.reviewerName}'s review has no reply`, detail: `Posted ${Math.floor(age)} days ago. Replying helps rankings and trust.`, action: "reviews", reviewId: review.reviewId });
    }
  }
  const order = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.tone] - order[b.tone]);
}

export type GoogleProfilePushAlert = { eventKey: string; title: string; body: string; url: string };

function weekKey(now: Date) {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  return monday.toISOString().slice(0, 10);
}

/**
 * Push alerts for one business. Event keys are stable so the delivery ledger
 * sends each one once: a review alerts once ever, and a Google edit re-alerts
 * at most weekly while it stays unresolved.
 */
export function googleProfilePushAlerts(input: {
  clientId: string;
  businessName: string;
  hasGoogleUpdated: boolean;
  reviews: HealthReview[];
  now: Date;
}): GoogleProfilePushAlert[] {
  const alerts: GoogleProfilePushAlert[] = [];
  const business = input.businessName.trim().slice(0, 80) || "Your business";
  if (input.hasGoogleUpdated) {
    alerts.push({
      eventKey: `gbp:${input.clientId}:google-updated:${weekKey(input.now)}`,
      title: "Google changed your profile",
      body: `Google edited or suggested changes to ${business}. Check hours, phone and category.`,
      url: "/dashboard?view=profiles",
    });
  }
  for (const review of input.reviews) {
    if (review.reply) continue;
    const age = ageDays(review.createTime, input.now);
    // Older reviews are left to the in-app list so a first run cannot flood a phone.
    if (age > 7) continue;
    const name = review.reviewerName.trim().slice(0, 60) || "A customer";
    if (review.starRating <= 2) {
      alerts.push({
        eventKey: `review:${review.reviewId}:low`,
        title: `New ${review.starRating}-star review`,
        body: `${name} left a ${review.starRating}-star review for ${business}. A calm, quick reply helps.`,
        url: "/dashboard?view=reviews",
      });
    } else if (age >= 2) {
      alerts.push({
        eventKey: `review:${review.reviewId}:unanswered`,
        title: "Review waiting for a reply",
        body: `${name}'s review of ${business} has had no reply for ${Math.floor(age)} days.`,
        url: "/dashboard?view=reviews",
      });
    }
  }
  return alerts.slice(0, 5);
}
