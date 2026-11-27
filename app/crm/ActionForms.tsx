"use client";

import { useState, type FormEvent } from "react";
import type { CrmClient, CrmContact, CrmLead, CrmRole, CrmTeamMember } from "../../db/crm";
import { Field, getFormValue, Modal } from "./ui";
import { BusinessChoice, ChoiceCards, QuickFill, StepFlow, choiceLabel, localInputValue } from "./StepFlow";

type Mutate = (input: Record<string, unknown>, success: string) => Promise<unknown>;

function SubmitButton({ busy, children }: { busy: boolean; children: string }) {
  return <button className="crm-button-primary" type="submit" disabled={busy}>{busy ? "Saving..." : children}</button>;
}

function useSubmit(mutate: Mutate, onClose: () => void) {
  const [busy, setBusy] = useState(false);
  return { busy, run: async (input: Record<string, unknown>, success: string) => { setBusy(true); try { await mutate(input, success); onClose(); } finally { setBusy(false); } } };
}

const value = (form: FormData, key: string) => getFormValue(form, key);
const joined = (...parts: string[]) => parts.filter(Boolean).join(" ");
const money = (raw: string) => (raw ? `$${Number(raw).toLocaleString("en-US")}` : "");
const when = (raw: string) => {
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const businessName = (clients: CrmClient[], id: string) => clients.find((client) => client.id === id)?.businessName ?? "";
const addressOf = (form: FormData) => joined(value(form, "address"), joined(value(form, "city"), value(form, "state")), value(form, "zip"));

function AddressFields() {
  return (
    <details className="crm-flow-optional">
      <summary>Add an address (optional)</summary>
      <div className="crm-flow-grid">
        <Field label="Address" span><input name="address" autoComplete="street-address" /></Field>
        <Field label="City"><input name="city" /></Field>
        <Field label="State"><input name="state" maxLength={2} /></Field>
        <Field label="ZIP code"><input name="zip" inputMode="numeric" /></Field>
      </div>
    </details>
  );
}

const LEAD_SOURCES = [
  { value: "Manual", label: "Added by hand", hint: "Call, walk-in, word of mouth" },
  { value: "Website Form", label: "Website form" },
  { value: "Google Ads", label: "Google Ads" },
  { value: "Meta Ads", label: "Facebook / Instagram" },
  { value: "Organic Search", label: "Google search" },
  { value: "Referral", label: "Referral" },
];

const CONSENT = [
  { value: "unknown", label: "Not yet", hint: "Don't send marketing" },
  { value: "granted", label: "Yes", hint: "They agreed to marketing" },
];

export function AddLeadModal({ clients, mutate, onClose }: { clients: CrmClient[]; mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);
  function save(form: FormData) { void submit.run({ action: "create_lead", businessName: getFormValue(form, "businessName"), firstName: getFormValue(form, "firstName"), lastName: getFormValue(form, "lastName"), phone: getFormValue(form, "phone"), email: getFormValue(form, "email"), address: getFormValue(form, "address"), city: getFormValue(form, "city"), state: getFormValue(form, "state"), zip: getFormValue(form, "zip"), serviceRequested: getFormValue(form, "serviceRequested"), message: getFormValue(form, "message"), source: getFormValue(form, "source"), campaign: getFormValue(form, "campaign"), estimatedValueCents: Math.round(Number(getFormValue(form, "estimatedValue") || 0) * 100), leadScore: Number(getFormValue(form, "leadScore") || 50), consentStatus: getFormValue(form, "consentStatus") }, "New lead created"); }
  return <StepFlow
    title="Add a new lead"
    eyebrow="LEAD INBOX"
    wide
    onClose={onClose}
    busy={submit.busy}
    submitLabel="Create Lead"
    onSubmit={save}
    steps={[
      {
        id: "who",
        label: "Who",
        question: "Who's the lead?",
        summary: (form) => joined(value(form, "firstName"), value(form, "lastName")),
        review: (form) => [
          { label: "Name", value: joined(value(form, "firstName"), value(form, "lastName")) },
          { label: "Phone", value: value(form, "phone") },
          { label: "Email", value: value(form, "email") },
          { label: "Address", value: addressOf(form) },
        ],
        content: <>
          <div className="crm-flow-grid">
            <Field label="First name"><input name="firstName" required autoFocus /></Field>
            <Field label="Last name"><input name="lastName" required /></Field>
            <Field label="Phone"><input name="phone" type="tel" placeholder="(512) 555-0100" /></Field>
            <Field label="Email"><input name="email" type="email" placeholder="customer@example.com" /></Field>
          </div>
          <AddressFields />
        </>,
      },
      {
        id: "need",
        label: "Need",
        question: "What do they need?",
        summary: (form) => value(form, "serviceRequested"),
        review: (form) => [
          { label: "Business", value: value(form, "businessName") },
          { label: "Service", value: value(form, "serviceRequested") },
          { label: "Estimated value", value: money(value(form, "estimatedValue")) },
          { label: "Their message", value: value(form, "message") },
        ],
        content: <>
          <Field label="Service requested"><input name="serviceRequested" required placeholder="e.g. Roof repair estimate" className="crm-flow-big" /></Field>
          <div className="crm-flow-grid">
            <Field label="Business"><input name="businessName" list="lead-business-options" required autoComplete="off" placeholder="Type a business name (creates it if new)" defaultValue={clients.length === 1 ? clients[0].businessName : undefined} /><datalist id="lead-business-options">{clients.map((client) => <option key={client.id} value={client.businessName} />)}</datalist></Field>
            <Field label="Estimated value"><input name="estimatedValue" type="number" min="0" step="1" placeholder="$0" /></Field>
          </div>
          <Field label="Customer message (optional)"><textarea name="message" rows={3} /></Field>
        </>,
      },
      {
        id: "source",
        label: "Source",
        question: "Where did they come from?",
        summary: (form) => choiceLabel(LEAD_SOURCES, value(form, "source")),
        review: (form) => [
          { label: "Source", value: choiceLabel(LEAD_SOURCES, value(form, "source")) },
          { label: "Campaign", value: value(form, "campaign") },
          { label: "Marketing consent", value: choiceLabel(CONSENT, value(form, "consentStatus")) },
          { label: "Lead score", value: value(form, "leadScore") },
        ],
        content: <>
          <ChoiceCards name="source" label="Lead source" defaultValue="Manual" options={LEAD_SOURCES} />
          <div className="crm-flow-grid">
            <Field label="Campaign (optional)"><input name="campaign" /></Field>
            <Field label="Lead score"><input name="leadScore" type="number" min="0" max="100" defaultValue="50" /></Field>
          </div>
          <div className="crm-flow-label">Can we send them marketing?</div>
          <ChoiceCards name="consentStatus" label="Marketing consent" columns={2} defaultValue="unknown" options={CONSENT} />
        </>,
      },
    ]}
  />;
}

export function AddContactModal({ clients, mutate, onClose }: { clients: CrmClient[]; mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);
  const single = clients.length <= 1;
  function save(form: FormData) { void submit.run({ action: "create_contact", clientId: getFormValue(form, "clientId"), firstName: getFormValue(form, "firstName"), lastName: getFormValue(form, "lastName"), phone: getFormValue(form, "phone"), email: getFormValue(form, "email"), address: getFormValue(form, "address"), city: getFormValue(form, "city"), state: getFormValue(form, "state"), zip: getFormValue(form, "zip"), marketingConsent: getFormValue(form, "marketingConsent") }, "Contact created"); }
  return <StepFlow
    title="Add a contact"
    eyebrow="CONTACT DATABASE"
    onClose={onClose}
    busy={submit.busy}
    submitLabel="Add Contact"
    onSubmit={save}
    steps={[
      {
        id: "business",
        label: "Business",
        question: "Which business is this contact for?",
        skip: single,
        summary: (form) => businessName(clients, value(form, "clientId")),
        review: (form) => [{ label: "Business", value: businessName(clients, value(form, "clientId")) }],
        content: <BusinessChoice name="clientId" clients={clients} />,
      },
      {
        id: "who",
        label: "Who",
        question: "Who are you adding?",
        summary: (form) => joined(value(form, "firstName"), value(form, "lastName")),
        review: (form) => [
          { label: "Name", value: joined(value(form, "firstName"), value(form, "lastName")) },
          { label: "Phone", value: value(form, "phone") },
          { label: "Email", value: value(form, "email") },
          { label: "Address", value: addressOf(form) },
          { label: "Marketing consent", value: choiceLabel(CONSENT, value(form, "marketingConsent")) },
        ],
        content: <>
          {single && clients[0] ? <input type="hidden" name="clientId" value={clients[0].id} /> : null}
          <div className="crm-flow-grid">
            <Field label="First name"><input name="firstName" required autoFocus={single} /></Field>
            <Field label="Last name"><input name="lastName" required /></Field>
            <Field label="Phone"><input name="phone" type="tel" /></Field>
            <Field label="Email"><input name="email" type="email" /></Field>
          </div>
          <AddressFields />
          <div className="crm-flow-label">Can we send them marketing?</div>
          <ChoiceCards name="marketingConsent" label="Marketing consent" columns={2} defaultValue="unknown" options={CONSENT} />
        </>,
      },
    ]}
  />;
}

const PRIORITIES = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

function at(daysFromNow: number, hour: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, 0, 0, 0);
  return localInputValue(date);
}

export function AddTaskModal({ clients, leads, mutate, onClose }: { clients: CrmClient[]; leads: CrmLead[]; mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const clientLeads = leads.filter((lead) => lead.clientId === clientId);
  const leadLabel = (id: string) => { const lead = leads.find((item) => item.id === id); return lead ? `${lead.firstName} ${lead.lastName} · ${lead.serviceRequested}` : ""; };
  function save(form: FormData) { const leadId = getFormValue(form, "leadId"); const lead = leads.find((item) => item.id === leadId); void submit.run({ action: "create_task", clientId, leadId, contactId: lead?.contactId ?? "", title: getFormValue(form, "title"), description: getFormValue(form, "description"), assignee: getFormValue(form, "assignee"), dueAt: getFormValue(form, "dueAt"), priority: getFormValue(form, "priority") }, "Task created"); }
  return <StepFlow
    title="Create a task"
    eyebrow="FOLLOW-UP WORK"
    onClose={onClose}
    busy={submit.busy}
    submitLabel="Create Task"
    onSubmit={save}
    steps={[
      {
        id: "what",
        label: "Task",
        question: "What needs to get done?",
        summary: (form) => value(form, "title"),
        review: (form) => [
          { label: "Task", value: value(form, "title") },
          { label: "Details", value: value(form, "description") },
          { label: "Priority", value: choiceLabel(PRIORITIES, value(form, "priority")) },
        ],
        content: <>
          <Field label="Task title"><input name="title" required autoFocus className="crm-flow-big" placeholder="e.g. Call back about the estimate" /></Field>
          <Field label="Description (optional)"><textarea name="description" rows={3} /></Field>
          <div className="crm-flow-label">How urgent is it?</div>
          <ChoiceCards name="priority" label="Priority" columns={4} defaultValue="MEDIUM" options={PRIORITIES} />
        </>,
      },
      {
        id: "for",
        label: "For",
        question: "Who is it about?",
        summary: (form) => (value(form, "leadId") ? leadLabel(value(form, "leadId")).split(" · ")[0] : businessName(clients, clientId)),
        review: (form) => [
          { label: "Business", value: businessName(clients, clientId) },
          { label: "Related lead", value: leadLabel(value(form, "leadId")) },
        ],
        content: <>
          {clients.length > 1 ? <BusinessChoice clients={clients} value={clientId} onChange={setClientId} /> : null}
          <Field label="Related lead"><select name="leadId"><option value="">No related lead</option>{clientLeads.map((lead) => <option key={lead.id} value={lead.id}>{lead.firstName} {lead.lastName} · {lead.serviceRequested}</option>)}</select></Field>
        </>,
      },
      {
        id: "when",
        label: "When",
        question: "When is it due?",
        summary: (form) => when(value(form, "dueAt")),
        review: (form) => [
          { label: "Due", value: when(value(form, "dueAt")) },
          { label: "Assigned to", value: value(form, "assignee") },
        ],
        content: <>
          <QuickFill target="dueAt" options={[
            { label: "Later today", value: () => at(0, Math.min(new Date().getHours() + 2, 23)) },
            { label: "Tomorrow 9 am", value: () => at(1, 9) },
            { label: "In 3 days", value: () => at(3, 9) },
            { label: "Next week", value: () => at(7, 9) },
          ]} />
          <div className="crm-flow-grid">
            <Field label="Due date"><input name="dueAt" type="datetime-local" required /></Field>
            <Field label="Assignee"><input name="assignee" defaultValue="Luciano Brizuela" /></Field>
          </div>
        </>,
      },
    ]}
  />;
}

function plusMinutes(form: HTMLFormElement, minutes: number) {
  const start = (form.elements.namedItem("startsAt") as HTMLInputElement | null)?.value;
  if (!start) return null;
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return null;
  return localInputValue(new Date(date.getTime() + minutes * 60_000));
}

export function AddAppointmentModal({ clients, contacts, leads, mutate, onClose }: { clients: CrmClient[]; contacts: CrmContact[]; leads: CrmLead[]; mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const clientContacts = contacts.filter((contact) => contact.clientId === clientId);
  const clientLeads = leads.filter((lead) => lead.clientId === clientId);
  const contactName = (id: string) => { const contact = contacts.find((item) => item.id === id); return contact ? `${contact.firstName} ${contact.lastName}` : ""; };
  const leadLabel = (id: string) => { const lead = leads.find((item) => item.id === id); return lead ? `${lead.firstName} ${lead.lastName} · ${lead.serviceRequested}` : ""; };
  function save(form: FormData) { void submit.run({ action: "create_appointment", clientId, contactId: getFormValue(form, "contactId"), leadId: getFormValue(form, "leadId"), serviceType: getFormValue(form, "serviceType"), startsAt: getFormValue(form, "startsAt"), endsAt: getFormValue(form, "endsAt"), assignedEmployee: getFormValue(form, "assignedEmployee"), address: getFormValue(form, "address"), notes: getFormValue(form, "notes") }, "Appointment booked"); }
  return <StepFlow
    title="Book an appointment"
    eyebrow="CALENDAR"
    wide
    onClose={onClose}
    busy={submit.busy}
    submitLabel="Book Appointment"
    onSubmit={save}
    steps={[
      {
        id: "who",
        label: "Who",
        question: "Who is the appointment with?",
        summary: (form) => contactName(value(form, "contactId")),
        review: (form) => [
          { label: "Business", value: clients.length > 1 ? businessName(clients, clientId) : "" },
          { label: "Contact", value: contactName(value(form, "contactId")) },
          { label: "Related lead", value: leadLabel(value(form, "leadId")) },
        ],
        content: <>
          {clients.length > 1 ? <BusinessChoice clients={clients} value={clientId} onChange={setClientId} /> : null}
          <div className="crm-flow-grid">
            <Field label="Contact"><select name="contactId" required>{clientContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.firstName} {contact.lastName}</option>)}</select></Field>
            <Field label="Related lead"><select name="leadId"><option value="">No related lead</option>{clientLeads.map((lead) => <option key={lead.id} value={lead.id}>{lead.firstName} {lead.lastName} · {lead.serviceRequested}</option>)}</select></Field>
          </div>
          {!clientContacts.length ? <p className="crm-flow-hint">This business has no contacts yet. Add a contact first, then book the appointment.</p> : null}
        </>,
      },
      {
        id: "what",
        label: "What",
        question: "What's the appointment for?",
        summary: (form) => value(form, "serviceType"),
        review: (form) => [
          { label: "Service", value: value(form, "serviceType") },
          { label: "Address", value: value(form, "address") },
          { label: "Notes", value: value(form, "notes") },
        ],
        content: <>
          <Field label="Service type"><input name="serviceType" required className="crm-flow-big" placeholder="e.g. Roof inspection" /></Field>
          <Field label="Service address (optional)"><input name="address" /></Field>
          <Field label="Internal notes (optional)"><textarea name="notes" rows={3} /></Field>
        </>,
      },
      {
        id: "when",
        label: "When",
        question: "When is it?",
        summary: (form) => when(value(form, "startsAt")),
        review: (form) => [
          { label: "Starts", value: when(value(form, "startsAt")) },
          { label: "Ends", value: when(value(form, "endsAt")) },
          { label: "Assigned to", value: value(form, "assignedEmployee") },
        ],
        content: <>
          <div className="crm-flow-grid">
            <Field label="Start time"><input name="startsAt" type="datetime-local" required /></Field>
            <Field label="End time"><input name="endsAt" type="datetime-local" required /></Field>
          </div>
          <div className="crm-flow-label">How long? Sets the end time from the start.</div>
          <QuickFill target="endsAt" options={[
            { label: "30 min", value: (form) => plusMinutes(form, 30) },
            { label: "1 hour", value: (form) => plusMinutes(form, 60) },
            { label: "2 hours", value: (form) => plusMinutes(form, 120) },
            { label: "Half day", value: (form) => plusMinutes(form, 240) },
          ]} />
          <Field label="Assigned employee (optional)"><input name="assignedEmployee" /></Field>
        </>,
      },
    ]}
  />;
}

const TIME_ZONES = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Los_Angeles", label: "Pacific" },
];

export function AddClientModal({ mutate, onClose }: { mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);
  function save(form: FormData) { void submit.run({ action: "create_client", businessName: getFormValue(form, "businessName"), industry: getFormValue(form, "industry"), website: getFormValue(form, "website"), phone: getFormValue(form, "phone"), email: getFormValue(form, "email"), address: getFormValue(form, "address"), city: getFormValue(form, "city"), state: getFormValue(form, "state"), zip: getFormValue(form, "zip"), timeZone: getFormValue(form, "timeZone"), monthlyAdBudgetCents: Math.round(Number(getFormValue(form, "monthlyAdBudget") || 0) * 100), assignedAccountManager: getFormValue(form, "assignedAccountManager"), serviceAreas: getFormValue(form, "serviceAreas"), notes: getFormValue(form, "notes") }, "Sub-account created"); }
  return <StepFlow
    title="Add a sub-account"
    eyebrow="AGENCY · SUB-ACCOUNTS"
    wide
    onClose={onClose}
    busy={submit.busy}
    submitLabel="Create Sub-Account"
    onSubmit={save}
    steps={[
      {
        id: "business",
        label: "Business",
        question: "What's the business?",
        summary: (form) => value(form, "businessName"),
        review: (form) => [
          { label: "Business", value: value(form, "businessName") },
          { label: "Industry", value: value(form, "industry") },
          { label: "Website", value: value(form, "website") },
        ],
        content: <>
          <Field label="Business name"><input name="businessName" required autoFocus className="crm-flow-big" /></Field>
          <div className="crm-flow-grid">
            <Field label="Industry"><input name="industry" required placeholder="Pest control" /></Field>
            <Field label="Website (optional)"><input name="website" type="url" placeholder="https://" /></Field>
          </div>
        </>,
      },
      {
        id: "contact",
        label: "Contact",
        question: "How do you reach them?",
        summary: (form) => value(form, "phone") || value(form, "email"),
        review: (form) => [
          { label: "Phone", value: value(form, "phone") },
          { label: "Email", value: value(form, "email") },
          { label: "Address", value: addressOf(form) },
        ],
        content: <>
          <div className="crm-flow-grid">
            <Field label="Phone"><input name="phone" type="tel" /></Field>
            <Field label="Email"><input name="email" type="email" /></Field>
          </div>
          <AddressFields />
        </>,
      },
      {
        id: "setup",
        label: "Setup",
        question: "A few settings",
        summary: (form) => choiceLabel(TIME_ZONES, value(form, "timeZone")),
        review: (form) => [
          { label: "Time zone", value: choiceLabel(TIME_ZONES, value(form, "timeZone")) },
          { label: "Monthly ad budget", value: money(value(form, "monthlyAdBudget")) },
          { label: "Account manager", value: value(form, "assignedAccountManager") },
          { label: "Service areas", value: value(form, "serviceAreas") },
          { label: "Notes", value: value(form, "notes") },
        ],
        content: <>
          <div className="crm-flow-label">Time zone</div>
          <ChoiceCards name="timeZone" label="Time zone" columns={4} defaultValue="America/Chicago" options={TIME_ZONES} />
          <div className="crm-flow-grid">
            <Field label="Monthly ad budget"><input name="monthlyAdBudget" type="number" min="0" placeholder="$0" /></Field>
            <Field label="Account manager"><input name="assignedAccountManager" defaultValue="Luciano Brizuela" /></Field>
          </div>
          <Field label="Service areas (optional)"><input name="serviceAreas" placeholder="Austin, Round Rock, Georgetown" /></Field>
          <Field label="Notes (optional)"><textarea name="notes" rows={3} /></Field>
        </>,
      },
    ]}
  />;
}

function AdminSubAccountChoices({ clients, selectedIds = [] }: { clients: CrmClient[]; selectedIds?: string[] }) {
  return (
    <fieldset className="crm-admin-subaccounts crm-field-span">
      <legend>Assigned sub-accounts</legend>
      {clients.map((client) => (
        <label key={client.id}>
          <input type="checkbox" name="clientIds" value={client.id} defaultChecked={selectedIds.includes(client.id)} />
          {client.businessName}
        </label>
      ))}
      {!clients.length && <p>Add a sub-account before assigning access.</p>}
    </fieldset>
  );
}

export function AdminAssignmentsModal({ member, clients, mutate, onClose }: { member: CrmTeamMember; clients: CrmClient[]; mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clientIds = new FormData(event.currentTarget).getAll("clientIds");
    void submit.run({ action: "set_admin_assignments", memberId: member.id, scope: member.clientId ? "client" : "agency", clientIds }, "Admin access updated");
  }

  return <Modal title={`Edit access for ${member.displayName}`} eyebrow="TEAM ACCESS" onClose={onClose}>
    <form className="crm-form" onSubmit={save}>
      <AdminSubAccountChoices clients={clients} selectedIds={member.assignedClientIds ?? (member.clientId ? [member.clientId] : [])} />
      <p className="crm-form-note crm-field-span">{member.clientId ? "Choose the sub-accounts this admin can open." : "Clear every selection to suspend workspace access."}</p>
      <footer><button className="crm-button-secondary" type="button" onClick={onClose}>Cancel</button><SubmitButton busy={submit.busy}>Save access</SubmitButton></footer>
    </form>
  </Modal>;
}

const ROLE_LABELS: Record<string, string> = {
  CLIENT_OWNER: "Client owner",
  CLIENT_MANAGER: "Client manager",
  CLIENT_EMPLOYEE: "Client employee",
  LB_TEAM_MEMBER: "LB Team Member",
  LB_ADMIN: "LB Admin",
};

const ROLE_HINTS: Record<string, string> = {
  CLIENT_OWNER: "Everything for this business, including adding its team and connecting payments.",
  CLIENT_MANAGER: "Day-to-day work, reviews, websites and invoices. Cannot manage the team.",
  CLIENT_EMPLOYEE: "Leads, contacts, tasks, appointments and messages. No imports or settings.",
  LB_TEAM_MEMBER: "Your agency staff, working inside one sub-account.",
  LB_ADMIN: "Your agency admin: every sidebar tab, in the sub-accounts you pick.",
};

export function InviteMemberModal({ clients, isAgency, viewerRole, mutate, onClose }: { clients: CrmClient[]; isAgency: boolean; viewerRole: CrmRole; mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);
  const canInviteLbRoles = isAgency && ["LB_OWNER", "SUPER_ADMIN", "AGENCY_OWNER"].includes(viewerRole);
  const [role, setRole] = useState<CrmRole>("CLIENT_OWNER");
  const isClientRole = role.startsWith("CLIENT_");
  const isLbTeamMember = role === "LB_TEAM_MEMBER";
  const isLbAdmin = role === "LB_ADMIN";
  // Client owners only ever add their own staff; the server takes the
  // sub-account from their session and refuses agency roles outright.
  const needsSubAccount = isAgency && (isClientRole || isLbTeamMember);
  function save(form: FormData) {
    void submit.run({
      action: "invite_member",
      displayName: getFormValue(form, "displayName"),
      email: getFormValue(form, "email"),
      role,
      clientId: needsSubAccount ? getFormValue(form, "clientId") : "",
      ...(isLbAdmin ? { clientIds: form.getAll("clientIds") } : {}),
    }, "Invite email sent");
  }
  return <StepFlow
    title="Give someone access"
    eyebrow="TEAM ACCESS"
    onClose={onClose}
    busy={submit.busy}
    submitLabel="Send Invite"
    reviewQuestion="Ready to send the invite"
    onSubmit={save}
    steps={[
      {
        id: "who",
        label: "Who",
        question: "Who are you inviting?",
        summary: (form) => value(form, "displayName"),
        review: (form) => [
          { label: "Name", value: value(form, "displayName") },
          { label: "Email", value: value(form, "email") },
        ],
        content: <>
          <Field label="Full name"><input name="displayName" required autoFocus className="crm-flow-big" /></Field>
          <Field label="Email"><input name="email" type="email" required /></Field>
        </>,
      },
      {
        id: "access",
        label: "Access",
        question: "What can they do?",
        summary: () => ROLE_LABELS[role] ?? role,
        review: (form) => [
          { label: "Role", value: ROLE_LABELS[role] ?? role },
          { label: "Sub-account", value: needsSubAccount ? businessName(clients, value(form, "clientId")) : "" },
          { label: "Sub-accounts", value: isLbAdmin ? form.getAll("clientIds").map((id) => businessName(clients, String(id))).join(", ") : "" },
        ],
        content: <>
          <Field label="Role"><select name="role" value={role} onChange={(event) => setRole(event.target.value as CrmRole)}>
            <optgroup label={isAgency ? "Client sub-account" : "Your team"}>
              <option value="CLIENT_OWNER">Client owner</option>
              <option value="CLIENT_MANAGER">Client manager</option>
              <option value="CLIENT_EMPLOYEE">Client employee</option>
            </optgroup>
            {canInviteLbRoles ? <optgroup label="LB Marketing">
              <option value="LB_TEAM_MEMBER">LB Team Member</option>
              <option value="LB_ADMIN">LB Admin</option>
            </optgroup> : null}
          </select></Field>
          <p className="crm-flow-hint">{ROLE_HINTS[role]}</p>
          {needsSubAccount ? <Field label="Sub-account"><select name="clientId" required defaultValue="">
            <option value="" disabled>Choose the business they can see</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.businessName}</option>)}
          </select></Field> : null}
          {isLbAdmin && <AdminSubAccountChoices clients={clients} />}
          <div className="crm-form-note">{isLbAdmin ? "LB Admins can open every sidebar tab and work in the sub-accounts you select. " : !isAgency ? "This person joins your business only. " : "This person can access the selected sub-account. "}BrizBuilder will email a secure invite link so they can choose their own password.</div>
        </>,
      },
    ]}
  />;
}
