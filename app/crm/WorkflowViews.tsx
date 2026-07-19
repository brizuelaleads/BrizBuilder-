"use client";

import { useMemo, useState } from "react";
import type {
  CrmClient,
  CrmPhoneConfig,
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
type NumberOption = {
  phoneNumber: string;
  label: string;
  locality: string;
  region: string;
};
type OwnedNumber = { sid: string; phoneNumber: string; label: string };

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
  configs,
  selectedClientId,
  mutate,
}: {
  clients: CrmClient[];
  connections: CrmProviderConnection[];
  configs: CrmPhoneConfig[];
  selectedClientId: string;
  mutate: Mutate;
}) {
  const [localClient, setLocalClient] = useState(clients[0]?.id ?? "");
  const [areaCode, setAreaCode] = useState("");
  const [numbers, setNumbers] = useState<NumberOption[]>([]);
  const [ownedNumbers, setOwnedNumbers] = useState<OwnedNumber[]>([]);
  const [searching, setSearching] = useState(false);
  const clientId = clientChoice(clients, selectedClientId, localClient);
  const client = clients.find((item) => item.id === clientId);
  const connection = connections.find(
    (item) => item.clientId === clientId && item.provider === "twilio",
  );
  const phone = configs.find((item) => item.clientId === clientId);
  async function search() {
    setSearching(true);
    try {
      const result = (await mutate(
        { action: "search_twilio_numbers", clientId, areaCode },
        "Available numbers loaded.",
      )) as { numbers?: NumberOption[] };
      setNumbers(result?.numbers ?? []);
    } finally {
      setSearching(false);
    }
  }
  async function purchase(option: NumberOption) {
    if (
      !window.confirm(
        `Buy ${option.phoneNumber}? Twilio will bill ${client?.businessName}, not BrizBuilder.`,
      )
    )
      return;
    await mutate(
      {
        action: "buy_twilio_number",
        clientId,
        phoneNumber: option.phoneNumber,
        confirmCharge: true,
      },
      "Phone number purchased and connected.",
    );
    setNumbers([]);
  }
  async function loadOwnedNumbers() {
    setSearching(true);
    try {
      const result = (await mutate(
        { action: "list_twilio_numbers", clientId },
        "Existing Twilio numbers loaded.",
      )) as { numbers?: OwnedNumber[] };
      setOwnedNumbers(result?.numbers ?? []);
    } finally {
      setSearching(false);
    }
  }
  async function connectOwnedNumber(option: OwnedNumber) {
    await mutate(
      {
        action: "connect_twilio_number",
        clientId,
        phoneNumberSid: option.sid,
      },
      `${option.phoneNumber} is now connected to BrizBuilder.`,
    );
  }
  return (
    <div className="crm-view crm-connections-view">
      <section className="crm-page-heading">
        <div>
          <p>CONNECTED ACCOUNTS</p>
          <h2>Connections</h2>
          <span>
            Connect any upgraded Twilio account once, then manage calls, texts,
            phone numbers and automations from BrizBuilder.
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
      <section className="crm-owner-billing-note">
        <span>$</span>
        <div>
          <strong>Your Twilio account, your phone bill</strong>
          <p>
            Twilio charges each business directly. BrizBuilder never sees the
            customer&apos;s password and never pays or marks up their usage.
          </p>
        </div>
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
                <p>Calls, phone numbers and two-way texting</p>
              </div>
              <Badge
                tone={connection?.status === "connected" ? "green" : "orange"}
              >
                {connection?.status === "connected"
                  ? "Connected"
                  : "Not connected"}
              </Badge>
            </header>
            {connection?.status === "connected" ? (
              <>
                <div className="crm-connection-details">
                  <div>
                    <span>Account</span>
                    <strong>
                      {connection.accountLabel ?? "Customer Twilio account"}
                    </strong>
                  </div>
                  <div>
                    <span>Billing</span>
                    <strong>Paid by {client.businessName}</strong>
                  </div>
                  <div>
                    <span>Phone number</span>
                    <strong>
                      {phone?.phoneNumber ?? "Choose a number below"}
                    </strong>
                  </div>
                  <div>
                    <span>Last checked</span>
                    <strong>
                      {connection.lastHealthCheckAt
                        ? new Date(
                            connection.lastHealthCheckAt,
                          ).toLocaleString()
                        : "Not checked"}
                    </strong>
                  </div>
                </div>
                <div className="crm-connection-actions">
                  <button
                    onClick={() =>
                      mutate(
                        { action: "check_provider_connection", clientId },
                        "Twilio connection is healthy.",
                      )
                    }
                  >
                    Check connection
                  </button>
                  <button
                    className="danger"
                    onClick={() =>
                      window.confirm(
                        "Disconnect Twilio? Automatic calls and texts will stop.",
                      ) &&
                      mutate(
                        { action: "disconnect_provider", clientId },
                        "Twilio disconnected.",
                      )
                    }
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <div className="crm-connect-steps">
                <div
                  className="crm-twilio-plan-guide"
                  aria-label="Twilio account requirements"
                >
                  <article className="trial">
                    <span>Testing only</span>
                    <h4>Twilio free trial</h4>
                    <p>
                      Useful for learning inside Twilio, but Twilio does not
                      allow trial accounts to connect to BrizBuilder.
                    </p>
                    <ul>
                      <li>Works only with verified test numbers</li>
                      <li>Not available for live customer automations</li>
                    </ul>
                  </article>
                  <article className="live">
                    <span>Required to connect</span>
                    <h4>Upgraded Twilio account</h4>
                    <p>
                      Any upgraded account can connect. It only needs to be off
                      the free trial and have a valid payment method.
                    </p>
                    <ul>
                      <li>Connects securely to BrizBuilder</li>
                      <li>Twilio bills the business directly</li>
                    </ul>
                  </article>
                </div>
                <ol>
                  <li>
                    <span>1</span>Create or sign in to the business&apos;s
                    Twilio account
                  </li>
                  <li>
                    <span>2</span>Upgrade the account and add the
                    business&apos;s payment method
                  </li>
                  <li>
                    <span>3</span>Approve BrizBuilder access once
                  </li>
                </ol>
                <a
                  className="crm-button-primary"
                  href={`/api/integrations/twilio/connect?clientId=${encodeURIComponent(clientId)}`}
                >
                  Activate phone &amp; texting
                </a>
                <small>
                  Twilio opens securely. After approval, you will return to
                  BrizBuilder automatically.
                </small>
              </div>
            )}
          </article>
          <article className="crm-connection-card">
            <header>
              <span className="crm-provider-logo native">B</span>
              <div>
                <h3>BrizBuilder Workflows</h3>
                <p>Native visual automation engine</p>
              </div>
              <Badge tone="green">Included</Badge>
            </header>
            <div className="crm-connection-details">
              <div>
                <span>Hosting</span>
                <strong>Runs inside BrizBuilder</strong>
              </div>
              <div>
                <span>Extra account</span>
                <strong>Not required</strong>
              </div>
              <div>
                <span>Run history</span>
                <strong>Enabled</strong>
              </div>
              <div>
                <span>Customer isolation</span>
                <strong>Enabled</strong>
              </div>
            </div>
          </article>
          {connection?.status === "connected" ? (
            <article className="crm-number-market">
              <header>
                <div>
                  <p>PHONE NUMBER</p>
                  <h3>
                    {phone?.phoneNumber
                      ? "Manage the connected number"
                      : "Choose a business number"}
                  </h3>
                </div>
                {phone?.phoneNumber ? (
                  <Badge tone="green">{phone.phoneNumber}</Badge>
                ) : null}
              </header>
              <section className="crm-owned-numbers">
                <div>
                  <div>
                    <strong>Use a number already connected here</strong>
                    <p>
                      Load numbers purchased through this business&apos;s
                      BrizBuilder Twilio connection.
                    </p>
                  </div>
                  <button onClick={loadOwnedNumbers} disabled={searching}>
                    Show connected numbers
                  </button>
                </div>
                {ownedNumbers.length ? (
                  <div className="crm-number-results">
                    {ownedNumbers.map((option) => (
                      <button
                        key={option.sid}
                        disabled={option.phoneNumber === phone?.phoneNumber}
                        onClick={() => connectOwnedNumber(option)}
                      >
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.phoneNumber}</small>
                        </span>
                        <b>
                          {option.phoneNumber === phone?.phoneNumber
                            ? "Connected"
                            : "Use number"}
                        </b>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
              <p className="crm-porting-note">
                <strong>Keeping a different existing number?</strong> It may
                need to be transferred or ported into this connection before
                BrizBuilder can manage it.
              </p>
              <div className="crm-number-divider">
                <span>or buy a new number</span>
              </div>
              <div className="crm-number-search">
                <label>
                  <span>Preferred area code</span>
                  <input
                    value={areaCode}
                    onChange={(event) =>
                      setAreaCode(
                        event.target.value.replace(/\D/g, "").slice(0, 3),
                      )
                    }
                    placeholder="512"
                    inputMode="numeric"
                  />
                </label>
                <button onClick={search} disabled={searching}>
                  {searching ? "Searching..." : "Find numbers"}
                </button>
              </div>
              {numbers.length ? (
                <div className="crm-number-results">
                  {numbers.map((option) => (
                    <button
                      key={option.phoneNumber}
                      onClick={() => purchase(option)}
                    >
                      <span>
                        <strong>{option.label}</strong>
                        <small>
                          {[option.locality, option.region]
                            .filter(Boolean)
                            .join(", ") || "US local number"}
                        </small>
                      </span>
                      <b>Choose</b>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="crm-number-empty">
                  Search by area code. Choosing a number will create a real
                  charge in the customer&apos;s Twilio account and always
                  requires confirmation.
                </p>
              )}
            </article>
          ) : null}
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
  workflows,
  runs,
  stages,
  selectedClientId,
  mutate,
}: {
  clients: CrmClient[];
  workflows: CrmWorkflow[];
  runs: CrmWorkflowRun[];
  stages: CrmStage[];
  selectedClientId: string;
  mutate: Mutate;
}) {
  const [localClient, setLocalClient] = useState(clients[0]?.id ?? "");
  const clientId = clientChoice(clients, selectedClientId, localClient);
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
  if (editing)
    return (
      <WorkflowEditor
        key={`${editing.id}-${editing.currentVersion}`}
        workflow={editing}
        clients={clients}
        stages={stages}
        runs={runs}
        mutate={mutate}
        onBack={() => setEditingId("")}
      />
    );
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
      <section className="crm-conversation-metrics">
        <article>
          <span>Active workflows</span>
          <strong>{stats.active}</strong>
        </article>
        <article>
          <span>Total runs</span>
          <strong>{stats.runs}</strong>
        </article>
        <article>
          <span>Failed runs</span>
          <strong>{stats.failed}</strong>
        </article>
      </section>
      <div className="crm-workflow-home-grid">
        <section className="crm-workflow-list">
          <header>
            <div>
              <h3>Workflows</h3>
              <p>Draft, test and publish automations for this business.</p>
            </div>
          </header>
          {visible.map((workflow) => (
            <button key={workflow.id} onClick={() => setEditingId(workflow.id)}>
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
              <Badge tone={workflow.status === "active" ? "green" : "orange"}>
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
    </div>
  );
}
