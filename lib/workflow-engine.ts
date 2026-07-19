import type { CrmWorkflowEdge, CrmWorkflowNode } from "../db/crm";
import { getSupabaseAdminClient } from "./supabase/server";
import { renderMessageTemplate, sendTwilioMessage } from "./twilio";

export type WorkflowGraph = {
  nodes: CrmWorkflowNode[];
  edges: CrmWorkflowEdge[];
};
type Payload = Record<string, unknown> & {
  organizationId: string;
  clientId: string;
  eventId: string;
  contactId?: string;
  leadId?: string;
};
const allowedTypes = new Set([
  "trigger",
  "send_sms",
  "create_task",
  "add_tag",
  "update_stage",
  "condition",
]);

function db() {
  return getSupabaseAdminClient();
}
function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function asGraph(value: unknown): WorkflowGraph {
  const graph =
    value && typeof value === "object" ? (value as Partial<WorkflowGraph>) : {};
  return {
    nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph.edges) ? graph.edges : [],
  };
}

export function validateWorkflowGraph(value: unknown) {
  const graph = asGraph(value);
  const errors: string[] = [];
  if (graph.nodes.length < 2)
    errors.push("Add one trigger and at least one action.");
  if (graph.nodes.length > 50)
    errors.push("A workflow can contain at most 50 steps.");
  if (graph.edges.length > 100)
    errors.push("A workflow can contain at most 100 connections.");
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (!node?.id || ids.has(node.id))
      errors.push("Every step must have a unique ID.");
    ids.add(node?.id);
    if (!allowedTypes.has(node?.type))
      errors.push(`Unsupported step type: ${String(node?.type)}`);
    if (!Number.isFinite(node?.x) || !Number.isFinite(node?.y))
      errors.push("Every step needs a valid canvas position.");
    if (
      node.type === "trigger" &&
      !["lead.created", "sms.received", "call.missed"].includes(
        text(node.config?.eventKey, 40),
      )
    )
      errors.push("Choose a supported workflow trigger.");
    if (node.type === "send_sms" && !text(node.config?.message, 1600))
      errors.push("Every Send SMS step needs a message.");
    if (node.type === "create_task" && !text(node.config?.title, 180))
      errors.push("Every Create task step needs a title.");
    if (node.type === "add_tag" && !text(node.config?.tag, 60))
      errors.push("Every Add tag step needs a tag.");
    if (node.type === "update_stage" && !text(node.config?.stageId, 100))
      errors.push("Every Update stage step needs a pipeline stage.");
    if (node.type === "condition" && !text(node.config?.field, 120))
      errors.push("Every condition needs a field.");
  }
  if (graph.nodes.filter((node) => node.type === "trigger").length !== 1)
    errors.push("Every workflow must contain exactly one trigger.");
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!edge.id || edgeIds.has(edge.id))
      errors.push("Every connection must have a unique ID.");
    edgeIds.add(edge.id);
    if (!ids.has(edge.source) || !ids.has(edge.target))
      errors.push("A connection points to a missing step.");
    if (edge.source === edge.target)
      errors.push("A step cannot connect to itself.");
    const source = graph.nodes.find((node) => node.id === edge.source);
    if (
      source?.type === "condition" &&
      !["yes", "no"].includes(String(edge.branch))
    )
      errors.push("Condition connections must use an If yes or If no path.");
    if (
      source &&
      source.type !== "condition" &&
      edge.branch &&
      edge.branch !== "always"
    )
      errors.push("Only condition steps can use yes or no paths.");
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const edge of graph.edges.filter((item) => item.source === id))
      if (hasCycle(edge.target)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of ids)
    if (hasCycle(id)) {
      errors.push("Workflow connections cannot contain a loop.");
      break;
    }
  const trigger = graph.nodes.find((node) => node.type === "trigger");
  if (trigger) {
    const reachable = new Set<string>();
    const pending = [trigger.id];
    while (pending.length) {
      const id = pending.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      pending.push(
        ...graph.edges
          .filter((edge) => edge.source === id)
          .map((edge) => edge.target),
      );
    }
    if (graph.nodes.some((node) => !reachable.has(node.id)))
      errors.push("Every step must be connected to the trigger.");
  }
  return { graph, errors: [...new Set(errors)] };
}

function tokenValues(
  payload: Payload,
  contact: Record<string, unknown> | null,
) {
  return {
    business_name: text(payload.businessName),
    contact_first_name: text(contact?.first_name),
    contact_last_name: text(contact?.last_name),
    contact_phone: text(contact?.phone),
    service_requested: text(payload.serviceRequested),
  };
}

function payloadField(payload: Payload, field: string) {
  return field
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      payload,
    );
}

export async function executeWorkflow(input: {
  workflowId: string;
  graph: WorkflowGraph;
  version: number;
  triggerKey: string;
  payload: Payload;
  isTest?: boolean;
}) {
  const { errors } = validateWorkflowGraph(input.graph);
  if (errors.length) throw new Error(errors.join(" "));
  const runInsert = await db()
    .from("workflow_runs")
    .insert({
      organization_id: input.payload.organizationId,
      client_id: input.payload.clientId,
      workflow_id: input.workflowId,
      version: input.version,
      trigger_key: input.triggerKey,
      trigger_event_id: input.isTest
        ? `test:${crypto.randomUUID()}`
        : input.payload.eventId,
      status: "running",
      is_test: Boolean(input.isTest),
      input: input.payload,
    })
    .select("id")
    .single();
  if (runInsert.error?.code === "23505") return { duplicate: true };
  if (runInsert.error || !runInsert.data)
    throw new Error(
      runInsert.error?.message ?? "Workflow run could not start.",
    );
  const runId = String(runInsert.data.id);
  const contactResult = input.payload.contactId
    ? await db()
        .from("contacts")
        .select("id,first_name,last_name,phone,tags,marketing_consent")
        .eq("id", input.payload.contactId)
        .eq("client_id", input.payload.clientId)
        .maybeSingle()
    : { data: null, error: null };
  const contact = contactResult.data as Record<string, unknown> | null;
  const nodes = new Map(input.graph.nodes.map((node) => [node.id, node]));
  const trigger = input.graph.nodes.find((node) => node.type === "trigger")!;
  const queue = [trigger.id];
  const completed = new Set<string>();
  const output: Record<string, unknown> = {};
  let currentStepId: string | null = null;
  try {
    while (queue.length) {
      const nodeId = queue.shift()!;
      if (completed.has(nodeId)) continue;
      const node = nodes.get(nodeId);
      if (!node) continue;
      const step = await db()
        .from("workflow_run_steps")
        .insert({
          organization_id: input.payload.organizationId,
          client_id: input.payload.clientId,
          run_id: runId,
          node_id: node.id,
          node_type: node.type,
          status: "running",
          input: node.config,
        })
        .select("id")
        .single();
      if (step.error || !step.data)
        throw new Error(
          step.error?.message ?? "Workflow step could not start.",
        );
      currentStepId = String(step.data.id);
      let branch: "always" | "yes" | "no" = "always";
      let stepOutput: Record<string, unknown> = {};
      if (input.isTest)
        stepOutput = { dryRun: true, summary: `${node.label} validated` };
      else if (node.type === "condition") {
        const actual = String(
          payloadField(input.payload, text(node.config.field, 120)) ?? "",
        );
        const expected = text(node.config.value, 300);
        const operator = text(node.config.operator, 30) || "equals";
        const matched =
          operator === "contains"
            ? actual.toLowerCase().includes(expected.toLowerCase())
            : operator === "not_equals"
              ? actual !== expected
              : actual === expected;
        branch = matched ? "yes" : "no";
        stepOutput = { matched, actual };
      } else if (node.type === "create_task") {
        const values = tokenValues(input.payload, contact);
        const title = renderMessageTemplate(
          text(node.config.title, 180) ||
            "Follow up with {{contact_first_name}}",
          values,
        );
        const allowedPriorities = new Set(["LOW", "MEDIUM", "HIGH", "URGENT"]);
        const requestedPriority = text(node.config.priority, 20).toUpperCase();
        const saved = await db()
          .from("tasks")
          .insert({
            organization_id: input.payload.organizationId,
            client_id: input.payload.clientId,
            lead_id: input.payload.leadId ?? null,
            contact_id: input.payload.contactId ?? null,
            title,
            description: renderMessageTemplate(
              text(node.config.description, 1000),
              values,
            ),
            priority: allowedPriorities.has(requestedPriority)
              ? requestedPriority
              : "MEDIUM",
            status: "TO_DO",
          })
          .select("id")
          .single();
        if (saved.error) throw new Error(saved.error.message);
        stepOutput = { taskId: saved.data?.id };
      } else if (node.type === "add_tag") {
        if (!contact?.id)
          throw new Error("Add tag requires a contact in the trigger event.");
        const tag = text(node.config.tag, 60);
        const tags = Array.isArray(contact.tags)
          ? contact.tags.filter(
              (item): item is string => typeof item === "string",
            )
          : [];
        if (tag && !tags.includes(tag)) tags.push(tag);
        const saved = await db()
          .from("contacts")
          .update({ tags })
          .eq("id", contact.id);
        if (saved.error) throw new Error(saved.error.message);
        stepOutput = { tag };
      } else if (node.type === "update_stage") {
        if (!input.payload.leadId)
          throw new Error("Update stage requires a lead in the trigger event.");
        const stageId = text(node.config.stageId, 100);
        const stage = await db()
          .from("pipeline_stages")
          .select("id")
          .eq("id", stageId)
          .eq("organization_id", input.payload.organizationId)
          .maybeSingle();
        if (stage.error || !stage.data)
          throw new Error(
            "The selected pipeline stage is not available for this business.",
          );
        const saved = await db()
          .from("leads")
          .update({ stage_id: stageId, updated_at: new Date().toISOString() })
          .eq("id", input.payload.leadId)
          .eq("client_id", input.payload.clientId);
        if (saved.error) throw new Error(saved.error.message);
        stepOutput = { stageId };
      } else if (node.type === "send_sms") {
        if (!contact?.phone)
          throw new Error("Send SMS requires a contact phone number.");
        if (String(contact.marketing_consent).toLowerCase() === "opt_out")
          throw new Error("The contact opted out of text messages.");
        const [connection, phone] = await Promise.all([
          db()
            .from("provider_connections")
            .select("external_account_id,status")
            .eq("organization_id", input.payload.organizationId)
            .eq("client_id", input.payload.clientId)
            .eq("provider", "twilio")
            .maybeSingle(),
          db()
            .from("phone_system_configs")
            .select("phone_number,messaging_service_sid,a2p_status")
            .eq("organization_id", input.payload.organizationId)
            .eq("client_id", input.payload.clientId)
            .maybeSingle(),
        ]);
        if (connection.error || connection.data?.status !== "connected")
          throw new Error("Connect this customer's Twilio account first.");
        if (phone.error || !phone.data?.phone_number)
          throw new Error("Choose a Twilio phone number first.");
        if (phone.data.a2p_status !== "approved")
          throw new Error("Texting registration must be approved first.");
        const body = renderMessageTemplate(
          text(node.config.message, 1600),
          tokenValues(input.payload, contact),
        );
        const sent = await sendTwilioMessage({
          accountSid: String(connection.data.external_account_id),
          fromNumber: String(phone.data.phone_number),
          messagingServiceSid: phone.data.messaging_service_sid
            ? String(phone.data.messaging_service_sid)
            : null,
          to: String(contact.phone),
          body,
        });
        const now = new Date().toISOString();
        const conversation = await db()
          .from("conversations")
          .upsert(
            {
              organization_id: input.payload.organizationId,
              client_id: input.payload.clientId,
              contact_id: contact.id,
              channel: "sms",
              status: "open",
              last_message_at: now,
              updated_at: now,
            },
            { onConflict: "client_id,contact_id,channel" },
          )
          .select("id")
          .single();
        if (conversation.error || !conversation.data)
          throw new Error(
            conversation.error?.message ?? "Conversation could not be saved.",
          );
        const message = await db().from("messages").insert({
          organization_id: input.payload.organizationId,
          client_id: input.payload.clientId,
          conversation_id: conversation.data.id,
          contact_id: contact.id,
          provider_message_sid: sent.sid,
          direction: "outbound",
          channel: "sms",
          from_number: phone.data.phone_number,
          to_number: contact.phone,
          body,
          status: sent.status,
          automation_key: `workflow:${input.workflowId}:${node.id}`,
          sent_at: now,
        });
        if (message.error) throw new Error(message.error.message);
        stepOutput = { providerMessageSid: sent.sid, status: sent.status };
      }
      await db()
        .from("workflow_run_steps")
        .update({
          status: "completed",
          output: stepOutput,
          completed_at: new Date().toISOString(),
        })
        .eq("id", step.data.id);
      output[node.id] = stepOutput;
      completed.add(node.id);
      currentStepId = null;
      const outgoing = input.graph.edges.filter(
        (edge) =>
          edge.source === node.id &&
          (edge.branch === undefined ||
            edge.branch === "always" ||
            edge.branch === branch),
      );
      queue.push(...outgoing.map((edge) => edge.target));
    }
    await db()
      .from("workflow_runs")
      .update({
        status: input.isTest ? "test_completed" : "completed",
        output,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return { runId, status: input.isTest ? "test_completed" : "completed" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Workflow failed";
    if (currentStepId)
      await db()
        .from("workflow_run_steps")
        .update({
          status: "failed",
          error: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", currentStepId);
    await db()
      .from("workflow_runs")
      .update({
        status: "failed",
        error: message,
        output,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return { runId, status: "failed", error: message };
  }
}

export async function runPublishedWorkflowsForEvent(
  triggerKey: string,
  payload: Payload,
) {
  const found = await db()
    .from("workflows")
    .select("id,published_version")
    .eq("organization_id", payload.organizationId)
    .eq("client_id", payload.clientId)
    .eq("status", "active")
    .eq("trigger_key", triggerKey);
  if (found.error) throw new Error(found.error.message);
  let started = 0;
  for (const workflow of found.data ?? []) {
    if (!workflow.published_version) continue;
    const version = await db()
      .from("workflow_versions")
      .select("graph")
      .eq("workflow_id", workflow.id)
      .eq("version", workflow.published_version)
      .single();
    if (!version.error) {
      started += 1;
      await executeWorkflow({
        workflowId: workflow.id,
        graph: asGraph(version.data.graph),
        version: workflow.published_version,
        triggerKey,
        payload,
      });
    }
  }
  return started;
}
