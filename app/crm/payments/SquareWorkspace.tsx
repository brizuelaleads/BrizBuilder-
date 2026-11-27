"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ExternalLink, FileText, Plus, RefreshCw, Repeat, Trash2, Trophy } from "lucide-react";
import type { SquareWorkspace as SquareWorkspaceData } from "../../../db/supabase-square";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_INVOICE_LINE_ITEMS,
  invoiceDisplayState,
  isoDay,
  parseMoneyToCents,
} from "../../../lib/square-core";
import { Badge, EmptyState, Field, Modal, dateTime, shortDate } from "../ui";

export type SquareScopeChoice =
  | { kind: "agency"; label: string }
  | { kind: "client"; clientId: string; label: string };

type Line = { key: number; name: string; quantity: string; unitPrice: string };

/** What a new invoice starts from: a won job, an earlier invoice, or nothing. */
type InvoicePreset = {
  source: "blank" | "job" | "repeat";
  recipientId?: string | null;
  recipientName?: string;
  recipientEmail?: string;
  title?: string;
  message?: string | null;
  lines?: { name: string; quantity: number; unitCents: number }[];
};

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
          onSubmit={async (invoice, file) => {
            const ok = await act(
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
  onSubmit: (invoice: Record<string, unknown>, file: File | null) => Promise<boolean>;
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
  const heading =
    preset.source === "job"
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem("");
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
      file,
    );
  }

  return (
    <Modal title={heading} eyebrow={`SQUARE · ${scope.label.toUpperCase()}`} onClose={onClose} wide>
      <form ref={formRef} className="crm-form crm-square-form" onSubmit={submit}>
        <div className="crm-field-span crm-square-step">
          <span className="crm-square-step-label">1 · Who it&apos;s for</span>
        </div>
        {recipients.length ? (
          <Field label={scope.kind === "agency" ? "Bill a client business" : "Bill a contact"} span>
            <select value={recipientId} onChange={(event) => chooseRecipient(event.target.value)}>
              <option value="">Someone else — type their details below</option>
              {recipients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.email ? ` — ${item.email}` : ""}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Name on the invoice">
          <input
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            maxLength={120}
            required
            autoFocus={!preset.recipientName && !recipients.length}
          />
        </Field>
        <Field label="Email the invoice to">
          <input
            type="email"
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            maxLength={254}
            placeholder="customer@example.com"
            required
          />
        </Field>

        <fieldset className="crm-field-span crm-square-lines">
          <legend>2 · What it&apos;s for</legend>
          {quickItems.length ? (
            <div className="crm-square-quick" aria-label="Items you have billed before">
              <small>Billed before:</small>
              {quickItems.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className="crm-square-chip"
                  disabled={lines.length >= MAX_INVOICE_LINE_ITEMS && !lines.some((line) => !line.name.trim())}
                  onClick={() => addSavedItem(item)}
                >
                  <Plus aria-hidden="true" /> {item.name} · {formatMoney(item.unitCents, currency)}
                </button>
              ))}
            </div>
          ) : null}
          {lines.map((line, index) => (
            <div key={line.key} className="crm-square-line">
              <input
                aria-label={`Line ${index + 1} description`}
                value={line.name}
                onChange={(event) => updateLine(line.key, { name: event.target.value })}
                placeholder="What you did, e.g. Roof inspection"
                maxLength={200}
                list={savedItems.length ? itemListId : undefined}
                autoComplete="off"
                required
              />
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
              <button
                type="button"
                aria-label={`Remove line ${index + 1}`}
                disabled={lines.length === 1}
                onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          ))}
          {savedItems.length ? (
            <datalist id={itemListId}>
              {savedItems.map((item) => (
                <option key={item.name} value={item.name} />
              ))}
            </datalist>
          ) : null}
          <div className="crm-square-lines-foot">
            <button
              type="button"
              className="crm-button-secondary"
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
              <Plus aria-hidden="true" /> Add line
            </button>
          </div>
        </fieldset>

        <fieldset className="crm-field-span crm-square-due">
          <legend>3 · When it&apos;s due</legend>
          <div className="crm-square-due-row">
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
        </fieldset>

        <details className="crm-field-span crm-square-more">
          <summary>
            More options
            <small>
              {title ? `Title: ${title}` : "Title fills in from the first line"}
              {message.trim() ? " · message included" : ""}
              {file ? ` · ${file.name}` : ""}
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
              <small>Leave it blank to use the first line item.</small>
            </Field>
            <Field label="Message to the customer (optional)" span>
              <textarea
                rows={3}
                maxLength={1000}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Thanks for your business!"
              />
              {lastMessage && message === lastMessage ? (
                <small>Same message as your last invoice. Edit it or clear it.</small>
              ) : null}
            </Field>
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
          </div>
        </details>

        {problem ? (
          <p className="crm-field-span crm-square-form-error" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="crm-field-span crm-square-summary">
          <span>Total</span>
          <strong>{formatMoney(totalCents, currency)}</strong>
          <small>
            {recipientEmail ? `Square emails it to ${recipientEmail}` : "Square emails it to the customer"}
            {` · due ${dueDate === dates.today ? "today" : dayLabel(dueDate)}`}
          </small>
        </div>
        <footer>
          <button className="crm-button-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="crm-button-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              saveAsDraft.current = true;
              // requestSubmit runs the browser's required-field checks first.
              formRef.current?.requestSubmit();
            }}
          >
            Save draft
          </button>
          <button className="crm-button-primary" type="submit" disabled={busy}>
            {busy ? "Working…" : `Send ${formatMoney(totalCents, currency)}`}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
