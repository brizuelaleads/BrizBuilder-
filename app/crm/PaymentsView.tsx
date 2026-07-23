"use client";

import { useState } from "react";
import type { CrmClient, CrmProviderConnection } from "../../db/crm";
import { Badge } from "./ui";

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

export function PaymentsView({
  clients,
  connections,
  selectedClientId,
  mutate,
}: {
  clients: CrmClient[];
  connections: CrmProviderConnection[];
  selectedClientId: string;
  mutate: Mutate;
}) {
  const [localClient, setLocalClient] = useState(clients[0]?.id ?? "");
  const clientId = clientChoice(clients, selectedClientId, localClient);
  const client = clients.find((item) => item.id === clientId);
  const connection = connections.find(
    (item) => item.clientId === clientId && item.provider === "stripe",
  );
  const isLinked = Boolean(connection?.isLinked);
  const isActive = Boolean(connection?.isActive);

  return (
    <div className="crm-view crm-payments-view">
      <section className="crm-page-heading">
        <div>
          <p>REVENUE OPERATIONS</p>
          <h2>Payments</h2>
          <span>
            Connect this business&apos;s own Stripe account so it can accept
            card payments. BrizBuilder never sees or stores card numbers or
            Stripe login details.
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
          <p>Payments belong to one business and cannot be shared across clients.</p>
        </section>
      ) : (
        <div className="crm-connection-grid">
          <article className="crm-connection-card stripe">
            <header>
              <span className="crm-provider-logo stripe">S</span>
              <div>
                <h3>Stripe</h3>
                <p>Accept card payments through this business&apos;s own Stripe account</p>
              </div>
              <Badge tone={isLinked ? "green" : "orange"}>
                {isLinked ? "Connected" : "Not connected"}
              </Badge>
            </header>
            <div className="crm-connection-details">
              <div>
                <span>Account</span>
                <strong>
                  {isLinked
                    ? connection?.accountLabel ?? "Connected Stripe account"
                    : "Not connected"}
                </strong>
              </div>
              <div>
                <span>Stripe account status</span>
                <strong>
                  {isLinked && connection?.accountStatus
                    ? connection.accountStatus.replaceAll("_", " ")
                    : "Not reported"}
                </strong>
              </div>
              <div>
                <span>Currency</span>
                <strong>{connection?.currency ?? "Not reported"}</strong>
              </div>
              <div>
                <span>Integration status</span>
                <strong>
                  <Badge tone={isActive ? "green" : "red"}>
                    {isActive ? "Active" : "Not active"}
                  </Badge>
                </strong>
              </div>
              <div>
                <span>Last checked</span>
                <strong>
                  {connection?.lastHealthCheckAt
                    ? new Date(connection.lastHealthCheckAt).toLocaleString()
                    : "Not checked"}
                </strong>
              </div>
            </div>
            {connection?.lastError ? (
              <p className="crm-inline-error">
                <strong>Needs attention:</strong> {connection.lastError}
              </p>
            ) : null}
            <div className="crm-connection-actions">
              {isLinked ? (
                <>
                  <button
                    onClick={() =>
                      mutate(
                        { action: "check_provider_connection", provider: "stripe", clientId },
                        "Stripe connection status refreshed.",
                      )
                    }
                  >
                    Refresh connection
                  </button>
                  <button
                    className="danger"
                    onClick={() =>
                      window.confirm(
                        "Disconnect Stripe? This business will no longer be able to collect payments through BrizBuilder.",
                      ) &&
                      mutate(
                        { action: "disconnect_provider", provider: "stripe", clientId },
                        "Stripe disconnected.",
                      )
                    }
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <a
                  className="crm-button-primary"
                  href={`/api/integrations/stripe/connect?clientId=${encodeURIComponent(clientId)}`}
                >
                  Connect Stripe
                </a>
              )}
            </div>
          </article>
        </div>
      )}
      <div className="crm-preview-notice" role="note">
        <span>i</span>
        <div>
          <strong>Invoicing is coming soon</strong>
          <p>
            {isLinked
              ? "Stripe is connected. Creating and sending invoices from BrizBuilder is not built yet."
              : "Connect Stripe now so invoicing is ready as soon as it launches."}
          </p>
        </div>
      </div>
    </div>
  );
}
