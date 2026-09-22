/** Validated manual corrections shared by both CRM storage backends. */
export function leadCorrectionPatch(input: Record<string, unknown>) {
  const contact: Record<string, string | null> = {};
  const lead: Record<string, string | number | null> = {};
  const fields: [string, string, number, boolean][] = [
    ['firstName', 'first_name', 80, true], ['lastName', 'last_name', 80, false],
    ['phone', 'phone', 40, false], ['email', 'email', 160, false],
    ['address', 'address', 200, false], ['city', 'city', 80, false],
    ['state', 'state', 30, false], ['zip', 'zip', 20, false],
  ];
  for (const [key, column, max, required] of fields) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string') throw new Error(`Invalid ${key}.`);
    let value = (input[key] as string).trim();
    if (value.length > max || (required && !value)) throw new Error(`Invalid ${key}.`);
    if (key === 'email' && value) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address.');
      value = value.toLowerCase();
    }
    if (key === 'phone' && value && value.replace(/\D/g, '').length < 7) throw new Error('Enter a valid phone number.');
    contact[column] = value || (key === 'lastName' ? '' : null);
  }
  for (const [key, column, max, required] of [
    ['serviceRequested','service_requested',160,true], ['message','message',10000,false],
    ['source','source',100,true], ['campaign','campaign',240,false],
    ['assignedUser','assigned_user',120,false], ['lostReason','lost_reason',240,false],
  ] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string') throw new Error(`Invalid ${key}.`);
    const value = (input[key] as string).trim();
    if (value.length > max || (required && !value)) throw new Error(`Invalid ${key}.`);
    lead[column] = value || (key === 'message' ? '' : null);
  }
  for (const [key, column] of [["estimatedValueCents", "estimated_value_cents"], ["finalRevenueCents", "final_revenue_cents"]] as const) {
    if (input[key] === undefined) continue;
    const value = Number(input[key]);
    if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000) throw new Error("Enter a valid amount between $0 and $1,000,000.");
    lead[column] = value;
  }
  if (input.leadScore !== undefined) {
    const score = Number(input.leadScore);
    if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error('Lead score must be between 0 and 100.');
    lead.lead_score = score;
  }
  if (input.consentStatus !== undefined) {
    if (!['unknown','granted','revoked'].includes(String(input.consentStatus))) throw new Error('Invalid consent status.');
    lead.consent_status = String(input.consentStatus);
  }
  return { contact, lead };
}

export function manualProvenance(existing: unknown, fields: string[]) {
  const result = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
  return Object.assign(result, Object.fromEntries(fields.map(field => [field, { source: 'manual', confidence: 1, verified: true, updatedAt: new Date().toISOString() }])));
}

/** A lead's latest scheduled occurrence is authoritative, including cancellation. */
export function latestLinkedAppointment<T extends { leadId: string | null; clientId: string; startsAt: string; id: string }>(lead: { id: string; clientId: string }, appointments: T[]) {
  return appointments.filter(a => a.leadId === lead.id && a.clientId === lead.clientId)
    .sort((a,b) => b.startsAt.localeCompare(a.startsAt) || b.id.localeCompare(a.id))[0] ?? null;
}

/** Calendar rows are the single source of truth for booked appointments. */
export function projectLeadAppointment<T extends { id: string; clientId: string; appointmentStatus: string }>(lead: T, rows: Record<string, unknown>[]) {
  const row = rows.filter(a => a.lead_id === lead.id && a.client_id === lead.clientId)
    .sort((a,b) => String(b.starts_at).localeCompare(String(a.starts_at)) || String(b.id).localeCompare(String(a.id)))[0];
  return { ...lead, appointmentStatus: row ? String(row.status).toLowerCase() : lead.appointmentStatus === 'tentative' ? 'tentative' : 'none',
    appointmentStart: row ? String(row.starts_at) : null, appointmentEnd: row ? String(row.ends_at) : null,
    appointmentDate: row && !['CANCELED','NO_SHOW','COMPLETED'].includes(String(row.status)) ? String(row.starts_at) : null };
}

export function appointmentTimePatch(input: Record<string, unknown>, existing: { startsAt: string; endsAt: string }) {
  const startsAt = input.startsAt === undefined ? existing.startsAt : String(input.startsAt);
  const endsAt = input.endsAt === undefined ? existing.endsAt : String(input.endsAt);
  if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('Enter a valid appointment end time after its start.');
  return { starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString() };
}

/** Legacy contact-only bookings can resolve only when that contact has one lead. */
export function linkAppointmentRows<T extends Record<string, unknown>>(rows: T[], leads: { id: string; clientId: string; contactId: string }[]): T[] {
  return rows.map(row => {
    if (row.lead_id || !row.contact_id) return row;
    const matches = leads.filter(lead => lead.clientId === row.client_id && lead.contactId === row.contact_id);
    return matches.length === 1 ? { ...row, lead_id: matches[0].id } : row;
  });
}
