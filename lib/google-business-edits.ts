// Pure helpers for Google Business Profile edits and performance data.
// No imports, so node:test can load this file directly.

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Google sends TimeOfDay as `{ hours, minutes }` with zero fields omitted. Returns "HH:MM". */
export function googleTimeOfDay(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const time = asRecord(value);
  const hours = Number(time.hours ?? 0);
  const minutes = Number(time.minutes ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function googleDate(value: unknown) {
  const date = asRecord(value);
  const year = Number(date.year);
  const month = Number(date.month);
  const day = Number(date.day);
  if (!year || !month || !day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const PERFORMANCE_METRICS_LIST = () => PERFORMANCE_METRICS;

const PERFORMANCE_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
] as const;
export const GOOGLE_PERFORMANCE_RANGES = [7, 28, 90, 180] as const;

export type GooglePerformanceDay = {
  date: string;
  searchMobile: number;
  searchDesktop: number;
  mapsMobile: number;
  mapsDesktop: number;
  calls: number;
  website: number;
  directions: number;
  messages: number;
  bookings: number;
};

export type GooglePerformanceTotals = Omit<GooglePerformanceDay, "date"> & { views: number };

export type GoogleBusinessPerformance = {
  startDate: string;
  endDate: string;
  days: GooglePerformanceDay[];
  totals: GooglePerformanceTotals;
  previousTotals: GooglePerformanceTotals;
  keywords: { keyword: string; value: number | null; threshold: number | null }[];
  keywordsAvailable: boolean;
  keywordRange: { start: string; end: string };
};

const METRIC_FIELD: Record<typeof PERFORMANCE_METRICS[number], keyof Omit<GooglePerformanceDay, "date">> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "mapsDesktop",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "searchDesktop",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "mapsMobile",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "searchMobile",
  CALL_CLICKS: "calls",
  WEBSITE_CLICKS: "website",
  BUSINESS_DIRECTION_REQUESTS: "directions",
  BUSINESS_CONVERSATIONS: "messages",
  BUSINESS_BOOKINGS: "bookings",
};

export function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function emptyPerformanceDay(date: string): GooglePerformanceDay {
  return { date, searchMobile: 0, searchDesktop: 0, mapsMobile: 0, mapsDesktop: 0, calls: 0, website: 0, directions: 0, messages: 0, bookings: 0 };
}

export function sumGooglePerformance(days: GooglePerformanceDay[]): GooglePerformanceTotals {
  const totals = { ...emptyPerformanceDay(""), views: 0 } as GooglePerformanceTotals & { date?: string };
  delete totals.date;
  for (const day of days) {
    for (const key of Object.values(METRIC_FIELD)) totals[key] += day[key];
  }
  totals.views = totals.searchMobile + totals.searchDesktop + totals.mapsMobile + totals.mapsDesktop;
  return totals;
}


/** Turns Google's daily series (covering two periods) and keyword payload into dashboard data. */
export function buildGooglePerformance(
  seriesPayload: UnknownRecord,
  keywordPayload: UnknownRecord | null,
  start: Date,
  end: Date,
  days: number,
  keywordRange: { start: string; end: string },
): GoogleBusinessPerformance {
  const byDate = new Map<string, GooglePerformanceDay>();
  for (let time = start.getTime(); time <= end.getTime(); time += 86_400_000) {
    const key = isoDay(new Date(time));
    byDate.set(key, emptyPerformanceDay(key));
  }
  for (const group of asArray(seriesPayload.multiDailyMetricTimeSeries).map(asRecord)) {
    for (const metricSeries of asArray(group.dailyMetricTimeSeries).map(asRecord)) {
      const field = METRIC_FIELD[String(metricSeries.dailyMetric) as typeof PERFORMANCE_METRICS[number]];
      if (!field) continue;
      for (const point of asArray(asRecord(metricSeries.timeSeries).datedValues).map(asRecord)) {
        const date = googleDate(point.date);
        const day = date ? byDate.get(date) : undefined;
        const value = Number(point.value ?? 0);
        if (day && Number.isFinite(value)) day[field] += value;
      }
    }
  }
  const all = [...byDate.values()];
  const previous = all.slice(0, all.length - days);
  const current = all.slice(-days);

  const keywords = keywordPayload
    ? asArray(keywordPayload.searchKeywordsCounts).map(asRecord).map((row) => {
        const insight = asRecord(row.insightsValue);
        const value = insight.value === undefined ? null : Number(insight.value);
        const threshold = insight.threshold === undefined ? null : Number(insight.threshold);
        return {
          keyword: (asString(row.searchKeyword) ?? "").slice(0, 200),
          value: value != null && Number.isFinite(value) ? value : null,
          threshold: threshold != null && Number.isFinite(threshold) ? threshold : null,
        };
      }).filter((row) => row.keyword)
        .sort((a, b) => (b.value ?? b.threshold ?? 0) - (a.value ?? a.threshold ?? 0))
    : [];

  return {
    startDate: current[0]?.date ?? isoDay(end),
    endDate: isoDay(end),
    days: current,
    totals: sumGooglePerformance(current),
    previousTotals: sumGooglePerformance(previous),
    keywords,
    keywordsAvailable: Boolean(keywordPayload),
    keywordRange,
  };
}

const DAY_NAMES = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
type DayName = typeof DAY_NAMES[number];

export type GoogleLocationUpdate =
  | { section: "about"; title: string; description: string; openStatus: "OPEN" | "CLOSED_TEMPORARILY" }
  | { section: "contact"; primaryPhone: string; additionalPhones: string[]; website: string }
  | { section: "categories"; primaryCategory: string; additionalCategories: string[] }
  | { section: "address"; addressLines: string[]; locality: string; administrativeArea: string; postalCode: string; regionCode: string }
  | { section: "hours"; periods: { day: DayName; openTime: string; closeTime: string }[] }
  | { section: "specialHours"; periods: { date: string; closed: boolean; openTime: string; closeTime: string }[] }
  | { section: "services"; items: { kind: "free" | "structured"; serviceTypeId: string; label: string; description: string; category: string }[] };

function editText(value: unknown, label: string, max: number, required = false) {
  if (value !== undefined && value !== null && typeof value !== "string") throw new Error(`${label} is invalid.`);
  const text = (value ?? "").trim();
  if (required && !text) throw new Error(`${label} is required.`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
}

function editTime(value: unknown, label: string) {
  const text = editText(value, label, 5, true);
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match || Number(match[1]) > 24 || Number(match[2]) > 59 || (Number(match[1]) === 24 && Number(match[2]) !== 0)) {
    throw new Error(`${label} must be a time like 09:00.`);
  }
  return text;
}

function editPhone(value: unknown, label: string, required: boolean) {
  const phone = editText(value, label, 30, required);
  if (phone && !/^\+?[\d\s().-]{7,25}$/.test(phone)) throw new Error(`${label} is not a valid phone number.`);
  return phone;
}

/** Validates an edit coming from the browser before anything is sent to Google. */
export function parseGoogleLocationUpdate(input: Record<string, unknown>): GoogleLocationUpdate {
  const section = input.section;
  if (section === "about") {
    const openStatus = input.openStatus === "CLOSED_TEMPORARILY" ? "CLOSED_TEMPORARILY" : "OPEN";
    return {
      section,
      title: editText(input.title, "Business name", 100, true),
      description: editText(input.description, "Description", 750),
      openStatus,
    };
  }
  if (section === "contact") {
    const extra = Array.isArray(input.additionalPhones) ? input.additionalPhones : [];
    if (extra.length > 2) throw new Error("Google allows up to two additional phone numbers.");
    const website = editText(input.website, "Website", 2048);
    if (website) {
      let url: URL;
      try { url = new URL(website); } catch { throw new Error("Enter a full website address, starting with https://."); }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Enter a valid website address.");
    }
    return {
      section,
      primaryPhone: editPhone(input.primaryPhone, "Primary phone", false),
      additionalPhones: extra.map((phone, index) => editPhone(phone, `Additional phone ${index + 1}`, false)).filter(Boolean),
      website,
    };
  }
  if (section === "categories") {
    const pattern = /^categories\/gcid:[a-z0-9_]{1,120}$/;
    const primaryCategory = editText(input.primaryCategory, "Primary category", 140, true);
    const additional = Array.isArray(input.additionalCategories) ? input.additionalCategories : [];
    if (additional.length > 9) throw new Error("Google allows up to nine additional categories.");
    const additionalCategories = additional.map((value) => editText(value, "Category", 140, true));
    if (![primaryCategory, ...additionalCategories].every((name) => pattern.test(name))) throw new Error("Choose categories from Google's list.");
    return { section, primaryCategory, additionalCategories: [...new Set(additionalCategories)].filter((name) => name !== primaryCategory) };
  }
  if (section === "address") {
    const lines = Array.isArray(input.addressLines) ? input.addressLines : [];
    const addressLines = lines.slice(0, 3).map((line, index) => editText(line, `Address line ${index + 1}`, 120)).filter(Boolean);
    if (!addressLines.length) throw new Error("Street address is required.");
    const regionCode = editText(input.regionCode, "Country", 2, true).toUpperCase();
    if (!/^[A-Z]{2}$/.test(regionCode)) throw new Error("Country must be a two-letter code like US.");
    return {
      section,
      addressLines,
      locality: editText(input.locality, "City", 80, true),
      administrativeArea: editText(input.administrativeArea, "State", 80, true),
      postalCode: editText(input.postalCode, "ZIP code", 20, true),
      regionCode,
    };
  }
  if (section === "hours") {
    const periods = Array.isArray(input.periods) ? input.periods : [];
    if (periods.length > 28) throw new Error("Too many opening hours.");
    return {
      section,
      periods: periods.map((value) => {
        const period = asRecord(value);
        const day = String(period.day ?? "") as DayName;
        if (!DAY_NAMES.includes(day)) throw new Error("Opening hours contain an invalid day.");
        const openTime = editTime(period.openTime, "Opening time");
        const closeTime = editTime(period.closeTime, "Closing time");
        if (openTime === "24:00") throw new Error("Opening time must be before midnight.");
        return { day, openTime, closeTime };
      }),
    };
  }
  if (section === "specialHours") {
    const periods = Array.isArray(input.periods) ? input.periods : [];
    if (periods.length > 60) throw new Error("Too many special hours.");
    return {
      section,
      periods: periods.map((value) => {
        const period = asRecord(value);
        const date = editText(period.date, "Date", 10, true);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error("Special hours need a valid date.");
        const closed = period.closed === true;
        return {
          date,
          closed,
          openTime: closed ? "" : editTime(period.openTime, "Opening time"),
          closeTime: closed ? "" : editTime(period.closeTime, "Closing time"),
        };
      }),
    };
  }
  if (section === "services") {
    const items = Array.isArray(input.items) ? input.items : [];
    if (items.length > 100) throw new Error("Too many services.");
    return {
      section,
      items: items.map((value) => {
        const item = asRecord(value);
        const kind = item.kind === "structured" ? "structured" : "free";
        const serviceTypeId = kind === "structured" ? editText(item.serviceTypeId, "Service", 140, true) : "";
        const category = kind === "free" ? editText(item.category, "Service category", 140, true) : "";
        if (kind === "free" && !/^categories\/gcid:[a-z0-9_]{1,120}$/.test(category)) throw new Error("Choose a category for each service.");
        return {
          kind,
          serviceTypeId,
          label: kind === "free" ? editText(item.label, "Service name", 140, true) : "",
          description: editText(item.description, "Service description", 300),
          category,
        };
      }),
    };
  }
  throw new Error("Choose what to update.");
}

function timeOfDay(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return { hours, minutes };
}

function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Maps a validated edit to Google's Location body and the matching updateMask. */
export function googleLocationPatch(update: GoogleLocationUpdate): { body: UnknownRecord; updateMask: string } {
  switch (update.section) {
    case "about":
      return {
        body: { title: update.title, profile: { description: update.description }, openInfo: { status: update.openStatus } },
        updateMask: "title,profile.description,openInfo.status",
      };
    case "contact":
      return {
        body: { phoneNumbers: { primaryPhone: update.primaryPhone, additionalPhones: update.additionalPhones }, websiteUri: update.website },
        updateMask: "phoneNumbers,websiteUri",
      };
    case "categories":
      return {
        body: { categories: { primaryCategory: { name: update.primaryCategory }, additionalCategories: update.additionalCategories.map((name) => ({ name })) } },
        updateMask: "categories",
      };
    case "address":
      return {
        body: {
          storefrontAddress: {
            regionCode: update.regionCode,
            addressLines: update.addressLines,
            locality: update.locality,
            administrativeArea: update.administrativeArea,
            postalCode: update.postalCode,
          },
        },
        updateMask: "storefrontAddress",
      };
    case "hours":
      return {
        body: {
          regularHours: {
            periods: update.periods.map((period) => {
              const overnight = period.closeTime !== "24:00" && period.closeTime <= period.openTime;
              const closeDay = overnight ? DAY_NAMES[(DAY_NAMES.indexOf(period.day) + 1) % 7] : period.day;
              return { openDay: period.day, openTime: timeOfDay(period.openTime), closeDay, closeTime: timeOfDay(period.closeTime) };
            }),
          },
        },
        updateMask: "regularHours",
      };
    case "specialHours":
      return {
        body: {
          specialHours: {
            specialHourPeriods: update.periods.map((period) => period.closed
              ? { startDate: dateParts(period.date), closed: true }
              : {
                  startDate: dateParts(period.date),
                  openTime: timeOfDay(period.openTime),
                  endDate: dateParts(period.closeTime !== "24:00" && period.closeTime <= period.openTime ? addDays(period.date, 1) : period.date),
                  closeTime: timeOfDay(period.closeTime),
                }),
          },
        },
        updateMask: "specialHours",
      };
    case "services":
      return servicesPatch(update);
  }
}

function servicesPatch(update: Extract<GoogleLocationUpdate, { section: "services" }>) {
  return {
    body: {
      serviceItems: update.items.map((item) => item.kind === "structured"
        ? { structuredServiceItem: { serviceTypeId: item.serviceTypeId, ...(item.description ? { description: item.description } : {}) } }
        : { freeFormServiceItem: { category: item.category, label: { displayName: item.label, languageCode: "en", ...(item.description ? { description: item.description } : {}) } } }),
    },
    updateMask: "serviceItems",
  };
}

