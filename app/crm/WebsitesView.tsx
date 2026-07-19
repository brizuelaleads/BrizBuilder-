"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { CrmClient, CrmLead, CrmWebsite } from "../../db/crm";
import { Badge, EmptyState, Field, getFormValue, Modal, shortDate } from "./ui";

type Mutate = (input: Record<string, unknown>, success: string) => Promise<unknown>;

const platformNames: Record<string, string> = {
  brizbuilder: "BrizBuilder",
  wordpress: "WordPress",
  wix: "Wix",
  squarespace: "Squarespace",
  webflow: "Webflow",
  shopify: "Shopify",
  custom: "Custom website",
  other: "I’m not sure",
};

function endpointFor(websiteId: string) {
  if (typeof window === "undefined") return `/api/website-leads/${websiteId}`;
  const configuredBase = process.env.NEXT_PUBLIC_LEAD_CAPTURE_BASE_URL?.replace(/\/$/, "");
  const productionBase = window.location.hostname.endsWith("workers.dev")
    ? "https://brizbuilder-leads.brizuelaleads.workers.dev"
    : window.location.origin;
  return `${configuredBase || productionBase}/api/website-leads/${websiteId}`;
}

function captureSnippet(websiteId: string) {
  return `fetch("${endpointFor(websiteId)}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    firstName: "Jane",
    lastName: "Customer",
    phone: "555-555-5555",
    email: "jane@example.com",
    service: "Free estimate",
    message: "I would like more information",
    consent: true
  })
});`;
}

function handoffMessage(website: CrmWebsite) {
  return `Hi! I need the contact or estimate form on ${website.domain ?? "my website"} connected to my BrizBuilder CRM.

Please make the form send a JSON POST request to this URL:
${endpointFor(website.id)}

Please send these fields when available: firstName, lastName, phone, email, service, message, address, city, state, zip, campaign, and consent. A phone number or email is required.

When it is finished, please submit one test form and let me know so I can confirm the lead appeared in my CRM. Thank you!`;
}

async function copyText(value: string, onCopied: () => void) {
  await navigator.clipboard.writeText(value);
  onCopied();
}

function WebsiteModal({ clients, website, mutate, onClose }: { clients: CrmClient[]; website: CrmWebsite | null; mutate: Mutate; onClose: () => void }) {
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await mutate({
        action: "save_website",
        websiteId: website?.id ?? "",
        clientId: getFormValue(form, "clientId"),
        name: getFormValue(form, "name"),
        domain: getFormValue(form, "domain"),
        platform: getFormValue(form, "platform"),
      }, website ? "Website connection updated" : "Website connected to the CRM");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={website ? "Update website information" : "Add a website to the CRM"} eyebrow="STEP 1 OF 2" onClose={onClose} wide>
    <form className="crm-form" onSubmit={save}>
      <Field label="Which client owns this website?" span><select name="clientId" defaultValue={website?.clientId} required disabled={Boolean(website)}>{clients.map((client) => <option key={client.id} value={client.id}>{client.businessName}</option>)}</select></Field>
      <Field label="What do you call this website?"><input name="name" defaultValue={website?.name ?? ""} placeholder="Example: Main website" required autoFocus /></Field>
      <Field label="Where was the website built?"><select name="platform" defaultValue={website?.platform ?? "other"}>{Object.entries(platformNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="Website address" span><input name="domain" defaultValue={website?.domain ?? ""} placeholder="Example: segoviapest.com" inputMode="url" required /></Field>
      <div className="crm-form-note crm-field-span"><strong>This will not change the live website.</strong><br />It saves the website in BrizBuilder. After you save it, Step 2 gives you a message to send to the person who manages the website.</div>
      <footer><button className="crm-button-secondary" type="button" onClick={onClose}>Cancel</button><button className="crm-button-primary" type="submit" disabled={busy}>{busy ? "Saving..." : website ? "Save Website" : "Save and Continue"}</button></footer>
    </form>
  </Modal>;
}

export function WebsitesView({ websites, clients, leads, mutate, canManage }: { websites: CrmWebsite[]; clients: CrmClient[]; leads: CrmLead[]; mutate: Mutate; canManage: boolean }) {
  const [editing, setEditing] = useState<CrmWebsite | null | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(websites[0]?.id ?? null);
  const [copied, setCopied] = useState("");
  const selected = websites.find((website) => website.id === selectedId) ?? websites[0] ?? null;
  const connected = websites.filter((website) => website.status === "connected").length;
  const websiteLeads = useMemo(() => leads.filter((lead) => lead.source.toLowerCase().startsWith("website")), [leads]);

  function markCopied(label: string) {
    setCopied(label);
    window.setTimeout(() => setCopied(""), 2200);
  }

  async function disconnect(website: CrmWebsite) {
    if (!window.confirm(`Disconnect ${website.name}? Its website form will stop creating CRM leads.`)) return;
    await mutate({ action: "disconnect_website", websiteId: website.id }, "Website disconnected");
  }

  return <div className="crm-view crm-websites-view">
    <section className="crm-page-heading"><div><p>WEBSITE CONNECTIONS</p><h2>Send website leads into the CRM</h2><span>Add a website, then send the provided instructions to whoever manages that website. New form requests will appear as CRM leads.</span></div>{canManage ? <button className="crm-button-primary" onClick={() => setEditing(null)}>+ Add a Website</button> : null}</section>

    <section className="crm-website-metrics">
      <article><span>Connected websites</span><strong>{connected}</strong><small>{websites.length - connected} disconnected</small></article>
      <article><span>Website leads</span><strong>{websiteLeads.length}</strong><small>Captured into this CRM view</small></article>
      <article><span>Lead capture setup</span><strong>{connected ? "Ready" : "Not set"}</strong><small>{connected ? "Send the setup message to your website person" : "Add a website to begin"}</small></article>
    </section>

    {!websites.length ? <EmptyState title="No websites added yet" description="Start by entering the client’s website address. BrizBuilder will then give you a ready-to-send message for the person who manages the website." action={canManage && clients.length ? <button className="crm-button-primary" onClick={() => setEditing(null)}>Add your first website</button> : null} /> : <div className="crm-website-layout">
      <section className="crm-website-list" aria-label="Website connections">
        <header><div><strong>Websites</strong><small>{websites.length} total connection{websites.length === 1 ? "" : "s"}</small></div></header>
        {websites.map((website) => {
          const client = clients.find((item) => item.id === website.clientId);
          const leadCount = websiteLeads.filter((lead) => lead.clientId === website.clientId).length;
          return <button key={website.id} className={selected?.id === website.id ? "active" : ""} onClick={() => setSelectedId(website.id)}>
            <span className="crm-website-icon">{website.name.slice(0, 1).toUpperCase()}</span>
            <span><strong>{website.name}</strong><small>{client?.businessName ?? "Client"} · {leadCount} website lead{leadCount === 1 ? "" : "s"}</small></span>
            <Badge tone={website.status !== "connected" ? "neutral" : website.lastLeadAt ? "green" : "orange"}>{website.status !== "connected" ? "Disconnected" : website.lastLeadAt ? "Working" : "Setup needed"}</Badge>
          </button>;
        })}
      </section>

      {selected ? <section className="crm-website-detail">
        <header><div><p>CONNECTION DETAILS</p><h3>{selected.name}</h3><span>{clients.find((client) => client.id === selected.clientId)?.businessName}</span></div><div className="crm-website-actions">{selected.domain ? <a className="crm-button-secondary" href={`https://${selected.domain}`} target="_blank" rel="noreferrer">Open Site</a> : null}{canManage ? <button className="crm-button-secondary" onClick={() => setEditing(selected)}>Edit</button> : null}</div></header>
        <div className="crm-website-status-grid">
          <div><span>Domain</span><strong>{selected.domain ?? "Not set"}</strong></div>
          <div><span>Platform</span><strong>{platformNames[selected.platform] ?? selected.platform}</strong></div>
          <div><span>Website form status</span><Badge tone={!selected.leadCaptureEnabled ? "neutral" : selected.lastLeadAt ? "green" : "orange"}>{!selected.leadCaptureEnabled ? "Disconnected" : selected.lastLeadAt ? "Confirmed working" : "Not tested yet"}</Badge></div>
          <div><span>Last website lead</span><strong>{selected.lastLeadAt ? shortDate(selected.lastLeadAt) : "None yet"}</strong></div>
        </div>
        <section className="crm-capture-setup">
          <div><p>STEP 2 OF 2</p><h4>Ask your website person to connect the form</h4><span>You do not need to understand code. Follow these three steps.</span></div>
          <div className="crm-owner-steps">
            <article><b>1</b><span><strong>Copy the setup message</strong><small>Click the purple button below.</small></span></article>
            <article><b>2</b><span><strong>Send it to your website person</strong><small>Email or text it to whoever built or manages the website.</small></span></article>
            <article><b>3</b><span><strong>Submit one test form</strong><small>When the test lead appears in the CRM, the status changes to Working.</small></span></article>
          </div>
          <div className="crm-owner-handoff"><div><strong>Message for your website person</strong><p>Everything they need—including the special connection URL—is already included.</p></div><button onClick={() => void copyText(handoffMessage(selected), () => markCopied("message"))}>{copied === "message" ? "Message copied!" : "Copy Message to Send"}</button></div>
          <div className="crm-help-note"><span>?</span><p><strong>Not sure who manages the website?</strong> Ask the person or company you pay for website updates, hosting, or online marketing. Send them the copied message.</p></div>
          <details><summary>For website professionals only</summary><p>Lead-capture URL:</p><div className="crm-copy-row"><code>{endpointFor(selected.id)}</code><button onClick={() => void copyText(endpointFor(selected.id), () => markCopied("url"))}>{copied === "url" ? "Copied" : "Copy URL"}</button></div><p>Send a JSON POST request with at least a phone number or email. Supported fields: firstName, lastName, name, phone, email, service, message, address, city, state, zip, campaign, and consent.</p><pre>{captureSnippet(selected.id)}</pre><button className="crm-button-secondary" onClick={() => void copyText(captureSnippet(selected.id), () => markCopied("code"))}>{copied === "code" ? "Code copied" : "Copy example code"}</button></details>
        </section>
        <footer><span>Connected {shortDate(selected.createdAt)}</span>{canManage && selected.status === "connected" ? <button onClick={() => void disconnect(selected)}>Disconnect website</button> : null}</footer>
      </section> : null}
    </div>}

    {editing !== undefined ? <WebsiteModal clients={clients} website={editing} mutate={mutate} onClose={() => setEditing(undefined)} /> : null}
  </div>;
}
