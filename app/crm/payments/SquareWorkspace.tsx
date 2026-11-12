"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink, FileText, Plus, RefreshCw, Trash2 } from "lucide-react";
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
  const [creating, setCreating] = useState(false);
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
                  onClick={() => setCreating(true)}
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
                          <td className="crm-square-cell-due"><span className="crm-square-due-label">Due </span>{shortDate(invoice.dueDate)}</td>
                          <td className="crm-square-cell-status">
                            <Badge tone={state.tone}>{state.label}</Badge>
                          </td>
                          <td className="crm-square-actions">
                            {invoice.publicUrl ? (
                              <a href={invoice.publicUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink aria-hidden="true" /> View
                              </a>
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
                description="Invoices you send from here will appear with their payment status."
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
          busy={busy === "create"}
          onClose={() => setCreating(false)}
          onSubmit={async (invoice, file) => {
            const ok = await act(
              { action: "create_invoice", invoice },
              invoice.send
                ? `Invoice sent to ${String(invoice.recipientEmail)}.`
                : "Draft saved. Send it when you are ready.",
              "create",
              file,
            );
            if (ok) setCreating(false);
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
  busy,
  onClose,
  onSubmit,
}: {
  scope: SquareScopeChoice;
  currency: string;
  recipients: SquareWorkspaceData["recipients"];
  busy: boolean;
  onClose: () => void;
  onSubmit: (invoice: Record<string, unknown>, file: File | null) => Promise<boolean>;
}) {
  const [recipientId, setRecipientId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { key: 1, name: "", quantity: "1", unitPrice: "" },
  ]);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState("");
  // Every submit button in the CRM is styled as the primary action, so "Save
  // draft" is a plain button that submits the form with this flag set.
  const saveAsDraft = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Read the clock once, when the form opens, not on every render.
  const [dates] = useState(() => {
    const now = new Date();
    return {
      today: isoDay(now),
      defaultDue: isoDay(new Date(now.getTime() + 14 * 86_400_000)),
    };
  });

  const totalCents = lines.reduce((sum, line) => {
    const cents = parseMoneyToCents(line.unitPrice);
    const quantity = Number(line.quantity);
    return cents !== null && Number.isInteger(quantity) && quantity > 0
      ? sum + cents * quantity
      : sum;
  }, 0);

  function chooseRecipient(id: string) {
    setRecipientId(id);
    const match = recipients.find((item) => item.id === id);
    if (!match) return;
    setRecipientName(match.name);
    setRecipientEmail(match.email);
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
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
    const form = new FormData(event.currentTarget);
    const draft = saveAsDraft.current;
    saveAsDraft.current = false;
    void onSubmit(
      {
        recipientId: recipientId || null,
        recipientName,
        recipientEmail,
        title: String(form.get("title") ?? ""),
        message: String(form.get("message") ?? ""),
        dueDate: String(form.get("dueDate") ?? ""),
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
    <Modal title="New invoice" eyebrow={`SQUARE · ${scope.label.toUpperCase()}`} onClose={onClose} wide>
      <form ref={formRef} className="crm-form crm-square-form" onSubmit={submit}>
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
            autoFocus
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
        <Field label="Invoice title">
          <input name="title" maxLength={120} placeholder="e.g. October marketing services" required />
        </Field>
        <Field label="Due date">
          <input name="dueDate" type="date" defaultValue={dates.defaultDue} min={dates.today} required />
        </Field>

        <fieldset className="crm-field-span crm-square-lines">
          <legend>Line items</legend>
          {lines.map((line, index) => (
            <div key={line.key} className="crm-square-line">
              <input
                aria-label={`Line ${index + 1} description`}
                value={line.name}
                onChange={(event) => updateLine(line.key, { name: event.target.value })}
                placeholder="Description"
                maxLength={200}
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
            <strong>Total {formatMoney(totalCents, currency)}</strong>
          </div>
        </fieldset>

        <Field label="Message to the customer (optional)" span>
          <textarea name="message" rows={3} maxLength={1000} />
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
        {problem ? (
          <p className="crm-field-span crm-square-form-error" role="alert">
            {problem}
          </p>
        ) : null}
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
            {busy ? "Working…" : "Send invoice"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
