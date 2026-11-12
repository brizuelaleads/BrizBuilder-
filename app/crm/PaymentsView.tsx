"use client";

import { useEffect, useState } from "react";
import type {
  CrmClient,
  CrmProviderConnection,
  CrmRole,
} from "../../db/crm";
import { SquareWorkspace, type SquareScopeChoice } from "./payments/SquareWorkspace";
import { StripeEmbeddedWorkspace } from "./payments/StripeEmbeddedWorkspace";
import { Badge, dateTime } from "./ui";

type Provider = "square" | "stripe";

// Picker value for the agency's own Square account, which bills the agency's
// clients rather than a client's customers.
const AGENCY_SCOPE = "__agency__";
const AGENCY_OWNER_ROLES: CrmRole[] = ["LB_OWNER", "SUPER_ADMIN", "AGENCY_OWNER"];
const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "square", label: "Square invoices" },
  { id: "stripe", label: "Stripe" },
];


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
  isAgency,
  organizationName,
  mutate,
}: {
  clients: CrmClient[];
  connections: CrmProviderConnection[];
  selectedClientId: string;
  viewerRole: CrmRole;
  isAgency: boolean;
  organizationName: string;
  mutate: Mutate;
}) {
  // The agency's own account is offered only to its owners, and only while no
  // single business is selected in the workspace switcher.
  const canUseAgency =
    isAgency && AGENCY_OWNER_ROLES.includes(viewerRole) && selectedClientId === "all";
  const [localClient, setLocalClient] = useState(clients[0]?.id ?? "");
  // Returning from Square's sign-in for the agency account lands back on it.
  // Read after mount: the server render cannot see the URL, so reading it
  // during render would make the two disagree.
  useEffect(() => {
    if (!canUseAgency) return;
    const timer = window.setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("payments_scope") === "agency")
        setLocalClient(AGENCY_SCOPE);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [canUseAgency]);
  const [provider, setProvider] = useState<Provider>("square");
  const agencySelected = canUseAgency && localClient === AGENCY_SCOPE;
  const clientId = clientChoice(
    clients,
    selectedClientId,
    localClient === AGENCY_SCOPE ? "" : localClient,
  );
  const client = clients.find((item) => item.id === clientId);
  const squareScope: SquareScopeChoice | null = agencySelected
    ? { kind: "agency", label: organizationName }
    : client
      ? { kind: "client", clientId: client.id, label: client.businessName }
      : null;
  // Stripe's connect flow is agency-run, so a client login sees Square only.
  const activeProvider: Provider = isAgency ? provider : "square";
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
    "LB_OWNER",
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
          <p>INVOICES AND PAYMENTS</p>
          <h2>Payments</h2>
          <span>
            Send invoices and see what has been paid. Each business uses its
            own payment account, so the money goes straight to them.
          </span>
        </div>
        {selectedClientId === "all" ? (
          <label className="crm-phone-client-picker">
            <span>Business</span>
            <select
              value={agencySelected ? AGENCY_SCOPE : clientId}
              onChange={(event) => setLocalClient(event.target.value)}
            >
              {canUseAgency ? (
                <option value={AGENCY_SCOPE}>{organizationName} (your agency)</option>
              ) : null}
              {clients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.businessName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      {isAgency ? (
        <div className="crm-tabs crm-payments-providers" role="tablist" aria-label="Payment provider">
          {PROVIDERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={activeProvider === item.id}
              className={activeProvider === item.id ? "active" : undefined}
              onClick={() => setProvider(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {activeProvider === "square" ? (
        squareScope ? (
          <SquareWorkspace
            key={squareScope.kind === "agency" ? AGENCY_SCOPE : squareScope.clientId}
            scope={squareScope}
          />
        ) : (
          <section className="crm-empty-state">
            <h3>Add a client first</h3>
            <p>
              Every payment account belongs to exactly one business and is
              never shared with another client.
            </p>
          </section>
        )
      ) : agencySelected ? (
        <section className="crm-empty-state">
          <h3>Stripe connects one business at a time</h3>
          <p>Choose a business above to connect or manage its Stripe account.</p>
        </section>
      ) : !client ? (
        <section className="crm-empty-state">
          <h3>Add a client first</h3>
          <p>
            Every Stripe connection belongs to exactly one business and is
            never shared with another client.
          </p>
        </section>
      ) : !isLinked ? (
        <section className="crm-stripe-connect-card crm-simple-connect-card">
          <div className="crm-stripe-connect-copy">
            <span className="crm-provider-logo stripe">S</span>
            <div>
              <p>STRIPE</p>
              <h3>Connect {client.businessName}&apos;s Stripe account</h3>
              <span>Accept payments and manage payouts from BrizBuilder.</span>
            </div>
          </div>
          <div className="crm-stripe-connect-actions">
            <a
              className="crm-button-primary"
              href={`/api/integrations/stripe/connect?clientId=${encodeURIComponent(clientId)}`}
            >
              Connect with Stripe
            </a>
            <span>Secure sign-in is handled by Stripe.</span>
          </div>
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

    </div>
  );
}
