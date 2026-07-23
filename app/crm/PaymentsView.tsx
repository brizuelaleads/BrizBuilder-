"use client";

import { useState } from "react";
import type {
  CrmClient,
  CrmProviderConnection,
  CrmRole,
} from "../../db/crm";
import { StripeEmbeddedWorkspace } from "./payments/StripeEmbeddedWorkspace";
import { Badge, dateTime } from "./ui";

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;

function clientChoice(
  clients: CrmClient[],
  selectedClientId: string,
  local: string,
) {
  return selectedClientId !== "all"
    ? selectedClientId
    : local || clients[0]?.id || "";
}

function setupLabel(status: string) {
  if (status === "ready") return "Ready";
  if (status === "payments_ready") return "Payments ready";
  if (status === "under_review") return "Stripe review";
  if (status === "action_required") return "Action needed";
  if (status === "setup_required") return "Finish setup";
  return "Not ready";
}

function setupTone(status: string): "green" | "orange" | "red" | "blue" {
  if (status === "ready") return "green";
  if (status === "under_review" || status === "payments_ready") return "blue";
  if (status === "action_required") return "red";
  return "orange";
}

function verificationLabel(
  detailsSubmitted: boolean | null,
  pendingVerificationCount: number | null,
) {
  if (!detailsSubmitted) return "Setup needed";
  if ((pendingVerificationCount ?? 0) > 0) return "Under review";
  return "Complete";
}

export function PaymentsView({
  clients,
  connections,
  selectedClientId,
  viewerRole,
  mutate,
}: {
  clients: CrmClient[];
  connections: CrmProviderConnection[];
  selectedClientId: string;
  viewerRole: CrmRole;
  mutate: Mutate;
}) {
  const [localClient, setLocalClient] = useState(clients[0]?.id ?? "");
  const clientId = clientChoice(clients, selectedClientId, localClient);
  const client = clients.find((item) => item.id === clientId);
  const connection = connections.find(
    (item) => item.clientId === clientId && item.provider === "stripe",
  );
  const isLinked = Boolean(connection?.isLinked);
  const connectionBlocked = [
    "disconnecting",
    "deauthorization_pending",
    "revoked",
  ].includes(connection?.status.toLowerCase() ?? "");
  const canOpenSecureTools = [
    "SUPER_ADMIN",
    "AGENCY_OWNER",
    "CLIENT_OWNER",
  ].includes(viewerRole);
  const setupStatus =
    connection?.setupStatus ??
    (connection?.isActive ? "ready" : "setup_required");

  async function refreshStripe() {
    await mutate(
      {
        action: "check_provider_connection",
        provider: "stripe",
        clientId,
      },
      "Stripe status refreshed.",
    );
  }

  return (
    <div className="crm-view crm-payments-view">
      <section className="crm-page-heading crm-payments-heading">
        <div>
          <p>PAYMENTS BY STRIPE</p>
          <h2>Payments</h2>
          <span>
            Connect and manage each business&apos;s own Stripe account without
            leaving BrizBuilder.
          </span>
        </div>
        {selectedClientId === "all" ? (
          <label className="crm-phone-client-picker">
            <span>Business</span>
            <select
              value={clientId}
              onChange={(event) => setLocalClient(event.target.value)}
            >
              {clients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.businessName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      {!client ? (
        <section className="crm-empty-state">
          <h3>Add a client first</h3>
          <p>
            Every Stripe connection belongs to exactly one business and is
            never shared with another client.
          </p>
        </section>
      ) : !isLinked ? (
        <section className="crm-stripe-connect-card">
          <div className="crm-stripe-connect-copy">
            <span className="crm-provider-logo stripe">S</span>
            <div>
              <p>SECURE STRIPE CONNECTION</p>
              <h3>Connect {client.businessName}&apos;s Stripe account</h3>
              <span>
                One button works for businesses that already use Stripe and
                businesses that need to create an account.
              </span>
            </div>
          </div>
          <div className="crm-stripe-trust-grid">
            <article>
              <b>1</b>
              <div>
                <strong>Sign in on Stripe</strong>
                <p>
                  Stripe handles the password and may ask the owner to confirm
                  their identity.
                </p>
              </div>
            </article>
            <article>
              <b>2</b>
              <div>
                <strong>Keep ownership and billing</strong>
                <p>
                  The business pays its own Stripe fees and receives money in
                  its own bank account.
                </p>
              </div>
            </article>
            <article>
              <b>3</b>
              <div>
                <strong>Manage it here</strong>
                <p>
                  Payments, disputes, balances, payouts, and setup appear in
                  BrizBuilder.
                </p>
              </div>
            </article>
          </div>
          <div className="crm-stripe-connect-actions">
            <a
              className="crm-button-primary"
              href={`/api/integrations/stripe/connect?clientId=${encodeURIComponent(clientId)}`}
            >
              Connect with Stripe
            </a>
            <span>
              BrizBuilder never sees the Stripe password, card numbers, bank
              login, or customer secret key.
            </span>
          </div>
          <p className="crm-stripe-platform-note">
            If this business&apos;s existing Stripe account is controlled by
            another software platform, Stripe may ask the owner to choose or
            create a separate account.
          </p>
        </section>
      ) : (
        <>
          <section className="crm-stripe-account-header">
            <div className="crm-stripe-account-title">
              <span className="crm-provider-logo stripe">S</span>
              <div>
                <p>CONNECTED ACCOUNT</p>
                <h3>
                  {connection?.accountLabel ?? "Connected Stripe account"}
                </h3>
                <span>
                  {client.businessName} ·{" "}
                  {connection?.livemode === true ? "Live mode" : "Test mode"}
                </span>
              </div>
            </div>
            <div className="crm-stripe-account-actions">
              <Badge tone={setupTone(setupStatus)}>
                {setupLabel(setupStatus)}
              </Badge>
              <button onClick={() => void refreshStripe()}>Refresh status</button>
            </div>
          </section>

          <section className="crm-stripe-status-grid">
            <article>
              <span>Connection</span>
              <strong>{connectionBlocked ? "Disconnect pending" : "Connected"}</strong>
              <small>
                {connectionBlocked
                  ? "New Stripe sessions are blocked."
                  : "This account is linked only to this business."}
              </small>
            </article>
            <article>
              <span>Payments</span>
              <strong>
                {connection?.chargesEnabled ? "Ready" : "Action needed"}
              </strong>
              <small>
                {connection?.chargesEnabled
                  ? "Card payments can be accepted."
                  : "Finish the Stripe setup items below."}
              </small>
            </article>
            <article>
              <span>Payouts</span>
              <strong>
                {connection?.payoutsEnabled ? "Ready" : "Action needed"}
              </strong>
              <small>
                {connection?.payoutsEnabled
                  ? "Stripe can send funds to the business."
                  : "Stripe still needs a payout or bank update."}
              </small>
            </article>
            <article>
              <span>Verification</span>
              <strong>
                {verificationLabel(
                  connection?.detailsSubmitted ?? null,
                  connection?.pendingVerificationCount ?? null,
                )}
              </strong>
              <small>
                Last synced {dateTime(connection?.lastHealthCheckAt ?? null)}
              </small>
            </article>
          </section>

          {connection?.livemode === false ? (
            <div className="crm-stripe-mode-note" role="note">
              <strong>Test mode is on.</strong>
              <span>
                No real money moves while this connection uses Stripe test
                keys. This is the safe place to learn the workflow.
              </span>
            </div>
          ) : null}

          {connection?.lastError && !connectionBlocked ? (
            <div
              className={`crm-stripe-attention ${setupTone(setupStatus)}`}
              role="status"
            >
              <strong>{setupLabel(setupStatus)}</strong>
              <span>{connection.lastError}</span>
              {(connection.currentlyDueCount ?? 0) > 0 ? (
                <small>
                  {connection.currentlyDueCount} secure Stripe{" "}
                  {connection.currentlyDueCount === 1 ? "item" : "items"} to
                  finish
                </small>
              ) : null}
            </div>
          ) : null}

          {!connectionBlocked && canOpenSecureTools ? (
            <StripeEmbeddedWorkspace
              key={clientId}
              clientId={clientId}
              setupStatus={setupStatus}
              onRefresh={refreshStripe}
            />
          ) : !canOpenSecureTools ? (
            <section className="crm-stripe-owner-gate">
              <strong>Financial tools are owner-only</strong>
              <p>
                An agency owner or this business&apos;s client owner can open
                Stripe payment and payout information.
              </p>
            </section>
          ) : null}

          <section className="crm-stripe-danger-zone">
            <div>
              <strong>Disconnect Stripe</strong>
              <p>
                This revokes BrizBuilder&apos;s access. It does not close the
                business&apos;s Stripe account or stop Stripe itself.
              </p>
            </div>
            <button
              className="danger"
              disabled={connectionBlocked}
              onClick={() =>
                window.confirm(
                  "Disconnect Stripe from BrizBuilder? The business keeps its Stripe account, money, and history, but Stripe tools will stop working here.",
                ) &&
                void mutate(
                  {
                    action: "disconnect_provider",
                    provider: "stripe",
                    clientId,
                  },
                  "Stripe disconnected from BrizBuilder.",
                )
              }
            >
              {connectionBlocked ? "Disconnect pending" : "Disconnect"}
            </button>
          </section>
        </>
      )}

      <div className="crm-preview-notice" role="note">
        <span>i</span>
        <div>
          <strong>Invoices and payment links are the next payment step</strong>
          <p>
            This workspace manages Stripe activity that already exists.
            Creating and sending a BrizBuilder invoice or checkout link is not
            built yet, so the screen never shows fake invoices.
          </p>
        </div>
      </div>
    </div>
  );
}
