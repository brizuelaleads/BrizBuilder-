"use client";

import { useState, type FormEvent } from "react";
import type { CrmClient, CrmContact, CrmLead, CrmRole } from "../../db/crm";
import { Field, getFormValue, Modal } from "./ui";

type Mutate = (input: Record<string, unknown>, success: string) => Promise<unknown>;

function SubmitButton({ busy, children }: { busy: boolean; children: string }) {
  return <button className="crm-button-primary" type="submit" disabled={busy}>{busy ? "Saving..." : children}</button>;
}

function useSubmit(mutate: Mutate, onClose: () => void) {
  const [busy, setBusy] = useState(false);
  return { busy, run: async (input: Record<string, unknown>, success: string) => { setBusy(true); try { await mutate(input, success); onClose(); } finally { setBusy(false); } } };
}

export function AddLeadModal({ clients, mutate, onClose }: { clients: CrmClient[]; mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); void submit.run({ action: "create_lead", businessName: getFormValue(form, "businessName"), firstName: getFormValue(form, "firstName"), lastName: getFormValue(form, "lastName"), phone: getFormValue(form, "phone"), email: getFormValue(form, "email"), address: getFormValue(form, "address"), city: getFormValue(form, "city"), state: getFormValue(form, "state"), zip: getFormValue(form, "zip"), serviceRequested: getFormValue(form, "serviceRequested"), message: getFormValue(form, "message"), source: getFormValue(form, "source"), campaign: getFormValue(form, "campaign"), estimatedValueCents: Math.round(Number(getFormValue(form, "estimatedValue") || 0) * 100), leadScore: Number(getFormValue(form, "leadScore") || 50), consentStatus: getFormValue(form, "consentStatus") }, "New lead created"); }
  return <Modal title="Add a new lead" eyebrow="LEAD INBOX" onClose={onClose} wide><form className="crm-form" onSubmit={save}><Field label="Business"><input name="businessName" list="lead-business-options" required autoComplete="off" placeholder="Type a business name (creates it if new)" /><datalist id="lead-business-options">{clients.map((client) => <option key={client.id} value={client.businessName} />)}</datalist></Field><Field label="Service requested"><input name="serviceRequested" required placeholder="e.g. Roof repair estimate" /></Field><Field label="First name"><input name="firstName" required autoFocus /></Field><Field label="Last name"><input name="lastName" required /></Field><Field label="Phone"><input name="phone" type="tel" placeholder="(512) 555-0100" /></Field><Field label="Email"><input name="email" type="email" placeholder="customer@example.com" /></Field><Field label="Address" span><input name="address" /></Field><Field label="City"><input name="city" /></Field><Field label="State"><input name="state" maxLength={2} /></Field><Field label="ZIP code"><input name="zip" inputMode="numeric" /></Field><Field label="Lead source"><select name="source"><option>Manual</option><option>Website Form</option><option>Google Ads</option><option>Meta Ads</option><option>Organic Search</option><option>Referral</option></select></Field><Field label="Campaign"><input name="campaign" /></Field><Field label="Estimated value"><input name="estimatedValue" type="number" min="0" step="1" /></Field><Field label="Lead score"><input name="leadScore" type="number" min="0" max="100" defaultValue="50" /></Field><Field label="Marketing consent"><select name="consentStatus"><option value="unknown">Unknown</option><option value="granted">Granted</option></select></Field><Field label="Customer message" span><textarea name="message" rows={4} /></Field><footer><button className="crm-button-secondary" type="button" onClick={onClose}>Cancel</button><SubmitButton busy={submit.busy}>Create Lead</SubmitButton></footer></form></Modal>;
}

export function AddContactModal({ clients, mutate, onClose }: { clients: CrmClient[]; mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); void submit.run({ action: "create_contact", clientId: getFormValue(form, "clientId"), firstName: getFormValue(form, "firstName"), lastName: getFormValue(form, "lastName"), phone: getFormValue(form, "phone"), email: getFormValue(form, "email"), address: getFormValue(form, "address"), city: getFormValue(form, "city"), state: getFormValue(form, "state"), zip: getFormValue(form, "zip"), marketingConsent: getFormValue(form, "marketingConsent") }, "Contact created"); }
  return <Modal title="Add a contact" eyebrow="CONTACT DATABASE" onClose={onClose}><form className="crm-form" onSubmit={save}><Field label="Client" span><select name="clientId" required>{clients.map((client) => <option key={client.id} value={client.id}>{client.businessName}</option>)}</select></Field><Field label="First name"><input name="firstName" required autoFocus /></Field><Field label="Last name"><input name="lastName" required /></Field><Field label="Phone"><input name="phone" type="tel" /></Field><Field label="Email"><input name="email" type="email" /></Field><Field label="Address" span><input name="address" /></Field><Field label="City"><input name="city" /></Field><Field label="State"><input name="state" maxLength={2} /></Field><Field label="ZIP"><input name="zip" /></Field><Field label="Marketing consent"><select name="marketingConsent"><option value="unknown">Unknown</option><option value="granted">Granted</option></select></Field><footer><button className="crm-button-secondary" type="button" onClick={onClose}>Cancel</button><SubmitButton busy={submit.busy}>Add Contact</SubmitButton></footer></form></Modal>;
}

export function AddTaskModal({ clients, leads, mutate, onClose }: { clients: CrmClient[]; leads: CrmLead[]; mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const clientLeads = leads.filter((lead) => lead.clientId === clientId);
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const leadId = getFormValue(form, "leadId"); const lead = leads.find((item) => item.id === leadId); void submit.run({ action: "create_task", clientId, leadId, contactId: lead?.contactId ?? "", title: getFormValue(form, "title"), description: getFormValue(form, "description"), assignee: getFormValue(form, "assignee"), dueAt: getFormValue(form, "dueAt"), priority: getFormValue(form, "priority") }, "Task created"); }
  return <Modal title="Create a task" eyebrow="FOLLOW-UP WORK" onClose={onClose}><form className="crm-form" onSubmit={save}><Field label="Client"><select name="clientId" value={clientId} onChange={(event) => setClientId(event.target.value)}>{clients.map((client) => <option key={client.id} value={client.id}>{client.businessName}</option>)}</select></Field><Field label="Related lead"><select name="leadId"><option value="">No related lead</option>{clientLeads.map((lead) => <option key={lead.id} value={lead.id}>{lead.firstName} {lead.lastName} · {lead.serviceRequested}</option>)}</select></Field><Field label="Task title" span><input name="title" required autoFocus /></Field><Field label="Description" span><textarea name="description" rows={3} /></Field><Field label="Assignee"><input name="assignee" defaultValue="Luciano Brizuela" /></Field><Field label="Due date"><input name="dueAt" type="datetime-local" required /></Field><Field label="Priority"><select name="priority"><option>MEDIUM</option><option>HIGH</option><option>URGENT</option><option>LOW</option></select></Field><footer><button className="crm-button-secondary" type="button" onClick={onClose}>Cancel</button><SubmitButton busy={submit.busy}>Create Task</SubmitButton></footer></form></Modal>;
}

export function AddAppointmentModal({ clients, contacts, leads, mutate, onClose }: { clients: CrmClient[]; contacts: CrmContact[]; leads: CrmLead[]; mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const clientContacts = contacts.filter((contact) => contact.clientId === clientId);
  const clientLeads = leads.filter((lead) => lead.clientId === clientId);
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); void submit.run({ action: "create_appointment", clientId, contactId: getFormValue(form, "contactId"), leadId: getFormValue(form, "leadId"), serviceType: getFormValue(form, "serviceType"), startsAt: getFormValue(form, "startsAt"), endsAt: getFormValue(form, "endsAt"), assignedEmployee: getFormValue(form, "assignedEmployee"), address: getFormValue(form, "address"), notes: getFormValue(form, "notes") }, "Appointment booked"); }
  return <Modal title="Book an appointment" eyebrow="CALENDAR" onClose={onClose} wide><form className="crm-form" onSubmit={save}><Field label="Client"><select value={clientId} onChange={(event) => setClientId(event.target.value)}>{clients.map((client) => <option key={client.id} value={client.id}>{client.businessName}</option>)}</select></Field><Field label="Contact"><select name="contactId" required>{clientContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.firstName} {contact.lastName}</option>)}</select></Field><Field label="Related lead"><select name="leadId"><option value="">No related lead</option>{clientLeads.map((lead) => <option key={lead.id} value={lead.id}>{lead.firstName} {lead.lastName} · {lead.serviceRequested}</option>)}</select></Field><Field label="Service type"><input name="serviceType" required /></Field><Field label="Start time"><input name="startsAt" type="datetime-local" required /></Field><Field label="End time"><input name="endsAt" type="datetime-local" required /></Field><Field label="Assigned employee"><input name="assignedEmployee" /></Field><Field label="Service address" span><input name="address" /></Field><Field label="Internal notes" span><textarea name="notes" rows={3} /></Field><footer><button className="crm-button-secondary" type="button" onClick={onClose}>Cancel</button><SubmitButton busy={submit.busy}>Book Appointment</SubmitButton></footer></form></Modal>;
}

export function AddClientModal({ mutate, onClose }: { mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); void submit.run({ action: "create_client", businessName: getFormValue(form, "businessName"), industry: getFormValue(form, "industry"), website: getFormValue(form, "website"), phone: getFormValue(form, "phone"), email: getFormValue(form, "email"), address: getFormValue(form, "address"), city: getFormValue(form, "city"), state: getFormValue(form, "state"), zip: getFormValue(form, "zip"), timeZone: getFormValue(form, "timeZone"), monthlyAdBudgetCents: Math.round(Number(getFormValue(form, "monthlyAdBudget") || 0) * 100), assignedAccountManager: getFormValue(form, "assignedAccountManager"), serviceAreas: getFormValue(form, "serviceAreas"), notes: getFormValue(form, "notes") }, "Sub-account created"); }
  return <Modal title="Add a sub-account" eyebrow="AGENCY · SUB-ACCOUNTS" onClose={onClose} wide><form className="crm-form" onSubmit={save}><Field label="Business name" span><input name="businessName" required autoFocus /></Field><Field label="Industry"><input name="industry" required placeholder="Pest control" /></Field><Field label="Website"><input name="website" type="url" /></Field><Field label="Phone"><input name="phone" type="tel" /></Field><Field label="Email"><input name="email" type="email" /></Field><Field label="Address" span><input name="address" /></Field><Field label="City"><input name="city" /></Field><Field label="State"><input name="state" maxLength={2} /></Field><Field label="ZIP"><input name="zip" /></Field><Field label="Time zone"><select name="timeZone"><option>America/Chicago</option><option>America/New_York</option><option>America/Denver</option><option>America/Los_Angeles</option></select></Field><Field label="Monthly ad budget"><input name="monthlyAdBudget" type="number" min="0" /></Field><Field label="Account manager"><input name="assignedAccountManager" defaultValue="Luciano Brizuela" /></Field><Field label="Service areas" span><input name="serviceAreas" placeholder="Austin, Round Rock, Georgetown" /></Field><Field label="Notes" span><textarea name="notes" rows={3} /></Field><footer><button className="crm-button-secondary" type="button" onClick={onClose}>Cancel</button><SubmitButton busy={submit.busy}>Create Sub-Account</SubmitButton></footer></form></Modal>;
}

export function InviteMemberModal({ clients, isAgency, viewerRole, mutate, onClose }: { clients: CrmClient[]; isAgency: boolean; viewerRole: CrmRole; mutate: Mutate; onClose: () => void }) {
  const submit = useSubmit(mutate, onClose);
  const canInviteLbRoles = isAgency && ["LB_OWNER", "SUPER_ADMIN", "AGENCY_OWNER"].includes(viewerRole);
  const [role, setRole] = useState<CrmRole>("CLIENT_OWNER");
  const isClientRole = role.startsWith("CLIENT_");
  const isLbTeamMember = role === "LB_TEAM_MEMBER";
  // Client owners only ever add their own staff; the server takes the
  // sub-account from their session and refuses agency roles outright.
  const needsSubAccount = isAgency && (isClientRole || isLbTeamMember);
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); void submit.run({ action: "invite_member", displayName: getFormValue(form, "displayName"), email: getFormValue(form, "email"), role, clientId: needsSubAccount ? getFormValue(form, "clientId") : "" }, "Invite email sent"); }
  return <Modal title="Give someone access" eyebrow="TEAM ACCESS" onClose={onClose}><form className="crm-form" onSubmit={save}>
    <Field label="Full name" span><input name="displayName" required autoFocus /></Field>
    <Field label="Email" span><input name="email" type="email" required /></Field>
    <Field label="Role" span><select name="role" value={role} onChange={(event) => setRole(event.target.value as CrmRole)}>
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
    {needsSubAccount ? <Field label="Sub-account" span><select name="clientId" required defaultValue="">
      <option value="" disabled>Choose the business they can see</option>
      {clients.map((client) => <option key={client.id} value={client.id}>{client.businessName}</option>)}
    </select></Field> : null}
    <div className="crm-form-note crm-field-span">{!isAgency ? "This person joins your business only. " : isClientRole ? "This person will only see the selected client sub-account. " : isLbTeamMember ? "LB Team Members only see the assigned client sub-account. " : "LB Admins can work across LB Marketing sub-accounts, with server-side permission checks. "}BrizBuilder will email a secure invite link so they can choose their own password.</div>
    <footer><button className="crm-button-secondary" type="button" onClick={onClose}>Cancel</button><SubmitButton busy={submit.busy}>Send Invite</SubmitButton></footer>
  </form></Modal>;
}
