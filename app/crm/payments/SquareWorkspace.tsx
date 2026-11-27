"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, ExternalLink, FileText, Plus, RefreshCw, Repeat, Trash2, Trophy } from "lucide-react";
import type { SquareWorkspace as SquareWorkspaceData } from "../../../db/supabase-square";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_INVOICE_LINE_ITEMS,
  invoiceDisplayState,
  isoDay,
  parseMoneyToCents,
  type RecurringFrequency,
} from "../../../lib/square-core";
import { Badge, EmptyState, Field, Modal, dateTime, shortDate } from "../ui";

export type SquareScopeChoice =
  | { kind: "agency"; label: string }
  | { kind: "client"; clientId: string; label: string };

type Line = { key: number; name: string; quantity: string; unitPrice: string };

/** What a new invoice starts from: a won job, an earlier invoice, or nothing. */
type InvoicePreset = {
  source: "blank" | "job" | "repeat" | "plan";
  /** Editing an existing recurring plan. */
  planId?: string;
  /** Start with "Repeats" set to this. */
  repeat?: RecurringFrequency;
  startDate?: string | null;
  dueInDays?: number;
  endAfterCount?: number | null;
  recipientId?: string | null;
  recipientName?: string;
  recipientEmail?: string;
  title?: string;
  message?: string | null;
  lines?: { name: string; quantity: number; unitCents: number }[];
};

type RecurringSubmit = {
  planId: string | null;
  frequency: RecurringFrequency;
  startDate: string;
  dueInDays: number;
  endAfterCount: number | null;
};

type Step = 0 | 1 | 2 | 3;

const REPEAT_OPTIONS: { value: RecurringFrequency; label: string; sentence: string; hint: string }[] = [
  { value: "weekly", label: "Weekly", sentence: "every week", hint: "Same day each week" },
  { value: "biweekly", label: "Every 2 weeks", sentence: "every 2 weeks", hint: "Every other week" },
  { value: "monthly", label: "Monthly", sentence: "every month", hint: "Same date each month" },
  { value: "quarterly", label: "Every 3 months", sentence: "every 3 months", hint: "Four times a year" },
  { value: "yearly", label: "Yearly", sentence: "every year", hint: "Once a year" },
];

function initials(name: string) {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[1][0] : "")).toUpperCase() || "?";
}

const PAY_WITHIN = [
  { value: "0", label: "On receipt" },
  { value: "7", label: "In 7 days" },
  { value: "14", label: "In 14 days" },
  { value: "30", label: "In 30 days" },
];

const DUE_PRESETS = [
  { label: "Today", days: 0 },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
];

function centsInput(cents: number) {
  return cents > 0 ? (cents / 100).toFixed(2) : "";
}

function autoTitle(lines: Line[]) {
  const named = lines.map((line) => line.name.trim()).filter(Boolean);
  if (!named.length) return "";
  const title = named.length > 1 ? `${named[0]} + ${named.length - 1} more` : named[0];
  return title.slice(0, 120);
}

/** A due date is a calendar day, so read it in local time, not as UTC midnight. */
function dayLabel(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year, (month || 1) - 1, date || 1);
  if (Number.isNaN(value.getTime())) return day;
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: year !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

function scopeQuery(scope: SquareScopeChoice) {
  return scope.kind === "agency"
    ? "scope=agency"
    : `scope=client&clientId=${encodeURIComponent(scope.clientId)}`;
}

function scopeBody(scope: SquareScopeChoice) {
  return scope.kind === "agency"
    ? { scope: "agency" }
    : { scope: "client", clientId: scope.clientId };
}

function formatMoney(cents: number, currency: string | null) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
  }
}

export function SquareWorkspace({ scope }: { scope: SquareScopeChoice }) {
  const [data, setData] = useState<SquareWorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [creating, setCreating] = useState<InvoicePreset | null>(null);
  const query = scopeQuery(scope);

  // The parent keys this component by scope, so a new business starts from a
  // clean slate and this only ever loads once per mount.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/square?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          data?: SquareWorkspaceData;
          error?: string;
        };
        if (response.status === 403) return setForbidden(true);
        if (!response.ok || !body.data)
          throw new Error(body.error ?? "Square could not be loaded.");
        setData(body.data);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Square could not be loaded.");
      });
    return () => controller.abort();
  }, [query]);

  const act = useCallback(
    async (input: Record<string, unknown>, done: string, key: string, file?: File | null) => {
      setBusy(key);
      setError("");
      setNotice("");
      try {
        const payload = { ...scopeBody(scope), ...input };
        let response: Response;
        if (file) {
          const form = new FormData();
          form.set("payload", JSON.stringify(payload));
          form.set("contract", file);
          response = await fetch("/api/square", { method: "POST", body: form });
        } else {
          response = await fetch("/api/square", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }
        const body = (await response.json().catch(() => ({}))) as {
          data?: SquareWorkspaceData;
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "That did not work. Try again.");
        if (body.data) setData(body.data);
        setNotice(done);
        return true;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "That did not work. Try again.");
        // A failed send still leaves a row explaining why, so show it.
        fetch(`/api/square?${scopeQuery(scope)}`, { cache: "no-store" })
          .then((response) => (response.ok ? response.json() : null))
          .then((body: { data?: SquareWorkspaceData } | null) => {
            if (body?.data) setData(body.data);
          })
          .catch(() => undefined);
        return false;
      } finally {
        setBusy("");
      }
    },
    [scope],
  );

  if (forbidden)
    return (
      <section className="crm-stripe-owner-gate">
        <strong>Invoices are for owners and managers</strong>
        <p>
          Ask the owner of {scope.label} to open Payments, or to give you a
          manager role.
        </p>
      </section>
    );

  if (!data)
    return error ? (
      <div className="crm-stripe-attention red" role="alert">
        <strong>Square</strong>
        <span>{error}</span>
      </div>
    ) : (
      <section className="crm-panel crm-square-loading" aria-busy="true">
        Loading Square…
      </section>
    );

  const currency = data.connection?.currency ?? "USD";
  const connectHref = `/api/integrations/square/connect?${query}`;
  const today = isoDay(new Date());
  const needsReconnect =
    data.connection?.status === "attention" || data.connection?.status === "revoked";

  return (
    <>
      {error ? (
        <div className="crm-stripe-attention red" role="alert">
          <strong>Square</strong>
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="crm-stripe-attention blue" role="status">
          <strong>Square</strong>
          <span>{notice}</span>
        </div>
      ) : null}

      {!data.configured ? (
        <section className="crm-empty-state">
          <h3>Square is not set up on BrizBuilder yet</h3>
          <p>
            {data.missingSettings.length
              ? `Add these to the BrizBuilder server settings first: ${data.missingSettings.join(", ")}.`
              : "Your BrizBuilder administrator needs to finish the Square setup before a Square account can be connected."}
          </p>
        </section>
      ) : !data.connection || data.connection.status === "revoked" ? (
        <section className="crm-stripe-connect-card crm-simple-connect-card crm-square-card">
          <div className="crm-stripe-connect-copy">
            <span className="crm-provider-logo square">■</span>
            <div>
              <p>SQUARE</p>
              <h3>Connect {scope.label}&apos;s Square account</h3>
              <span>
                Send invoices from BrizBuilder and see which are paid. Square
                collects the money and pays it out to {scope.label} directly.
              </span>
            </div>
          </div>
          <div className="crm-stripe-connect-actions">
            {data.canConnect ? (
              <a className="crm-button-primary" href={connectHref}>
                Connect with Square
              </a>
            ) : (
              <span>Only the business owner can connect Square.</span>
            )}
            <span>
              {data.connection?.status === "revoked"
                ? "Access was removed from inside Square. Connect again to continue."
                : "Sign-in and permission are handled by Square."}
            </span>
          </div>
          {data.environment !== "production" && data.canConnect ? (
            <div className="crm-stripe-mode-note crm-square-sandbox-note" role="note">
              <strong>Square test mode.</strong>
              <span>
                Square&apos;s test sign-in page loads blank unless a Square test
                account is open in this browser. First open one from the{" "}
                <a href="https://developer.squareup.com/apps" target="_blank" rel="noreferrer">
                  Square Developer Console
                </a>{" "}
                (your app, then Sandbox test accounts, then Open in Square
                Dashboard), then click Connect with Square.
              </span>
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <section className="crm-stripe-account-header crm-square-card">
            <div className="crm-stripe-account-title">
              <span className="crm-provider-logo square">■</span>
              <div>
                <p>CONNECTED SQUARE ACCOUNT</p>
                <h3>{data.connection.merchantName ?? "Square account"}</h3>
                <span>
                  {scope.label}
                  {data.connection.locationName ? ` · ${data.connection.locationName}` : ""}
                  {` · ${data.connection.environment === "production" ? "Live" : "Sandbox"}`}
                </span>
              </div>
            </div>
            <div className="crm-stripe-account-actions">
              <Badge tone={needsReconnect ? "red" : "green"}>
                {needsReconnect ? "Action needed" : "Connected"}
              </Badge>
              <button
                type="button"
                disabled={busy === "sync" || needsReconnect}
                onClick={() => void act({ action: "sync" }, "Payment status is up to date.", "sync")}
              >
                <RefreshCw aria-hidden="true" /> {busy === "sync" ? "Checking…" : "Refresh status"}
              </button>
            </div>
          </section>

          {needsReconnect ? (
            <div className="crm-stripe-attention red" role="status">
              <strong>Reconnect Square</strong>
              <span>{data.connection.lastError ?? "Square needs to be connected again."}</span>
              {data.canConnect ? <a href={connectHref}>Reconnect</a> : null}
            </div>
          ) : null}

          {data.connection.environment !== "production" ? (
            <div className="crm-stripe-mode-note" role="note">
              <strong>Square sandbox.</strong>
              <span>
                Invoices here are tests. No real customer is emailed and no
                real money moves.
              </span>
            </div>
          ) : null}

          <section className="crm-stripe-status-grid">
            <article>
              <span>Outstanding</span>
              <strong>{formatMoney(data.totals.outstandingCents, currency)}</strong>
              <small>Sent and not yet paid.</small>
            </article>
            <article>
              <span>Overdue</span>
              <strong>{formatMoney(data.totals.overdueCents, currency)}</strong>
              <small>Past the due date.</small>
            </article>
            <article>
              <span>Paid, last 30 days</span>
              <strong>{formatMoney(data.totals.paidLast30DaysCents, currency)}</strong>
              <small>Collected by Square.</small>
            </article>
            <article>
              <span>Status updates</span>
              <strong>{data.webhookReady ? "Automatic" : "On refresh"}</strong>
              <small>
                {data.webhookReady
                  ? `Last checked ${dateTime(data.connection.lastCheckedAt)}`
                  : "Use Refresh status to check for payments."}
              </small>
            </article>
          </section>

          {data.canInvoice && data.readyToInvoice.length ? (
            <section className="crm-panel crm-square-ready">
              <header>
                <div>
                  <h3>Ready to invoice</h3>
                  <span>
                    Won jobs with no invoice yet. The customer, job and price
                    are filled in for you. Check it and send.
                  </span>
                </div>
                <Badge tone="blue">{data.readyToInvoice.length}</Badge>
              </header>
              <ul>
                {data.readyToInvoice.map((job) => (
                  <li key={job.leadId}>
                    <span className="crm-square-ready-icon" aria-hidden="true">
                      <Trophy />
                    </span>
                    <div className="crm-square-ready-copy">
                      <strong>{job.name || job.email}</strong>
                      <small>
                        {job.service || "Won job"} · Won {shortDate(job.wonAt)}
                      </small>
                    </div>
                    <strong className="crm-square-ready-amount">
                      {job.valueCents ? formatMoney(job.valueCents, currency) : "No price yet"}
                    </strong>
                    <button
                      type="button"
                      className="crm-button-primary"
                      disabled={needsReconnect}
                      onClick={() =>
                        setCreating({
                          source: "job",
                          recipientId: job.recipientId,
                          recipientName: job.name,
                          recipientEmail: job.email,
                          title: job.service,
                          lines: [
                            {
                              name: job.service || "Services",
                              quantity: 1,
                              unitCents: job.valueCents,
                            },
                          ],
                        })
                      }
                    >
                      Review and send
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {data.canInvoice ? (
            <section className="crm-panel crm-square-recurring">
              <header>
                <div>
                  <h3>Recurring clients</h3>
                  <span>
                    Customers billed on a schedule. BrizBuilder sends each
                    invoice through Square on the billing day, around 9 am
                    Eastern.
                  </span>
                </div>
                <button
                  type="button"
                  className="crm-button-secondary"
                  disabled={needsReconnect}
                  onClick={() => setCreating({ source: "blank", repeat: "monthly" })}
                >
                  <Repeat aria-hidden="true" /> Set up recurring
                </button>
              </header>
              {data.recurringPlans.length ? (
                <ul>
                  {data.recurringPlans.map((plan) => {
                    const planBusy = busy === plan.id;
                    const setStatus = (change: "pause" | "resume" | "end", done: string) =>
                      void act({ action: "recurring_status", planId: plan.id, change }, done, plan.id);
                    return (
                      <li key={plan.id} className={plan.status === "paused" ? "is-paused" : undefined}>
                        <div className="crm-square-plan-copy">
                          <strong>{plan.recipientName}</strong>
                          <small>
                            {plan.title} · {plan.scheduleLabel}
                          </small>
                          {plan.lastError ? (
                            <small className="crm-square-row-error">{plan.lastError}</small>
                          ) : null}
                        </div>
                        <div className="crm-square-plan-amount">
                          <strong>{formatMoney(plan.amountCents, currency)}</strong>
                          <small>
                            {plan.invoicesCreated} billed
                            {plan.endAfterCount ? ` of ${plan.endAfterCount}` : ""}
                          </small>
                        </div>
                        <div className="crm-square-plan-next">
                          {plan.status === "paused" ? (
                            <Badge tone="orange">Paused</Badge>
                          ) : (
                            <>
                              <small>Next invoice</small>
                              <strong>{plan.nextRunOn ? dayLabel(plan.nextRunOn) : "—"}</strong>
                            </>
                          )}
                        </div>
                        <div className="crm-square-actions">
                          <button
                            type="button"
                            disabled={planBusy}
                            onClick={() =>
                              setCreating({
                                source: "plan",
                                planId: plan.id,
                                repeat: plan.frequency,
                                recipientId: plan.recipientId,
                                recipientName: plan.recipientName,
                                recipientEmail: plan.recipientEmail,
                                title: plan.title,
                                message: plan.message,
                                lines: plan.lineItems,
                                startDate: plan.nextRunOn,
                                dueInDays: plan.dueInDays,
                                endAfterCount: plan.endAfterCount,
                              })
                            }
                          >
                            Edit
                          </button>
                          {plan.status === "active" ? (
                            <button
                              type="button"
                              disabled={planBusy}
                              onClick={() => setStatus("pause", `Billing for ${plan.recipientName} is paused.`)}
                            >
                              Pause
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={planBusy}
                              onClick={() => setStatus("resume", `Billing for ${plan.recipientName} is back on.`)}
                            >
                              Resume
                            </button>
                          )}
                          <button
                            type="button"
                            className="danger"
                            disabled={planBusy}
                            onClick={() =>
                              window.confirm(
                                `Stop billing ${plan.recipientName}? Invoices already sent are not affected.`,
                              ) && setStatus("end", `Recurring billing for ${plan.recipientName} stopped.`)
                            }
                          >
                            Stop
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="crm-square-recurring-empty">
                  No recurring clients yet. Set one up, or use Bill again on
                  any invoice and choose how often it repeats.
                </p>
              )}
            </section>
          ) : null}

          <section className="crm-panel crm-square-invoices">
            <header>
              <div>
                <h3>Invoices</h3>
                <span>Invoices sent from BrizBuilder through this Square account.</span>
              </div>
              {data.canInvoice ? (
                <button
                  type="button"
                  className="crm-button-primary"
                  disabled={needsReconnect}
                  onClick={() => setCreating({ source: "blank" })}
                >
                  <Plus aria-hidden="true" /> New invoice
                </button>
              ) : null}
            </header>
            {data.invoices.length ? (
              <div className="crm-table-scroll">
                <table className="crm-table crm-square-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Billed to</th>
                      <th>Amount</th>
                      <th>Due</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.invoices.map((invoice) => {
                      const state = invoiceDisplayState(invoice.status, invoice.dueDate, today);
                      const rowBusy = busy === invoice.id;
                      return (
                        <tr key={invoice.id}>
                          <td className="crm-square-cell-invoice">
                            <strong>{invoice.title}</strong>
                            <small>
                              {invoice.invoiceNumber ? `#${invoice.invoiceNumber} · ` : ""}
                              Created {shortDate(invoice.createdAt)}
                              {invoice.recurringPlanId ? (
                                <span className="crm-square-attachment">
                                  <Repeat aria-hidden="true" /> Recurring
                                </span>
                              ) : null}
                              {invoice.attachmentName ? (
                                <span className="crm-square-attachment">
                                  <FileText aria-hidden="true" /> {invoice.attachmentName}
                                </span>
                              ) : null}
                            </small>
                            {invoice.lastError ? (
                              <small className="crm-square-row-error">{invoice.lastError}</small>
                            ) : null}
                          </td>
                          <td className="crm-square-cell-recipient">
                            <strong>{invoice.recipientName}</strong>
                            <small>{invoice.recipientEmail}</small>
                          </td>
                          <td className="crm-square-cell-amount">
                            <strong>{formatMoney(invoice.amountCents, invoice.currency)}</strong>
                            {invoice.paidCents > 0 && invoice.paidCents < invoice.amountCents ? (
                              <small>{formatMoney(invoice.paidCents, invoice.currency)} paid</small>
                            ) : null}
                          </td>
                          <td className="crm-square-cell-due"><span className="crm-square-due-label">Due </span>{dayLabel(invoice.dueDate)}</td>
                          <td className="crm-square-cell-status">
                            <Badge tone={state.tone}>{state.label}</Badge>
                          </td>
                          <td className="crm-square-actions">
                            {invoice.publicUrl ? (
                              <a href={invoice.publicUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink aria-hidden="true" /> View
                              </a>
                            ) : null}
                            {data.canInvoice && !needsReconnect && invoice.lineItems.length ? (
                              <button
                                type="button"
                                aria-label={`Bill ${invoice.recipientName} again`}
                                onClick={() =>
                                  setCreating({
                                    source: "repeat",
                                    recipientId: invoice.recipientId,
                                    recipientName: invoice.recipientName,
                                    recipientEmail: invoice.recipientEmail,
                                    title: invoice.title,
                                    message: invoice.message,
                                    lines: invoice.lineItems,
                                  })
                                }
                              >
                                <Repeat aria-hidden="true" /> Bill again
                              </button>
                            ) : null}
                            {data.canInvoice && invoice.actionable && invoice.status === "draft" ? (
                              <button
                                type="button"
                                disabled={rowBusy}
                                onClick={() =>
                                  void act(
                                    { action: "send_invoice", invoiceId: invoice.id },
                                    `Invoice sent to ${invoice.recipientEmail}.`,
                                    invoice.id,
                                  )
                                }
                              >
                                Send
                              </button>
                            ) : null}
                            {data.canInvoice &&
                            invoice.actionable &&
                            ["unpaid", "scheduled", "partially_paid"].includes(invoice.status) ? (
                              <button
                                type="button"
                                disabled={rowBusy}
                                onClick={() =>
                                  window.confirm(
                                    `Cancel this invoice to ${invoice.recipientName}? Square will tell them it was canceled.`,
                                  ) &&
                                  void act(
                                    { action: "cancel_invoice", invoiceId: invoice.id },
                                    "Invoice canceled.",
                                    invoice.id,
                                  )
                                }
                              >
                                Cancel
                              </button>
                            ) : null}
                            {data.canInvoice &&
                            (invoice.status === "failed" ||
                              (invoice.status === "draft" && invoice.actionable)) ? (
                              <button
                                type="button"
                                className="danger"
                                disabled={rowBusy}
                                aria-label={`Delete ${invoice.title}`}
                                onClick={() =>
                                  window.confirm("Delete this invoice? It was never sent.") &&
                                  void act(
                                    { action: "delete_invoice", invoiceId: invoice.id },
                                    "Invoice deleted.",
                                    invoice.id,
                                  )
                                }
                              >
                                <Trash2 aria-hidden="true" />
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No invoices yet"
                description={
                  scope.kind === "client"
                    ? "Invoices you send from here will appear with their payment status. When a lead is marked Won and has an email, it shows up above, ready to invoice."
                    : "Invoices you send from here will appear with their payment status. After the first one, Bill again repeats it in one step."
                }
              />
            )}
          </section>

          {data.canConnect ? (
            <section className="crm-stripe-danger-zone">
              <div>
                <strong>Disconnect Square</strong>
                <p>
                  This removes BrizBuilder&apos;s access. The Square account,
                  its invoices and its money are not affected.
                </p>
              </div>
              <button
                type="button"
                className="danger"
                disabled={busy === "disconnect"}
                onClick={() =>
                  window.confirm(
                    "Disconnect Square from BrizBuilder? Invoices already sent stay in Square, but their status will stop updating here.",
                  ) &&
                  void act({ action: "disconnect" }, "Square disconnected.", "disconnect")
                }
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            </section>
          ) : null}
        </>
      )}

      {creating && data.connection ? (
        <NewInvoiceModal
          scope={scope}
          currency={currency}
          recipients={data.recipients}
          readyToInvoice={data.readyToInvoice}
          savedItems={data.savedItems}
          lastMessage={data.lastMessage}
          preset={creating}
          busy={busy === "create"}
          onClose={() => setCreating(null)}
          onSubmit={async (invoice, file, plan) => {
            const ok = plan
              ? await act(
                  plan.planId
                    ? { action: "update_recurring", planId: plan.planId, plan: { ...invoice, ...plan } }
                    : { action: "create_recurring", plan: { ...invoice, ...plan } },
                  plan.planId
                    ? "Recurring plan updated."
                    : plan.startDate <= today
                      ? `Recurring billing started. The first invoice went to ${String(invoice.recipientEmail)}.`
                      : `Recurring billing set. The first invoice goes out ${dayLabel(plan.startDate)}.`,
                  "create",
                )
              : await act(
                  { action: "create_invoice", invoice },
                  invoice.send
                    ? `Invoice sent to ${String(invoice.recipientEmail)}.`
                    : "Draft saved. Send it when you are ready.",
                  "create",
                  file,
                );
            if (ok) setCreating(null);
            return ok;
          }}
        />
      ) : null}
    </>
  );
}

function NewInvoiceModal({
  scope,
  currency,
  recipients,
  readyToInvoice,
  savedItems,
  lastMessage,
  preset,
  busy,
  onClose,
  onSubmit,
}: {
  scope: SquareScopeChoice;
  currency: string;
  recipients: SquareWorkspaceData["recipients"];
  readyToInvoice: SquareWorkspaceData["readyToInvoice"];
  savedItems: SquareWorkspaceData["savedItems"];
  lastMessage: string | null;
  preset: InvoicePreset;
  busy: boolean;
  onClose: () => void;
  onSubmit: (
    invoice: Record<string, unknown>,
    file: File | null,
    plan: RecurringSubmit | null,
  ) => Promise<boolean>;
}) {
  const itemListId = useId();
  const [recipientId, setRecipientId] = useState(() =>
    preset.recipientId && recipients.some((item) => item.id === preset.recipientId)
      ? preset.recipientId
      : "",
  );
  const [recipientName, setRecipientName] = useState(preset.recipientName ?? "");
  const [recipientEmail, setRecipientEmail] = useState(preset.recipientEmail ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    preset.lines?.length
      ? preset.lines.map((line, index) => ({
          key: index + 1,
          name: line.name,
          quantity: String(line.quantity),
          unitPrice: centsInput(line.unitCents),
        }))
      : [{ key: 1, name: "", quantity: "1", unitPrice: "" }],
  );
  // The title follows the line items until someone types their own.
  const [customTitle, setCustomTitle] = useState(preset.title?.trim() ?? "");
  const [message, setMessage] = useState(preset.message ?? lastMessage ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState("");
  // Every submit button in the CRM is styled as the primary action, so "Save
  // draft" is a plain button that submits the form with this flag set.
  const saveAsDraft = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Read the clock once, when the form opens, not on every render.
  const [dates] = useState(() => {
    const now = new Date();
    return { now: now.getTime(), today: isoDay(now) };
  });
  const dueIn = (days: number) => isoDay(new Date(dates.now + days * 86_400_000));
  const [dueDate, setDueDate] = useState(() => dueIn(14));
  const editingPlan = Boolean(preset.planId);
  const [repeat, setRepeat] = useState<RecurringFrequency | "">(preset.repeat ?? "");
  const [startDate, setStartDate] = useState(() =>
    preset.startDate && preset.startDate > dates.today ? preset.startDate : dates.today,
  );
  const [payWithin, setPayWithin] = useState(String(preset.dueInDays ?? 14));
  const [endAfter, setEndAfter] = useState(preset.endAfterCount ? String(preset.endAfterCount) : "");
  const [quantitiesOpen, setQuantitiesOpen] = useState(false);

  const title = customTitle || autoTitle(lines);
  const totalCents = lines.reduce((sum, line) => {
    const cents = parseMoneyToCents(line.unitPrice);
    const quantity = Number(line.quantity);
    return cents !== null && Number.isInteger(quantity) && quantity > 0
      ? sum + cents * quantity
      : sum;
  }, 0);
  const usedNames = new Set(lines.map((line) => line.name.trim().toLowerCase()));
  const quickItems = savedItems.filter((item) => !usedNames.has(item.name.toLowerCase())).slice(0, 6);
  const heading = editingPlan
    ? "Edit recurring plan"
    : repeat
      ? "Set up recurring billing"
      : preset.source === "job"
        ? "Invoice a won job"
        : preset.source === "repeat"
          ? "Bill again"
          : "New invoice";

  function chooseRecipient(id: string) {
    setRecipientId(id);
    const match = recipients.find((item) => item.id === id);
    if (!match) {
      setRecipientName("");
      setRecipientEmail("");
      return;
    }
    setRecipientName(match.name);
    setRecipientEmail(match.email);
    // A customer with a won job and an untouched form gets that job filled in.
    const job = readyToInvoice.find((item) => item.recipientId === id);
    const untouched = lines.every((line) => !line.name.trim() && !line.unitPrice.trim());
    if (job && untouched) {
      setLines([
        { key: 1, name: job.service || "Services", quantity: "1", unitPrice: centsInput(job.valueCents) },
      ]);
    }
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        // Typing or picking a saved item fills in the price it was last billed at.
        if (patch.name !== undefined && !line.unitPrice.trim()) {
          const saved = savedItems.find(
            (item) => item.name.toLowerCase() === patch.name!.trim().toLowerCase(),
          );
          if (saved) next.unitPrice = centsInput(saved.unitCents);
        }
        return next;
      }),
    );
  }

  function addSavedItem(item: SquareWorkspaceData["savedItems"][number]) {
    setLines((current) => {
      const filled = { name: item.name, quantity: "1", unitPrice: centsInput(item.unitCents) };
      const blank = current.find((line) => !line.name.trim() && !line.unitPrice.trim());
      if (blank) return current.map((line) => (line.key === blank.key ? { ...line, ...filled } : line));
      if (current.length >= MAX_INVOICE_LINE_ITEMS) return current;
      return [...current, { key: Math.max(...current.map((line) => line.key)) + 1, ...filled }];
    });
  }

  function chooseFile(next: File | null) {
    setProblem("");
    if (next && next.size > MAX_ATTACHMENT_BYTES) {
      setFile(null);
      setProblem("That file is too large. Attach a PDF under 10 MB.");
      return;
    }
    if (next && next.type && next.type !== "application/pdf") {
      setFile(null);
      setProblem("The attachment must be a PDF file.");
      return;
    }
    setFile(next);
  }

  // ---- Step flow ----------------------------------------------------------
  // One question per step. Anything already known (a won job, Bill again, a
  // plan being edited) opens on the review step, so the fast path is one tap.
  const [step, setStep] = useState<Step>(() => {
    const knowsWho = Boolean(preset.recipientName?.trim() && preset.recipientEmail?.trim());
    const knowsWhat = Boolean(preset.lines?.length && preset.lines.every((line) => line.unitCents > 0));
    if (knowsWho && knowsWhat) return 3;
    return knowsWho ? 1 : 0;
  });
  const [search, setSearch] = useState("");
  const [typingNew, setTypingNew] = useState(() => !recipients.length);

  const showQuantity = quantitiesOpen || lines.some((line) => line.quantity.trim() !== "1");
  const endsAfterCount = endAfter !== "";
  const when = (day: string) => (day === dates.today ? "today" : dayLabel(day));
  const cadence = REPEAT_OPTIONS.find((option) => option.value === repeat);
  const query = search.trim().toLowerCase();
  const matches = (query
    ? recipients.filter(
        (item) => item.name.toLowerCase().includes(query) || item.email.toLowerCase().includes(query),
      )
    : recipients
  ).slice(0, 8);
  const whoDone = Boolean(recipientName.trim() && recipientEmail.trim());
  const whatDone = totalCents > 0 && lines.every((line) => line.name.trim());
  const singleLine = lines.length === 1 && !showQuantity;
  const firstItem = lines[0];

  function pick(id: string) {
    chooseRecipient(id);
    setTypingNew(false);
    setSearch("");
    setStep(1);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem("");
    // Before the last step, Enter or Continue moves on. The browser has
    // already checked the fields on screen.
    if (step === 0) {
      if (!typingNew && !whoDone) {
        if (matches[0]) pick(matches[0].id);
        return;
      }
      setStep(1);
      return;
    }
    if (step < 3) {
      setStep((step + 1) as Step);
      return;
    }
    const draft = saveAsDraft.current;
    saveAsDraft.current = false;
    void onSubmit(
      {
        recipientId: recipientId || null,
        recipientName,
        recipientEmail,
        title: title || "Invoice",
        message,
        dueDate,
        lineItems: lines.map((line) => ({
          name: line.name,
          quantity: Number(line.quantity),
          unitPrice: line.unitPrice,
        })),
        send: !draft,
      },
      repeat ? null : file,
      repeat
        ? {
            planId: preset.planId ?? null,
            frequency: repeat,
            startDate,
            dueInDays: Number(payWithin),
            endAfterCount: endAfter ? Number(endAfter) : null,
          }
        : null,
    );
  }

  const progress: { label: string; value: string; done: boolean }[] = [
    { label: "Who", value: whoDone ? recipientName.trim() : "Customer", done: whoDone },
    { label: "What", value: whatDone ? formatMoney(totalCents, currency) : "Amount", done: whatDone },
    { label: "When", value: cadence ? cadence.label : "One time", done: step > 2 },
    { label: "Send", value: "Review", done: false },
  ];

  return (
    <Modal title={heading} eyebrow={`SQUARE · ${scope.label.toUpperCase()}`} onClose={onClose} wide>
      <form ref={formRef} className="crm-form crm-square-form crm-square-wizard" onSubmit={submit}>
        <ol className="crm-field-span crm-square-steps" aria-label="Steps">
          {progress.map((item, index) => (
            <li key={item.label}>
              <button
                type="button"
                className={index === step ? "is-current" : item.done ? "is-done" : undefined}
                aria-current={index === step ? "step" : undefined}
                // Moving forward past an unanswered step is what Continue is for.
                disabled={index > step && !(index <= 1 ? whoDone : whoDone && whatDone)}
                onClick={() => setStep(index as Step)}
              >
                <span className="crm-square-step-dot" aria-hidden="true">
                  {item.done && index !== step ? <Check /> : index + 1}
                </span>
                <span className="crm-square-step-text">
                  <small>{item.label}</small>
                  {item.value}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div key={step} className="crm-field-span crm-square-stage">
          {step === 0 ? (
            <>
              <h3>Who are you billing?</h3>
              {typingNew ? (
                <div className="crm-square-new-person">
                  <input
                    aria-label="Name on the invoice"
                    value={recipientName}
                    onChange={(event) => {
                      setRecipientId("");
                      setRecipientName(event.target.value);
                    }}
                    maxLength={120}
                    placeholder="Their name"
                    autoFocus
                    required
                  />
                  <input
                    aria-label="Email the invoice to"
                    type="email"
                    value={recipientEmail}
                    onChange={(event) => {
                      setRecipientId("");
                      setRecipientEmail(event.target.value);
                    }}
                    maxLength={254}
                    placeholder="Their email"
                    required
                  />
                  {recipients.length ? (
                    <button type="button" className="crm-square-link" onClick={() => setTypingNew(false)}>
                      Pick from your {scope.kind === "agency" ? "clients" : "contacts"} instead
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  <input
                    className="crm-square-search"
                    aria-label={scope.kind === "agency" ? "Search your clients" : "Search your contacts"}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={scope.kind === "agency" ? "Search clients…" : "Search by name or email…"}
                    autoFocus
                  />
                  <div className="crm-square-people">
                    {matches.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`crm-square-person${item.id === recipientId ? " is-selected" : ""}`}
                        onClick={() => pick(item.id)}
                      >
                        <span className="crm-square-avatar" aria-hidden="true">
                          {initials(item.name || item.email)}
                        </span>
                        <span>
                          <strong>{item.name || item.email}</strong>
                          <small>{item.email || "No email yet"}</small>
                        </span>
                        {readyToInvoice.some((job) => job.recipientId === item.id) ? (
                          <em>Won job</em>
                        ) : null}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="crm-square-person is-new"
                      onClick={() => {
                        setRecipientId("");
                        setRecipientName(search.includes("@") ? "" : search.trim());
                        setRecipientEmail(search.includes("@") ? search.trim() : "");
                        setTypingNew(true);
                      }}
                    >
                      <span className="crm-square-avatar" aria-hidden="true">
                        <Plus />
                      </span>
                      <span>
                        <strong>{search.trim() ? `Bill "${search.trim()}"` : "Someone new"}</strong>
                        <small>Type their name and email</small>
                      </span>
                    </button>
                  </div>
                  {query && !matches.length ? (
                    <p className="crm-square-hint">No match. Add them as someone new.</p>
                  ) : null}
                </>
              )}
            </>
          ) : null}

          {step === 1 ? (
            <>
              <h3>What are you billing {recipientName.trim().split(/\s+/)[0] || "them"} for?</h3>
              {singleLine && firstItem ? (
                <div className="crm-square-hero">
                  <label className="crm-square-hero-amount">
                    <span aria-hidden="true">$</span>
                    <input
                      aria-label="Amount"
                      inputMode="decimal"
                      value={firstItem.unitPrice}
                      onChange={(event) => updateLine(firstItem.key, { unitPrice: event.target.value })}
                      placeholder="0"
                      pattern="\$?[0-9,]+(\.[0-9]{1,2})?"
                      title="An amount such as 250 or 250.00"
                      autoFocus={!firstItem.unitPrice}
                      required
                    />
                  </label>
                  <input
                    className="crm-square-hero-what"
                    aria-label="What it's for"
                    value={firstItem.name}
                    onChange={(event) => updateLine(firstItem.key, { name: event.target.value })}
                    placeholder="What's it for? e.g. Gutter installation"
                    maxLength={200}
                    list={savedItems.length ? itemListId : undefined}
                    autoComplete="off"
                    autoFocus={Boolean(firstItem.unitPrice) && !firstItem.name}
                    required
                  />
                </div>
              ) : (
                <div className="crm-square-items">
                  {lines.map((line, index) => (
                    <div key={line.key} className={`crm-square-item${showQuantity ? " has-quantity" : ""}`}>
                      <input
                        aria-label={`Line ${index + 1} description`}
                        value={line.name}
                        onChange={(event) => updateLine(line.key, { name: event.target.value })}
                        placeholder="What you're billing for"
                        maxLength={200}
                        list={savedItems.length ? itemListId : undefined}
                        autoComplete="off"
                        required
                      />
                      {showQuantity ? (
                        <input
                          aria-label={`Line ${index + 1} quantity`}
                          type="number"
                          min={1}
                          max={999}
                          step={1}
                          value={line.quantity}
                          onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                          required
                        />
                      ) : null}
                      <span className="crm-square-money">
                        <span aria-hidden="true">$</span>
                        <input
                          aria-label={`Line ${index + 1} price`}
                          inputMode="decimal"
                          value={line.unitPrice}
                          onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                          placeholder="0.00"
                          pattern="\$?[0-9,]+(\.[0-9]{1,2})?"
                          title="An amount such as 250 or 250.00"
                          required
                        />
                      </span>
                      {lines.length > 1 ? (
                        <button
                          type="button"
                          className="crm-square-remove"
                          aria-label={`Remove line ${index + 1}`}
                          onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <p className="crm-square-items-total">
                    Total <strong>{formatMoney(totalCents, currency)}</strong>
                  </p>
                </div>
              )}
              {savedItems.length ? (
                <datalist id={itemListId}>
                  {savedItems.map((item) => (
                    <option key={item.name} value={item.name} />
                  ))}
                </datalist>
              ) : null}
              {quickItems.length ? (
                <div className="crm-square-saved">
                  <small>Billed before — tap to add</small>
                  <div>
                    {quickItems.map((item) => (
                      <button
                        key={item.name}
                        type="button"
                        className="crm-square-saved-item"
                        disabled={lines.length >= MAX_INVOICE_LINE_ITEMS && !lines.some((line) => !line.name.trim())}
                        onClick={() => addSavedItem(item)}
                      >
                        <span>{item.name}</span>
                        <strong>{formatMoney(item.unitCents, currency)}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="crm-square-item-links">
                <button
                  type="button"
                  className="crm-square-link"
                  disabled={lines.length >= MAX_INVOICE_LINE_ITEMS}
                  onClick={() =>
                    setLines((current) => [
                      ...current,
                      {
                        key: Math.max(...current.map((item) => item.key)) + 1,
                        name: "",
                        quantity: "1",
                        unitPrice: "",
                      },
                    ])
                  }
                >
                  <Plus aria-hidden="true" /> Add another item
                </button>
                {showQuantity ? null : (
                  <button type="button" className="crm-square-link" onClick={() => setQuantitiesOpen(true)}>
                    Set quantities
                  </button>
                )}
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h3>How often?</h3>
              <div className="crm-square-cadences" role="group" aria-label="How often">
                {editingPlan ? null : (
                  <button
                    type="button"
                    className="crm-square-cadence"
                    aria-pressed={repeat === ""}
                    onClick={() => setRepeat("")}
                  >
                    <strong>One time</strong>
                    <small>A single invoice</small>
                  </button>
                )}
                {REPEAT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="crm-square-cadence"
                    aria-pressed={repeat === option.value}
                    onClick={() => setRepeat(option.value)}
                  >
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </button>
                ))}
              </div>
              {repeat ? (
                <div className="crm-square-rows">
                  <div className="crm-square-row">
                    <span>{editingPlan ? "Next one" : "Starts"}</span>
                    <div className="crm-square-chips">
                      <button
                        type="button"
                        className="crm-square-chip"
                        aria-pressed={startDate === dates.today}
                        onClick={() => setStartDate(dates.today)}
                      >
                        Today
                      </button>
                      <input
                        aria-label={editingPlan ? "Next invoice date" : "First invoice date"}
                        type="date"
                        value={startDate}
                        min={dates.today}
                        onChange={(event) => setStartDate(event.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="crm-square-row">
                    <span>Due</span>
                    <div className="crm-square-chips" role="group" aria-label="When each invoice is due">
                      {PAY_WITHIN.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className="crm-square-chip"
                          aria-pressed={payWithin === option.value}
                          onClick={() => setPayWithin(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="crm-square-row">
                    <span>Ends</span>
                    <div className="crm-square-chips" role="group" aria-label="When billing stops">
                      <button
                        type="button"
                        className="crm-square-chip"
                        aria-pressed={!endsAfterCount}
                        onClick={() => setEndAfter("")}
                      >
                        Never
                      </button>
                      <button
                        type="button"
                        className="crm-square-chip"
                        aria-pressed={endsAfterCount}
                        onClick={() => setEndAfter(endAfter || "12")}
                      >
                        After a set number
                      </button>
                      {endsAfterCount ? (
                        <label className="crm-square-count">
                          <input
                            aria-label="Number of invoices"
                            type="number"
                            min={1}
                            max={500}
                            step={1}
                            value={endAfter}
                            onChange={(event) => setEndAfter(event.target.value)}
                            required
                          />
                          invoices
                        </label>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="crm-square-rows">
                  <div className="crm-square-row">
                    <span>Due</span>
                    <div className="crm-square-chips">
                      {DUE_PRESETS.map((option) => {
                        const day = dueIn(option.days);
                        return (
                          <button
                            key={option.label}
                            type="button"
                            className="crm-square-chip"
                            aria-pressed={dueDate === day}
                            onClick={() => setDueDate(day)}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                      <input
                        aria-label="Due date"
                        type="date"
                        value={dueDate}
                        min={dates.today}
                        onChange={(event) => setDueDate(event.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <h3>{repeat ? "Ready to start billing" : "Ready to send"}</h3>
              <article className="crm-square-paper">
                <header>
                  <div>
                    <small>INVOICE</small>
                    <strong>{title || "Invoice"}</strong>
                  </div>
                  <span>{scope.label}</span>
                </header>
                <button type="button" className="crm-square-paper-part" onClick={() => setStep(0)}>
                  <small>Bill to</small>
                  <strong>{recipientName || "—"}</strong>
                  <span>{recipientEmail}</span>
                  <em>Change</em>
                </button>
                <button type="button" className="crm-square-paper-part" onClick={() => setStep(1)}>
                  <small>Items</small>
                  <span className="crm-square-paper-lines">
                    {lines.map((line) => {
                      const cents = parseMoneyToCents(line.unitPrice) ?? 0;
                      const quantity = Number(line.quantity) || 1;
                      return (
                        <span key={line.key}>
                          <span>
                            {line.name || "Item"}
                            {quantity > 1 ? ` × ${quantity}` : ""}
                          </span>
                          <span>{formatMoney(cents * quantity, currency)}</span>
                        </span>
                      );
                    })}
                  </span>
                  <em>Change</em>
                </button>
                <button type="button" className="crm-square-paper-part" onClick={() => setStep(2)}>
                  <small>{repeat ? "Schedule" : "Due"}</small>
                  <strong>
                    {repeat && cadence
                      ? `${cadence.label}, ${editingPlan ? "next on" : "starting"} ${when(startDate)}`
                      : `Due ${when(dueDate)}`}
                  </strong>
                  {repeat ? (
                    <span>
                      Each due {payWithin === "0" ? "on receipt" : `in ${payWithin} days`}
                      {endsAfterCount && Number(endAfter) > 0 ? ` · ${endAfter} invoices` : " · until you stop it"}
                    </span>
                  ) : null}
                  <em>Change</em>
                </button>
                <footer>
                  <span>Total{repeat && cadence ? `, ${cadence.sentence}` : ""}</span>
                  <strong>{formatMoney(totalCents, currency)}</strong>
                </footer>
              </article>

              <details className="crm-square-more">
                <summary>
                  Title, message{repeat ? "" : " and attachment"}
                  <small>
                    {message.trim() ? "Message included" : "No message"}
                    {file && !repeat ? ` · ${file.name}` : ""}
                  </small>
                </summary>
                <div className="crm-square-more-body">
                  <Field label="Invoice title" span>
                    <input
                      value={customTitle}
                      onChange={(event) => setCustomTitle(event.target.value)}
                      maxLength={120}
                      placeholder={autoTitle(lines) || "e.g. October marketing services"}
                    />
                  </Field>
                  <Field label="Message to the customer (optional)" span>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder="Thanks for your business!"
                    />
                  </Field>
                  {repeat ? null : (
                    <Field label="Contract or other PDF to send with it (optional)" span>
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
                      />
                      <small>
                        Square emails it with the invoice. It is not a signature request,
                        and BrizBuilder does not keep a copy.
                      </small>
                    </Field>
                  )}
                </div>
              </details>
              {repeat && startDate === dates.today && !editingPlan ? (
                <p className="crm-square-hint">The first invoice goes out the moment you start billing.</p>
              ) : null}
            </>
          ) : null}
        </div>

        {problem ? (
          <p className="crm-field-span crm-square-form-error" role="alert">
            {problem}
          </p>
        ) : null}
        <footer>
          {step > 0 ? (
            <button className="crm-button-secondary" type="button" onClick={() => setStep((step - 1) as Step)}>
              Back
            </button>
          ) : (
            <button className="crm-button-secondary" type="button" onClick={onClose}>
              Cancel
            </button>
          )}
          {step === 3 && !repeat ? (
            <button
              className="crm-button-secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                saveAsDraft.current = true;
                formRef.current?.requestSubmit();
              }}
            >
              Save draft
            </button>
          ) : null}
          {step === 0 && !typingNew && !whoDone ? null : (
            <button className="crm-button-primary" type="submit" disabled={busy}>
              {step < 3
                ? "Continue"
                : busy
                  ? "Working…"
                  : editingPlan
                    ? "Save changes"
                    : repeat
                      ? `Start billing ${formatMoney(totalCents, currency)}`
                      : `Send ${formatMoney(totalCents, currency)}`}
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}
