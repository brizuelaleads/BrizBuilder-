"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Check, Copy, Minus, Printer } from "lucide-react";
import type {
  CrmAppointment,
  CrmClient,
  CrmLead,
  CrmMetaAdInsight,
  CrmPhoneCall,
} from "../../db/crm";
import { BOOKED_STATUSES as AD_BOOKED_STATUSES, buildAdsReport } from "../../lib/meta-ads-report";
import { timestamp } from "./dashboard-charts";

/*
 * Client report: everything an agency needs to send a business its weekly or
 * monthly results, on one printable page. Calendar periods (not the rolling
 * header range), each compared with the period before. Every figure comes
 * from real CRM records; anything not recorded reads as "—", never zero.
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
  const last = new Date(endExclusive.getTime() - 86_400_000);
  const sameMonth = start.getMonth() === last.getMonth();
  const from = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const to = last.toLocaleDateString("en-US", sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${from} – ${to}, ${last.getFullYear()}`;
}

/** The chosen period and the one before it, in the viewer's local calendar. */
function periods(kind: PeriodKind, now: Date): { current: Period; previous: Period } {
  if (kind === "this-week" || kind === "last-week") {
    const thisWeek = startOfWeek(now);
    const start = new Date(thisWeek);
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

/** "▲ 12% vs October", in words as well as colour. */
function Change({
  now,
  before,
  short,
  lowerIsBetter = false,
}: {
  now: number | null;
  before: number | null;
  short: string;
  lowerIsBetter?: boolean;
}) {
  if (now == null || before == null) return <small className="crm-rpt-change">—</small>;
  if (before === 0) {
    return <small className="crm-rpt-change">{now === 0 ? `Same as ${short}` : `None in ${short}`}</small>;
  }
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) {
    return (
      <small className="crm-rpt-change">
        <Minus aria-hidden="true" /> Same as {short}
      </small>
    );
  }
  const up = change > 0;
  const good = lowerIsBetter ? !up : up;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <small className={`crm-rpt-change ${good ? "is-good" : "is-bad"}`}>
      <Arrow aria-hidden="true" />
      {up ? "Up" : "Down"} {Math.abs(change)}% vs {short}
    </small>
  );
}

function Stat({
  label,
  value,
  note,
  children,
}: {
  label: string;
  value: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <article className="crm-rpt-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <em>{note}</em> : null}
      {children}
    </article>
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

  const thisPeriod = useMemo(
    () => summarize(current, leads, appointments, phoneCalls, metaAdInsights),
    [current, leads, appointments, phoneCalls, metaAdInsights],
  );
  const lastPeriod = useMemo(
    () => summarize(previous, leads, appointments, phoneCalls, metaAdInsights),
    [previous, leads, appointments, phoneCalls, metaAdInsights],
  );

  const client = clients.find((c) => c.id === selectedClientId);
  const allBusinesses = !client;
  const businessName = client?.businessName ?? (clients.length === 1 ? clients[0].businessName : "All businesses");

  // Notes for this business and period, kept in this browser so a half-written
  // report survives a reload. They print with the report.
  const notesKey = `brizbuilder:report-notes:${selectedClientId}:${kind}:${dayKey(current.start)}`;
  // What this browser has stored, read without touching it during the server
  // render; edits made here win over it, so typing works even where storage
  // is unavailable (private windows).
  const stored = useSyncExternalStore(subscribeNotes, () => readNotes(notesKey), () => "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const notes = drafts[notesKey] ?? stored;
  const saveNotes = (value: string) => {
    setDrafts((current) => ({ ...current, [notesKey]: value }));
    try {
      window.localStorage.setItem(notesKey, value);
    } catch {
      // Storage unavailable: the notes still print from this page.
    }
  };

  const t = thisPeriod;
  const p = lastPeriod;
  const adTotals = t.ads.totals;
  const prevAdTotals = p.ads.totals;
  const hasAds = t.hasSpend || adTotals.leads > 0;

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
  ).sort((a, b) => b[1].leads - a[1].leads);

  const stages = STATUS_ORDER.map((status) => ({
    status,
    count: t.leads.filter((lead) => lead.status === status).length,
  })).filter((stage) => stage.count > 0);
  const maxStage = Math.max(1, ...stages.map((stage) => stage.count));

  const wonJobs = [...t.won].sort((a, b) => b.finalRevenueCents - a.finalRevenueCents);
  const generated = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const periodWord = kind.endsWith("week") ? "week" : "month";

  // Written to the client, so "you".
  const headline = t.leadCount === 0
    ? `No new leads came in ${current.toDate ? "so far " : ""}${kind.endsWith("week") ? `${current.short}` : `in ${current.short}`}.`
    : `${current.toDate ? "So far, you" : "You"} got ${plural(t.leadCount, "new lead")}${t.wonCount ? ` and won ${plural(t.wonCount, "job")} worth ${dollars(t.revenueCents)}` : ""}${adTotals.roas != null ? `. Every $1 spent on ads brought back $${adTotals.roas.toFixed(2)}` : ""}.`;

  async function copySummary() {
    const lines = [
      `${businessName} — ${current.label} report${current.toDate ? " (so far)" : ""}`,
      "",
      headline,
      "",
      `Leads: ${count(t.leadCount)} (${p.leadCount} in ${previous.short})`,
      `Booked jobs: ${count(t.booked)}`,
      `Jobs won: ${count(t.wonCount)} · ${dollars(t.revenueCents)}`,
      ...(t.calls ? [`Calls: ${count(t.calls)} (${count(t.answeredCalls)} answered, ${count(t.missedCalls)} missed)`] : []),
      ...(hasAds
        ? [
            `Ad spend: ${dollars(adTotals.spendCents)}`,
            `Cost per lead: ${adTotals.costPerLeadCents == null ? "—" : dollars(adTotals.costPerLeadCents)}`,
            `Back per $1 on ads: ${adTotals.roas == null ? "—" : `$${adTotals.roas.toFixed(2)}`}`,
          ]
        : []),
      ...(sources.length ? ["", "Where leads came from:", ...sources.slice(0, 5).map(([name, row]) => `- ${name}: ${row.leads}`)] : []),
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
    <div className="crm-view crm-report-view crm-rpt-view">
      <section className="crm-page-heading">
        <div>
          <p>CLIENT REPORT</p>
          <h2>Reports</h2>
          <span>A {periodWord}ly report to send {allBusinesses ? "a business" : businessName}. Print it, save it as a PDF, or copy the summary into an email.</span>
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

      {allBusinesses && clients.length > 1 ? (
        <p className="crm-rpt-hint">
          This covers every business together. Pick one business in the header to make the report you send them.
        </p>
      ) : null}

      <article className="crm-rpt-sheet">
        <header className="crm-rpt-head">
          <div>
            <p>Marketing report</p>
            <h3>{businessName}</h3>
            <span>
              {current.label}
              {current.toDate ? " · so far" : ""}
            </span>
          </div>
          <dl>
            <div>
              <dt>Prepared by</dt>
              <dd>{organizationName}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{generated}</dd>
            </div>
          </dl>
        </header>

        <p className="crm-rpt-headline">{headline}</p>

        <section className="crm-rpt-stats" aria-label="Results">
          <Stat label="New leads" value={count(t.leadCount)}>
            <Change now={t.leadCount} before={p.leadCount} short={previous.short} />
          </Stat>
          <Stat label="Booked jobs" value={count(t.booked)}>
            <Change now={t.booked} before={p.booked} short={previous.short} />
          </Stat>
          <Stat label="Jobs won" value={count(t.wonCount)}>
            <Change now={t.wonCount} before={p.wonCount} short={previous.short} />
          </Stat>
          <Stat label="Revenue won" value={dollars(t.revenueCents)}>
            <Change now={t.revenueCents} before={p.revenueCents} short={previous.short} />
          </Stat>
          <Stat label="Ad spend" value={hasAds ? dollars(adTotals.spendCents) : "—"} note={hasAds ? undefined : "No ad data"}>
            {hasAds ? <Change now={adTotals.spendCents} before={prevAdTotals.spendCents} short={previous.short} /> : null}
          </Stat>
          <Stat
            label="Cost per lead"
            value={adTotals.costPerLeadCents == null ? "—" : dollars(adTotals.costPerLeadCents)}
            note={adTotals.costPerLeadCents == null ? (hasAds ? "No ad leads yet" : "No ad data") : "From ads"}
          >
            {adTotals.costPerLeadCents != null ? (
              <Change now={adTotals.costPerLeadCents} before={prevAdTotals.costPerLeadCents} short={previous.short} lowerIsBetter />
            ) : null}
          </Stat>
        </section>

        <div className="crm-rpt-grid">
          <section className="crm-rpt-block">
            <h4>Where leads came from</h4>
            {sources.length ? (
              <table className="crm-rpt-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Leads</th>
                    <th>Won</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map(([name, row]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{count(row.leads)}</td>
                      <td>{count(row.won)}</td>
                      <td>{row.revenue ? dollars(row.revenue) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="crm-rpt-empty">No leads in this {periodWord}.</p>
            )}
          </section>

          <section className="crm-rpt-block">
            <h4>Where those leads are now</h4>
            {stages.length ? (
              <ul className="crm-rpt-stages">
                {stages.map((stage) => (
                  <li key={stage.status}>
                    <span>{STATUS_LABELS[stage.status] ?? stage.status}</span>
                    <i aria-hidden="true">
                      <b style={{ width: `${Math.max(4, (stage.count / maxStage) * 100)}%` }} />
                    </i>
                    <strong>{count(stage.count)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="crm-rpt-empty">No leads in this {periodWord}.</p>
            )}
            <dl className="crm-rpt-mini">
              <div>
                <dt>Appointments</dt>
                <dd>{count(t.appointments)}</dd>
              </div>
              <div>
                <dt>Calls</dt>
                <dd>{t.calls ? count(t.calls) : "—"}</dd>
              </div>
              <div>
                <dt>Missed calls</dt>
                <dd>{t.calls ? count(t.missedCalls) : "—"}</dd>
              </div>
            </dl>
          </section>
        </div>

        {hasAds ? (
          <section className="crm-rpt-block">
            <h4>Ads</h4>
            <dl className="crm-rpt-mini is-wide">
              <div>
                <dt>Spent</dt>
                <dd>{dollars(adTotals.spendCents)}</dd>
              </div>
              <div>
                <dt>Leads from ads</dt>
                <dd>{count(adTotals.leads)}</dd>
              </div>
              <div>
                <dt>Earned from ads</dt>
                <dd>{dollars(adTotals.revenueCents)}</dd>
              </div>
              <div>
                <dt>Back per $1</dt>
                <dd>{adTotals.roas == null ? "—" : `$${adTotals.roas.toFixed(2)}`}</dd>
              </div>
            </dl>
            {t.ads.campaigns.length ? (
              <table className="crm-rpt-table">
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
                      <td>{campaign.costPerLeadCents == null ? "—" : dollars(campaign.costPerLeadCents)}</td>
                      <td>{count(campaign.won)}</td>
                      <td>{campaign.revenueCents ? dollars(campaign.revenueCents) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        ) : null}

        <section className="crm-rpt-block">
          <h4>Jobs won</h4>
          {wonJobs.length ? (
            <ul className="crm-rpt-jobs">
              {wonJobs.map((lead) => (
                <li key={lead.id}>
                  <span>
                    <strong>
                      {lead.firstName} {lead.lastName}
                    </strong>
                    <small>{[lead.serviceRequested, lead.source].filter(Boolean).join(" · ")}</small>
                  </span>
                  <b>{dollars(lead.finalRevenueCents)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="crm-rpt-empty">No jobs won from this {periodWord}&apos;s leads yet.</p>
          )}
        </section>

        <section className={`crm-rpt-block crm-rpt-notes${notes.trim() ? "" : " is-empty"}`}>
          <h4>Notes and next steps</h4>
          <textarea
            value={notes}
            onChange={(event) => saveNotes(event.target.value)}
            placeholder="Add a note for the client: what went well, what you are changing next."
            rows={4}
            aria-label="Notes for this report"
          />
          {notes.trim() ? <p className="crm-rpt-notes-print">{notes}</p> : null}
          <small className="crm-rpt-screen-only">Saved in this browser only. Prints with the report.</small>
        </section>

        <footer className="crm-rpt-foot">
          Counts leads that came in during {current.label}
          {current.toDate ? " so far" : ""}, with their status as of {generated}. Ad figures come
          from the connected Meta ad account; revenue is what was recorded on won jobs.
        </footer>
      </article>
    </div>
  );
}

