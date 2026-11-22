import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildGooglePerformance,
  googleDate,
  googleLocationPatch,
  googleTimeOfDay,
  parseGoogleLocationUpdate,
} from "../lib/google-business-edits.ts";

test("Google TimeOfDay objects become HH:MM, including omitted zero fields", () => {
  assert.equal(googleTimeOfDay({ hours: 17, minutes: 30 }), "17:30");
  assert.equal(googleTimeOfDay({}), "00:00");
  assert.equal(googleTimeOfDay({ hours: 24 }), "24:00");
  assert.equal(googleTimeOfDay(null), null);
  assert.equal(googleDate({ year: 2026, month: 12, day: 25 }), "2026-12-25");
  assert.equal(googleDate({ year: 2026 }), null);
});

test("hours edits map overnight and 24-hour periods onto Google's format", () => {
  const update = parseGoogleLocationUpdate({
    section: "hours",
    periods: [
      { day: "MONDAY", openTime: "08:00", closeTime: "17:00" },
      { day: "FRIDAY", openTime: "20:00", closeTime: "02:00" },
      { day: "SUNDAY", openTime: "00:00", closeTime: "24:00" },
    ],
  });
  const { body, updateMask } = googleLocationPatch(update);
  assert.equal(updateMask, "regularHours");
  assert.deepEqual(body.regularHours.periods, [
    { openDay: "MONDAY", openTime: { hours: 8, minutes: 0 }, closeDay: "MONDAY", closeTime: { hours: 17, minutes: 0 } },
    { openDay: "FRIDAY", openTime: { hours: 20, minutes: 0 }, closeDay: "SATURDAY", closeTime: { hours: 2, minutes: 0 } },
    { openDay: "SUNDAY", openTime: { hours: 0, minutes: 0 }, closeDay: "SUNDAY", closeTime: { hours: 24, minutes: 0 } },
  ]);
});

test("special hours support closed days and late closes", () => {
  const { body } = googleLocationPatch(parseGoogleLocationUpdate({
    section: "specialHours",
    periods: [
      { date: "2026-12-25", closed: true },
      { date: "2026-12-31", closed: false, openTime: "18:00", closeTime: "01:00" },
    ],
  }));
  assert.deepEqual(body.specialHours.specialHourPeriods[0], { startDate: { year: 2026, month: 12, day: 25 }, closed: true });
  assert.deepEqual(body.specialHours.specialHourPeriods[1].endDate, { year: 2027, month: 1, day: 1 });
});

test("edits are validated before anything is sent to Google", () => {
  assert.throws(() => parseGoogleLocationUpdate({ section: "about", title: "", description: "" }), /Business name is required/);
  assert.throws(() => parseGoogleLocationUpdate({ section: "about", title: "A", description: "x".repeat(751) }), /750/);
  assert.throws(() => parseGoogleLocationUpdate({ section: "contact", primaryPhone: "call me", additionalPhones: [], website: "" }), /phone/);
  assert.throws(() => parseGoogleLocationUpdate({ section: "contact", primaryPhone: "", additionalPhones: ["1", "2", "3"], website: "" }), /two additional/);
  assert.throws(() => parseGoogleLocationUpdate({ section: "contact", primaryPhone: "", website: "javascript:alert(1)" }), /website/i);
  assert.throws(() => parseGoogleLocationUpdate({ section: "categories", primaryCategory: "pest control" }), /Google's list/);
  assert.throws(() => parseGoogleLocationUpdate({ section: "hours", periods: [{ day: "FUNDAY", openTime: "09:00", closeTime: "17:00" }] }), /invalid day/);
  assert.throws(() => parseGoogleLocationUpdate({ section: "hours", periods: [{ day: "MONDAY", openTime: "25:00", closeTime: "17:00" }] }), /time like/);
  assert.throws(() => parseGoogleLocationUpdate({ section: "openInfo" }), /what to update/);
});

test("about edits can mark a business temporarily closed but never permanently closed", () => {
  const permanent = parseGoogleLocationUpdate({ section: "about", title: "Segovia", description: "", openStatus: "CLOSED_PERMANENTLY" });
  assert.equal(permanent.openStatus, "OPEN");
  const { body, updateMask } = googleLocationPatch(parseGoogleLocationUpdate({ section: "about", title: "Segovia", description: "Pest control", openStatus: "CLOSED_TEMPORARILY" }));
  assert.equal(updateMask, "title,profile.description,openInfo.status");
  assert.deepEqual(body.openInfo, { status: "CLOSED_TEMPORARILY" });
});

test("categories and services keep Google's identifiers", () => {
  const categories = googleLocationPatch(parseGoogleLocationUpdate({
    section: "categories",
    primaryCategory: "categories/gcid:pest_control_service",
    additionalCategories: ["categories/gcid:pest_control_service", "categories/gcid:termite_control_service"],
  }));
  assert.deepEqual(categories.body.categories.additionalCategories, [{ name: "categories/gcid:termite_control_service" }]);

  const services = googleLocationPatch(parseGoogleLocationUpdate({
    section: "services",
    items: [
      { kind: "structured", serviceTypeId: "job_type_id:rodent_control", description: "" },
      { kind: "free", label: "Termite inspection", description: "Free estimate", category: "categories/gcid:pest_control_service" },
    ],
  }));
  assert.equal(services.updateMask, "serviceItems");
  assert.deepEqual(services.body.serviceItems[0], { structuredServiceItem: { serviceTypeId: "job_type_id:rodent_control" } });
  assert.equal(services.body.serviceItems[1].freeFormServiceItem.label.displayName, "Termite inspection");
});

test("performance data splits into current and previous periods", () => {
  const start = new Date(Date.UTC(2026, 10, 1));
  const end = new Date(Date.UTC(2026, 10, 14));
  const point = (day, value) => ({ date: { year: 2026, month: 11, day }, value: String(value) });
  const result = buildGooglePerformance(
    {
      multiDailyMetricTimeSeries: [{
        dailyMetricTimeSeries: [
          { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [point(2, 3), point(10, 5), point(14, 1)] } },
          { dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", timeSeries: { datedValues: [point(9, 20), { date: { year: 2026, month: 11, day: 12 } }] } },
          { dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", timeSeries: { datedValues: [point(3, 4), point(13, 6)] } },
        ],
      }],
    },
    { searchKeywordsCounts: [
      { searchKeyword: "pest control hemet", insightsValue: { value: "42" } },
      { searchKeyword: "termite near me", insightsValue: { threshold: "15" } },
    ] },
    start,
    end,
    7,
    { start: "2026-09", end: "2026-11" },
  );
  assert.equal(result.days.length, 7);
  assert.equal(result.startDate, "2026-11-08");
  assert.equal(result.totals.calls, 6);
  assert.equal(result.previousTotals.calls, 3);
  assert.equal(result.totals.views, 26);
  assert.equal(result.previousTotals.views, 4);
  assert.deepEqual(result.keywords.map((row) => row.keyword), ["pest control hemet", "termite near me"]);
  assert.equal(result.keywords[1].threshold, 15);
  assert.equal(result.keywordsAvailable, true);
});

test("media routes only touch media that belongs to the connected location", () => {
  const source = readFileSync(new URL("../lib/google-business.ts", import.meta.url), "utf8");
  assert.match(source, /That photo does not belong to this business/);
  const route = readFileSync(new URL("../app/api/integrations/google/media/route.ts", import.meta.url), "utf8");
  assert.match(route, /sameOrigin\(request\)/);
  const crm = readFileSync(new URL("../db/supabase-crm.ts", import.meta.url), "utf8");
  assert.match(crm, /action === "update_google_location"[\s\S]{0,200}requirePermission\(context, "profiles.manage"\)/);
});

import { googleProfilePushAlerts, holidaysMissingHours, profileAlerts, profileHealth } from "../lib/google-profile-health.ts";

const now = new Date(2026, 10, 22, 12);
const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();
const fullListing = () => ({
  editable: {
    description: "x".repeat(300), primaryPhone: "(760) 851-3652", website: "https://example.com",
    primaryCategory: { name: "categories/gcid:pest_control_service" }, additionalCategories: [{}],
    serviceItems: [{}, {}, {}], openStatus: "OPEN",
  },
  hasGoogleUpdated: false, hasPendingEdits: false,
  hours: [{}],
  specialHours: [{ date: "2026-11-26" }, { date: "2026-12-25" }, { date: "2027-01-01" }],
  mediaAvailable: true,
  media: [
    { kind: "PHOTO", category: "COVER", createTime: daysAgo(3) },
    { kind: "PHOTO", category: "PROFILE", createTime: daysAgo(40) },
    ...Array.from({ length: 8 }, () => ({ kind: "PHOTO", category: "AT_WORK", createTime: daysAgo(60) })),
  ],
});
const goodReviews = { totalReviewCount: 2, reviews: [
  { reviewId: "a", reviewerName: "Ana", starRating: 5, createTime: daysAgo(5), reply: { comment: "Thanks" } },
  { reviewId: "b", reviewerName: "Bo", starRating: 4, createTime: daysAgo(40), reply: { comment: "Thanks" } },
] };

test("a complete profile scores 100 and missing basics cost points", () => {
  const full = profileHealth({ listing: fullListing(), reviews: goodReviews, hasReviewLink: true, now });
  assert.equal(full.score, 100);
  assert.equal(full.grade, "Strong");

  const listing = fullListing();
  listing.editable.description = "Short.";
  listing.hours = [];
  listing.media = [];
  const weak = profileHealth({ listing, reviews: goodReviews, hasReviewLink: false, now });
  const failing = weak.checks.filter((item) => item.status === "fail").map((item) => item.id);
  assert.deepEqual(failing.sort(), ["cover", "description", "freshPhotos", "hours", "logo", "photos", "reviewLink"].sort());
  assert.ok(weak.score < 65);
  assert.deepEqual(weak.checks.find((item) => item.id === "hours").fix, { kind: "edit", section: "hours" });
});

test("checks that could not be loaded do not count against the score", () => {
  const listing = fullListing();
  listing.mediaAvailable = false;
  listing.media = [];
  const result = profileHealth({ listing, reviews: null, hasReviewLink: true, now });
  assert.equal(result.score, 100);
  assert.equal(result.checks.filter((item) => item.status === "unknown").length, 6);
});

test("upcoming holidays without special hours are flagged", () => {
  // 45 days ahead of Nov 22 reaches Thanksgiving, Christmas and New Year's Day.
  assert.deepEqual(holidaysMissingHours([{ date: "2026-12-25" }], now).map((holiday) => holiday.name), ["Thanksgiving", "New Year's Day"]);
  assert.deepEqual(holidaysMissingHours([{ date: "2026-11-26" }, { date: "2026-12-25" }, { date: "2027-01-01" }], now), []);
});

test("alerts surface Google edits and reviews that need a reply", () => {
  const listing = { ...fullListing(), hasGoogleUpdated: true };
  const alerts = profileAlerts({ listing, now, reviews: { totalReviewCount: 3, reviews: [
    { reviewId: "low", reviewerName: "Cy", starRating: 1, createTime: daysAgo(1), reply: null },
    { reviewId: "wait", reviewerName: "Di", starRating: 5, createTime: daysAgo(3), reply: null },
    { reviewId: "fresh", reviewerName: "Ed", starRating: 5, createTime: daysAgo(0.5), reply: null },
  ] } });
  assert.deepEqual(alerts.map((alert) => alert.id), ["google-updated", "low-low", "unanswered-wait"]);
});

test("push alerts use stable keys and skip old reviews", () => {
  const alerts = googleProfilePushAlerts({
    clientId: "client-1", businessName: "Segovia", hasGoogleUpdated: true, now,
    reviews: [
      { reviewId: "low", reviewerName: "Cy", starRating: 2, createTime: daysAgo(1), reply: null },
      { reviewId: "wait", reviewerName: "Di", starRating: 4, createTime: daysAgo(3), reply: null },
      { reviewId: "old", reviewerName: "Fa", starRating: 1, createTime: daysAgo(20), reply: null },
      { reviewId: "done", reviewerName: "Gi", starRating: 1, createTime: daysAgo(1), reply: { comment: "Sorry" } },
    ],
  });
  assert.deepEqual(alerts.map((alert) => alert.eventKey), [
    "gbp:client-1:google-updated:2026-11-16",
    "review:low:low",
    "review:wait:unanswered",
  ]);
  assert.ok(alerts.every((alert) => alert.url.startsWith("/dashboard?view=")));
});

test("the hourly sweep is wired to the cron and respects the notification toggle", () => {
  const worker = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /getUTCMinutes\(\) < 15\)[\s\S]{0,200}sweepGoogleProfileAlerts/);
  const sweep = readFileSync(new URL("../lib/google-profile-alerts.ts", import.meta.url), "utf8");
  assert.match(sweep, /branding\.notifications\.googleProfile/);
});
