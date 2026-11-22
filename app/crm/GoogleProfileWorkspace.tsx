"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Eye,
  Film,
  Globe,
  Image as ImageIcon,
  MessageSquare,
  Navigation,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
  CalendarCheck,
} from "lucide-react";
import type { CrmGoogleProfile } from "../../db/crm";
import type {
  GoogleBusinessPerformance,
  GoogleBusinessReviewsPage,
  GooglePerformanceDay,
  GooglePerformanceTotals,
  getGoogleBusinessListing,
} from "../../lib/google-business";

export type LiveListing = Awaited<ReturnType<typeof getGoogleBusinessListing>>;
type Editable = LiveListing["editable"];
type Mutate = (input: Record<string, unknown>, success: string) => Promise<unknown>;

async function readJson<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${path}?${new URLSearchParams(params)}`, { signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Request failed.");
  return payload.data as T;
}

/** Loads the live Google listing (and reviews, when allowed) for one business. */
export function useGoogleListing(clientId: string, connected: boolean, canReadReviews: boolean) {
  const [listing, setListing] = useState<LiveListing | null>(null);
  const [reviews, setReviews] = useState<GoogleBusinessReviewsPage | null>(null);
  const [listingStatus, setListingStatus] = useState("Loading listing from Google…");
  const [reviewStatus, setReviewStatus] = useState("Loading Google reviews…");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    void readJson<LiveListing>("/api/integrations/google/listing", { clientId }, controller.signal)
      .then((data) => { if (!controller.signal.aborted) { setListing(data); setListingStatus(""); } })
      .catch(() => { if (!controller.signal.aborted) setListingStatus("Google listing data is unavailable."); });
    if (canReadReviews) {
      void readJson<GoogleBusinessReviewsPage>("/api/reviews", { clientId }, controller.signal)
        .then((data) => { if (!controller.signal.aborted) { setReviews(data); setReviewStatus(""); } })
        .catch(() => { if (!controller.signal.aborted) setReviewStatus("Google reviews are unavailable."); });
    }
    return () => controller.abort();
  }, [canReadReviews, clientId, connected, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { listing, reviews, listingStatus, reviewStatus, reload };
}

/* ───────────────────────────── Performance ───────────────────────────── */

type MetricKey = "views" | "calls" | "website" | "directions" | "messages" | "bookings";

const METRICS: { key: MetricKey; label: string; icon: ReactNode; hint: string }[] = [
  { key: "views", label: "Profile views", icon: <Eye size={16} aria-hidden="true" />, hint: "Times the profile was shown on Search and Maps" },
  { key: "calls", label: "Calls", icon: <Phone size={16} aria-hidden="true" />, hint: "Taps on the Call button" },
  { key: "website", label: "Website clicks", icon: <Globe size={16} aria-hidden="true" />, hint: "Clicks through to the website" },
  { key: "directions", label: "Directions", icon: <Navigation size={16} aria-hidden="true" />, hint: "Direction requests" },
  { key: "messages", label: "Messages", icon: <MessageSquare size={16} aria-hidden="true" />, hint: "Message conversations started" },
  { key: "bookings", label: "Bookings", icon: <CalendarCheck size={16} aria-hidden="true" />, hint: "Bookings made from the profile" },
];

function dayValue(day: GooglePerformanceDay, key: MetricKey) {
  return key === "views" ? day.searchMobile + day.searchDesktop + day.mapsMobile + day.mapsDesktop : day[key];
}

function totalValue(totals: GooglePerformanceTotals, key: MetricKey) {
  return totals[key];
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function formatShortDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Change({ current, previous }: { current: number; previous: number }) {
  if (!previous && !current) return <span className="gbw-change is-flat">No activity</span>;
  if (!previous) return <span className="gbw-change is-up"><ArrowUpRight size={14} aria-hidden="true" /> New</span>;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return <span className="gbw-change is-flat">Same as before</span>;
  const up = percent > 0;
  return (
    <span className={`gbw-change ${up ? "is-up" : "is-down"}`}>
      {up ? <ArrowUpRight size={14} aria-hidden="true" /> : <ArrowDownRight size={14} aria-hidden="true" />}
      {Math.abs(percent)}% <span className="gbw-change-label">vs previous</span>
    </span>
  );
}

export function GooglePerformancePanel({ clientId }: { clientId: string }) {
  const [range, setRange] = useState(28);
  const [metric, setMetric] = useState<MetricKey>("views");
  const [hover, setHover] = useState<number | null>(null);
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  const [version, setVersion] = useState(0);
  const requestKey = `${clientId}:${range}:${version}`;
  const [result, setResult] = useState<{ key: string; data: GoogleBusinessPerformance | null; error: string }>({ key: "", data: null, error: "" });
  const loading = result.key !== requestKey;
  const error = loading ? "" : result.error;
  // Keep the previous range's numbers on screen while the next range loads.
  const data = result.data;

  useEffect(() => {
    const controller = new AbortController();
    void readJson<GoogleBusinessPerformance>("/api/integrations/google/performance", { clientId, days: String(range) }, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setResult({ key: requestKey, data: next, error: "" }); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, data: null, error: reason instanceof Error ? reason.message : "Google performance data could not be loaded." });
      });
    return () => controller.abort();
  }, [clientId, range, requestKey]);

  const visibleMetrics = METRICS.filter((item) =>
    !data || item.key === "views" || item.key === "calls" || item.key === "website" || item.key === "directions" ||
    totalValue(data.totals, item.key) > 0 || totalValue(data.previousTotals, item.key) > 0);
  const series = useMemo(() => data?.days.map((day) => ({ date: day.date, value: dayValue(day, metric) })) ?? [], [data, metric]);
  const max = Math.max(1, ...series.map((point) => point.value));
  const niceMax = max <= 5 ? max : Math.ceil(max / 5) * 5;
  const activeMetric = METRICS.find((item) => item.key === metric) ?? METRICS[0];
  const hovered = hover != null ? series[hover] : null;
  const sources = data ? [
    { label: "Google Search · mobile", value: data.totals.searchMobile },
    { label: "Google Search · desktop", value: data.totals.searchDesktop },
    { label: "Google Maps · mobile", value: data.totals.mapsMobile },
    { label: "Google Maps · desktop", value: data.totals.mapsDesktop },
  ] : [];
  const sourceMax = Math.max(1, ...sources.map((item) => item.value));
  const keywords = data?.keywords ?? [];

  return (
    <section className="crm-panel gbw-performance" aria-labelledby="gbw-performance-title">
      <header className="gbw-panel-head">
        <div>
          <h3 id="gbw-performance-title">Performance</h3>
          <p>{data ? `${formatShortDate(data.startDate)} – ${formatShortDate(data.endDate)} · compared with the ${range} days before` : "How customers find and contact this business on Google."}</p>
        </div>
        <div className="gbw-segmented" role="group" aria-label="Date range">
          {[7, 28, 90, 180].map((days) => (
            <button key={days} type="button" aria-pressed={range === days} className={range === days ? "active" : ""} onClick={() => setRange(days)}>
              {days === 180 ? "6 months" : `${days} days`}
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <div className="gbw-callout" role="alert">
          <strong>Performance data isn&apos;t available</strong>
          <p>{error}</p>
          {error.includes("businessprofileperformance") ? (
            <p>In Google Cloud Console, open <b>APIs &amp; Services → Library</b>, enable <b>Business Profile Performance API</b> for the BrizBuilder project, then retry.</p>
          ) : null}
          <button className="crm-button-secondary" type="button" onClick={() => setVersion((value) => value + 1)}>Retry</button>
        </div>
      ) : null}

      {!error ? (
        <>
          <div className="gbw-kpis" aria-busy={loading}>
            {visibleMetrics.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`gbw-kpi${metric === item.key ? " is-active" : ""}`}
                aria-pressed={metric === item.key}
                title={item.hint}
                onClick={() => { setMetric(item.key); setHover(null); }}
              >
                <span className="gbw-kpi-label">{item.icon}{item.label}</span>
                <strong>{data ? formatCount(totalValue(data.totals, item.key)) : "—"}</strong>
                {data ? <Change current={totalValue(data.totals, item.key)} previous={totalValue(data.previousTotals, item.key)} /> : <span className="gbw-change is-flat">Loading…</span>}
              </button>
            ))}
          </div>

          <div className="gbw-chart-card">
            <div className="gbw-chart-head">
              <h4>{activeMetric.label} per day</h4>
              <span>{hovered ? `${formatShortDate(hovered.date)}: ${formatCount(hovered.value)}` : activeMetric.hint}</span>
            </div>
            <div className="gbw-chart" role="img" aria-label={`${activeMetric.label} per day. Total ${data ? formatCount(totalValue(data.totals, metric)) : "loading"}.`} onMouseLeave={() => setHover(null)}>
              <div className="gbw-chart-axis" aria-hidden="true">
                <span>{formatCount(niceMax)}</span>
                <span>{formatCount(Math.round(niceMax / 2))}</span>
                <span>0</span>
              </div>
              <div className="gbw-chart-plot">
                <div className="gbw-chart-grid" aria-hidden="true"><i /><i /><i /></div>
                <div className="gbw-chart-bars" style={{ gap: series.length > 60 ? 1 : 2 }}>
                  {series.map((point, index) => (
                    <div
                      key={point.date}
                      className={`gbw-col-slot${hover === index ? " is-hover" : ""}`}
                      onMouseEnter={() => setHover(index)}
                    >
                      <span className="gbw-col" style={{ height: `${(point.value / niceMax) * 100}%` }} />
                    </div>
                  ))}
                </div>
                {hovered && hover != null ? (
                  <div className="gbw-tooltip" style={{ left: `${((hover + 0.5) / series.length) * 100}%` }}>
                    <span>{formatShortDate(hovered.date)}</span>
                    <strong>{formatCount(hovered.value)}</strong>
                  </div>
                ) : null}
              </div>
            </div>
            {series.length ? (
              <div className="gbw-chart-x" aria-hidden="true">
                <span>{formatShortDate(series[0].date)}</span>
                <span>{formatShortDate(series[Math.floor(series.length / 2)].date)}</span>
                <span>{formatShortDate(series[series.length - 1].date)}</span>
              </div>
            ) : null}
            {series.length ? (
              <details className="gbw-table-toggle">
                <summary>Show daily numbers</summary>
                <table className="gbw-table">
                  <thead><tr><th scope="col">Date</th><th scope="col">{activeMetric.label}</th></tr></thead>
                  <tbody>
                    {[...series].reverse().map((point) => (
                      <tr key={point.date}><td>{formatShortDate(point.date)}</td><td>{formatCount(point.value)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}
          </div>

          <div className="gbw-split">
            <div className="gbw-sub-card">
              <h4>How customers found the profile</h4>
              <p className="gbw-sub">Profile views by platform and device</p>
              <ul className="gbw-sources">
                {sources.map((source) => (
                  <li key={source.label}>
                    <div><span>{source.label}</span><strong>{formatCount(source.value)}</strong></div>
                    <span className="gbw-meter"><span style={{ width: `${(source.value / sourceMax) * 100}%` }} /></span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="gbw-sub-card">
              <h4>Searches that showed the profile</h4>
              <p className="gbw-sub">{data ? `Monthly search terms, ${data.keywordRange.start} to ${data.keywordRange.end}` : "Search terms customers used"}</p>
              {data && !data.keywordsAvailable ? <p className="gbw-empty">Google didn&apos;t return search terms for this range.</p> : null}
              {data?.keywordsAvailable && !keywords.length ? <p className="gbw-empty">Not enough searches yet. Google shows terms once enough people use them.</p> : null}
              {keywords.length ? (
                <>
                  <table className="gbw-table gbw-keywords">
                    <thead><tr><th scope="col">Search term</th><th scope="col">Searches</th></tr></thead>
                    <tbody>
                      {keywords.slice(0, showAllKeywords ? 50 : 8).map((row) => (
                        <tr key={row.keyword}>
                          <td>{row.keyword}</td>
                          <td>{row.value != null ? formatCount(row.value) : `< ${row.threshold ?? 15}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {keywords.length > 8 ? (
                    <button className="gbw-link-button" type="button" onClick={() => setShowAllKeywords((value) => !value)}>
                      {showAllKeywords ? "Show fewer" : `Show all ${keywords.length}`}
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

/* ───────────────────────────── Edit profile ───────────────────────────── */

const EDIT_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
type EditDay = typeof EDIT_DAYS[number];
type DayHours = { open: boolean; allDay: boolean; ranges: { openTime: string; closeTime: string }[] };

function dayLabel(day: string) {
  return day.charAt(0) + day.slice(1).toLowerCase();
}

function to12h(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const normalized = hours % 24;
  return `${normalized % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${normalized < 12 ? "AM" : "PM"}`;
}

function hoursFromListing(listing: LiveListing): Record<EditDay, DayHours> {
  const result = Object.fromEntries(EDIT_DAYS.map((day): [EditDay, DayHours] => [day, { open: false, allDay: false, ranges: [] }])) as Record<EditDay, DayHours>;
  for (const period of listing.hours) {
    const day = period.openDay as EditDay;
    if (!result[day]) continue;
    const openTime = period.openTime ?? "00:00";
    const closeTime = period.closeTime ?? "00:00";
    result[day].open = true;
    if (openTime === "00:00" && (closeTime === "24:00" || (period.closeDay !== period.openDay && closeTime === "00:00"))) {
      result[day].allDay = true;
    } else {
      result[day].ranges.push({ openTime, closeTime: closeTime === "24:00" ? "00:00" : closeTime });
    }
  }
  for (const day of EDIT_DAYS) {
    result[day].ranges.sort((a, b) => a.openTime.localeCompare(b.openTime));
    if (result[day].open && !result[day].allDay && !result[day].ranges.length) result[day].ranges.push({ openTime: "09:00", closeTime: "17:00" });
  }
  return result;
}

function hoursSummary(listing: LiveListing) {
  const hours = hoursFromListing(listing);
  const open = EDIT_DAYS.filter((day) => hours[day].open);
  if (!open.length) return "No hours set";
  return EDIT_DAYS.map((day) => {
    const value = hours[day];
    const text = !value.open ? "Closed" : value.allDay ? "Open 24 hours" : value.ranges.map((range) => `${to12h(range.openTime)}–${to12h(range.closeTime)}`).join(", ");
    return `${dayLabel(day).slice(0, 3)} ${text}`;
  }).join(" · ");
}

function EditRow({ id, title, summary, open, onToggle, canManage, children }: {
  id: string;
  title: string;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  canManage: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`gbw-edit-row${open ? " is-open" : ""}`}>
      <div className="gbw-edit-row-head">
        <div>
          <h4 id={`${id}-title`}>{title}</h4>
          {!open ? <div className="gbw-edit-summary">{summary}</div> : null}
        </div>
        {canManage ? (
          <button type="button" className="gbw-icon-button" onClick={onToggle} aria-expanded={open} aria-controls={id} aria-label={open ? `Close ${title}` : `Edit ${title}`}>
            {open ? <X size={18} aria-hidden="true" /> : <Pencil size={16} aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      {open ? <div id={id} className="gbw-edit-body">{children}</div> : null}
    </div>
  );
}

function SaveBar({ saving, error, note, onCancel }: { saving: boolean; error: string; note?: string; onCancel: () => void }) {
  return (
    <>
      {note ? <p className="gbw-note">{note}</p> : null}
      {error ? <p className="gbw-error" role="alert">{error}</p> : null}
      <div className="gbw-save-bar">
        <button type="button" className="crm-button-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="crm-button-primary" disabled={saving}>{saving ? "Saving to Google…" : "Save"}</button>
      </div>
    </>
  );
}

function CategoryPicker({ clientId, regionCode, onPick, placeholder }: {
  clientId: string;
  regionCode: string;
  onPick: (category: { name: string; displayName: string }) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ term: string; results: { name: string; displayName: string }[]; error: boolean }>({ term: "", results: [], error: false });
  const term = query.trim();
  const searching = term.length >= 2 && found.term !== term;
  const results = term.length >= 2 && found.term === term ? found.results : [];
  const status = term.length < 2 ? "" : searching ? "Searching…" : found.error ? "Categories could not be loaded." : results.length ? "" : "No matching Google categories.";

  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void readJson<{ name: string; displayName: string }[]>("/api/integrations/google/categories", { clientId, q: term, region: regionCode }, controller.signal)
        .then((data) => setFound({ term, results: data, error: false }))
        .catch(() => { if (!controller.signal.aborted) setFound({ term, results: [], error: true }); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [clientId, term, regionCode]);

  return (
    <div className="gbw-category-picker">
      <label className="gbw-search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">{placeholder}</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} />
      </label>
      {status ? <p className="gbw-hint">{status}</p> : null}
      {results.length ? (
        <ul className="gbw-category-results">
          {results.map((category) => (
            <li key={category.name}>
              <button type="button" onClick={() => { onPick(category); setQuery(""); }}>{category.displayName}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function GoogleProfileEditor({ clientId, profile, listing, canManage, mutate, onSaved }: {
  clientId: string;
  profile: CrmGoogleProfile | null;
  listing: LiveListing | null;
  canManage: boolean;
  mutate: Mutate;
  onSaved: () => void;
}) {
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!listing) return <section className="crm-panel gbw-edit"><p className="gbw-empty">Loading the profile from Google…</p></section>;
  if (!listing.detailsAvailable) return <section className="crm-panel gbw-edit"><p className="gbw-empty">Google didn&apos;t return the profile details. Reload to try again.</p></section>;
  const editable = listing.editable;

  function toggle(section: string) {
    setError("");
    setOpenSection((current) => current === section ? null : section);
  }

  async function save(section: string, payload: Record<string, unknown>, label: string) {
    if (!canManage || saving) return;
    setSaving(true);
    setError("");
    try {
      await mutate({ action: "update_google_location", clientId, locationId: profile?.locationId, section, ...payload }, `${label} saved to Google`);
      setOpenSection(null);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Google could not save this change.");
    } finally {
      setSaving(false);
    }
  }

  const rowProps = (section: string) => ({ open: openSection === section, onToggle: () => toggle(section), canManage });
  const saveBar = (note?: string) => <SaveBar saving={saving} error={error} note={note} onCancel={() => toggle(openSection ?? "")} />;
  const address = editable.address;
  const addressText = [...address.addressLines, [address.locality, [address.administrativeArea, address.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  const upcomingSpecial = listing.specialHours.filter((period) => period.date && period.date >= new Date().toISOString().slice(0, 10));

  return (
    <section className="crm-panel gbw-edit" aria-labelledby="gbw-edit-title">
      <header className="gbw-panel-head">
        <div>
          <h3 id="gbw-edit-title">Business information</h3>
          <p>Changes publish to Google. Most appear within minutes; some are reviewed by Google first.</p>
        </div>
        <a className="crm-button-secondary" href="https://business.google.com/locations" target="_blank" rel="noreferrer">Open in Google</a>
      </header>
      {listing.hasPendingEdits ? <p className="gbw-banner">Google is reviewing recent edits. They&apos;ll appear here once approved.</p> : null}
      {listing.hasGoogleUpdated ? <p className="gbw-banner is-warn">Google suggested changes to this profile. Review them in Google Business Profile so they don&apos;t overwrite your info.</p> : null}

      <EditRow id="gbw-about" title="Name, description and status" {...rowProps("about")} summary={
        <>
          <strong>{editable.title || "No name"}</strong>
          <span className={editable.openStatus === "OPEN" ? "" : "is-warn"}>{editable.openStatus === "OPEN" ? "Open" : editable.openStatus === "CLOSED_TEMPORARILY" ? "Temporarily closed" : "Permanently closed"}</span>
          <p className="gbw-clamp">{editable.description || "No description"}</p>
        </>
      }>
        <AboutForm editable={editable} onSubmit={(payload) => void save("about", payload, "Business info")} saveBar={saveBar("Changing the business name can send the profile to Google for review.")} />
      </EditRow>

      <EditRow id="gbw-categories" title="Categories" {...rowProps("categories")} summary={
        <>
          <strong>{editable.primaryCategory?.displayName ?? "No primary category"}</strong>
          {editable.additionalCategories.length ? <span>{editable.additionalCategories.map((category) => category.displayName).join(", ")}</span> : null}
        </>
      }>
        <CategoriesForm clientId={clientId} editable={editable} onSubmit={(payload) => void save("categories", payload, "Categories")} saveBar={saveBar()} />
      </EditRow>

      <EditRow id="gbw-contact" title="Phone and website" {...rowProps("contact")} summary={
        <>
          <strong>{editable.primaryPhone || "No phone"}</strong>
          {editable.additionalPhones.length ? <span>Also {editable.additionalPhones.join(", ")}</span> : null}
          <span>{editable.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "") || "No website"}</span>
        </>
      }>
        <ContactForm editable={editable} onSubmit={(payload) => void save("contact", payload, "Contact info")} saveBar={saveBar()} />
      </EditRow>

      <EditRow id="gbw-address" title="Address and service area" {...rowProps("address")} summary={
        <>
          <strong>{addressText || "Address hidden (service-area business)"}</strong>
          {listing.serviceAreas.length ? <span>Serves {listing.serviceAreas.join(", ")}</span> : null}
        </>
      }>
        <AddressForm editable={editable} serviceAreas={listing.serviceAreas} onSubmit={(payload) => void save("address", payload, "Address")} saveBar={saveBar("Address changes may require Google to re-verify the business.")} />
      </EditRow>

      <EditRow id="gbw-hours" title="Opening hours" {...rowProps("hours")} summary={<span>{hoursSummary(listing)}</span>}>
        <HoursForm listing={listing} onSubmit={(payload) => void save("hours", payload, "Hours")} saveBar={saveBar()} />
      </EditRow>

      <EditRow id="gbw-special" title="Holiday and special hours" {...rowProps("specialHours")} summary={
        <span>{upcomingSpecial.length ? upcomingSpecial.slice(0, 4).map((period) => `${formatShortDate(period.date ?? "")} ${period.closed ? "Closed" : `${to12h(period.openTime ?? "00:00")}–${to12h(period.closeTime ?? "00:00")}`}`).join(" · ") : "None scheduled"}</span>
      }>
        <SpecialHoursForm listing={listing} onSubmit={(payload) => void save("specialHours", payload, "Special hours")} saveBar={saveBar()} />
      </EditRow>

      <EditRow id="gbw-services" title="Services" {...rowProps("services")} summary={
        <span>{editable.serviceItems.length ? editable.serviceItems.slice(0, 8).map((item) => item.label).join(", ") + (editable.serviceItems.length > 8 ? ` +${editable.serviceItems.length - 8} more` : "") : "No services listed"}</span>
      }>
        <ServicesForm editable={editable} onSubmit={(payload) => void save("services", payload, "Services")} saveBar={saveBar()} />
      </EditRow>

      <footer className="gbw-edit-footer">
        Attributes (like &ldquo;Online estimates&rdquo;), products and posts are managed in{" "}
        <a href="https://business.google.com/locations" target="_blank" rel="noreferrer">Google Business Profile</a>.
      </footer>
    </section>
  );
}

type FormProps = { onSubmit: (payload: Record<string, unknown>) => void; saveBar: ReactNode };

function AboutForm({ editable, onSubmit, saveBar }: FormProps & { editable: Editable }) {
  const [description, setDescription] = useState(editable.description);
  return (
    <form className="gbw-form" onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      onSubmit({ title: String(form.get("title") ?? ""), description, openStatus: String(form.get("openStatus") ?? "OPEN") });
    }}>
      <label className="gbw-field"><span>Business name</span><input name="title" defaultValue={editable.title} maxLength={100} required /></label>
      <label className="gbw-field">
        <span>Description</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={750} rows={6} />
        <small>{description.length}/750 · No links or promotional offers — Google removes them.</small>
      </label>
      <fieldset className="gbw-field">
        <legend>Business status</legend>
        <div className="gbw-radio-row">
          <label><input type="radio" name="openStatus" value="OPEN" defaultChecked={editable.openStatus !== "CLOSED_TEMPORARILY"} /> Open</label>
          <label><input type="radio" name="openStatus" value="CLOSED_TEMPORARILY" defaultChecked={editable.openStatus === "CLOSED_TEMPORARILY"} /> Temporarily closed</label>
        </div>
      </fieldset>
      {saveBar}
    </form>
  );
}

function CategoriesForm({ clientId, editable, onSubmit, saveBar }: FormProps & { clientId: string; editable: Editable }) {
  const [primary, setPrimary] = useState(editable.primaryCategory);
  const [additional, setAdditional] = useState(editable.additionalCategories);
  return (
    <form className="gbw-form" onSubmit={(event) => {
      event.preventDefault();
      if (!primary) return;
      onSubmit({ primaryCategory: primary.name, additionalCategories: additional.map((category) => category.name) });
    }}>
      <div className="gbw-field">
        <span>Primary category</span>
        {primary ? <div className="gbw-chip is-primary">{primary.displayName}</div> : <p className="gbw-hint">Choose the category that best describes the business.</p>}
        <CategoryPicker clientId={clientId} regionCode={editable.address.regionCode} placeholder="Search to change the primary category" onPick={(category) => {
          setPrimary(category);
          setAdditional((current) => current.filter((item) => item.name !== category.name));
        }} />
      </div>
      <div className="gbw-field">
        <span>Additional categories ({additional.length}/9)</span>
        <div className="gbw-chips">
          {additional.map((category) => (
            <span key={category.name} className="gbw-chip">
              {category.displayName}
              <button type="button" aria-label={`Remove ${category.displayName}`} onClick={() => setAdditional((current) => current.filter((item) => item.name !== category.name))}><X size={14} /></button>
            </span>
          ))}
          {!additional.length ? <span className="gbw-hint">None</span> : null}
        </div>
        {additional.length < 9 ? (
          <CategoryPicker clientId={clientId} regionCode={editable.address.regionCode} placeholder="Search to add a category" onPick={(category) => {
            if (category.name === primary?.name) return;
            setAdditional((current) => current.some((item) => item.name === category.name) ? current : [...current, category]);
          }} />
        ) : null}
      </div>
      {saveBar}
    </form>
  );
}

function ContactForm({ editable, onSubmit, saveBar }: FormProps & { editable: Editable }) {
  const [extra, setExtra] = useState<string[]>(editable.additionalPhones);
  return (
    <form className="gbw-form" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      onSubmit({ primaryPhone: String(form.get("primaryPhone") ?? ""), additionalPhones: extra.map((phone) => phone.trim()).filter(Boolean), website: String(form.get("website") ?? "") });
    }}>
      <label className="gbw-field"><span>Primary phone</span><input name="primaryPhone" type="tel" defaultValue={editable.primaryPhone} maxLength={30} placeholder="(951) 555-0123" /></label>
      {extra.map((phone, index) => (
        <div className="gbw-field" key={index}>
          <span>Additional phone {index + 1}</span>
          <div className="gbw-inline">
            <input type="tel" value={phone} maxLength={30} onChange={(event) => setExtra((current) => current.map((value, position) => position === index ? event.target.value : value))} aria-label={`Additional phone ${index + 1}`} />
            <button type="button" className="gbw-icon-button" aria-label={`Remove additional phone ${index + 1}`} onClick={() => setExtra((current) => current.filter((_, position) => position !== index))}><Trash2 size={16} /></button>
          </div>
        </div>
      ))}
      {extra.length < 2 ? <button type="button" className="gbw-link-button" onClick={() => setExtra((current) => [...current, ""])}><Plus size={14} aria-hidden="true" /> Add phone number</button> : null}
      <label className="gbw-field"><span>Website</span><input name="website" type="url" defaultValue={editable.website} maxLength={2048} placeholder="https://" /></label>
      {saveBar}
    </form>
  );
}

function AddressForm({ editable, serviceAreas, onSubmit, saveBar }: FormProps & { editable: Editable; serviceAreas: string[] }) {
  const address = editable.address;
  return (
    <form className="gbw-form" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      onSubmit({
        addressLines: [form.get("line1"), form.get("line2")].map((value) => String(value ?? "")),
        locality: String(form.get("locality") ?? ""),
        administrativeArea: String(form.get("administrativeArea") ?? ""),
        postalCode: String(form.get("postalCode") ?? ""),
        regionCode: String(form.get("regionCode") ?? "US"),
      });
    }}>
      {!editable.hasStorefront ? <p className="gbw-note">This is a service-area business with no public address. Adding an address makes it visible to customers on Google.</p> : null}
      <label className="gbw-field"><span>Street address</span><input name="line1" defaultValue={address.addressLines[0] ?? ""} maxLength={120} required /></label>
      <label className="gbw-field"><span>Suite, unit (optional)</span><input name="line2" defaultValue={address.addressLines[1] ?? ""} maxLength={120} /></label>
      <div className="gbw-grid-3">
        <label className="gbw-field"><span>City</span><input name="locality" defaultValue={address.locality} maxLength={80} required /></label>
        <label className="gbw-field"><span>State</span><input name="administrativeArea" defaultValue={address.administrativeArea} maxLength={80} required /></label>
        <label className="gbw-field"><span>ZIP code</span><input name="postalCode" defaultValue={address.postalCode} maxLength={20} required /></label>
      </div>
      <label className="gbw-field gbw-narrow"><span>Country code</span><input name="regionCode" defaultValue={address.regionCode} maxLength={2} required /></label>
      <div className="gbw-field">
        <span>Service area</span>
        <p className="gbw-hint">{serviceAreas.length ? serviceAreas.join(", ") : "No service area set."} Service areas are edited in{" "}
          <a href="https://business.google.com/locations" target="_blank" rel="noreferrer">Google Business Profile</a>.</p>
      </div>
      {saveBar}
    </form>
  );
}

function HoursForm({ listing, onSubmit, saveBar }: FormProps & { listing: LiveListing }) {
  const [hours, setHours] = useState(() => hoursFromListing(listing));
  const update = (day: EditDay, next: Partial<DayHours>) => setHours((current) => ({ ...current, [day]: { ...current[day], ...next } }));

  return (
    <form className="gbw-form" onSubmit={(event) => {
      event.preventDefault();
      const periods = EDIT_DAYS.flatMap((day) => {
        const value = hours[day];
        if (!value.open) return [];
        if (value.allDay) return [{ day, openTime: "00:00", closeTime: "24:00" }];
        return value.ranges.map((range) => ({ day, openTime: range.openTime, closeTime: range.closeTime === "00:00" ? "24:00" : range.closeTime }));
      });
      onSubmit({ periods });
    }}>
      <div className="gbw-hours">
        {EDIT_DAYS.map((day) => {
          const value = hours[day];
          return (
            <div className="gbw-hours-row" key={day}>
              <span className="gbw-hours-day">{dayLabel(day)}</span>
              <label className="gbw-switch">
                <input type="checkbox" checked={value.open} onChange={(event) => update(day, { open: event.target.checked, ranges: value.ranges.length ? value.ranges : [{ openTime: "09:00", closeTime: "17:00" }] })} />
                <span>{value.open ? "Open" : "Closed"}</span>
              </label>
              {value.open ? (
                <div className="gbw-hours-ranges">
                  <label className="gbw-check"><input type="checkbox" checked={value.allDay} onChange={(event) => update(day, { allDay: event.target.checked })} /> 24 hours</label>
                  {!value.allDay ? value.ranges.map((range, index) => (
                    <div className="gbw-range" key={index}>
                      <input type="time" value={range.openTime} aria-label={`${dayLabel(day)} opens`} required onChange={(event) => update(day, { ranges: value.ranges.map((item, position) => position === index ? { ...item, openTime: event.target.value } : item) })} />
                      <span>–</span>
                      <input type="time" value={range.closeTime} aria-label={`${dayLabel(day)} closes`} required onChange={(event) => update(day, { ranges: value.ranges.map((item, position) => position === index ? { ...item, closeTime: event.target.value } : item) })} />
                      {value.ranges.length > 1 ? (
                        <button type="button" className="gbw-icon-button" aria-label="Remove these hours" onClick={() => update(day, { ranges: value.ranges.filter((_, position) => position !== index) })}><X size={15} /></button>
                      ) : null}
                    </div>
                  )) : null}
                  {!value.allDay && value.ranges.length < 4 ? (
                    <button type="button" className="gbw-link-button" onClick={() => update(day, { ranges: [...value.ranges, { openTime: "13:00", closeTime: "17:00" }] })}><Plus size={14} aria-hidden="true" /> Add hours</button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <button type="button" className="gbw-link-button" onClick={() => setHours((current) => {
        const monday = current.MONDAY;
        return Object.fromEntries(EDIT_DAYS.map((day) => [day, ["SATURDAY", "SUNDAY"].includes(day) ? current[day] : { ...monday, ranges: monday.ranges.map((range) => ({ ...range })) }])) as Record<EditDay, DayHours>;
      })}>Copy Monday to all weekdays</button>
      {saveBar}
    </form>
  );
}

function SpecialHoursForm({ listing, onSubmit, saveBar }: FormProps & { listing: LiveListing }) {
  const today = new Date().toISOString().slice(0, 10);
  const [periods, setPeriods] = useState(() => listing.specialHours
    .filter((period) => period.date && period.date >= today)
    .map((period) => ({ date: period.date ?? today, closed: period.closed, openTime: period.openTime ?? "09:00", closeTime: period.closeTime === "24:00" ? "00:00" : period.closeTime ?? "17:00" })));
  const update = (index: number, next: Partial<typeof periods[number]>) => setPeriods((current) => current.map((item, position) => position === index ? { ...item, ...next } : item));

  return (
    <form className="gbw-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit({ periods: periods.map((period) => ({ ...period, closeTime: period.closeTime === "00:00" ? "24:00" : period.closeTime })) });
    }}>
      {!periods.length ? <p className="gbw-hint">No upcoming special hours. Add holidays or one-off changes so customers don&apos;t show up to a closed door.</p> : null}
      {periods.map((period, index) => (
        <div className="gbw-special-row" key={index}>
          <input type="date" value={period.date} min={today} required aria-label="Date" onChange={(event) => update(index, { date: event.target.value })} />
          <label className="gbw-check"><input type="checkbox" checked={period.closed} onChange={(event) => update(index, { closed: event.target.checked })} /> Closed all day</label>
          {!period.closed ? (
            <div className="gbw-range">
              <input type="time" value={period.openTime} required aria-label="Opens" onChange={(event) => update(index, { openTime: event.target.value })} />
              <span>–</span>
              <input type="time" value={period.closeTime} required aria-label="Closes" onChange={(event) => update(index, { closeTime: event.target.value })} />
            </div>
          ) : null}
          <button type="button" className="gbw-icon-button" aria-label="Remove this date" onClick={() => setPeriods((current) => current.filter((_, position) => position !== index))}><Trash2 size={16} /></button>
        </div>
      ))}
      <button type="button" className="gbw-link-button" onClick={() => setPeriods((current) => [...current, { date: today, closed: true, openTime: "09:00", closeTime: "17:00" }])}><Plus size={14} aria-hidden="true" /> Add a date</button>
      {saveBar}
    </form>
  );
}

function ServicesForm({ editable, onSubmit, saveBar }: FormProps & { editable: Editable }) {
  const [items, setItems] = useState(editable.serviceItems);
  const [draft, setDraft] = useState("");
  const category = editable.primaryCategory?.name ?? "";
  return (
    <form className="gbw-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ items }); }}>
      <ul className="gbw-services">
        {items.map((item, index) => (
          <li key={`${item.kind}-${item.serviceTypeId || item.label}-${index}`}>
            <div>
              <strong>{item.label}</strong>
              {item.kind === "free" ? (
                <input value={item.description} maxLength={300} placeholder="Short description (optional)" aria-label={`${item.label} description`} onChange={(event) => setItems((current) => current.map((value, position) => position === index ? { ...value, description: event.target.value } : value))} />
              ) : <small>Suggested by Google</small>}
            </div>
            <button type="button" className="gbw-icon-button" aria-label={`Remove ${item.label}`} onClick={() => setItems((current) => current.filter((_, position) => position !== index))}><Trash2 size={16} /></button>
          </li>
        ))}
        {!items.length ? <li className="gbw-hint">No services yet.</li> : null}
      </ul>
      {category ? (
        <div className="gbw-inline">
          <input value={draft} maxLength={140} placeholder="Add a custom service, like Termite inspection" aria-label="New service" onChange={(event) => setDraft(event.target.value)} />
          <button type="button" className="crm-button-secondary" disabled={!draft.trim()} onClick={() => {
            setItems((current) => [...current, { kind: "free", serviceTypeId: "", label: draft.trim(), description: "", category }]);
            setDraft("");
          }}>Add</button>
        </div>
      ) : <p className="gbw-hint">Set a primary category before adding services.</p>}
      {saveBar}
    </form>
  );
}

/* ───────────────────────────── Photos ───────────────────────────── */

const MEDIA_CATEGORY_LABELS: Record<string, string> = {
  COVER: "Cover",
  PROFILE: "Logo",
  LOGO: "Logo",
  EXTERIOR: "Exterior",
  INTERIOR: "Interior",
  PRODUCT: "Products",
  AT_WORK: "At work",
  TEAMS: "Team",
  ADDITIONAL: "Other",
};
const UPLOAD_CATEGORIES = ["ADDITIONAL", "AT_WORK", "TEAMS", "EXTERIOR", "INTERIOR", "PRODUCT", "COVER", "PROFILE"] as const;

function httpsOnly(value: string | null | undefined) {
  return value && /^https:\/\//i.test(value) ? value : undefined;
}

export function GooglePhotosPanel({ clientId, listing, canManage, onChanged }: {
  clientId: string;
  listing: LiveListing | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<string>("ADDITIONAL");
  const [filter, setFilter] = useState("ALL");
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<{ name: string; state: "uploading" | "done" | "error"; message?: string }[]>([]);
  const [deleting, setDeleting] = useState("");
  const [notice, setNotice] = useState("");
  const media = listing?.media ?? [];
  const counts = media.reduce<Record<string, number>>((result, item) => {
    const key = item.kind === "VIDEO" ? "VIDEO" : item.category ?? "ADDITIONAL";
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
  const filters = ["ALL", ...Object.keys(counts)];
  const visible = media.filter((item) => filter === "ALL" || (filter === "VIDEO" ? item.kind === "VIDEO" : item.kind !== "VIDEO" && (item.category ?? "ADDITIONAL") === filter));
  const uploading = queue.some((item) => item.state === "uploading");

  async function upload(files: FileList | File[]) {
    if (!canManage || uploading) return;
    const list = Array.from(files).slice(0, 10);
    if (!list.length) return;
    setNotice("");
    setQueue(list.map((file) => ({ name: file.name, state: "uploading" })));
    let succeeded = 0;
    for (const [index, file] of list.entries()) {
      const body = new FormData();
      body.set("clientId", clientId);
      body.set("category", file.type.startsWith("video/") && ["COVER", "PROFILE"].includes(category) ? "ADDITIONAL" : category);
      body.set("file", file);
      try {
        const response = await fetch("/api/integrations/google/media", { method: "POST", body });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Upload failed.");
        succeeded += 1;
        setQueue((current) => current.map((item, position) => position === index ? { ...item, state: "done" } : item));
      } catch (error) {
        setQueue((current) => current.map((item, position) => position === index ? { ...item, state: "error", message: error instanceof Error ? error.message : "Upload failed." } : item));
      }
    }
    if (succeeded) {
      setNotice(`${succeeded} ${succeeded === 1 ? "file" : "files"} sent to Google. New photos can take a little while to appear publicly.`);
      onChanged();
    }
  }

  async function remove(name: string | null) {
    if (!name || !canManage || !window.confirm("Remove this photo from the Google Business Profile? Customers will no longer see it.")) return;
    setDeleting(name);
    setNotice("");
    try {
      const response = await fetch(`/api/integrations/google/media?${new URLSearchParams({ clientId, name })}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Google could not remove it.");
      setNotice("Removed from Google.");
      onChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Google could not remove it.");
    } finally {
      setDeleting("");
    }
  }

  return (
    <section className="crm-panel gbw-photos" aria-labelledby="gbw-photos-title">
      <header className="gbw-panel-head">
        <div>
          <h3 id="gbw-photos-title">Photos and videos</h3>
          <p>{media.length} on Google{listing?.hasMoreMedia ? "+ (showing the latest 60)" : ""}. Uploads publish straight to the profile.</p>
        </div>
      </header>

      {canManage ? (
        <div
          className={`gbw-dropzone${dragging ? " is-dragging" : ""}`}
          onDragEnter={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()}
          onDragLeave={(event: DragEvent<HTMLDivElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
          onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files); }}
        >
          <span className="gbw-dropzone-icon" aria-hidden="true"><Upload size={22} /></span>
          <div>
            <strong>Drop photos or videos to publish on Google</strong>
            <small>JPG or PNG up to 5 MB (at least 720 × 720 px recommended) · MP4 or MOV up to 30 MB, 30 seconds</small>
          </div>
          <label className="gbw-select">
            <span className="sr-only">Photo type</span>
            <select value={category} onChange={(event: ChangeEvent<HTMLSelectElement>) => setCategory(event.target.value)}>
              {UPLOAD_CATEGORIES.map((value) => <option key={value} value={value}>{value === "PROFILE" ? "Logo" : value === "ADDITIONAL" ? "Other" : MEDIA_CATEGORY_LABELS[value]}</option>)}
            </select>
          </label>
          <button className="crm-button-primary" type="button" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? "Uploading…" : "Choose files"}
          </button>
          <input ref={inputRef} className="gbw-file-input" type="file" accept="image/jpeg,image/png,video/mp4,video/quicktime" multiple onChange={(event) => { if (event.target.files) void upload(event.target.files); event.target.value = ""; }} />
        </div>
      ) : null}

      {queue.length ? (
        <ul className="gbw-queue" aria-live="polite">
          {queue.map((item, index) => (
            <li key={`${item.name}-${index}`} className={`is-${item.state}`}>
              <span>{item.name}</span>
              <strong>{item.state === "uploading" ? "Uploading…" : item.state === "done" ? "Published" : item.message}</strong>
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? <p className="gbw-note" role="status">{notice}</p> : null}

      {media.length ? (
        <div className="gbw-segmented gbw-filter" role="group" aria-label="Filter photos">
          {filters.map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
              {value === "ALL" ? `All ${media.length}` : `${value === "VIDEO" ? "Videos" : MEDIA_CATEGORY_LABELS[value] ?? value} ${counts[value]}`}
            </button>
          ))}
        </div>
      ) : null}

      {visible.length ? (
        <div className="gbw-media-grid">
          {visible.map((item, index) => {
            const src = httpsOnly(item.thumbnail) ?? (item.kind === "PHOTO" ? httpsOnly(item.url) : undefined);
            return (
              <article key={item.name ?? index}>
                <a href={httpsOnly(item.url) ?? "#"} target="_blank" rel="noreferrer" className="gbw-media-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Google's media thumbnail */}
                  {src ? <img src={src} alt={item.description ?? ""} loading="lazy" referrerPolicy="no-referrer" /> : <Film aria-hidden="true" />}
                  <span className="gbw-media-tag">{item.kind === "VIDEO" ? "Video" : MEDIA_CATEGORY_LABELS[item.category ?? "ADDITIONAL"] ?? "Other"}</span>
                </a>
                <footer>
                  <small>
                    {item.views != null ? <><Eye size={13} aria-hidden="true" /> {formatCount(item.views)}</> : null}
                    {item.createTime ? <><Clock size={13} aria-hidden="true" /> {new Date(item.createTime).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</> : null}
                  </small>
                  {canManage ? (
                    <button type="button" className="gbw-icon-button" disabled={deleting === item.name} onClick={() => void remove(item.name)} aria-label="Remove from Google"><Trash2 size={16} /></button>
                  ) : null}
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="gbw-empty-state">
          <span aria-hidden="true"><ImageIcon size={24} /></span>
          <strong>{listing ? "No photos on Google yet" : "Loading photos…"}</strong>
          <p>Profiles with photos get more calls and direction requests. Start with a cover photo, logo, and a few shots of the team at work.</p>
        </div>
      )}
    </section>
  );
}
