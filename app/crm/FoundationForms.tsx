"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import type { CrmClient } from "../../db/crm";
import { Field, getFormValue, Modal } from "./ui";

type Mutate = (input: Record<string, unknown>, success: string) => Promise<void>;

function SubmitButton({ busy, children }: { busy: boolean; children: string }) {
  return <button className="crm-button-primary" type="submit" disabled={busy}>{busy ? "Saving..." : children}</button>;
}

export function AddCompanyModal({ clients, mutate, onClose }: { clients: CrmClient[]; mutate: Mutate; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await mutate({ action: "create_company", clientId: getFormValue(form, "clientId"), name: getFormValue(form, "name"), industry: getFormValue(form, "industry"), website: getFormValue(form, "website"), phone: getFormValue(form, "phone"), email: getFormValue(form, "email"), address: getFormValue(form, "address"), city: getFormValue(form, "city"), state: getFormValue(form, "state"), zip: getFormValue(form, "zip"), tags: getFormValue(form, "tags"), notes: getFormValue(form, "notes") }, "Company created");
      onClose();
    } finally {
      setBusy(false);
    }
  }
  return <Modal title="Add a company" eyebrow="COMPANY DATABASE" onClose={onClose} wide><form className="crm-form" onSubmit={save}><Field label="Client"><select name="clientId" required>{clients.map((client) => <option key={client.id} value={client.id}>{client.businessName}</option>)}</select></Field><Field label="Company name"><input name="name" required autoFocus /></Field><Field label="Industry"><input name="industry" /></Field><Field label="Website"><input name="website" type="url" /></Field><Field label="Phone"><input name="phone" type="tel" /></Field><Field label="Email"><input name="email" type="email" /></Field><Field label="Address" span><input name="address" /></Field><Field label="City"><input name="city" /></Field><Field label="State"><input name="state" maxLength={2} /></Field><Field label="ZIP"><input name="zip" /></Field><Field label="Tags"><input name="tags" placeholder="Commercial, recurring" /></Field><Field label="Notes" span><textarea name="notes" rows={3} /></Field><footer><button className="crm-button-secondary" type="button" onClick={onClose}>Cancel</button><SubmitButton busy={busy}>Create Company</SubmitButton></footer></form></Modal>;
}

const fieldTypes = [
  ["TEXT", "Single-line text"], ["TEXTAREA", "Multi-line text"], ["NUMBER", "Number"], ["CURRENCY", "Currency"], ["PERCENTAGE", "Percentage"], ["DATE", "Date"], ["DATETIME", "Date and time"], ["CHECKBOX", "Checkbox"], ["RADIO", "Radio"], ["DROPDOWN", "Dropdown"], ["MULTI_SELECT", "Multi-select"], ["PHONE", "Phone"], ["EMAIL", "Email"], ["URL", "URL"], ["ADDRESS", "Address"], ["USER", "User selector"], ["CONTACT", "Contact selector"],
];

export function AddCustomFieldModal({ clients, mutate, onClose }: { clients: CrmClient[]; mutate: Mutate; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [fieldType, setFieldType] = useState("TEXT");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await mutate({ action: "create_custom_field", clientId: getFormValue(form, "clientId"), entityType: getFormValue(form, "entityType"), label: getFormValue(form, "label"), fieldKey: getFormValue(form, "fieldKey"), fieldType, options: getFormValue(form, "options"), isRequired: form.get("isRequired") === "on" }, "Custom field created");
      onClose();
    } finally {
      setBusy(false);
    }
  }
  const needsOptions = ["RADIO", "DROPDOWN", "MULTI_SELECT"].includes(fieldType);
  return <Modal title="Create a custom field" eyebrow="CUSTOM DATA" onClose={onClose}><form className="crm-form" onSubmit={save}><Field label="Client" span><select name="clientId" required>{clients.map((client) => <option key={client.id} value={client.id}>{client.businessName}</option>)}</select></Field><Field label="Record type"><select name="entityType"><option value="CONTACT">Contact</option><option value="COMPANY">Company</option><option value="OPPORTUNITY">Opportunity</option></select></Field><Field label="Field type"><select value={fieldType} onChange={(event) => setFieldType(event.target.value)}>{fieldTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Label"><input name="label" required autoFocus placeholder="Property type" /></Field><Field label="API key"><input name="fieldKey" placeholder="property_type" pattern="[A-Za-z0-9_ -]+" /></Field>{needsOptions ? <Field label="Options" span><textarea name="options" rows={4} required placeholder={'One option per line\nSecond option'} /></Field> : null}<label className="crm-checkbox crm-field-span"><input name="isRequired" type="checkbox" /><span>Require a value when this field is used</span></label><footer><button className="crm-button-secondary" type="button" onClick={onClose}>Cancel</button><SubmitButton busy={busy}>Create Field</SubmitButton></footer></form></Modal>;
}

export function AddCustomValueModal({ clients, mutate, onClose }: { clients: CrmClient[]; mutate: Mutate; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await mutate({ action: "upsert_custom_value", clientId: getFormValue(form, "clientId"), label: getFormValue(form, "label"), valueKey: getFormValue(form, "valueKey"), value: getFormValue(form, "value") }, "Custom value saved");
      onClose();
    } finally {
      setBusy(false);
    }
  }
  return <Modal title="Add a custom value" eyebrow="MERGE VALUES" onClose={onClose}><form className="crm-form" onSubmit={save}><Field label="Client" span><select name="clientId" required>{clients.map((client) => <option key={client.id} value={client.id}>{client.businessName}</option>)}</select></Field><Field label="Label"><input name="label" required autoFocus placeholder="Current offer" /></Field><Field label="Template key"><input name="valueKey" required placeholder="custom.offer" pattern="[A-Za-z][A-Za-z0-9_.]*" /></Field><Field label="Value" span><textarea name="value" required rows={4} /></Field><div className="crm-form-note crm-field-span">Use this value later with syntax such as <code>{"{{custom.offer}}"}</code>. Rendering uses an allowlisted token resolver and never evaluates code.</div><footer><button className="crm-button-secondary" type="button" onClick={onClose}>Cancel</button><SubmitButton busy={busy}>Save Value</SubmitButton></footer></form></Modal>;
}

type ImportRow = { firstName: string; lastName: string; phone: string; email: string; address: string; city: string; state: string; zip: string; company: string; tags: string; marketingConsent: string };

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function parseContactCsv(text: string): ImportRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("The CSV must include a header row and at least one contact.");
  const aliases: Record<string, keyof ImportRow> = { first_name: "firstName", firstname: "firstName", first: "firstName", last_name: "lastName", lastname: "lastName", last: "lastName", phone: "phone", mobile: "phone", email: "email", address: "address", street: "address", city: "city", state: "state", zip: "zip", postal_code: "zip", company: "company", company_name: "company", tags: "tags", marketing_consent: "marketingConsent", consent: "marketingConsent" };
  const headers = parseCsvLine(lines[0]).map((header) => aliases[header.toLowerCase().trim().replace(/[\s-]+/g, "_")] ?? null);
  if (!headers.includes("firstName") || !headers.includes("lastName")) throw new Error("The CSV needs first_name and last_name columns.");
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: ImportRow = { firstName: "", lastName: "", phone: "", email: "", address: "", city: "", state: "", zip: "", company: "", tags: "", marketingConsent: "unknown" };
    headers.forEach((key, index) => { if (key) row[key] = values[index] ?? ""; });
    return row;
  });
}

export function ContactImportModal({ clients, mutate, onClose }: { clients: CrmClient[]; mutate: Mutate; onClose: () => void }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError(""); setRows([]); setFileName(file?.name ?? "");
    if (!file) return;
    if (file.size > 400_000) { setError("Choose a CSV smaller than 400 KB."); return; }
    try { const parsed = parseContactCsv(await file.text()); if (parsed.length > 500) throw new Error("A single import can contain at most 500 contacts."); setRows(parsed); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The CSV could not be read."); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!rows.length) { setError("Choose a valid CSV before importing."); return; }
    setBusy(true); setError("");
    try { await mutate({ action: "import_contacts", clientId: getFormValue(form, "clientId"), rows }, `${rows.length} CSV rows processed`); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The contacts could not be imported."); }
    finally { setBusy(false); }
  }
  return <Modal title="Import contacts" eyebrow="CSV IMPORT" onClose={onClose} wide><form className="crm-form" onSubmit={save}><Field label="Client"><select name="clientId" required>{clients.map((client) => <option key={client.id} value={client.id}>{client.businessName}</option>)}</select></Field><Field label="CSV file"><input type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event)} required /></Field><div className="crm-form-note crm-field-span">Required columns: <code>first_name</code> and <code>last_name</code>, plus a phone or email. Optional: address, city, state, zip, company, tags, and marketing_consent. Existing phone/email matches are skipped.</div>{error ? <div className="crm-inline-error crm-field-span" role="alert">{error}</div> : null}{rows.length ? <div className="crm-import-preview crm-field-span"><strong>{fileName}: {rows.length} contacts ready</strong><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Company</th></tr></thead><tbody>{rows.slice(0, 5).map((row, index) => <tr key={`${row.email}-${index}`}><td>{row.firstName} {row.lastName}</td><td>{row.phone || "—"}</td><td>{row.email || "—"}</td><td>{row.company || "—"}</td></tr>)}</tbody></table>{rows.length > 5 ? <small>Previewing 5 of {rows.length} rows</small> : null}</div> : null}<footer><button className="crm-button-secondary" type="button" onClick={onClose}>Cancel</button><SubmitButton busy={busy}>Import Contacts</SubmitButton></footer></form></Modal>;
}
