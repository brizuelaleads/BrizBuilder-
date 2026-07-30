"use client";

import { useMemo, useState } from "react";
import type {
  CrmAiActivity,
  CrmAiAuthorization,
  CrmClient,
} from "../../db/crm";
import { Badge, dateTime } from "./ui";

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;

type Runtime = {
  configured: boolean;
  endpoint: string;
};

const actionLabels: Record<string, string> = {
  "ai.oauth.authorized": "Connected the AI app",
  "ai.oauth.revoked": "Disconnected the AI app",
  "ai.authorization.created": "Connected the AI app",
  "ai.authorization.revoked": "Disconnected the AI app",
  "ai.tool.crm_get_overview": "Viewed the CRM overview",
  "ai.tool.crm_search_contacts": "Searched contacts",
  "ai.tool.crm_list_opportunities": "Viewed opportunities",
  "ai.tool.crm_list_tasks": "Viewed tasks",
  "ai.tool.crm_list_appointments": "Viewed appointments",
  "ai.tool.crm_create_task": "Created a follow-up task",
  "ai.tool.crm_add_opportunity_note": "Added an opportunity note",
  "ai.tool.crm_move_opportunity_stage": "Updated an opportunity stage",
  crm_search_contacts: "Searched contacts",
  crm_list_leads: "Viewed leads",
  crm_list_tasks: "Viewed tasks",
  crm_list_appointments: "Viewed appointments",
  crm_create_task: "Created a follow-up task",
  crm_add_opportunity_note: "Added an opportunity note",
  crm_move_opportunity_stage: "Updated an opportunity stage",
  oauth_authorized: "Connected the AI app",
  oauth_revoked: "Disconnected the AI app",
};

function isActive(status: string) {
  return ["active", "connected", "authorized"].includes(
    status.trim().toLowerCase(),
  );
}

function statusTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["active", "connected", "authorized", "success"].includes(normalized))
    return "green" as const;
  if (["attention", "expired", "pending", "warning"].includes(normalized))
    return "orange" as const;
  if (["error", "failed", "blocked"].includes(normalized))
    return "red" as const;
  return "neutral" as const;
}

function outcomeTone(outcome: string) {
  const normalized = outcome.trim().toLowerCase();
  if (["success", "succeeded", "allowed", "completed"].includes(normalized))
    return "green" as const;
  if (["denied", "failed", "error", "blocked"].includes(normalized))
    return "red" as const;
  return "neutral" as const;
}

function humanize(value: string, fallback: string) {
  const cleaned = value
    .replace(/[^a-zA-Z0-9_. -]/g, "")
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!cleaned) return fallback;
  return cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeMessage(value: string | null) {
  if (!value) return null;
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, "a service address")
    .replace(
      /\b(token|secret|password|api[ _-]?key)\s*[:=]\s*\S+/gi,
      "$1: [hidden]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return cleaned || null;
}

function authorizationCoversClient(
  authorization: CrmAiAuthorization,
  selectedClientId: string,
) {
  return (
    selectedClientId === "all" ||
    authorization.clientIds.includes(selectedClientId)
  );
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Copy was not available in this browser.");
}

export function AiConnectorView({
  clients,
  authorizations,
  activities,
  runtime,
  selectedClientId,
  mutate,
  canManage,
}: {
  clients: CrmClient[];
  authorizations: CrmAiAuthorization[];
  activities: CrmAiActivity[];
  runtime: Runtime;
  selectedClientId: string;
  mutate: Mutate;
  canManage: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const clientById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );
  const selectedClient =
    selectedClientId === "all"
      ? null
      : clientById.get(selectedClientId) ?? null;
  const workspaceName = selectedClient?.businessName ?? "Agency workspace";

  const visibleAuthorizations = useMemo(
    () =>
      authorizations.filter((authorization) =>
        authorizationCoversClient(authorization, selectedClientId),
      ),
    [authorizations, selectedClientId],
  );
  const activeAuthorizations = visibleAuthorizations.filter((authorization) =>
    isActive(authorization.status),
  );
  const connectionState = !runtime.configured
    ? "setup"
    : activeAuthorizations.length
      ? "connected"
      : "ready";

  const recentActivities = useMemo(
    () =>
      [...activities]
        .filter(
          (activity) =>
            selectedClientId === "all" ||
            activity.clientId === selectedClientId,
        )
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
        )
        .slice(0, 8),
    [activities, selectedClientId],
  );

  async function handleCopy() {
    if (!runtime.endpoint) {
      setCopyStatus("The connector address is not available yet.");
      return;
    }
    try {
      await copyText(runtime.endpoint);
      setCopyStatus("Connector address copied.");
    } catch (error) {
      setCopyStatus(
        error instanceof Error
          ? error.message
          : "The connector address could not be copied.",
      );
    }
  }

  async function revoke(authorization: CrmAiAuthorization) {
    if (!canManage || !isActive(authorization.status)) return;
    const appName = authorization.appName.trim() || "this AI app";
    if (
      !window.confirm(
        `Disconnect ${appName}? It will immediately lose access to the approved BrizBuilder businesses.`,
      )
    )
      return;

    setRevokingId(authorization.id);
    setActionError(null);
    try {
      await mutate(
        {
          action: "revoke_ai_authorization",
          authorizationId: authorization.id,
        },
        `${appName} disconnected`,
      );
    } catch (error) {
      setActionError(
        safeMessage(
          error instanceof Error
            ? error.message
            : "The AI app could not be disconnected.",
        ),
      );
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="crm-view crm-ai-connector-view">
      <section className="crm-page-heading crm-ai-connector-heading">
        <div>
          <p>AI CONNECTOR</p>
          <h2>Connect your AI apps</h2>
          <span>
            Use BrizBuilder securely from a compatible AI app.
          </span>
        </div>
        <Badge
          tone={
            connectionState === "connected"
              ? "green"
              : connectionState === "setup"
                ? "orange"
                : "neutral"
          }
        >
          {connectionState === "connected"
            ? `${activeAuthorizations.length} connected`
            : connectionState === "setup"
              ? "Setup needed"
              : "Not connected"}
        </Badge>
      </section>

      <section className="crm-panel crm-ai-connector-simple-connect">
        <header>
          <div>
            <p>CONNECT</p>
            <h3>Add BrizBuilder to your AI app</h3>
          </div>
          <Badge tone={runtime.configured ? "green" : "orange"}>
            {runtime.configured ? "Ready" : "Unavailable"}
          </Badge>
        </header>

        {!runtime.configured ? (
          <div className="crm-ai-connector-runtime-warning" role="alert">
            <strong>The connector is not available yet.</strong>
            <p>Ask a BrizBuilder administrator to finish setup.</p>
          </div>
        ) : null}

        <div className="crm-ai-connector-simple-body">
          <label className="crm-ai-connector-endpoint">
            <span>Connector address</span>
            <div>
              <input
                value={runtime.endpoint}
                readOnly
                aria-label="Secure AI connector address"
                placeholder="Connector address unavailable"
              />
              <button
                className="crm-button-secondary"
                type="button"
                onClick={() => void handleCopy()}
                disabled={!runtime.endpoint}
              >
                Copy
              </button>
            </div>
          </label>
          <span
            className="crm-ai-connector-copy-status"
            role="status"
            aria-live="polite"
          >
            {copyStatus}
          </span>

          <ol className="crm-ai-connector-simple-steps">
            <li><span>1</span><strong>Select the business above</strong></li>
            <li><span>2</span><strong>Copy the connector address</strong></li>
            <li><span>3</span><strong>Add it to your AI app and approve access</strong></li>
          </ol>

          <p className="crm-ai-connector-compatibility">
            Works with AI apps that support custom MCP connectors. Access is
            limited to the businesses and permissions you approve.
          </p>
        </div>
      </section>

      <section className="crm-panel crm-ai-connector-grants crm-ai-connector-simple-grants">
        <header>
          <div>
            <p>CONNECTED APPS</p>
            <h3>{workspaceName}</h3>
          </div>
          <Badge tone={activeAuthorizations.length ? "green" : "neutral"}>
            {activeAuthorizations.length} active
          </Badge>
        </header>

        {actionError ? <div className="crm-inline-error" role="alert">{actionError}</div> : null}

        {visibleAuthorizations.length ? (
          <div className="crm-ai-connector-simple-apps">
            {visibleAuthorizations.map((authorization) => {
              const active = isActive(authorization.status);
              const lastError = safeMessage(authorization.lastError);
              return (
                <article key={authorization.id}>
                  <div className="crm-ai-connector-app-identity">
                    <span aria-hidden="true">
                      {(authorization.appName.trim()[0] || "A").toUpperCase()}
                    </span>
                    <div>
                      <strong>{authorization.appName || "AI app"}</strong>
                      <small>
                        {authorization.clientIds.length} business{authorization.clientIds.length === 1 ? "" : "es"} · {authorization.scopes.length} permission{authorization.scopes.length === 1 ? "" : "s"}
                      </small>
                    </div>
                  </div>
                  <Badge tone={statusTone(authorization.status)}>
                    {humanize(authorization.status, "Unknown")}
                  </Badge>
                  <time dateTime={authorization.connectedAt}>
                    Connected {dateTime(authorization.connectedAt)}
                  </time>
                  {canManage && active ? (
                    <button
                      className="crm-button-danger"
                      type="button"
                      disabled={revokingId === authorization.id}
                      onClick={() => void revoke(authorization)}
                    >
                      {revokingId === authorization.id ? "Disconnecting..." : "Disconnect"}
                    </button>
                  ) : null}
                  {lastError ? <p role="alert">{lastError}</p> : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="crm-ai-connector-empty">
            <strong>No AI apps connected</strong>
            <span>Use the steps above when you are ready.</span>
          </div>
        )}

        {!canManage ? (
          <p className="crm-ai-connector-view-only">
            Only an account owner or manager can change connections.
          </p>
        ) : null}
      </section>

      {recentActivities.length ? (
        <section className="crm-panel crm-ai-connector-activity crm-ai-connector-simple-activity">
          <header>
            <div>
              <p>RECENT ACTIVITY</p>
              <h3>AI connector history</h3>
            </div>
          </header>
          <div className="crm-ai-connector-activity-list">
            {recentActivities.map((activity) => {
              const clientName = activity.clientId
                ? clientById.get(activity.clientId)?.businessName ??
                  "Restricted business"
                : "Account access";
              return (
                <article key={activity.id}>
                  <span
                    className={`crm-ai-connector-activity-mark ${outcomeTone(activity.outcome)}`}
                    aria-hidden="true"
                  />
                  <div>
                    <strong>
                      {actionLabels[activity.action] ??
                        humanize(activity.action, "CRM action")}
                    </strong>
                    <p>
                      {activity.appName || "AI app"} · {clientName}
                    </p>
                  </div>
                  <Badge tone={outcomeTone(activity.outcome)}>
                    {humanize(activity.outcome, "Recorded")}
                  </Badge>
                  <time dateTime={activity.createdAt}>
                    {dateTime(activity.createdAt)}
                  </time>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <p className="crm-ai-connector-simple-note">
        BrizBuilder limits access to approved businesses and records every AI action.
      </p>
    </div>
  );
}
