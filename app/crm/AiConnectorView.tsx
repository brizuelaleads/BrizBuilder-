"use client";

import { useMemo, useState } from "react";
import type {
  CrmAiActivity,
  CrmAiAuthorization,
  CrmClient,
} from "../../db/crm";
import { Badge, EmptyState, dateTime } from "./ui";

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;

type Runtime = {
  configured: boolean;
  endpoint: string;
};

const CHATGPT_CONNECTORS_URL = "https://chatgpt.com/plugins";

const scopeLabels: Record<string, string> = {
  "crm:read": "View CRM records",
  "crm:tasks.write": "Create follow-up tasks",
  "crm:opportunities.write": "Update opportunities and add notes",
  "crm.read": "Read CRM records",
  "crm.contacts.read": "Find contacts",
  "crm.leads.read": "View leads",
  "crm.tasks.read": "View tasks",
  "crm.appointments.read": "View appointments",
  "crm.tasks.write": "Create follow-up tasks",
  "crm.notes.write": "Add internal notes",
  "crm.opportunities.write": "Update opportunity stages",
  "contacts.read": "Find contacts",
  "leads.read": "View leads",
  "tasks.read": "View tasks",
  "appointments.read": "View appointments",
  "tasks.write": "Create follow-up tasks",
  "notes.write": "Add internal notes",
  "opportunities.write": "Update opportunity stages",
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

const safeCapabilities = [
  {
    eyebrow: "LOOK UP",
    title: "Find CRM information",
    description:
      "Search contacts, leads, tasks, and appointments only inside approved businesses.",
    badge: "Read only",
    tone: "blue" as const,
  },
  {
    eyebrow: "FOLLOW UP",
    title: "Create tasks",
    description:
      "Turn a conversation into a clear follow-up task without sending anything to a customer.",
    badge: "Logged action",
    tone: "purple" as const,
  },
  {
    eyebrow: "ORGANIZE",
    title: "Add internal notes",
    description:
      "Save useful context to the correct CRM record. Notes remain inside BrizBuilder.",
    badge: "Logged action",
    tone: "purple" as const,
  },
  {
    eyebrow: "PIPELINE",
    title: "Update opportunity stages",
    description:
      "Move an approved opportunity to a new stage while preserving a complete audit trail.",
    badge: "Controlled update",
    tone: "orange" as const,
  },
];

const blockedActions = [
  "Delete CRM records or erase activity history",
  "Send texts or emails, or place phone calls",
  "Open businesses that were not approved during connection",
  "Charge cards, move money, or reveal passwords and secret keys",
];

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
        .slice(0, 20),
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
          <h2>Use the AI account you already have</h2>
          <span>
            Give a compatible AI app limited access to help organize your CRM.
            You keep control of every business and permission.
          </span>
        </div>
        <div className="crm-ai-connector-heading-status" aria-live="polite">
          <Badge
            tone={
              connectionState === "connected"
                ? "green"
                : connectionState === "setup"
                  ? "orange"
                  : "blue"
            }
          >
            {connectionState === "connected"
              ? "Connected"
              : connectionState === "setup"
                ? "Setup needed"
                : "Ready to connect"}
          </Badge>
          <strong>{workspaceName}</strong>
          <small>
            {activeAuthorizations.length
              ? `${activeAuthorizations.length} active AI connection${activeAuthorizations.length === 1 ? "" : "s"}`
              : "No AI app currently has access"}
          </small>
        </div>
      </section>

      <section className="crm-ai-connector-cost-note" role="note">
        <span className="crm-ai-connector-cost-icon" aria-hidden="true">
          $0
        </span>
        <div>
          <strong>No BrizBuilder AI usage bill</strong>
          <p>
            BrizBuilder does not call a paid model API or add per-message AI
            charges. You use your own AI account under that provider&apos;s plan
            limits and connector availability.
          </p>
        </div>
        <Badge tone="green">Bring your own AI account</Badge>
      </section>

      <section className="crm-ai-connector-setup-grid">
        <article className="crm-panel crm-ai-connector-setup-card">
          <header>
            <div>
              <p>CONNECT IN MINUTES</p>
              <h3>Add BrizBuilder to your AI app</h3>
            </div>
            <Badge tone={runtime.configured ? "green" : "orange"}>
              {runtime.configured ? "Connector online" : "Server setup needed"}
            </Badge>
          </header>

          {!runtime.configured ? (
            <div className="crm-ai-connector-runtime-warning" role="alert">
              <strong>The secure connector is not online yet.</strong>
              <p>
                A BrizBuilder administrator needs to finish the server setup
                before an AI app can connect. No CRM access has been opened.
              </p>
            </div>
          ) : null}

          <label className="crm-ai-connector-endpoint">
            <span>Secure connector address</span>
            <div>
              <input
                value={runtime.endpoint}
                readOnly
                aria-label="Secure AI connector address"
                placeholder="Connector address will appear after setup"
              />
              <button
                className="crm-button-secondary"
                type="button"
                onClick={() => void handleCopy()}
                disabled={!runtime.endpoint}
              >
                Copy address
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

          <ol className="crm-ai-connector-steps">
            <li>
              <span>1</span>
              <div>
                <strong>Choose the business</strong>
                <p>
                  Use the business switcher above. The AI can never move beyond
                  the businesses you approve.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Copy the connector address</strong>
                <p>This is the secure address your AI app needs.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Add it in your AI app</strong>
                <p>
                  Open Settings &rarr; Plugins, choose the plus button, and
                  paste the address as the MCP server URL.
                </p>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>Review and approve access</strong>
                <p>
                  BrizBuilder shows the exact businesses and actions before the
                  connection is approved.
                </p>
              </div>
            </li>
          </ol>

          <div className="crm-ai-connector-setup-actions">
            <a
              className={`crm-button-primary ${!runtime.configured ? "disabled" : ""}`}
              href={runtime.configured ? CHATGPT_CONNECTORS_URL : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!runtime.configured}
              onClick={(event) => {
                if (!runtime.configured) event.preventDefault();
              }}
            >
              Open ChatGPT Plugins
            </a>
            <small>
              Chat happens inside your AI app, not inside BrizBuilder.
            </small>
          </div>
        </article>

        <aside className="crm-panel crm-ai-connector-safety-card">
          <header>
            <div>
              <p>CURRENT ACCESS</p>
              <h3>{workspaceName}</h3>
            </div>
          </header>
          <div className="crm-ai-connector-access-summary">
            <span
              className={`crm-ai-connector-access-light ${activeAuthorizations.length ? "active" : ""}`}
              aria-hidden="true"
            />
            <div>
              <strong>
                {activeAuthorizations.length
                  ? "AI access is active"
                  : "AI access is off"}
              </strong>
              <p>
                {activeAuthorizations.length
                  ? "Only the permissions shown below are available."
                  : "No AI app can read or change CRM data for this view."}
              </p>
            </div>
          </div>
          <dl className="crm-ai-connector-access-facts">
            <div>
              <dt>AI apps</dt>
              <dd>{activeAuthorizations.length}</dd>
            </div>
            <div>
              <dt>Business view</dt>
              <dd>{workspaceName}</dd>
            </div>
            <div>
              <dt>Every action logged</dt>
              <dd>Yes</dd>
            </div>
            <div>
              <dt>Customer messages</dt>
              <dd>Blocked</dd>
            </div>
          </dl>
          <div className="crm-ai-connector-safety-note">
            <strong>You are always in control</strong>
            <p>
              Disconnecting an app stops future access immediately. It does not
              delete your CRM records or change your AI subscription.
            </p>
          </div>
        </aside>
      </section>

      <section className="crm-ai-connector-capabilities">
        <header>
          <div>
            <p>SAFE CRM TOOLS</p>
            <h3>What a connected AI can help with</h3>
            <span>
              The connector offers a small, approved set of tools instead of
              broad access to your database.
            </span>
          </div>
        </header>
        <div className="crm-ai-connector-capability-grid">
          {safeCapabilities.map((capability) => (
            <article key={capability.title}>
              <p>{capability.eyebrow}</p>
              <h4>{capability.title}</h4>
              <span>{capability.description}</span>
              <Badge tone={capability.tone}>{capability.badge}</Badge>
            </article>
          ))}
        </div>
      </section>

      <section className="crm-panel crm-ai-connector-grants">
        <header>
          <div>
            <p>AUTHORIZED AI APPS</p>
            <h3>Connections for {workspaceName}</h3>
            <span>
              Review exactly which businesses and CRM actions each app can use.
            </span>
          </div>
          <Badge tone={activeAuthorizations.length ? "green" : "neutral"}>
            {activeAuthorizations.length} active
          </Badge>
        </header>

        {actionError ? (
          <div className="crm-inline-error" role="alert">
            {actionError}
          </div>
        ) : null}

        {visibleAuthorizations.length ? (
          <div className="crm-ai-connector-grant-list">
            {visibleAuthorizations.map((authorization) => {
              const active = isActive(authorization.status);
              const businessNames = authorization.clientIds
                .map((clientId) => clientById.get(clientId)?.businessName)
                .filter((name): name is string => Boolean(name));
              const lastError = safeMessage(authorization.lastError);
              return (
                <article key={authorization.id}>
                  <header>
                    <div className="crm-ai-connector-app-identity">
                      <span aria-hidden="true">
                        {(authorization.appName.trim()[0] || "A").toUpperCase()}
                      </span>
                      <div>
                        <strong>{authorization.appName || "AI app"}</strong>
                        <small>
                          Connected by {authorization.connectedByEmail || "an authorized user"}
                        </small>
                      </div>
                    </div>
                    <Badge tone={statusTone(authorization.status)}>
                      {humanize(authorization.status, "Unknown")}
                    </Badge>
                  </header>

                  <div className="crm-ai-connector-grant-details">
                    <section>
                      <p>BUSINESS ACCESS</p>
                      <div className="crm-ai-connector-chip-list">
                        {businessNames.length ? (
                          businessNames.map((name) => (
                            <span key={name}>{name}</span>
                          ))
                        ) : (
                          <span>No business access</span>
                        )}
                      </div>
                    </section>
                    <section>
                      <p>ALLOWED ACTIONS</p>
                      <div className="crm-ai-connector-chip-list">
                        {authorization.scopes.length ? (
                          authorization.scopes.map((scope) => (
                            <span key={scope}>
                              {scopeLabels[scope] ?? humanize(scope, "Limited CRM access")}
                            </span>
                          ))
                        ) : (
                          <span>No actions approved</span>
                        )}
                      </div>
                    </section>
                  </div>

                  <dl className="crm-ai-connector-grant-meta">
                    <div>
                      <dt>Connected</dt>
                      <dd>{dateTime(authorization.connectedAt)}</dd>
                    </div>
                    <div>
                      <dt>Last used</dt>
                      <dd>
                        {authorization.lastUsedAt
                          ? dateTime(authorization.lastUsedAt)
                          : "Not used yet"}
                      </dd>
                    </div>
                    <div>
                      <dt>Last successful action</dt>
                      <dd>
                        {authorization.lastSuccessAt
                          ? dateTime(authorization.lastSuccessAt)
                          : "None yet"}
                      </dd>
                    </div>
                  </dl>

                  {lastError ? (
                    <div className="crm-ai-connector-grant-error" role="alert">
                      <strong>Connection needs attention</strong>
                      <p>{lastError}</p>
                    </div>
                  ) : null}

                  <footer>
                    <small>
                      {active
                        ? "Disconnecting stops future access immediately."
                        : "This authorization no longer has CRM access."}
                    </small>
                    {canManage && active ? (
                      <button
                        className="crm-button-danger"
                        type="button"
                        disabled={revokingId === authorization.id}
                        onClick={() => void revoke(authorization)}
                      >
                        {revokingId === authorization.id
                          ? "Disconnecting..."
                          : "Disconnect"}
                      </button>
                    ) : null}
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={`No AI app connected to ${workspaceName}`}
            description={
              runtime.configured
                ? "Copy the connector address above and add it in your AI app when you are ready. Nothing can access this CRM view until you approve it."
                : "Finish the secure connector setup first. No AI app currently has access to this CRM view."
            }
          />
        )}

        {!canManage ? (
          <p className="crm-ai-connector-view-only">
            You can review AI activity, but only an account owner or manager can
            connect or disconnect an AI app.
          </p>
        ) : null}
      </section>

      <section className="crm-ai-connector-guardrails">
        <div>
          <p>PERMANENT GUARDRAILS</p>
          <h3>Actions this connector will not perform</h3>
          <span>
            These limits protect customer information even if an AI response is
            wrong or misleading.
          </span>
        </div>
        <ul>
          {blockedActions.map((action) => (
            <li key={action}>
              <span aria-hidden="true">×</span>
              <strong>{action}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="crm-panel crm-ai-connector-activity">
        <header>
          <div>
            <p>AI ACTIVITY</p>
            <h3>Recent connector history</h3>
            <span>
              Only the app, action, business, result, and time are shown here.
              Prompts and customer record contents are not displayed.
            </span>
          </div>
          <Badge tone="neutral">Sanitized log</Badge>
        </header>

        {recentActivities.length ? (
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
        ) : (
          <EmptyState
            title="No AI activity yet"
            description="After you connect an AI app, each allowed request and result will appear here without exposing prompts or customer record contents."
          />
        )}
      </section>
    </div>
  );
}
