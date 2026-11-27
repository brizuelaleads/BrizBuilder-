"use client";

import { Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type {
  CrmClient,
  CrmLead,
  CrmProviderConnection,
  CrmWebsite,
} from "../../db/crm";
import { buildDniSnippet, isCallRailScriptUrl } from "../../lib/callrail-dni";
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
  return `// Forward the ad click ids from the landing page URL so paid traffic can be
// matched back to the ad that produced the lead.
const params = new URLSearchParams(location.search);
const attribution = {};
for (const key of ["fbclid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
  const value = params.get(key);
  if (value) attribution[key] = value;
}

fetch("${endpointFor(websiteId)}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    firstName: "Jane",
    lastName: "Customer",
    phone: "555-555-5555",
    email: "jane@example.com",
    service: "Free estimate",
    message: "I would like more information",
    consent: true,
    pageUrl: location.href,
    ...attribution
  })
});`;
}

function handoffMessage(website: CrmWebsite) {
  return `Hi! I need the contact or estimate form on ${website.domain ?? "my website"} connected to my BrizBuilder CRM.

Please make the form send a JSON POST request to this URL:
${endpointFor(website.id)}

Please send these fields when available: firstName, lastName, phone, email, service, message, address, city, state, zip, campaign, and consent. A phone number or email is required.

If we run Facebook or Instagram ads to this page, please also forward whatever is in the page URL: fbclid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, plus pageUrl. That is what lets the ads learn which clicks turn into real customers.

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

export function WebsitesView({ websites, clients, leads, connections, mutate, canManage }: { websites: CrmWebsite[]; clients: CrmClient[]; leads: CrmLead[]; connections: CrmProviderConnection[]; mutate: Mutate; canManage: boolean }) {
  const [section, setSection] = useState<"overview" | "setup" | "settings">("overview");
  const [search, setSearch] = useState("");
  const [dniLink, setDniLink] = useState("");
  const [editing, setEditing] = useState<CrmWebsite | null | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(websites[0]?.id ?? null);
  const [copied, setCopied] = useState("");
  const selected = websites.find((website) => website.id === selectedId) ?? websites[0] ?? null;
  const visibleWebsites = websites.filter(website => `${website.name} ${website.domain ?? ""} ${clients.find(client => client.id === website.clientId)?.businessName ?? ""}`.toLowerCase().includes(search.toLowerCase().trim()));
  const captureEnabled = selected?.status === "connected" && selected.leadCaptureEnabled;
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

  async function remove(website: CrmWebsite) {
    if (!window.confirm(`Delete ${website.name}? This permanently removes the website connection and setup. Existing CRM leads will stay in BrizBuilder.`)) return;
    await mutate({ action: "delete_website", websiteId: website.id }, "Website deleted");
    setSelectedId(websites.find((item) => item.id !== website.id)?.id ?? null);
  }

  return <div className="crm-view crm-websites-view">
    <section className="crm-page-heading crm-website-toolbar" aria-label="Website overview">
      <div><h2>Websites</h2><span>Manage website connections</span></div>
      {canManage ? <button className="crm-button-primary" onClick={() => setEditing(null)}>+ Add website</button> : null}
    </section>

    <section className="crm-website-metrics" aria-label="Website summary">
      <article><span>Total websites</span><strong>{websites.length}</strong><small>Websites in this workspace</small></article>
      <article><span>Lead capture enabled</span><strong>{connected}</strong><small>{websites.length - connected} disconnected</small></article>
      <article><span>Website leads</span><strong>{websiteLeads.length}</strong><small>Leads captured from website forms</small></article>
    </section>

    {!websites.length ? <EmptyState title="No websites added yet" description="Start by entering the client’s website address. BrizBuilder will then give you a ready-to-send message for the person who manages the website." action={canManage && clients.length ? <button className="crm-button-primary" onClick={() => setEditing(null)}>Add your first website</button> : null} /> : <div className="crm-website-layout">
      <section className="crm-website-list" aria-label="Website connections">
        <header><div><strong>Websites</strong><small>{websites.length} total connection{websites.length === 1 ? "" : "s"}</small></div></header>
        <label className="crm-search crm-website-search"><Search aria-hidden="true" /><input aria-label="Find a website" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, domain, or client" /></label>
        {!visibleWebsites.length ? <p className="crm-website-no-results">No websites match your search.</p> : null}
        {visibleWebsites.map((website) => {
          const client = clients.find((item) => item.id === website.clientId);

          return <button key={website.id} className={selected?.id === website.id ? "active" : ""} aria-pressed={selected?.id === website.id} onClick={() => { setSelectedId(website.id); setDniLink(""); setSection("overview"); setCopied(""); }}>
            <span className="crm-website-icon">{website.name.slice(0, 1).toUpperCase()}</span>
            <span><strong>{website.name}</strong><small>{website.domain || client?.businessName || "No domain added"}</small></span>
            <Badge tone={(website.status !== "connected" || !website.leadCaptureEnabled) ? "neutral" : website.lastLeadAt ? "green" : "orange"}>{website.status !== "connected" || !website.leadCaptureEnabled ? "Disconnected" : website.lastLeadAt ? "Lead received" : "Setup needed"}</Badge>
          </button>;
        })}
      </section>

      {selected ? <section className="crm-website-detail">
        <header><div><h3>{selected.name}</h3><span>{clients.find((client) => client.id === selected.clientId)?.businessName}</span></div><div className="crm-website-actions">{selected.domain ? <a className="crm-button-secondary" href={`https://${selected.domain}`} target="_blank" rel="noreferrer">Open Site</a> : null}{canManage ? <button className="crm-button-secondary" onClick={() => setEditing(selected)}>Edit</button> : null}</div></header>
        <nav className="crm-tabs crm-website-nav" aria-label="Website details">{(["overview", "setup", "settings"] as const).map(tab => <button type="button" key={tab} className={section === tab ? "active" : ""} aria-current={section === tab ? "page" : undefined} onClick={() => setSection(tab)}>{tab === "overview" ? "Overview" : tab === "setup" ? "Form setup" : "Settings"}</button>)}</nav>
        {section === "overview" ? <div className="crm-website-overview-panel">
          <div className="crm-website-connection-state"><Badge tone={!captureEnabled ? "neutral" : selected.lastLeadAt ? "green" : "orange"}>{!captureEnabled ? "Disconnected" : selected.lastLeadAt ? "Lead received" : "Awaiting first lead"}</Badge><h4>{!captureEnabled ? "Lead capture is off" : selected.lastLeadAt ? "Your website has sent leads" : "Finish connecting your form"}</h4><p>{!captureEnabled ? "Update this website in Settings to enable lead capture again." : selected.lastLeadAt ? "New form submissions appear in your Leads tab. You can find the last received date below." : "Send the setup instructions to your website manager, then submit a test form to check the connection."}</p><button className="crm-button-secondary" onClick={() => setSection(captureEnabled ? "setup" : "settings")}>{captureEnabled ? selected.lastLeadAt ? "View setup instructions" : "Set up form" : "Open settings"}</button></div>
        <div className="crm-website-status-grid">
          <div><span>Domain</span><strong>{selected.domain ?? "Not set"}</strong></div>
          <div><span>Platform</span><strong>{platformNames[selected.platform] ?? selected.platform}</strong></div>
          <div><span>Client</span><strong>{clients.find(client => client.id === selected.clientId)?.businessName || "Not assigned"}</strong></div>
          <div><span>Last website lead</span><strong>{selected.lastLeadAt ? shortDate(selected.lastLeadAt) : "None yet"}</strong></div>
        </div>
        </div> : null}
        {section === "setup" ? <section className="crm-capture-setup">
          <div><h4>{selected.lastLeadAt ? "Form connection" : "Connect your website form"}</h4><span>{selected.lastLeadAt ? "Setup instructions are available whenever your website needs an update." : "Send the setup message to your website manager, then submit a test form."}</span></div>
          <div className="crm-owner-handoff"><div><strong>Website setup message</strong><p>Includes your connection URL, required fields, and testing instructions.</p></div><button onClick={() => void copyText(handoffMessage(selected), () => markCopied("message"))}>{copied === "message" ? "Message copied!" : "Copy setup message"}</button></div>
          <details className="crm-website-help"><summary>Who should I send this to?</summary><p>Send the message to the person or company who manages your website, hosting, or online marketing. Ask them to submit a test form after connecting it.</p></details>
          <CallRailDniSetup
            connection={connections.find((item) => item.clientId === selected.clientId && item.provider === "callrail") ?? null}
            canManage={canManage}
            copied={copied}
            onCopy={(text, label) => void copyText(text, () => markCopied(label))}
            dniLink={dniLink}
            onTestLink={async () => {
              const result = (await mutate({ action: "create_callrail_dni_test_link", clientId: selected.clientId }, "Test link ready — it expires shortly.")) as { url?: string } | null;
              setDniLink(result?.url ?? "");
            }}
          />
          <details><summary>Developer instructions</summary><p>Lead-capture URL:</p><div className="crm-copy-row"><code>{endpointFor(selected.id)}</code><button onClick={() => void copyText(endpointFor(selected.id), () => markCopied("url"))}>{copied === "url" ? "Copied" : "Copy URL"}</button></div><p>Send a JSON POST request with at least a phone number or email. Supported fields: firstName, lastName, name, phone, email, service, message, address, city, state, zip, campaign, and consent. For paid traffic also send pageUrl, fbclid and any utm_ values from the landing page URL, plus eventId if the page runs a Meta Pixel.</p><pre>{captureSnippet(selected.id)}</pre><button className="crm-button-secondary" onClick={() => void copyText(captureSnippet(selected.id), () => markCopied("code"))}>{copied === "code" ? "Code copied" : "Copy example code"}</button></details>
        </section> : null}
        {section === "settings" ? <section className="crm-website-settings"><h4>Website settings</h4><p>Update the website name, address, platform, or connection.</p>{canManage ? <button className="crm-button-secondary" onClick={() => setEditing(selected)}>Edit website</button> : <p>Contact an administrator to change this website.</p>}<footer><span>Added {shortDate(selected.createdAt)}</span>{canManage ? <div className="crm-website-footer-actions">{selected.status === "connected" ? <button onClick={() => void disconnect(selected)}>Disconnect</button> : null}<button className="danger" onClick={() => void remove(selected)}>Delete website</button></div> : null}</footer></section> : null}
      </section> : null}
    </div>}

    {editing !== undefined ? <WebsiteModal clients={clients} website={editing} mutate={mutate} onClose={() => setEditing(undefined)} /> : null}
  </div>;
}

/**
 * Call tracking install instructions for a website whose client has CallRail
 * connected.
 *
 * The snippet is generated from the script URL CallRail returned for the
 * chosen company, so nobody has to go and copy it out of the CallRail
 * dashboard and nobody can paste the wrong company's script by mistake.
 */
function CallRailDniSetup({
  connection,
  canManage,
  copied,
  onCopy,
  dniLink,
  onTestLink,
}: {
  connection: CrmProviderConnection | null;
  canManage: boolean;
  copied: string;
  onCopy: (text: string, label: string) => void;
  dniLink: string;
  onTestLink: () => void | Promise<void>;
}) {
  if (!connection || connection.setupStatus !== "ready") return null;
  if (!isCallRailScriptUrl(connection.scriptUrl)) return null;
  const snippet = buildDniSnippet(connection.scriptUrl as string);
  return (
    <details className="crm-callrail-dni">
      <summary>Call tracking (CallRail)</summary>
      <p>
        This snippet swaps the phone number on the site for a tracking number,
        so a call can be matched to the ad, campaign or search that produced it.
        It belongs just before the closing &lt;/body&gt; tag on every page.
      </p>
      <div className="crm-copy-row">
        <code>{snippet}</code>
        <button onClick={() => onCopy(snippet, "dni")}>
          {copied === "dni" ? "Copied" : "Copy snippet"}
        </button>
      </div>
      <p>
        Numbers on the page are replaced only for visits CallRail can attribute.
        A visitor CallRail has no tracker for keeps seeing the original number,
        which is the intended behaviour rather than a fault.
      </p>
      <p>
        Installed on: <strong>{connection.companyName ?? "the connected company"}</strong>
        {" · "}
        Script seen on the site:{" "}
        <strong>
          {connection.dniActive === true
            ? "yes"
            : connection.dniActive === false
              ? "not yet"
              : "never"}
        </strong>
      </p>
      {canManage ? (
        <>
          <p>
            Before touching the live site, check the swap on a private test page.
            The link below needs no login, expires in fifteen minutes, is not
            indexed, and cannot create a lead or a conversion.
          </p>
          <button className="crm-button-secondary" onClick={() => void onTestLink()}>
            Create a test-page link
          </button>
          {dniLink ? (
            <div className="crm-copy-row">
              <code>{dniLink}</code>
              <button onClick={() => onCopy(dniLink, "dnilink")}>
                {copied === "dnilink" ? "Copied" : "Copy link"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </details>
  );
}
