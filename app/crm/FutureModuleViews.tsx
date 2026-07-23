"use client";

import { Badge } from "./ui";

export type FutureModule = "conversations" | "automations" | "forms" | "payments" | "funnels";

type ModuleDefinition = {
  name: string;
  eyebrow: string;
  phase: string;
  description: string;
  features: string[];
};

const modules: Record<FutureModule, ModuleDefinition> = {
  conversations: {
    name: "Conversations",
    eyebrow: "EMAIL, SMS & CALLS",
    phase: "Planned for Phase 2",
    description: "A shared inbox for every client conversation, with assignments, templates, delivery status, and a complete contact timeline.",
    features: ["Two-way email and SMS", "Calling and missed-call text back", "Templates, snippets, and assignments"],
  },
  automations: {
    name: "Automations",
    eyebrow: "WORKFLOW BUILDER",
    phase: "Planned for Phase 3",
    description: "Build repeatable follow-up systems using triggers, waits, decisions, CRM updates, tasks, and messages.",
    features: ["Visual workflow builder", "Versioned publishing and run history", "Retries, goals, and enrollment controls"],
  },
  forms: {
    name: "Forms",
    eyebrow: "LEAD CAPTURE",
    phase: "Planned for Phase 4",
    description: "Create branded forms and surveys that route new inquiries into the correct client, pipeline, and follow-up process.",
    features: ["Drag-and-drop fields", "Embeds and hosted links", "Routing, attribution, and spam controls"],
  },
  payments: {
    name: "Payments",
    eyebrow: "REVENUE OPERATIONS",
    phase: "Planned for Phase 6",
    description: "Manage estimates, invoices, payment links, subscriptions, refunds, and revenue reporting from one workspace.",
    features: ["Products, estimates, and invoices", "Stripe-hosted payment collection", "Subscriptions and reconciliation"],
  },
  funnels: {
    name: "Funnels",
    eyebrow: "CONVERSION JOURNEYS",
    phase: "Planned for Phase 5",
    description: "Design step-by-step conversion journeys with landing pages, forms, appointments, offers, and attribution.",
    features: ["Visual funnel steps", "Traffic and conversion reporting", "Experiments, templates, and reusable sections"],
  },
};

const previewStats: Record<FutureModule, Array<[string, string, string]>> = {
  conversations: [["Open conversations", "0", "Live"], ["Median response", "—", "Live"], ["Unread", "0", "Live"]],
  automations: [["Published workflows", "0", "Live"], ["Active enrollments", "0", "Live"], ["Completion rate", "—", "Live"]],
  forms: [["Form views", "0", "Live"], ["Submissions", "0", "Live"], ["Conversion rate", "—", "Live"]],
  payments: [["Collected", "$0", "Live"], ["Outstanding", "$0", "Live"], ["Paid invoices", "0", "Live"]],
  funnels: [["Visitors", "0", "Live"], ["Conversions", "0", "Live"], ["Conversion rate", "—", "Live"]],
};

function PreviewNotice() {
  return <div className="crm-preview-notice" role="note">
    <span>i</span>
    <div><strong>Design preview</strong><p>This screen is available for planning and feedback. It does not send messages, charge cards, publish content, or contact an outside service yet.</p></div>
  </div>;
}

function ConversationsPreview() {
  const threads = [
    ["Contact 1", "No live message connected yet.", "—", "SMS"],
    ["Contact 2", "No live email connected yet.", "—", "Email"],
    ["Contact 3", "No live call connected yet.", "—", "Call"],
  ];
  return <div className="crm-preview-inbox">
    <aside><header><strong>Inbox preview</strong><Badge tone="purple">7 unread</Badge></header><label><span>Search</span><input disabled placeholder="Search conversations" /></label>{threads.map(([name, message, time, channel], index) => <article className={index === 0 ? "active" : ""} key={name}><span className="crm-preview-avatar">{name.split(" ").map((part) => part[0]).join("")}</span><div><strong>{name}</strong><p>{message}</p><small>{channel}</small></div><time>{time}</time></article>)}</aside>
    <section><header><div><strong>Contact thread</strong><small>Client workspace · SMS preview</small></div><button disabled>Assign</button></header><div className="crm-preview-messages"><p className="incoming">No live messages yet.<small>—</small></p><p className="outgoing">Connect a provider before sending replies.<small>Draft preview</small></p></div><footer><textarea disabled placeholder="Messaging will be available after a provider is connected." /><button disabled>Send</button></footer></section>
  </div>;
}

function AutomationsPreview() {
  return <div className="crm-workflow-preview">
    <header><div><strong>New lead speed-to-contact</strong><small>Workflow canvas preview</small></div><Badge tone="orange">Draft only</Badge></header>
    <div className="crm-workflow-canvas">
      <article className="trigger"><small>TRIGGER</small><strong>New lead created</strong><p>Any client · Any source</p></article><i />
      <article><small>WAIT</small><strong>Wait 2 minutes</strong><p>Respect client time zone</p></article><i />
      <article><small>ACTION</small><strong>Send welcome SMS</strong><p>Provider not connected</p></article><i />
      <article><small>DECISION</small><strong>Did the lead reply?</strong><p>Yes / No paths</p></article>
    </div>
  </div>;
}

function FormsPreview() {
  return <div className="crm-form-builder-preview"><aside><header><strong>Field library</strong><small>Drag-and-drop preview</small></header>{["Full name", "Email address", "Phone number", "Service needed", "Preferred date", "Consent checkbox"].map((field) => <span key={field}><b>+</b>{field}</span>)}</aside><section><div className="crm-form-preview-card"><Badge tone="purple">LEAD FORM</Badge><h3>Request your free service estimate</h3><p>Tell us how we can help and our team will get back to you shortly.</p><label>Name<input disabled placeholder="Your full name" /></label><label>Phone<input disabled placeholder="(555) 555-0123" /></label><label>How can we help?<textarea disabled placeholder="Describe the service you need" /></label><button disabled>Request estimate</button></div></section><aside className="crm-form-settings-preview"><header><strong>Form settings</strong><small>Preview</small></header><dl><div><dt>Destination</dt><dd>New leads</dd></div><div><dt>Pipeline stage</dt><dd>New inquiry</dd></div><div><dt>Spam protection</dt><dd>Planned</dd></div><div><dt>Consent evidence</dt><dd>Planned</dd></div></dl></aside></div>;
}

function PaymentsPreview() {
  const rows = [["No invoices", "Connect payments", "$0", "Draft"]];
  return <section className="crm-preview-table-card"><header><div><strong>Recent invoices</strong><small>Payment workspace</small></div><button disabled>+ New invoice</button></header><div className="crm-preview-table-scroll"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={cell}>{index === 3 ? <Badge tone={cell === "Paid" ? "green" : cell === "Draft" ? "neutral" : "orange"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div><footer><p>Stripe connection, payment collection, refunds, and reconciliation are not active in this preview.</p></footer></section>;
}

function FunnelsPreview() {
  const steps = [["1", "Service landing page", "0", "—"], ["2", "Estimate form", "0", "—"], ["3", "Booking calendar", "0", "—"], ["4", "Thank-you page", "0", "—"]];
  return <div className="crm-funnel-preview"><header><div><strong>Free estimate funnel</strong><small>Draft conversion journey</small></div><Badge tone="orange">Draft preview</Badge></header><section>{steps.map(([number, name, visitors, rate], index) => <article key={number}><span>{number}</span><div><strong>{name}</strong><small>{visitors} visitors</small></div><b>{rate}</b>{index < steps.length - 1 ? <i>→</i> : null}</article>)}</section></div>;
}

function ModuleBody({ module }: { module: FutureModule }) {
  if (module === "conversations") return <ConversationsPreview />;
  if (module === "automations") return <AutomationsPreview />;
  if (module === "forms") return <FormsPreview />;
  if (module === "payments") return <PaymentsPreview />;
  return <FunnelsPreview />;
}

export function FutureModuleView({ module }: { module: FutureModule }) {
  const definition = modules[module];
  return <div className="crm-view crm-future-view">
    <section className="crm-page-heading crm-future-heading"><div><p>{definition.eyebrow}</p><h2>{definition.name}</h2><span>{definition.description}</span></div><div className="crm-preview-status"><Badge tone="purple">UI PREVIEW</Badge><strong>{definition.phase}</strong><small>Provider connections and live actions are not enabled.</small></div></section>
    <PreviewNotice />
    <section className="crm-preview-metrics">{previewStats[module].map(([label, value, note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note} data for layout feedback</small></article>)}</section>
    <ModuleBody module={module} />
    <section className="crm-future-scope"><div><p>PLANNED CAPABILITIES</p><h3>What this module will include</h3></div>{definition.features.map((feature, index) => <article key={feature}><span>{String(index + 1).padStart(2, "0")}</span><strong>{feature}</strong><Badge tone="neutral">Planned</Badge></article>)}</section>
  </div>;
}
