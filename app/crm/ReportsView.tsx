"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeDollarSign,
  Check,
  Copy,
  Megaphone,
  Minus,
  NotebookPen,
  PieChart,
  Printer,
} from "lucide-react";
import type {
  CrmAppointment,
  CrmClient,
  CrmLead,
  CrmMetaAdInsight,
  CrmPhoneCall,
} from "../../db/crm";
import { BOOKED_STATUSES as AD_BOOKED_STATUSES, buildAdsReport } from "../../lib/meta-ads-report";
import { DAY_MS, timestamp } from "./dashboard-charts";

/*
 * Client reports. On screen the tab is a dashboard for one calendar week or
 * month, every headline number compared with the period before. Printed (or
 * saved as PDF) it becomes a formal report built from the same figures:
 * letterhead, summary, a this-period / last-period table, then the detail.
 * Every figure comes from real CRM records; anything not recorded reads as
 * "—", never zero.
 */

type PeriodKind = "this-week" | "last-week" | "this-month" | "last-month";

const PERIODS: Array<{ id: PeriodKind; label: string }> = [
  { id: "last-month", label: "Last month" },
  { id: "this-month", label: "This month" },
  { id: "last-week", label: "Last week" },
  { id: "this-week", label: "This week" },
];

// "Booked" means the same here as on the Ads tab and the dashboard.
const BOOKED_STATUSES: readonly string[] = AD_BOOKED_STATUSES;
const STATUS_ORDER = ["NEW", "CONTACTED", "QUALIFIED", "APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON", "LOST", "UNRESPONSIVE", "SPAM"];
const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  APPOINTMENT_BOOKED: "Appointment booked",
  ESTIMATE_SENT: "Estimate sent",
  WON: "Won",
  LOST: "Lost",
  SPAM: "Spam",
  UNRESPONSIVE: "No response",
};
// The Dashboard's lead-source colours, so a source reads the same everywhere.
const SOURCE_COLORS = ["#18b65d", "#ff7a2f", "#6947ff", "#4d8fff", "#9ca3af"];

type Period = {
  start: Date;
  /** Exclusive. */
  end: Date;
  label: string;
  /** Short name used in comparisons: "October", "the week before". */
  short: string;
  toDate: boolean;
};

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function startOfWeek(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
  return start;
}

function weekLabel(start: Date, endExclusive: Date) {
  const last = new Date(endExclusive.getTime() - DAY_MS);
  const sameMonth = start.getMonth() === last.getMonth();
  const from = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const to = last.toLocaleDateString("en-US", sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${from} – ${to}, ${last.getFullYear()}`;
}

/** The chosen period and the one before it, in the viewer's local calendar. */
function periods(kind: PeriodKind, now: Date): { current: Period; previous: Period } {
  if (kind === "this-week" || kind === "last-week") {
    const start = startOfWeek(now);
    if (kind === "last-week") start.setDate(start.getDate() - 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 7);
    return {
      current: { start, end, label: weekLabel(start, end), short: kind === "this-week" ? "this week" : "last week", toDate: kind === "this-week" },
      previous: { start: prevStart, end: start, label: weekLabel(prevStart, start), short: "the week before", toDate: false },
    };
  }
  const offset = kind === "last-month" ? -1 : 0;
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() + offset - 1, 1);
  const monthName = (date: Date) => date.toLocaleDateString("en-US", { month: "long" });
  return {
    current: { start, end, label: `${monthName(start)} ${start.getFullYear()}`, short: monthName(start), toDate: kind === "this-month" },
    previous: { start: prevStart, end: start, label: `${monthName(prevStart)} ${prevStart.getFullYear()}`, short: monthName(prevStart), toDate: false },
  };
}

function dollars(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(cents) < 1000 ? 2 : 0,
  }).format(cents / 100);
}

const count = (value: number) => value.toLocaleString();
const plural = (value: number, one: string, many = `${one}s`) => `${count(value)} ${value === 1 ? one : many}`;
const backPerDollar = (roas: number | null) => (roas == null ? "—" : `$${roas.toFixed(2)}`);
const costOrDash = (cents: number | null) => (cents == null ? "—" : dollars(cents));

function isMissedCall(call: CrmPhoneCall) {
  const status = call.status.toLowerCase().replaceAll("_", "-");
  return status.includes("missed") || ["no-answer", "busy", "failed", "canceled", "cancelled"].includes(status);
}

/** Everything the report says about one period. */
function summarize(
  period: Period,
  leads: CrmLead[],
  appointments: CrmAppointment[],
  phoneCalls: CrmPhoneCall[],
  insights: CrmMetaAdInsight[],
) {
  const from = period.start.getTime();
  const to = period.end.getTime();
  const inPeriod = (value: string | null) => {
    const at = timestamp(value);
    return at >= from && at < to;
  };
  const periodLeads = leads.filter((lead) => inPeriod(lead.createdAt));
  const won = periodLeads.filter((lead) => lead.status === "WON");
  const fromKey = dayKey(period.start);
  const toKey = dayKey(period.end);
  const periodInsights = insights.filter((insight) => insight.date >= fromKey && insight.date < toKey);
  const ads = buildAdsReport({
    insights: periodInsights,
    leads: periodLeads.map((lead) => ({
      id: lead.id,
      metaCampaignId: lead.metaCampaignId,
      metaAdsetId: lead.metaAdsetId,
      metaAdId: lead.metaAdId,
      status: lead.status,
      finalRevenueCents: lead.finalRevenueCents,
    })),
    connected: true,
  });
  const inboundCalls = phoneCalls.filter(
    (call) => inPeriod(call.startedAt) && call.direction.toLowerCase() !== "outbound",
  );
  const missedCalls = inboundCalls.filter(isMissedCall).length;
  return {
    leads: periodLeads,
    won,
    leadCount: periodLeads.length,
    booked: periodLeads.filter((lead) => BOOKED_STATUSES.includes(lead.status)).length,
    wonCount: won.length,
    revenueCents: won.reduce((sum, lead) => sum + lead.finalRevenueCents, 0),
    appointments: appointments.filter(
      (appointment) => inPeriod(appointment.startsAt) && !["CANCELED", "CANCELLED"].includes(appointment.status.toUpperCase()),
    ).length,
    calls: inboundCalls.length,
    answeredCalls: inboundCalls.length - missedCalls,
    missedCalls,
    hasSpend: periodInsights.length > 0,
    ads,
  };
}

type Tone = "good" | "bad" | "flat";

/** How a number moved since the period before, in words as well as colour. */
function change(now: number | null, before: number | null, lowerIsBetter = false): { text: string; tone: Tone; up: boolean | null } {
  if (now == null || before == null) return { text: "—", tone: "flat", up: null };
  if (before === 0) return { text: now === 0 ? "No change" : "New", tone: "flat", up: null };
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { text: "No change", tone: "flat", up: null };
  const up = pct > 0;
  return { text: `${up ? "+" : "−"}${Math.abs(pct)}%`, tone: (lowerIsBetter ? !up : up) ? "good" : "bad", up };
}

/** "Up 25% from September", in words, with an arrow and a colour. */
function Change({ now, before, short, lowerIsBetter = false }: { now: number | null; before: number | null; short: string; lowerIsBetter?: boolean }) {
  const moved = change(now, before, lowerIsBetter);
  if (moved.text === "—") return <span className="crm-rpt-change">Nothing to compare yet</span>;
  if (moved.up == null) {
    return (
      <span className="crm-rpt-change">
        <Minus aria-hidden="true" />
        {moved.text === "New" ? `None in ${short}` : `Same as ${short}`}
      </span>
    );
  }
  const Icon = moved.up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`crm-rpt-change is-${moved.tone}`}>
      <Icon aria-hidden="true" />
      {moved.up ? "Up" : "Down"} {moved.text.slice(1)} from {short}
    </span>
  );
}

/** One headline number, as a dashboard card. */
function Kpi({ label, value, note, children }: { label: string; value: string; note?: string; children?: React.ReactNode }) {
  return (
    <article className="crm-panel crm-rpt-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {children ?? <span className="crm-rpt-change">{note}</span>}
    </article>
  );
}

function Panel({ icon: Icon, title, aside, className = "", children }: { icon: typeof PieChart; title: string; aside?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`crm-panel crm-rpt-panel ${className}`}>
      <header>
        <div className="crm-dashboard-widget-heading">
          <Icon aria-hidden="true" />
          <h3>{title}</h3>
        </div>
        {aside ? <small>{aside}</small> : null}
      </header>
      <div className="crm-rpt-body">{children}</div>
    </section>
  );
}

function subscribeNotes(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readNotes(key: string) {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function ReportsView({
  leads,
  clients,
  metaAdInsights,
  appointments,
  phoneCalls,
  selectedClientId,
  organizationName,
}: {
  leads: CrmLead[];
  clients: CrmClient[];
  metaAdInsights: CrmMetaAdInsight[];
  appointments: CrmAppointment[];
  phoneCalls: CrmPhoneCall[];
  selectedClientId: string;
  organizationName: string;
}) {
  const [kind, setKind] = useState<PeriodKind>("last-month");
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  // Read the clock once: a report should not change under the reader.
  const [now] = useState(() => new Date());
  const { current, previous } = useMemo(() => periods(kind, now), [kind, now]);

  const t = useMemo(
    () => summarize(current, leads, appointments, phoneCalls, metaAdInsights),
    [current, leads, appointments, phoneCalls, metaAdInsights],
  );
  const p = useMemo(
    () => summarize(previous, leads, appointments, phoneCalls, metaAdInsights),
    [previous, leads, appointments, phoneCalls, metaAdInsights],
  );

  const client = clients.find((c) => c.id === selectedClientId);
  const allBusinesses = !client && clients.length !== 1;
  const businessName = client?.businessName ?? (clients.length === 1 ? clients[0].businessName : "All businesses");

  // Notes for this business and period, kept in this browser so a half-written
  // report survives a reload. They print with the report.
  const notesKey = `brizbuilder:report-notes:${selectedClientId}:${kind}:${dayKey(current.start)}`;
  const stored = useSyncExternalStore(subscribeNotes, () => readNotes(notesKey), () => "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const notes = drafts[notesKey] ?? stored;
  const saveNotes = (value: string) => {
    setDrafts((existing) => ({ ...existing, [notesKey]: value }));
    try {
      window.localStorage.setItem(notesKey, value);
    } catch {
      // Storage unavailable: the notes still print from this page.
    }
  };

  const adTotals = t.ads.totals;
  const prevAdTotals = p.ads.totals;
  const hasAds = t.hasSpend || adTotals.leads > 0;
  const periodWord = kind.endsWith("week") ? "week" : "month";

  const sources = Object.entries(
    t.leads.reduce<Record<string, { leads: number; won: number; revenue: number }>>((acc, lead) => {
      const key = lead.source.trim() || "Unknown";
      const row = acc[key] ?? { leads: 0, won: 0, revenue: 0 };
      row.leads += 1;
      if (lead.status === "WON") {
        row.won += 1;
        row.revenue += lead.finalRevenueCents;
      }
      acc[key] = row;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1].leads - a[1].leads)
    .map(([name, row], index) => ({ name, ...row, color: SOURCE_COLORS[Math.min(index, SOURCE_COLORS.length - 1)] }));

  const stages = STATUS_ORDER.map((status) => ({
    status,
    count: t.leads.filter((lead) => lead.status === status).length,
  })).filter((stage) => stage.count > 0);

  const wonJobs = [...t.won].sort((a, b) => b.finalRevenueCents - a.finalRevenueCents);
  const generated = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const periodTitle = `${current.label}${current.toDate ? " (so far)" : ""}`;

  // Written to the client, so "you".
  const headline = t.leadCount === 0
    ? `No new leads came in ${kind.endsWith("week") ? current.short : `in ${current.short}`}${current.toDate ? " so far" : ""}.`
    : `${current.toDate ? "So far, you" : "You"} got ${plural(t.leadCount, "new lead")}${t.wonCount ? ` and won ${plural(t.wonCount, "job")} worth ${dollars(t.revenueCents)}` : ""}${adTotals.roas != null ? `. Every $1 spent on ads brought back $${adTotals.roas.toFixed(2)}` : ""}.`;

  // One table drives the printed key results.
  const keyRows: Array<{ label: string; now: string; before: string; moved: ReturnType<typeof change> }> = [
    { label: "New leads", now: count(t.leadCount), before: count(p.leadCount), moved: change(t.leadCount, p.leadCount) },
    { label: "Booked jobs", now: count(t.booked), before: count(p.booked), moved: change(t.booked, p.booked) },
    { label: "Jobs won", now: count(t.wonCount), before: count(p.wonCount), moved: change(t.wonCount, p.wonCount) },
    { label: "Revenue won", now: dollars(t.revenueCents), before: dollars(p.revenueCents), moved: change(t.revenueCents, p.revenueCents) },
    { label: "Appointments", now: count(t.appointments), before: count(p.appointments), moved: change(t.appointments, p.appointments) },
    ...(t.calls || p.calls ? [{ label: "Calls received", now: count(t.calls), before: count(p.calls), moved: change(t.calls, p.calls) }] : []),
    ...(hasAds
      ? [
          { label: "Ad spend", now: dollars(adTotals.spendCents), before: dollars(prevAdTotals.spendCents), moved: change(adTotals.spendCents, prevAdTotals.spendCents) },
          { label: "Leads from ads", now: count(adTotals.leads), before: count(prevAdTotals.leads), moved: change(adTotals.leads, prevAdTotals.leads) },
          { label: "Cost per lead", now: costOrDash(adTotals.costPerLeadCents), before: costOrDash(prevAdTotals.costPerLeadCents), moved: change(adTotals.costPerLeadCents, prevAdTotals.costPerLeadCents, true) },
          { label: "Back per $1 on ads", now: backPerDollar(adTotals.roas), before: backPerDollar(prevAdTotals.roas), moved: change(adTotals.roas, prevAdTotals.roas) },
        ]
      : []),
  ];

  async function copySummary() {
    const lines = [
      `${businessName} — ${periodTitle} report`,
      "",
      headline,
      "",
      ...keyRows.map((row) => `${row.label}: ${row.now} (${previous.short}: ${row.before})`),
      ...(sources.length ? ["", "Where leads came from:", ...sources.slice(0, 5).map((row) => `- ${row.name}: ${row.leads}`)] : []),
      ...(notes.trim() ? ["", notes.trim()] : []),
      "",
      `Prepared by ${organizationName} · ${generated}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied("idle"), 2500);
  }

  return (
    <div className="crm-view crm-dashboard-view crm-report-view crm-rpt-view">
      {/* ===================== Screen: a simple dashboard ===================== */}
      <div className="crm-rpt-screen">
        <section className="crm-page-heading">
          <div>
            <p>CLIENT REPORT</p>
            <h2>Reports</h2>
            <span>{allBusinesses ? "All businesses together" : businessName} · {periodTitle}</span>
          </div>
        </section>

        <section className="crm-rpt-toolbar" aria-label="Report options">
          <div className="crm-rpt-periods" role="group" aria-label="Report period">
            {PERIODS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={kind === option.id}
                className={kind === option.id ? "is-active" : undefined}
                onClick={() => setKind(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="crm-rpt-actions">
            <button type="button" className="crm-button-secondary" onClick={() => void copySummary()}>
              {copied === "done" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy summary"}
            </button>
            <button className="crm-button-secondary" onClick={() => window.print()}>
              <Printer aria-hidden="true" />
              Print / Save PDF
            </button>
          </div>
        </section>

        {allBusinesses ? (
          <p className="crm-rpt-hint">
            This adds up every business. Pick one business in the header to build the report you send them.
          </p>
        ) : null}

        {/* 1. The answer, in one sentence. */}
        <section className="crm-panel crm-rpt-hero">
          <p>{headline}</p>
        </section>

        {/* 2. Four numbers, each with how it moved. */}
        <section className="crm-rpt-kpis" aria-label="Headline numbers">
          <Kpi label="New leads" value={count(t.leadCount)}>
            <Change now={t.leadCount} before={p.leadCount} short={previous.short} />
          </Kpi>
          <Kpi label="Jobs won" value={count(t.wonCount)}>
            <Change now={t.wonCount} before={p.wonCount} short={previous.short} />
          </Kpi>
          <Kpi label="Revenue won" value={dollars(t.revenueCents)}>
            <Change now={t.revenueCents} before={p.revenueCents} short={previous.short} />
          </Kpi>
          <Kpi
            label="Back per $1 on ads"
            value={backPerDollar(adTotals.roas)}
            note={hasAds ? "No ad sales yet" : "No ad data"}
          >
            {adTotals.roas != null ? (
              <Change now={adTotals.roas} before={prevAdTotals.roas} short={previous.short} />
            ) : undefined}
          </Kpi>
        </section>

        {/* 3. Where the leads came from, and the jobs they became. */}
        <div className="crm-rpt-row">
          <Panel icon={PieChart} title="Where leads came from">
            {sources.length ? (
              <ul className="crm-rpt-sources">
                {sources.map((s) => (
                  <li key={s.name}>
                    <i style={{ background: s.color }} aria-hidden="true" />
                    <span>{s.name}</span>
                    <strong>{plural(s.leads, "lead")}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="crm-rpt-empty">No leads came in this {periodWord}.</p>
            )}
          </Panel>

          <Panel icon={BadgeDollarSign} title="Jobs won" aside={wonJobs.length ? dollars(t.revenueCents) : undefined}>
            {wonJobs.length ? (
              <ul className="crm-rpt-jobs">
                {wonJobs.slice(0, 6).map((lead) => (
                  <li key={lead.id}>
                    <span>
                      {lead.firstName} {lead.lastName}
                    </span>
                    <strong>{dollars(lead.finalRevenueCents)}</strong>
                  </li>
                ))}
                {wonJobs.length > 6 ? (
                  <li className="crm-rpt-more">
                    and {plural(wonJobs.length - 6, "more job")} in the printed report
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="crm-rpt-empty">No jobs won from this {periodWord}&apos;s leads yet.</p>
            )}
          </Panel>
        </div>

        {/* 4. Ads, in one line. */}
        {hasAds ? (
          <section className="crm-panel crm-rpt-ads" aria-label="Ads">
            <Megaphone aria-hidden="true" />
            <p>
              <strong>{dollars(adTotals.spendCents)}</strong> spent on ads <ArrowRight aria-hidden="true" />{" "}
              <strong>{plural(adTotals.leads, "lead")}</strong> <ArrowRight aria-hidden="true" />{" "}
              <strong>{dollars(adTotals.revenueCents)}</strong> earned
            </p>
          </section>
        ) : null}

        {/* 5. Notes that print with the report. */}
        <Panel icon={NotebookPen} title="Notes for the client" aside="Prints with the report">
          <textarea
            className="crm-rpt-notes"
            value={notes}
            onChange={(event) => saveNotes(event.target.value)}
            placeholder="What went well, and what you are changing next."
            rows={4}
            aria-label="Notes for this report"
          />
        </Panel>
      </div>

      {/* ===================== Print: a formal report ===================== */}
      <article className="crm-rpt-print" aria-hidden="true">
        <header className="crm-rpt-letterhead">
          <strong>{organizationName}</strong>
          <span>Marketing report</span>
        </header>
        <section className="crm-rpt-title">
          <h1>{businessName}</h1>
          <p>
            {periodTitle} · compared with {previous.label}
          </p>
          <small>Prepared {generated}</small>
        </section>

        <section className="crm-rpt-psection">
          <h2>Summary</h2>
          <p className="crm-rpt-pheadline">{headline}</p>
        </section>

        <section className="crm-rpt-psection">
          <h2>Key results</h2>
          <table className="crm-rpt-ptable">
            <thead>
              <tr>
                <th>Measure</th>
                <th>{current.label}</th>
                <th>{previous.label}</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {keyRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.now}</td>
                  <td>{row.before}</td>
                  <td className={`is-${row.moved.tone}`}>{row.moved.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="crm-rpt-pcols">
          <section className="crm-rpt-psection">
            <h2>Lead sources</h2>
            {sources.length ? (
              <table className="crm-rpt-ptable">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Leads</th>
                    <th>Won</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.name}>
                      <td>{s.name}</td>
                      <td>{count(s.leads)}</td>
                      <td>{count(s.won)}</td>
                      <td>{s.revenue ? dollars(s.revenue) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No leads came in this {periodWord}.</p>
            )}
          </section>
          <section className="crm-rpt-psection">
            <h2>Lead status today</h2>
            {stages.length ? (
              <table className="crm-rpt-ptable">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((stage) => (
                    <tr key={stage.status}>
                      <td>{STATUS_LABELS[stage.status] ?? stage.status}</td>
                      <td>{count(stage.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No leads came in this {periodWord}.</p>
            )}
          </section>
        </div>

        {hasAds && t.ads.campaigns.length ? (
          <section className="crm-rpt-psection">
            <h2>Ad campaigns</h2>
            <table className="crm-rpt-ptable">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Spend</th>
                  <th>Leads</th>
                  <th>Cost per lead</th>
                  <th>Won</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {t.ads.campaigns.map((campaign) => (
                  <tr key={campaign.campaignId}>
                    <td>{campaign.campaignName}</td>
                    <td>{dollars(campaign.spendCents)}</td>
                    <td>{count(campaign.leads)}</td>
                    <td>{costOrDash(campaign.costPerLeadCents)}</td>
                    <td>{count(campaign.won)}</td>
                    <td>{campaign.revenueCents ? dollars(campaign.revenueCents) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td>{dollars(adTotals.spendCents)}</td>
                  <td>{count(adTotals.leads)}</td>
                  <td>{costOrDash(adTotals.costPerLeadCents)}</td>
                  <td>{count(adTotals.won)}</td>
                  <td>{dollars(adTotals.revenueCents)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        ) : null}

        {wonJobs.length ? (
          <section className="crm-rpt-psection">
            <h2>Jobs won</h2>
            <table className="crm-rpt-ptable">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Source</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {wonJobs.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      {lead.firstName} {lead.lastName}
                    </td>
                    <td>{lead.serviceRequested || "—"}</td>
                    <td>{lead.source || "—"}</td>
                    <td>{dollars(lead.finalRevenueCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total</td>
                  <td>{dollars(t.revenueCents)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        ) : null}

        {notes.trim() ? (
          <section className="crm-rpt-psection">
            <h2>Notes and next steps</h2>
            <p className="crm-rpt-pnotes">{notes}</p>
          </section>
        ) : null}

        <footer className="crm-rpt-pfoot">
          <span>
            Counts leads that came in during {periodTitle}, with their status as of {generated}. Ad
            figures come from the connected Meta ad account; revenue is what was recorded on won jobs.
          </span>
          <span>Prepared by {organizationName}</span>
        </footer>
      </article>
    </div>
  );
}
