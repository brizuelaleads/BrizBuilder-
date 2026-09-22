"use client";

import { useState, type FormEvent } from "react";
import type { CrmAppointment, CrmLead } from "../../db/crm";

type Mutate = (input: Record<string, unknown>, message: string) => Promise<unknown>;
const statuses = ["NEW", "CONTACTED", "QUALIFIED", "APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON", "LOST", "SPAM", "UNRESPONSIVE"];
const appointmentStatuses = ["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"];
const label = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
function localDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
}

export function LeadEditForm({ lead, appointment, mutate, onDone }: { lead: CrmLead; appointment: CrmAppointment | null; mutate: Mutate; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const contactFields = [
    ["firstName", "First name", 80], ["lastName", "Last name", 80], ["phone", "Phone", 40], ["email", "Email", 160],
    ["address", "Street address", 200], ["city", "City", 80], ["state", "State / region", 30], ["zip", "ZIP / postal code", 20],
  ] as const;
  const leadFields = [["serviceRequested", "Requested service", 160], ["source", "Source", 100], ["campaign", "Campaign", 240], ["assignedUser", "Assigned to", 120], ["lostReason", "Lost reason", 240]] as const;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const patch: Record<string, unknown> = { action: "update_lead", leadId: lead.id };
    for (const key of [...contactFields.map(([key]) => key), ...leadFields.map(([key]) => key), "message", "consentStatus", "status"] as const) {
      const value = String(data.get(key) ?? "").trim();
      if (value !== String(lead[key] ?? "")) patch[key] = value;
    }
    for (const key of ["estimatedValueCents", "finalRevenueCents", "leadScore"] as const) {
      const raw = Number(data.get(key));
      const value = key === "leadScore" ? raw : Math.round(raw * 100);
      if (!Number.isFinite(value) || value < 0) { setError("Enter valid non-negative amounts."); return; }
      if (value !== lead[key]) patch[key] = value;
    }
    let appointmentPatch: Record<string, unknown> | null = null;
    if (appointment) {
      const start = new Date(String(data.get("startsAt")));
      const end = new Date(String(data.get("endsAt")));
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) { setError("Appointment end must be after its start."); return; }
      const status = String(data.get("appointmentStatus"));
      if (localDate(appointment.startsAt) !== data.get("startsAt") || localDate(appointment.endsAt) !== data.get("endsAt") || status !== appointment.status) {
        appointmentPatch = { action: "update_appointment", appointmentId: appointment.id, startsAt: start.toISOString(), endsAt: end.toISOString(), status };
      }
    }
    setError(""); setBusy(true);
    let leadSaved = false;
    try {
      if (Object.keys(patch).length > 2) { await mutate(patch, "Lead details saved"); leadSaved = true; }
      if (appointmentPatch) await mutate(appointmentPatch, "Appointment updated in the calendar");
      onDone();
    } catch (caught) {
      setError(`${leadSaved ? "Lead details saved. The appointment could not be saved: " : ""}${caught instanceof Error ? caught.message : "Unable to save changes. Please try again."}`);
    } finally { setBusy(false); }
  }
  return <form className="lead-record-edit" onSubmit={(event) => void save(event)}>
    <h3>Edit lead</h3><p>Correct the details below. Contact changes also update other records for this contact.</p>
    {error ? <p className="lead-record-edit-error" role="alert">{error}</p> : null}
    <fieldset disabled={busy}><legend>Contact details</legend>
      {contactFields.map(([key,title,max]) => <label key={key}>{title}<input name={key} defaultValue={lead[key] ?? ""} maxLength={max} required={key === "firstName"} autoFocus={key === "firstName"} type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} /></label>)}
    </fieldset>
    <fieldset disabled={busy}><legend>Lead details</legend>
      {leadFields.map(([key,title,max]) => <label key={key}>{title}<input name={key} defaultValue={lead[key] ?? ""} maxLength={max} required={key === "serviceRequested" || key === "source"} /></label>)}
      <label>Status<select name="status" defaultValue={lead.status}>{statuses.map(status => <option key={status} value={status}>{label(status)}</option>)}</select></label>
      <label>Estimated value ($)<input name="estimatedValueCents" type="number" min="0" max="1000000" step="0.01" required defaultValue={lead.estimatedValueCents / 100} /></label>
      <label>Final revenue ($)<input name="finalRevenueCents" type="number" min="0" max="1000000" step="0.01" required defaultValue={lead.finalRevenueCents / 100} /></label>
      <label>Lead score<input name="leadScore" type="number" min="0" max="100" step="1" required defaultValue={lead.leadScore} /></label>
      <label>Consent<select name="consentStatus" defaultValue={lead.consentStatus}><option value="unknown">Unknown</option><option value="granted">Granted</option><option value="revoked">Revoked</option></select></label>
      <label>Call summary<textarea name="message" rows={6} maxLength={10000} defaultValue={lead.message} /></label>
    </fieldset>
    {appointment ? <fieldset disabled={busy}><legend>Calendar appointment</legend><p>Times are shown in your local time zone. Changes update this same calendar booking.</p>
      <label>Starts<input name="startsAt" type="datetime-local" required defaultValue={localDate(appointment.startsAt)} /></label>
      <label>Ends<input name="endsAt" type="datetime-local" required defaultValue={localDate(appointment.endsAt)} /></label>
      <label>Appointment status<select name="appointmentStatus" defaultValue={appointment.status}>{appointmentStatuses.map(status => <option key={status} value={status}>{label(status)}</option>)}</select></label>
    </fieldset> : null}
    <footer><button type="button" className="lead-record-secondary" disabled={busy} onClick={onDone}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button></footer>
  </form>;
}
