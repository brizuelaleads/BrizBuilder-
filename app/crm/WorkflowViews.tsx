"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  CrmAiAuthorization,
  CrmClient,
  CrmProviderConnection,
  CrmStage,
  CrmWorkflow,
  CrmWorkflowEdge,
  CrmWorkflowNode,
  CrmWorkflowRun,
} from "../../db/crm";
import { Badge } from "./ui";

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;

type TwilioVisibleBalance = {
  balance: number | null;
  currency: string | null;
  balanceStatus: "parent" | "available" | "shared" | "unavailable";
};

function clientChoice(
  clients: CrmClient[],
  selectedClientId: string,
  local: string,
) {
  return selectedClientId !== "all"
    ? selectedClientId
    : local || clients[0]?.id || "";
}

export function ConnectionsView({
  clients,
  connections,
  aiAuthorizations,
  selectedClientId,
  mutate,
  canReadSharedBilling,
  onOpenAiConnector,
}: {
  clients: CrmClient[];
  connections: CrmProviderConnection[];
  aiAuthorizations: CrmAiAuthorization[];
  selectedClientId: string;
  mutate: Mutate;
  canReadSharedBilling: boolean;
  onOpenAiConnector: (clientId: string) => void;
}) {
  const [localClient, setLocalClient] = useState(clients[0]?.id ?? "");
  const clientId = clientChoice(clients, selectedClientId, localClient);
  const client = clients.find((item) => item.id === clientId);
  const connection = connections.find(
    (item) => item.clientId === clientId && item.provider === "twilio",
  );
  const isLinked = Boolean(connection?.isLinked);
  const isActive = Boolean(connection?.isActive);
  const activeAiAuthorizations = aiAuthorizations.filter(
    (authorization) =>
      authorization.status === "active" &&
      authorization.clientIds.includes(clientId),
  );
  const aiConnected = activeAiAuthorizations.length > 0;
  const metaConnection = connections.find(
    (item) => item.clientId === clientId && item.provider === "meta",
  );
  const metaLinked = Boolean(metaConnection?.isLinked);
  const metaLive = metaConnection?.mode === "live";
  const [metaDatasetId, setMetaDatasetId] = useState("");
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaTestEventCode, setMetaTestEventCode] = useState("");
  const callRailConnection = connections.find(
    (item) => item.clientId === clientId && item.provider === "callrail",
  );
  // A CallRail connection exists as soon as the key is stored, which is before
  // an account or company has been chosen. isLinked is keyed on the external
  // account id and would read false during that window, so status is what
  // decides whether the connect form or the setup steps are shown.
  const callRailStored =
    callRailConnection?.status === "connected" ||
    callRailConnection?.status === "setup_required" ||
    callRailConnection?.status === "attention";
  const callRailSetup = callRailConnection?.setupStatus ?? null;
  const emptyCallRail = {
    apiKey: "",
    accounts: [] as Array<{ id: string; name: string }>,
    companies: [] as Array<{ id: string; name: string }>,
    check: "",
  };
  const [callRailState, setCallRailState] = useState({
    clientId,
    ...emptyCallRail,
  });
  // Scoped by deriving during render rather than by clearing in an effect:
  // anything fetched for one business is simply not shown against another, and
  // switching business costs no cascading render.
  const callRail =
    callRailState.clientId === clientId
      ? callRailState
      : { clientId, ...emptyCallRail };
  const patchCallRail = (patch: Partial<typeof emptyCallRail>) =>
    setCallRailState({ ...callRail, clientId, ...patch });
  const [balanceResult, setBalanceResult] = useState<{
    key: string;
    data: TwilioVisibleBalance | null;
    error: string | null;
  }>({ key: "", data: null, error: null });
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const balanceRequestKey = `${clientId}:${connection?.connectedAt ?? ""}:${balanceRefreshKey}`;

  useEffect(() => {
    const controller = new AbortController();
    if (!canReadSharedBilling || !isLinked || !clientId)
      return () => controller.abort();

    void fetch(
      `/api/integrations/twilio/balance?clientId=${encodeURIComponent(clientId)}&refresh=${balanceRefreshKey > 0 ? "true" : "false"}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          data?: TwilioVisibleBalance;
          error?: string;
        };
        if (!response.ok || !payload.data)
          throw new Error(payload.error || "Twilio balance could not be loaded.");
        return payload.data;
      })
      .then((data) => {
        if (!controller.signal.aborted)
          setBalanceResult({ key: balanceRequestKey, data, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setBalanceResult({
            key: balanceRequestKey,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : "Twilio balance could not be loaded.",
          });
      });

    return () => controller.abort();
  }, [
    balanceRefreshKey,
    balanceRequestKey,
    canReadSharedBilling,
    clientId,
    isLinked,
  ]);

  const currentBalanceResult =
    canReadSharedBilling && isLinked && balanceResult.key === balanceRequestKey
      ? balanceResult
      : null;
  const visibleBalance = currentBalanceResult?.data ?? null;
  const balanceError = currentBalanceResult?.error ?? null;
  const balanceLoading = Boolean(
    canReadSharedBilling &&
      isLinked &&
      clientId &&
      balanceResult.key !== balanceRequestKey,
  );
  const displayedBalance = visibleBalance?.balance ?? null;
  const displayedBalanceStatus =
    visibleBalance?.balanceStatus ?? connection?.balanceStatus;
  const displayedCurrency = visibleBalance?.currency ?? connection?.currency;
  const money = (
    value: number | null | undefined,
    currency = connection?.currency,
  ) =>
    value == null
      ? isLinked
        ? "Not available"
        : "Not loaded"
      : new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currency || "USD",
        }).format(value);
  const lowBalance =
    canReadSharedBilling &&
    displayedBalance != null &&
    displayedBalance < 10;

  return (
    <div className="crm-view crm-connections-view">
      <section className="crm-page-heading">
        <div>
          <p>EXTERNAL INTEGRATIONS</p>
          <h2>Connections</h2>
          <span>
            Connect and monitor every outside service used by this business in
            one place.
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
            Connections belong to one business and cannot be shared across
            clients.
          </p>
        </section>
      ) : (
        <div className="crm-connection-grid">
          <article className="crm-connection-card featured">
            <header>
              <span className="crm-provider-logo twilio">T</span>
              <div>
                <h3>Twilio</h3>
                <p>Business phone system, calls and two-way texting</p>
              </div>
              <Badge tone={isLinked ? "green" : "orange"}>
                {isLinked ? "Connected" : "Not connected"}
              </Badge>
            </header>
            <div className="crm-connection-details crm-connection-details-simple">
              <div className="crm-twilio-balance"><span>Available balance</span><strong>{connection?.balanceStatus === "restricted" ? "Restricted" : balanceLoading ? "Loading..." : balanceError ? "Not available" : displayedBalanceStatus === "shared" ? "Shared balance" : money(displayedBalance, displayedCurrency)}</strong></div>
              <div><span>Calls this month</span><strong>{connection?.monthCalls ?? (isLinked ? "—" : "Not connected")}</strong></div>
              <div><span>Texts this month</span><strong>{connection?.monthMessages ?? (isLinked ? "—" : "Not connected")}</strong></div>
              <div><span>Status</span><strong>{isActive ? "Active" : isLinked ? "Needs attention" : "Not connected"}</strong></div>
            </div>
            {lowBalance ? (
              <p className="crm-balance-warning">
                <strong>Low Twilio balance.</strong> Add funds in Twilio soon so calls, texts and automations do not stop.
              </p>
            ) : null}
            {connection?.lastError ? (
              <p className="crm-inline-error">
                <strong>Needs attention:</strong> {connection.lastError}
              </p>
            ) : null}
            <div className="crm-connection-actions">
              {isLinked ? (
                <>
                  <button
                    onClick={async () => {
                      await mutate(
                        { action: "check_provider_connection", clientId },
                        "Twilio connection status refreshed.",
                      );
                      setBalanceRefreshKey((value) => value + 1);
                    }}
                  >
                    Refresh connection
                  </button>
                  <button
                    className="danger"
                    onClick={() =>
                      window.confirm(
                        "Disconnect Twilio? Phone calls, texts and automations will stop.",
                      ) &&
                      mutate(
                        { action: "disconnect_provider", clientId },
                        "Twilio disconnected.",
                      )
                    }
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <a
                  className="crm-button-primary"
                  href={`/api/integrations/twilio/connect?clientId=${encodeURIComponent(clientId)}`}
                >
                  Connect
                </a>
              )}
            </div>
          </article>
          <article className="crm-connection-card ai">
            <header>
              <span className="crm-provider-logo ai">AI</span>
              <div>
                <h3>AI Connector</h3>
                <p>Let your own AI account safely work with this CRM</p>
              </div>
              <Badge tone={aiConnected ? "green" : "orange"}>
                {aiConnected ? "Connected" : "Not connected"}
              </Badge>
            </header>
            <div className="crm-connection-details compact crm-connection-details-simple">
              <div><span>Status</span><strong>{aiConnected ? "Active" : "Not connected"}</strong></div>
              <div><span>Connected apps</span><strong>{activeAiAuthorizations.length}</strong></div>
            </div>
            <div className="crm-connection-actions">
              <button
                className="crm-button-primary"
                type="button"
                onClick={() => onOpenAiConnector(clientId)}
              >
                {aiConnected ? "Manage" : "Connect"}
              </button>
              {activeAiAuthorizations.length === 1 ? (
                <button
                  className="danger"
                  type="button"
                  onClick={() => {
                    const authorization = activeAiAuthorizations[0];
                    if (
                      authorization &&
                      window.confirm(
                        `Disconnect ${authorization.appName}? It will immediately lose access to every business approved for this connection.`,
                      )
                    ) {
                      void mutate(
                        {
                          action: "revoke_ai_authorization",
                          authorizationId: authorization.id,
                        },
                        `${authorization.appName} disconnected.`,
                      );
                    }
                  }}
                >
                  Disconnect
                </button>
              ) : null}
            </div>
          </article>
          <article className="crm-connection-card meta">
            <header>
              <span className="crm-provider-logo meta">M</span>
              <div>
                <h3>Meta Conversions</h3>
                <p>Report which ad clicks became leads and paying customers</p>
              </div>
              <Badge tone={!metaLinked ? "orange" : metaLive ? "green" : "purple"}>
                {!metaLinked ? "Not connected" : metaLive ? "Live" : "Test mode"}
              </Badge>
            </header>
            <div className="crm-connection-details compact crm-connection-details-simple">
              <div><span>Dataset</span><strong>{metaConnection?.accountLabel ?? "Not connected"}</strong></div>
              <div>
                <span>Mode</span>
                <strong>
                  {!metaLinked
                    ? "Not connected"
                    : metaLive
                      ? "Live"
                      : "Test mode"}
                </strong>
              </div>
            </div>
            {metaLinked ? (
              <>
                {metaLive ? (
                  <p className="crm-connection-note">
                    Conversions from this business count toward its ad
                    optimization.
                  </p>
                ) : (
                  <p className="crm-connection-note">
                    Conversions are sent with a test event code so they show in
                    Meta&rsquo;s Test Events view. Meta only routes them there
                    while that code is the active one for this dataset, so check
                    Test Events to confirm they are arriving. Go live when you
                    want conversions to start counting.
                  </p>
                )}
                <div className="crm-connection-actions">
                  {metaLive ? null : (
                    <button
                      className="crm-button-primary"
                      type="button"
                      onClick={() =>
                        window.confirm(
                          "Go live? Conversions will start counting toward this business's ad optimization. Returning to test mode means disconnecting and reconnecting with a new test event code.",
                        ) &&
                        mutate(
                          { action: "set_meta_conversions_live", clientId },
                          "Meta is now live.",
                        )
                      }
                    >
                      Go live
                    </button>
                  )}
                  <button
                    className="danger"
                    type="button"
                    onClick={() =>
                      window.confirm(
                        "Disconnect Meta? Facebook and Instagram will stop learning which ad clicks turn into customers.",
                      ) &&
                      mutate(
                        { action: "disconnect_meta_conversions", clientId },
                        "Meta disconnected.",
                      )
                    }
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <form
                className="crm-connection-connect-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await mutate(
                    {
                      action: "connect_meta_conversions",
                      clientId,
                      datasetId: metaDatasetId,
                      accessToken: metaAccessToken,
                      testEventCode: metaTestEventCode,
                    },
                    "Meta conversions connected.",
                  );
                  // Never keep the customer's token in browser state after use.
                  setMetaAccessToken("");
                }}
              >
                <p>
                  This business creates both of these in their own Meta Events
                  Manager, on the dataset for their pixel. BrizBuilder stores the
                  token encrypted and never sees their Meta password.
                </p>
                <label>
                  Dataset (pixel) ID
                  <input
                    value={metaDatasetId}
                    onChange={(event) => setMetaDatasetId(event.target.value)}
                    inputMode="numeric"
                    placeholder="1234567890123456"
                    required
                  />
                </label>
                <label>
                  Conversions API access token
                  <input
                    type="password"
                    value={metaAccessToken}
                    onChange={(event) => setMetaAccessToken(event.target.value)}
                    autoComplete="off"
                    required
                  />
                </label>
                <label>
                  Test event code
                  <input
                    value={metaTestEventCode}
                    onChange={(event) =>
                      setMetaTestEventCode(event.target.value)
                    }
                    autoComplete="off"
                    placeholder="From the Test Events tab"
                    required
                  />
                </label>
                <p>
                  Connecting sends one test event to confirm the token works. The
                  test event code keeps it in the Test Events view, out of this
                  business&rsquo;s real reporting.
                </p>
                <button className="crm-button-primary" type="submit">
                  Connect
                </button>
              </form>
            )}
          </article>
          <article className="crm-connection-card callrail">
            <header>
              <span className="crm-provider-logo callrail">CR</span>
              <div>
                <h3>CallRail</h3>
                <p>See which ads and pages produce phone calls</p>
              </div>
              <Badge
                tone={
                  !callRailStored
                    ? "orange"
                    : callRailConnection?.status === "attention"
                      ? "orange"
                      : callRailSetup === "ready"
                        ? "green"
                        : "purple"
                }
              >
                {!callRailStored
                  ? "Not connected"
                  : callRailConnection?.status === "attention"
                    ? "Needs attention"
                    : callRailSetup === "ready"
                      ? "Connected"
                      : "Finish setup"}
              </Badge>
            </header>
            {callRailStored ? (
              <>
                <div className="crm-connection-details compact crm-connection-details-simple">
                  <div>
                    <span>Account</span>
                    <strong>
                      {callRailConnection?.accountLabel ?? "Not chosen yet"}
                    </strong>
                  </div>
                  <div>
                    <span>Company</span>
                    <strong>
                      {callRailConnection?.companyName ?? "Not chosen yet"}
                    </strong>
                  </div>
                  <div>
                    <span>Tracking script</span>
                    <strong>
                      {callRailConnection?.dniActive === true
                        ? "Detected on the site"
                        : callRailConnection?.dniActive === false
                          ? "Not detected"
                          : "Never installed"}
                    </strong>
                  </div>
                  <div>
                    <span>CallScribe</span>
                    <strong>
                      {callRailConnection?.callScribeEnabled === true
                        ? "Enabled on this company"
                        : callRailConnection?.callScribeEnabled === false
                          ? "Off for this company"
                          : "Unknown"}
                    </strong>
                  </div>
                </div>
                <p className="crm-connection-note">
                  CallScribe being enabled means the feature is switched on for
                  this company. It does not confirm that this CallRail
                  subscription returns call transcripts through the API — that
                  is a separate plan entitlement, and an account can show
                  CallScribe on while the API still returns nothing. Confirm it
                  with CallRail before relying on transcripts.
                </p>
                {callRailSetup !== "ready" ? (
                  <div className="crm-connection-connect-form">
                    {callRailSetup === "needs_account" ? (
                      callRail.accounts.length > 0 ? (
                        <label>
                          CallRail account
                          <select
                            defaultValue=""
                            onChange={async (event) => {
                              const accountId = event.target.value;
                              if (!accountId) return;
                              const result = (await mutate(
                                {
                                  action: "select_callrail_account",
                                  clientId,
                                  accountId,
                                },
                                "CallRail account selected.",
                              )) as {
                                companies?: Array<{ id: string; name: string }>;
                              } | null;
                              patchCallRail({ companies: result?.companies ?? [] });
                            }}
                          >
                            <option value="">Choose an account…</option>
                            {callRail.accounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <button
                          className="crm-button-primary"
                          type="button"
                          onClick={async () => {
                            const result = (await mutate(
                              { action: "list_callrail_accounts", clientId },
                              "Accounts loaded.",
                            )) as {
                              accounts?: Array<{ id: string; name: string }>;
                            } | null;
                            patchCallRail({ accounts: result?.accounts ?? [] });
                          }}
                        >
                          Choose an account
                        </button>
                      )
                    ) : callRail.companies.length > 0 ? (
                      <label>
                        CallRail company
                        <select
                          defaultValue=""
                          onChange={async (event) => {
                            const companyId = event.target.value;
                            if (!companyId) return;
                            await mutate(
                              {
                                action: "select_callrail_company",
                                clientId,
                                companyId,
                              },
                              "CallRail company selected.",
                            );
                          }}
                        >
                          <option value="">Choose a company…</option>
                          {callRail.companies.map((company) => (
                            <option key={company.id} value={company.id}>
                              {company.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <button
                        className="crm-button-primary"
                        type="button"
                        onClick={async () => {
                          const result = (await mutate(
                            { action: "list_callrail_companies", clientId },
                            "Companies loaded.",
                          )) as {
                            companies?: Array<{ id: string; name: string }>;
                          } | null;
                          patchCallRail({ companies: result?.companies ?? [] });
                        }}
                      >
                        Choose a company
                      </button>
                    )}
                  </div>
                ) : null}
                {callRail.check ? (
                  <p className="crm-connection-note">{callRail.check}</p>
                ) : null}
                <div className="crm-connection-actions">
                  <button
                    type="button"
                    onClick={async () => {
                      const result = (await mutate(
                        { action: "check_callrail_connection", clientId },
                        "CallRail connection checked.",
                      )) as { ok?: boolean; message?: string | null } | null;
                      patchCallRail({
                        check: result?.ok
                          ? "CallRail answered and the selected company is reachable."
                          : (result?.message ??
                            "CallRail did not confirm the connection."),
                      });
                    }}
                  >
                    Check connection
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() =>
                      window.confirm(
                        "Disconnect CallRail? The stored API key is deleted. Call tracking in CallRail keeps running; BrizBuilder simply stops reading it.",
                      ) &&
                      mutate(
                        { action: "disconnect_callrail", clientId },
                        "CallRail disconnected.",
                      ).then(() =>
                        patchCallRail({
                          accounts: [],
                          companies: [],
                          check: "",
                        }),
                      )
                    }
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <form
                className="crm-connection-connect-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const result = (await mutate(
                    {
                      action: "connect_callrail",
                      clientId,
                      apiKey: callRail.apiKey,
                    },
                    "CallRail connected.",
                  )) as {
                    accounts?: Array<{ id: string; name: string }>;
                    companies?: Array<{ id: string; name: string }>;
                  } | null;
                  // Never keep the customer's key in browser state after use.
                  patchCallRail({
                    accounts: result?.accounts ?? [],
                    companies: result?.companies ?? [],
                    apiKey: "",
                  });
                }}
              >
                <p>
                  This business creates the key in their own CallRail account,
                  under a user that can see the company you want to track.
                  BrizBuilder stores it encrypted and never shows it again.
                </p>
                <label>
                  CallRail API key
                  <input
                    type="password"
                    value={callRail.apiKey}
                    onChange={(event) => patchCallRail({ apiKey: event.target.value })}
                    autoComplete="off"
                    required
                  />
                </label>
                <p>
                  No account ID is needed. BrizBuilder asks CallRail which
                  accounts this key can reach and lets you pick from those, so a
                  mistyped ID cannot point the connection at the wrong place.
                </p>
                <button className="crm-button-primary" type="submit">
                  Connect
                </button>
              </form>
            )}
          </article>
        </div>
      )}
    </div>
  );
}

const nodeLibrary: Array<{
  type: CrmWorkflowNode["type"];
  label: string;
  description: string;
  color: string;
}> = [
  {
    type: "send_sms",
    label: "Send SMS",
    description: "Send a compliant text",
    color: "violet",
  },
  {
    type: "create_task",
    label: "Create task",
    description: "Assign team follow-up",
    color: "blue",
  },
  {
    type: "add_tag",
    label: "Add contact tag",
    description: "Organize the contact",
    color: "green",
  },
  {
    type: "update_stage",
    label: "Update lead stage",
    description: "Move an opportunity",
    color: "orange",
  },
  {
    type: "condition",
    label: "If / else",
    description: "Choose a path",
    color: "gray",
  },
];

function defaultConfig(
  type: CrmWorkflowNode["type"],
): CrmWorkflowNode["config"] {
  if (type === "send_sms")
    return {
      message:
        "Hi {{contact_first_name}}, how can we help? Reply STOP to unsubscribe.",
    };
  if (type === "create_task")
    return {
      title: "Follow up with {{contact_first_name}}",
      priority: "MEDIUM",
    };
  if (type === "add_tag") return { tag: "automation" };
  if (type === "update_stage") return { stageId: "" };
  if (type === "condition")
    return { field: "serviceRequested", operator: "contains", value: "" };
  return { eventKey: "lead.created" };
}

function lineStyle(source: CrmWorkflowNode, target: CrmWorkflowNode) {
  const x1 = source.x + 190,
    y1 = source.y + 42,
    x2 = target.x,
    y2 = target.y + 42;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return { left: x1, top: y1, width: length, transform: `rotate(${angle}deg)` };
}

function WorkflowEditor({
  workflow,
  clients,
  stages,
  runs,
  mutate,
  onBack,
}: {
  workflow: CrmWorkflow;
  clients: CrmClient[];
  stages: CrmStage[];
  runs: CrmWorkflowRun[];
  mutate: Mutate;
  onBack: () => void;
}) {
  const [graph, setGraph] = useState(workflow.graph);
  const [selectedId, setSelectedId] = useState(
    workflow.graph.nodes[0]?.id ?? "",
  );
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [drag, setDrag] = useState<{
    id: string;
    dx: number;
    dy: number;
  } | null>(null);
  const selected = graph.nodes.find((node) => node.id === selectedId);
  const client = clients.find((item) => item.id === workflow.clientId);
  function addNode(item: (typeof nodeLibrary)[number]) {
    const id = `${item.type}-${crypto.randomUUID().slice(0, 8)}`;
    const source = selected ?? graph.nodes.at(-1);
    const node: CrmWorkflowNode = {
      id,
      type: item.type,
      label: item.label,
      x: source ? Math.min(source.x + 280, 920) : 360,
      y:
        source && source.x > 800 ? source.y + 150 : (source?.y ?? 180),
      config: defaultConfig(item.type),
    };
    const edge: CrmWorkflowEdge | null = source
      ? {
          id: `edge-${crypto.randomUUID().slice(0, 8)}`,
          source: source.id,
          target: id,
          branch: source.type === "condition" ? "yes" : "always",
        }
      : null;
    setGraph({
      nodes: [...graph.nodes, node],
      edges: edge ? [...graph.edges, edge] : graph.edges,
    });
    setSelectedId(id);
  }
  function updateSelected(
    patch: Partial<CrmWorkflowNode>,
    config?: Record<string, string | number | boolean>,
  ) {
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === selectedId
          ? {
              ...node,
              ...patch,
              config: config ? { ...node.config, ...config } : node.config,
            }
          : node,
      ),
    }));
  }
  function removeSelected() {
    if (!selected || selected.type === "trigger") return;
    setGraph((current) => ({
      nodes: current.nodes.filter((node) => node.id !== selected.id),
      edges: current.edges.filter(
        (edge) => edge.source !== selected.id && edge.target !== selected.id,
      ),
    }));
    setSelectedId(graph.nodes[0]?.id ?? "");
  }
  function updateEdge(edgeId: string, patch: Partial<CrmWorkflowEdge>) {
    setGraph((current) => ({
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === edgeId ? { ...edge, ...patch } : edge,
      ),
    }));
  }
  function removeEdge(edgeId: string) {
    setGraph((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.id !== edgeId),
    }));
  }
  function addConnection() {
    if (!selected) return;
    const existingTargets = new Set(
      graph.edges
        .filter((edge) => edge.source === selected.id)
        .map((edge) => edge.target),
    );
    const target = graph.nodes.find(
      (node) => node.id !== selected.id && !existingTargets.has(node.id),
    );
    if (!target) return;
    setGraph((current) => ({
      ...current,
      edges: [
        ...current.edges,
        {
          id: `edge-${crypto.randomUUID().slice(0, 8)}`,
          source: selected.id,
          target: target.id,
          branch: selected.type === "condition" ? "no" : "always",
        },
      ],
    }));
  }
  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === drag.id
          ? {
              ...node,
              x: Math.max(
                20,
                Math.min(1000, event.clientX - rect.left - drag.dx),
              ),
              y: Math.max(
                20,
                Math.min(620, event.clientY - rect.top - drag.dy),
              ),
            }
          : node,
      ),
    }));
  }
  async function save() {
    await mutate(
      {
        action: "save_workflow",
        workflowId: workflow.id,
        name,
        description,
        graph,
      },
      "Workflow draft saved.",
    );
  }
  async function test() {
    await save();
    await mutate(
      { action: "test_workflow", workflowId: workflow.id },
      "Safe test completed. No outside actions were sent.",
    );
  }
  async function publish() {
    await save();
    await mutate(
      { action: "publish_workflow", workflowId: workflow.id },
      "Workflow published.",
    );
  }
  return (
    <div className="crm-workflow-builder">
      <header className="crm-builder-header">
        <button onClick={onBack}>← Workflows</button>
        <div>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Workflow name"
          />
          <span>
            {client?.businessName} · Version {workflow.currentVersion}
          </span>
        </div>
        <div>
          <Badge tone={workflow.status === "active" ? "green" : "orange"}>
            {workflow.status.replaceAll("_", " ")}
          </Badge>
          <button onClick={test}>
            Test
          </button>
          <button onClick={save}>Save draft</button>
          {workflow.status === "active" ? (
            <button
              onClick={() =>
                mutate(
                  { action: "pause_workflow", workflowId: workflow.id },
                  "Workflow paused.",
                )
              }
            >
              Pause
            </button>
          ) : (
            <button className="crm-button-primary" onClick={publish}>
              Publish
            </button>
          )}
        </div>
      </header>
      <div className="crm-builder-body">
        <aside className="crm-node-library">
          <p>STEPS</p>
          {nodeLibrary.map((item) => (
            <button key={item.type} onClick={() => addNode(item)}>
              <i className={item.color}>{item.label.slice(0, 2)}</i>
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <b>+</b>
            </button>
          ))}
          <div className="crm-builder-help">
            <strong>How it works</strong>
            <p>
              Add steps, drag them into place, select each one to configure it,
              then test before publishing.
            </p>
          </div>
        </aside>
        <div
          className="crm-workflow-canvas"
          onPointerMove={pointerMove}
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
        >
          {graph.edges.map((edge) => {
            const source = graph.nodes.find((node) => node.id === edge.source);
            const target = graph.nodes.find((node) => node.id === edge.target);
            return source && target ? (
              <i
                className="crm-visual-edge"
                key={edge.id}
                style={lineStyle(source, target)}
              >
                <b>
                  {edge.branch && edge.branch !== "always" ? edge.branch : ""}
                </b>
              </i>
            ) : null;
          })}
          {graph.nodes.map((node) => (
            <button
              key={node.id}
              style={{ left: node.x, top: node.y }}
              className={`crm-visual-node ${node.type} ${selectedId === node.id ? "selected" : ""}`}
              onClick={() => setSelectedId(node.id)}
              onPointerDown={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrag({
                  id: node.id,
                  dx: event.clientX - rect.left,
                  dy: event.clientY - rect.top,
                });
                setSelectedId(node.id);
              }}
            >
              <span>
                {node.type === "trigger"
                  ? "TR"
                  : node.label.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <small>{node.type.replaceAll("_", " ")}</small>
                <strong>{node.label}</strong>
              </div>
              <em>⋮⋮</em>
            </button>
          ))}
        </div>
        <aside className="crm-node-settings">
          {selected ? (
            <>
              <p>STEP SETTINGS</p>
              <input
                className="crm-node-title-input"
                value={selected.label}
                onChange={(event) =>
                  updateSelected({ label: event.target.value })
                }
              />
              {selected.type === "trigger" ? (
                <label>
                  <span>Starts when</span>
                  <select
                    value={String(selected.config.eventKey ?? "lead.created")}
                    onChange={(event) =>
                      updateSelected({}, { eventKey: event.target.value })
                    }
                  >
                    <option value="lead.created">New lead is created</option>
                    <option value="sms.received">Customer sends a text</option>
                    <option value="call.missed">Call is missed</option>
                  </select>
                </label>
              ) : null}
              {selected.type === "send_sms" ? (
                <label>
                  <span>Message</span>
                  <textarea
                    rows={6}
                    value={String(selected.config.message ?? "")}
                    onChange={(event) =>
                      updateSelected({}, { message: event.target.value })
                    }
                  />
                  <small>
                    Available: {"{{contact_first_name}}"}, {"{{business_name}}"}
                  </small>
                </label>
              ) : null}
              {selected.type === "create_task" ? (
                <>
                  <label>
                    <span>Task title</span>
                    <input
                      value={String(selected.config.title ?? "")}
                      onChange={(event) =>
                        updateSelected({}, { title: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Priority</span>
                    <select
                      value={String(selected.config.priority ?? "MEDIUM")}
                      onChange={(event) =>
                        updateSelected({}, { priority: event.target.value })
                      }
                    >
                      <option>LOW</option>
                      <option>MEDIUM</option>
                      <option>HIGH</option>
                      <option>URGENT</option>
                    </select>
                  </label>
                </>
              ) : null}
              {selected.type === "add_tag" ? (
                <label>
                  <span>Tag</span>
                  <input
                    value={String(selected.config.tag ?? "")}
                    onChange={(event) =>
                      updateSelected({}, { tag: event.target.value })
                    }
                  />
                </label>
              ) : null}
              {selected.type === "update_stage" ? (
                <label>
                  <span>Pipeline stage</span>
                  <select
                    value={String(selected.config.stageId ?? "")}
                    onChange={(event) =>
                      updateSelected({}, { stageId: event.target.value })
                    }
                  >
                    <option value="">Choose stage</option>
                    {stages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {selected.type === "condition" ? (
                <>
                  <label>
                    <span>Event field</span>
                    <select
                      value={String(
                        selected.config.field ?? "serviceRequested",
                      )}
                      onChange={(event) =>
                        updateSelected({}, { field: event.target.value })
                      }
                    >
                      <option value="serviceRequested">
                        Service requested
                      </option>
                      <option value="messageBody">Incoming message</option>
                      <option value="callStatus">Call status</option>
                    </select>
                  </label>
                  <label>
                    <span>Comparison</span>
                    <select
                      value={String(selected.config.operator ?? "contains")}
                      onChange={(event) =>
                        updateSelected({}, { operator: event.target.value })
                      }
                    >
                      <option value="contains">Contains</option>
                      <option value="equals">Equals</option>
                      <option value="not_equals">Does not equal</option>
                    </select>
                  </label>
                  <label>
                    <span>Value</span>
                    <input
                      value={String(selected.config.value ?? "")}
                      onChange={(event) =>
                        updateSelected({}, { value: event.target.value })
                      }
                    />
                  </label>
                </>
              ) : null}
              <div className="crm-edge-settings">
                <div>
                  <span>Next steps</span>
                  <button type="button" onClick={addConnection}>
                    + Connect
                  </button>
                </div>
                {graph.edges
                  .filter((edge) => edge.source === selected.id)
                  .map((edge) => (
                    <div className="crm-edge-setting" key={edge.id}>
                      {selected.type === "condition" ? (
                        <select
                          aria-label="Connection branch"
                          value={edge.branch ?? "yes"}
                          onChange={(event) =>
                            updateEdge(edge.id, {
                              branch: event.target.value as "yes" | "no",
                            })
                          }
                        >
                          <option value="yes">If yes</option>
                          <option value="no">If no</option>
                        </select>
                      ) : (
                        <span>Then</span>
                      )}
                      <select
                        aria-label="Connected step"
                        value={edge.target}
                        onChange={(event) =>
                          updateEdge(edge.id, { target: event.target.value })
                        }
                      >
                        {graph.nodes
                          .filter((node) => node.id !== selected.id)
                          .map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.label}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        aria-label="Remove connection"
                        onClick={() => removeEdge(edge.id)}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
              </div>
              {selected.type !== "trigger" ? (
                <button className="crm-remove-node" onClick={removeSelected}>
                  Remove step
                </button>
              ) : null}
            </>
          ) : (
            <p>Select a step to edit it.</p>
          )}
          <label className="crm-workflow-description">
            <span>Workflow description</span>
            <textarea
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </aside>
      </div>
      <section className="crm-builder-runs">
        <header>
          <div>
            <h3>Recent runs</h3>
            <p>Every execution and safe test is recorded.</p>
          </div>
        </header>
        {runs
          .filter((run) => run.workflowId === workflow.id)
          .slice(0, 10)
          .map((run) => (
            <article key={run.id}>
              <i className={run.status} />
              <span>
                <strong>
                  {run.isTest
                    ? "Safe test"
                    : run.triggerKey.replaceAll(".", " ")}
                </strong>
                <small>{new Date(run.startedAt).toLocaleString()}</small>
              </span>
              <Badge
                tone={
                  run.status.includes("completed")
                    ? "green"
                    : run.status === "failed"
                      ? "red"
                      : "orange"
                }
              >
                {run.status.replaceAll("_", " ")}
              </Badge>
              {run.error ? <em>{run.error}</em> : null}
            </article>
          ))}
        {!runs.some((run) => run.workflowId === workflow.id) ? (
          <p>
            No runs yet. Use Test to validate every step without sending
            messages or changing customer records.
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function VisualAutomationsView({
  clients,
  connections,
  workflows,
  runs,
  stages,
  selectedClientId,
  mutate,
  onOpenConnections,
}: {
  clients: CrmClient[];
  connections: CrmProviderConnection[];
  workflows: CrmWorkflow[];
  runs: CrmWorkflowRun[];
  stages: CrmStage[];
  selectedClientId: string;
  mutate: Mutate;
  onOpenConnections: (clientId: string) => void;
}) {
  const [localClient, setLocalClient] = useState(clients[0]?.id ?? "");
  const clientId = clientChoice(clients, selectedClientId, localClient);
  const client = clients.find((item) => item.id === clientId);
  const twilioConnection = connections.find(
    (item) => item.clientId === clientId && item.provider === "twilio",
  );
  const hasActiveTwilio = Boolean(
    twilioConnection?.isLinked && twilioConnection.isActive,
  );
  const visible = workflows.filter((item) => item.clientId === clientId);
  const [editingId, setEditingId] = useState("");
  const editing = visible.find((item) => item.id === editingId);
  const stats = useMemo(
    () => ({
      active: visible.filter((item) => item.status === "active").length,
      runs: runs.filter((item) => item.clientId === clientId).length,
      failed: runs.filter(
        (item) => item.clientId === clientId && item.status === "failed",
      ).length,
    }),
    [visible, runs, clientId],
  );
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = (await mutate(
      {
        action: "create_workflow",
        clientId,
        name: form.get("name"),
        triggerKey: form.get("triggerKey"),
      },
      "Workflow created.",
    )) as { id?: string };
    if (result?.id) setEditingId(result.id);
  }
  return (
    <div className="crm-view crm-workflows-home">
      <section className="crm-page-heading">
        <div>
          <p>VISUAL AUTOMATION</p>
          <h2>Workflows</h2>
          <span>
            Build advanced follow-up systems visually, then test and publish
            them safely.
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
          <p>Automations belong to one business and cannot be shared.</p>
        </section>
      ) : !hasActiveTwilio ? (
        <section className="crm-empty-state crm-communication-gate">
          <Badge tone="orange">Twilio required</Badge>
          <h3>Connect Twilio to use automations</h3>
          <p>
            {client.businessName} needs an active Twilio connection before you
            can create or edit automated follow-up. Manage the connection from
            the Connections page.
          </p>
          <button
            className="crm-button-primary"
            type="button"
            onClick={() => onOpenConnections(clientId)}
          >
            Go to Connections
          </button>
        </section>
      ) : editing ? (
        <WorkflowEditor
          key={`${editing.id}-${editing.currentVersion}`}
          workflow={editing}
          clients={clients}
          stages={stages}
          runs={runs}
          mutate={mutate}
          onBack={() => setEditingId("")}
        />
      ) : (
        <>
          <div className="crm-workflow-home-grid">
            <section className="crm-workflow-list">
              <header>
                <div>
                  <h3>Workflows</h3>
                  <p>{visible.length} total · {stats.active} active</p>
                </div>
              </header>
              {visible.map((workflow) => (
                <button
                  key={workflow.id}
                  onClick={() => setEditingId(workflow.id)}
                >
                  <span className="crm-workflow-list-icon">WF</span>
                  <div>
                    <strong>{workflow.name}</strong>
                    <p>
                      {workflow.description ||
                        `${workflow.graph.nodes.length} steps · ${workflow.triggerKey.replaceAll(".", " ")}`}
                    </p>
                    <small>
                      Version {workflow.currentVersion} · Updated{" "}
                      {new Date(workflow.updatedAt).toLocaleDateString()}
                    </small>
                  </div>
                  <Badge
                    tone={workflow.status === "active" ? "green" : "orange"}
                  >
                    {workflow.status.replaceAll("_", " ")}
                  </Badge>
                  <b>→</b>
                </button>
              ))}
              {!visible.length ? (
                <div className="crm-empty-state">
                  <h3>No workflows yet</h3>
                  <p>Create the first visual automation for this client.</p>
                </div>
              ) : null}
            </section>
            <form className="crm-new-workflow" onSubmit={create}>
              <p>NEW WORKFLOW</p>
              <h3>Start with a trigger</h3>
              <label>
                <span>Name</span>
                <input name="name" required placeholder="New lead follow-up" />
              </label>
              <label>
                <span>Starts when</span>
                <select name="triggerKey">
                  <option value="lead.created">New lead is created</option>
                  <option value="sms.received">Customer sends a text</option>
                  <option value="call.missed">Call is missed</option>
                </select>
              </label>
              <button className="crm-button-primary" disabled={!clientId}>
                Create workflow
              </button>
              <small>
                A safe task step is added automatically. Nothing runs until you
                publish.
              </small>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
