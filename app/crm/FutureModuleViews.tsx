"use client";

import { Badge } from "./ui";

export type FutureModule = "conversations" | "automations" | "forms" | "payments" | "ai" | "websites" | "funnels" | "reviews";

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
  ai: {
    name: "AI workspace",
    eyebrow: "BRIZBUILDER AI",
    phase: "Planned for Phase 9",
    description: "Help teams write, summarize, organize, and respond faster with approval-based AI tools connected to CRM context.",
    features: ["Conversation and lead summaries", "Draft replies and campaign content", "Knowledge bases and guarded agents"],
  },
  websites: {
    name: "Websites",
    eyebrow: "SITE MANAGEMENT",
    phase: "Planned for Phase 5",
    description: "Manage client websites, brand systems, domains, SEO, analytics, performance, and publishing from BrizBuilder.",
    features: ["Responsive page and section editor", "Domains, SSL, preview, and rollback", "SEO, schema, analytics, and image optimization"],
  },
  funnels: {
    name: "Funnels",
    eyebrow: "CONVERSION JOURNEYS",
    phase: "Planned for Phase 5",
    description: "Design step-by-step conversion journeys with landing pages, forms, appointments, offers, and attribution.",
    features: ["Visual funnel steps", "Traffic and conversion reporting", "Experiments, templates, and reusable sections"],
  },
  reviews: {
    name: "Reputation",
    eyebrow: "REVIEWS & FEEDBACK",
    phase: "Planned for Phase 7",
    description: "Request, monitor, and respond to customer reviews while giving every client a clear view of reputation growth.",
    features: ["Automated review requests", "Google Business Profile monitoring", "Response approvals and reporting"],
  },
};

const previewStats: Record<FutureModule, Array<[string, string, string]>> = {
  conversations: [["Open conversations", "24", "Sample"], ["Median response", "4m 12s", "Sample"], ["Unread", "7", "Sample"]],
  automations: [["Published workflows", "8", "Sample"], ["Active enrollments", "342", "Sample"], ["Completion rate", "91%", "Sample"]],
  forms: [["Form views", "1,284", "Sample"], ["Submissions", "146", "Sample"], ["Conversion rate", "11.4%", "Sample"]],
  payments: [["Collected", "$18,420", "Sample"], ["Outstanding", "$4,850", "Sample"], ["Paid invoices", "32", "Sample"]],
  ai: [["Drafts created", "126", "Sample"], ["Time saved", "9.4h", "Sample"], ["Approval rate", "88%", "Sample"]],
  websites: [["Managed sites", "12", "Sample"], ["Published", "9", "Sample"], ["Average performance", "94", "Sample"]],
  funnels: [["Visitors", "3,842", "Sample"], ["Conversions", "318", "Sample"], ["Conversion rate", "8.3%", "Sample"]],
  reviews: [["Average rating", "4.8", "Sample"], ["New this month", "27", "Sample"], ["Response rate", "96%", "Sample"]],
};

function PreviewNotice() {
  return <div className="crm-preview-notice" role="note">
    <span>i</span>
    <div><strong>Design preview</strong><p>This screen is available for planning and feedback. It does not send messages, charge cards, publish content, or contact an outside service yet.</p></div>
  </div>;
}

function ConversationsPreview() {
  const threads = [
    ["Maria Chen", "Can you send the estimate again?", "2m", "SMS"],
    ["Derek Wilson", "Thursday afternoon works for me.", "18m", "Email"],
    ["Tamika Brooks", "Missed call follow-up", "1h", "Call"],
  ];
  return <div className="crm-preview-inbox">
    <aside><header><strong>Inbox preview</strong><Badge tone="purple">7 unread</Badge></header><label><span>Search</span><input disabled placeholder="Search conversations" /></label>{threads.map(([name, message, time, channel], index) => <article className={index === 0 ? "active" : ""} key={name}><span className="crm-preview-avatar">{name.split(" ").map((part) => part[0]).join("")}</span><div><strong>{name}</strong><p>{message}</p><small>{channel}</small></div><time>{time}</time></article>)}</aside>
    <section><header><div><strong>Maria Chen</strong><small>Segovia Pest Management · SMS preview</small></div><button disabled>Assign</button></header><div className="crm-preview-messages"><p className="incoming">Hi, can you send the estimate again?<small>10:42 AM</small></p><p className="outgoing">Absolutely — I have attached it here for you.<small>Draft preview</small></p></div><footer><textarea disabled placeholder="Messaging will be available after a provider is connected." /><button disabled>Send</button></footer></section>
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
  const rows = [["INV-1048", "Anderson Family", "$1,250", "Paid"], ["INV-1049", "Oakridge Properties", "$2,400", "Due Jul 22"], ["INV-1050", "M. Ramirez", "$875", "Draft"]];
  return <section className="crm-preview-table-card"><header><div><strong>Recent invoices</strong><small>Example revenue workspace</small></div><button disabled>+ New invoice</button></header><div className="crm-preview-table-scroll"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={cell}>{index === 3 ? <Badge tone={cell === "Paid" ? "green" : cell === "Draft" ? "neutral" : "orange"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div><footer><p>Stripe connection, payment collection, refunds, and reconciliation are not active in this preview.</p></footer></section>;
}

function AiPreview() {
  return <div className="crm-ai-preview"><section><Badge tone="purple">AI PLAYGROUND PREVIEW</Badge><h3>What would you like help with?</h3><p>Use CRM context to prepare work while keeping a person in control of every external action.</p><textarea disabled placeholder="Example: Summarize this week's new leads and suggest the next follow-up..." /><div>{["Summarize leads", "Draft a reply", "Write campaign copy", "Find follow-up risks"].map((item) => <button disabled key={item}>{item}</button>)}</div></section><aside><strong>Safety controls</strong><ul><li><span>1</span>Human approval before sending</li><li><span>2</span>Tenant-scoped CRM context</li><li><span>3</span>Usage limits and audit history</li><li><span>4</span>Tool and provider allowlists</li></ul></aside></div>;
}

function WebsitesPreview() {
  const sites = [["Segovia Pest Management", "segoviapest.example", "Published", "94"], ["Hill Country Demo Bakery", "Preview domain", "Draft", "—"], ["Lone Star Demo Property", "Domain needed", "Setup", "—"]];
  return <section className="crm-preview-table-card"><header><div><strong>Client websites</strong><small>Publishing workspace preview</small></div><button disabled>+ New website</button></header><div className="crm-preview-table-scroll"><table><thead><tr><th>Website</th><th>Domain</th><th>Status</th><th>Performance</th></tr></thead><tbody>{sites.map((row) => <tr key={row[0]}><td><strong>{row[0]}</strong></td><td>{row[1]}</td><td><Badge tone={row[2] === "Published" ? "green" : row[2] === "Draft" ? "orange" : "neutral"}>{row[2]}</Badge></td><td>{row[3]}</td></tr>)}</tbody></table></div><footer><p>The page editor and Cloudflare publishing workflow will return when the complete website module is functional.</p></footer></section>;
}

function FunnelsPreview() {
  const steps = [["1", "Service landing page", "3,842", "100%"], ["2", "Estimate form", "1,106", "28.8%"], ["3", "Booking calendar", "514", "13.4%"], ["4", "Thank-you page", "318", "8.3%"]];
  return <div className="crm-funnel-preview"><header><div><strong>Free estimate funnel</strong><small>Example conversion journey</small></div><Badge tone="orange">Draft preview</Badge></header><section>{steps.map(([number, name, visitors, rate], index) => <article key={number}><span>{number}</span><div><strong>{name}</strong><small>{visitors} sample visitors</small></div><b>{rate}</b>{index < steps.length - 1 ? <i>→</i> : null}</article>)}</section></div>;
}

function ReviewsPreview() {
  const reviews = [["MC", "Maria Chen", "5.0", "Fast, professional, and very easy to schedule."], ["DW", "Derek Wilson", "4.0", "The team communicated clearly and arrived on time."], ["TB", "Tamika Brooks", "5.0", "Excellent service from the first call through completion."]];
  return <div className="crm-reviews-preview"><section><header><div><strong>Recent review examples</strong><small>Google Business Profile preview</small></div><button disabled>Request review</button></header>{reviews.map(([initial, name, rating, copy]) => <article key={name}><span className="crm-preview-avatar">{initial}</span><div><strong>{name}<b>{rating} ★</b></strong><p>{copy}</p><small>Response workflow not connected</small></div></article>)}</section><aside><strong>Rating trend</strong><div className="crm-rating-score">4.8<small>out of 5</small></div>{[["5 stars", "82%"], ["4 stars", "14%"], ["3 stars", "3%"], ["1–2 stars", "1%"]].map(([label, width]) => <p key={label}><span>{label}</span><i><b style={{ width }} /></i><small>{width}</small></p>)}</aside></div>;
}

function ModuleBody({ module }: { module: FutureModule }) {
  if (module === "conversations") return <ConversationsPreview />;
  if (module === "automations") return <AutomationsPreview />;
  if (module === "forms") return <FormsPreview />;
  if (module === "payments") return <PaymentsPreview />;
  if (module === "ai") return <AiPreview />;
  if (module === "websites") return <WebsitesPreview />;
  if (module === "funnels") return <FunnelsPreview />;
  return <ReviewsPreview />;
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

