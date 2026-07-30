"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type {
  CrmAppointment,
  CrmClient,
  CrmContact,
  CrmLead,
  CrmProviderConnection,
  CrmTask,
  CrmTeamMember,
} from "../../db/crm";
import { Badge, dateTime, EmptyState, Modal, money, shortDate } from "./ui";

type Mutate = (input: Record<string, unknown>, success: string) => Promise<unknown>;

type CalendarSegment = {
  appointment: CrmAppointment;
  startsAt: Date;
  endsAt: Date;
  continuesFromPreviousDay: boolean;
  continuesIntoNextDay: boolean;
};

function calendarSegmentsForDay(
  appointments: CrmAppointment[],
  day: Date,
): CalendarSegment[] {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  return appointments.flatMap((appointment) => {
    const appointmentStart = new Date(appointment.startsAt);
    const appointmentEnd = new Date(appointment.endsAt);
    if (
      appointmentEnd.getTime() <= dayStart.getTime() ||
      appointmentStart.getTime() >= dayEnd.getTime()
    ) {
      return [];
    }
    return [
      {
        appointment,
        startsAt: new Date(
          Math.max(appointmentStart.getTime(), dayStart.getTime()),
        ),
        endsAt: new Date(
          Math.min(appointmentEnd.getTime(), dayEnd.getTime()),
        ),
        continuesFromPreviousDay:
          appointmentStart.getTime() < dayStart.getTime(),
        continuesIntoNextDay: appointmentEnd.getTime() > dayEnd.getTime(),
      },
    ];
  });
}

function layoutCalendarDay(segments: CalendarSegment[]) {
  const sorted = [...segments].sort(
    (first, second) =>
      first.startsAt.getTime() - second.startsAt.getTime(),
  );
  const groups: CalendarSegment[][] = [];
  let activeGroup: CalendarSegment[] = [];
  let activeGroupEnd = 0;

  for (const segment of sorted) {
    const startsAt = segment.startsAt.getTime();
    const visualEndsAt = Math.max(
      segment.endsAt.getTime(),
      startsAt + 60 * 60 * 1000,
    );
    if (activeGroup.length && startsAt >= activeGroupEnd) {
      groups.push(activeGroup);
      activeGroup = [];
      activeGroupEnd = 0;
    }
    activeGroup.push(segment);
    activeGroupEnd = Math.max(activeGroupEnd, visualEndsAt);
  }
  if (activeGroup.length) groups.push(activeGroup);

  return groups.flatMap((group) => {
    const laneEnds: number[] = [];
    const positioned = group.map((segment) => {
      const startsAt = segment.startsAt.getTime();
      const visualEndsAt = Math.max(
        segment.endsAt.getTime(),
        startsAt + 60 * 60 * 1000,
      );
      let lane = laneEnds.findIndex((laneEnd) => startsAt >= laneEnd);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = visualEndsAt;
      return { segment, lane };
    });
    const laneCount = Math.max(1, laneEnds.length);
    return positioned.map((item) => ({ ...item, laneCount }));
  });
}

export function ContactsView({ contacts, clients, onAddContact }: { contacts: CrmContact[]; clients: CrmClient[]; onAddContact: () => void }) {
  const [query, setQuery] = useState("");
  const filtered = contacts.filter((contact) => `${contact.firstName} ${contact.lastName} ${contact.phone ?? ""} ${contact.email ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const clientName = (id: string) => clients.find((client) => client.id === id)?.businessName ?? "Unknown client";
  return <div className="crm-view crm-contacts-simple"><section className="crm-page-heading"><div><p>CONTACTS</p><h2>Contacts</h2><span>Find customer contact details in one place.</span></div><button className="crm-button-primary" onClick={onAddContact}>+ Add Contact</button></section><section className="crm-filterbar"><label className="crm-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contacts" aria-label="Search contacts" /></label><span>{filtered.length} contacts</span></section>{filtered.length ? <section className="crm-contact-list">{filtered.map((contact) => <article key={contact.id}><span className="crm-avatar">{contact.firstName[0]}{contact.lastName[0]}</span><div className="crm-contact-identity"><strong>{contact.firstName} {contact.lastName}</strong><small>{clientName(contact.clientId)}</small></div><div><small>Phone</small><span>{contact.phone ?? "Not provided"}</span></div><div><small>Email</small><span>{contact.email ?? "Not provided"}</span></div><div><small>Last contact</small><span>{shortDate(contact.lastInteractionAt)}</span></div></article>)}</section> : <EmptyState title="No contacts yet" description="Add a contact or create a lead to build the customer database." action={<button className="crm-button-primary" onClick={onAddContact}>Add Contact</button>} />}</div>;
}
export function TasksView({ tasks, clients, mutate, onAddTask }: { tasks: CrmTask[]; clients: CrmClient[]; mutate: Mutate; onAddTask: () => void }) {
  const [filter, setFilter] = useState("OPEN");
  const visible = tasks.filter((task) => filter === "ALL" || (filter === "OPEN" ? !["COMPLETED", "CANCELED"].includes(task.status) : task.status === filter));
  return <div className="crm-view"><section className="crm-page-heading"><div><p>FOLLOW-UP WORK</p><h2>Tasks</h2><span>Keep every callback, estimate follow-up, and reminder accountable.</span></div><button className="crm-button-primary" onClick={onAddTask}>+ New Task</button></section><section className="crm-tabs">{["OPEN", "IN_PROGRESS", "COMPLETED", "ALL"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item.replaceAll("_", " ")}</button>)}</section><section className="crm-task-list">{visible.map((task) => <article key={task.id} className={task.status === "COMPLETED" ? "crm-task-complete" : ""}><button className="crm-task-check" onClick={() => void mutate({ action: "toggle_task", taskId: task.id }, task.status === "COMPLETED" ? "Task reopened" : "Task completed")} aria-label={task.status === "COMPLETED" ? `Reopen ${task.title}` : `Complete ${task.title}`}>{task.status === "COMPLETED" ? "✓" : ""}</button><div><strong>{task.title}</strong><p>{task.description || "No description"}</p><span>{clients.find((client) => client.id === task.clientId)?.businessName} · {task.assignee ?? "Unassigned"}</span></div><div><Badge tone={task.priority === "URGENT" ? "red" : task.priority === "HIGH" ? "orange" : "neutral"}>{task.priority}</Badge><small>{dateTime(task.dueAt)}</small></div></article>)}{!visible.length ? <EmptyState title="No tasks in this view" description="Create a task when a lead needs a clear next step." /> : null}</section></div>;
}

export function CalendarView({
  appointments,
  mutate,
  onAddAppointment,
  selectedClientId,
  clients,
  googleCalendarConnections,
  googleCalendarConfigured,
  canConnectGoogleCalendar,
}: {
  appointments: CrmAppointment[];
  mutate: Mutate;
  onAddAppointment: () => void;
  selectedClientId: string | null;
  clients: CrmClient[];
  googleCalendarConnections: CrmProviderConnection[];
  googleCalendarConfigured: boolean;
  canConnectGoogleCalendar: boolean;
}) {
  const [mode, setMode] = useState<"week" | "agenda">("week");
  const [agendaFilter, setAgendaFilter] = useState<"upcoming" | "all">("upcoming");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [connectionClientId, setConnectionClientId] = useState("");
  const calendarScrollRef = useRef<HTMLElement>(null);
  const today = new Date();
  const googleCalendarClientId =
    selectedClientId ??
    (clients.length === 1 ? clients[0].id : connectionClientId || null);
  const googleCalendarConnection =
    googleCalendarConnections.find(
      (connection) => connection.clientId === googleCalendarClientId,
    ) ?? null;
  const googleCalendarLinked = Boolean(
    googleCalendarConnection?.isLinked,
  );
  const googleCalendarNeedsAttention =
    googleCalendarLinked && !googleCalendarConnection?.isActive;
  const weekStart = new Date(anchorDate);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + index);
    return day;
  });
  const hours = Array.from({ length: 24 }, (_, index) => index);
  const dayKey = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const visible = appointments
    .filter((appointment) =>
      mode === "week"
        ? appointment.status !== "CANCELED"
        : agendaFilter === "all" ||
          !["COMPLETED", "CANCELED"].includes(appointment.status),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekAppointments = visible.filter(
    (appointment) =>
      new Date(appointment.startsAt).getTime() < weekEnd.getTime() &&
      new Date(appointment.endsAt).getTime() > weekStart.getTime(),
  );
  const grouped = visible.reduce<Record<string, CrmAppointment[]>>((acc, appointment) => {
    const key = dayKey(new Date(appointment.startsAt));
    (acc[key] ??= []).push(appointment);
    return acc;
  }, {});
  const isToday = (day: Date) => dayKey(day) === dayKey(today);
  const shiftWeek = (days: number) => {
    const next = new Date(anchorDate);
    next.setDate(next.getDate() + days);
    setAnchorDate(next);
  };
  const deleteAppointment = async (appointment: CrmAppointment) => {
    if (!window.confirm(`Delete the ${appointment.serviceType} appointment for ${appointment.contactName}? This cannot be undone.`)) return;
    await mutate(
      { action: "delete_appointment", appointmentId: appointment.id },
      "Appointment deleted",
    );
  };
  useEffect(() => {
    if (mode !== "week") return;
    const frame = window.requestAnimationFrame(() => {
      calendarScrollRef.current?.scrollTo({ top: 6 * 64 - 24 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [anchorDate, mode]);

  return (
    <div className="crm-view crm-calendar-view">
      <section className="crm-calendar-toolbar">
        <div className="crm-calendar-nav">
          <div className="crm-calendar-nav-group">
            <button type="button" onClick={() => shiftWeek(-7)} aria-label="Previous week">‹</button>
            <button type="button" onClick={() => setAnchorDate(new Date())}>Today</button>
            <button type="button" onClick={() => shiftWeek(7)} aria-label="Next week">›</button>
          </div>
          <h2>{weekStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h2>
        </div>
        <div className="crm-calendar-actions">
          {!selectedClientId && clients.length > 1 ? (
            <select
              className="crm-google-calendar-client-select"
              value={connectionClientId}
              onChange={(event) => setConnectionClientId(event.target.value)}
              aria-label="Client calendar to connect"
            >
              <option value="">Choose client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.businessName}
                </option>
              ))}
            </select>
          ) : null}
          {googleCalendarClientId &&
          canConnectGoogleCalendar &&
          googleCalendarConfigured ? (
            <a
              className={`crm-google-calendar-link ${
                googleCalendarNeedsAttention
                  ? "needs-attention"
                  : googleCalendarLinked
                    ? "connected"
                    : ""
              }`}
              href={`/api/integrations/google-calendar/connect?clientId=${encodeURIComponent(googleCalendarClientId)}`}
            >
              <span aria-hidden="true">G</span>
              {googleCalendarNeedsAttention
                ? "Reconnect Google Calendar"
                : googleCalendarLinked
                  ? "Google Calendar linked"
                  : "Link Google Calendar"}
            </a>
          ) : (
            <button
              type="button"
              className="crm-google-calendar-link"
              disabled
              title={
                !googleCalendarClientId
                  ? "Choose a client before linking a calendar."
                  : !canConnectGoogleCalendar
                    ? "You do not have permission to connect Google Calendar."
                    : "Google Calendar connection is not configured."
              }
            >
              <span aria-hidden="true">G</span>
              Link Google Calendar
            </button>
          )}
          {mode === "agenda" ? (
            <select
              value={agendaFilter}
              onChange={(event) =>
                setAgendaFilter(event.target.value as "upcoming" | "all")
              }
              aria-label="Filter agenda appointments"
            >
              <option value="upcoming">Upcoming</option>
              <option value="all">All appointments</option>
            </select>
          ) : null}
          <div className="crm-view-switcher crm-calendar-switcher" role="tablist" aria-label="Calendar view">
            <button type="button" className={mode === "week" ? "active" : ""} onClick={() => setMode("week")} role="tab" aria-selected={mode === "week"}>Week</button>
            <button type="button" className={mode === "agenda" ? "active" : ""} onClick={() => setMode("agenda")} role="tab" aria-selected={mode === "agenda"}>Agenda</button>
          </div>
          <button className="crm-button-primary" onClick={onAddAppointment}>+ Book Appointment</button>
        </div>
      </section>

      {mode === "week" ? (
        <section
          className="crm-week-calendar"
          ref={calendarScrollRef}
          tabIndex={0}
          aria-label={`Week of ${weekStart.toLocaleDateString("en-US")}`}
        >
          <header className="crm-week-header">
            <span aria-hidden="true" />
            {weekDays.map((day) => (
              <div className={isToday(day) ? "today" : ""} key={dayKey(day)}>
                <small>{day.toLocaleDateString("en-US", { weekday: "short" })}</small>
                <strong>{day.getDate()}</strong>
              </div>
            ))}
          </header>
          <div className="crm-week-body">
            <div className="crm-week-times" aria-hidden="true">
              {hours.map((hour) => (
                <span
                  key={hour}
                  style={{ top: `${hour * 64 + (hour === 0 ? 12 : 0)}px` }}
                >
                  {new Date(2000, 0, 1, hour).toLocaleTimeString("en-US", { hour: "numeric" })}
                </span>
              ))}
            </div>
            {weekDays.map((day) => (
              <div className={`crm-week-day ${isToday(day) ? "today" : ""}`} key={dayKey(day)}>
                {hours.map((hour) => <i key={hour} aria-hidden="true" />)}
                {layoutCalendarDay(
                  calendarSegmentsForDay(weekAppointments, day),
                ).map(({ segment, lane, laneCount }) => {
                    const { appointment, startsAt, endsAt } = segment;
                    const startHour = startsAt.getHours() + startsAt.getMinutes() / 60;
                    const duration = Math.max(
                      1,
                      (endsAt.getTime() - startsAt.getTime()) / 3_600_000,
                    );
                    return (
                      <article
                        className={`crm-calendar-event status-${appointment.status.toLowerCase()}`}
                        key={appointment.id}
                        style={{
                          top: `${startHour * 64}px`,
                          height: `${duration * 64 - 2}px`,
                          right: "auto",
                          left: `calc(${(lane / laneCount) * 100}% + 4px)`,
                          width: `calc(${100 / laneCount}% - 8px)`,
                        }}
                      >
                        <time>
                          {segment.continuesFromPreviousDay
                            ? "Continued"
                            : startsAt.toLocaleTimeString("en-US", {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                        </time>
                        <strong>{appointment.contactName}</strong>
                        <span>
                          {segment.continuesIntoNextDay
                            ? `${appointment.serviceType} · continues tomorrow`
                            : appointment.serviceType}
                        </span>
                        <select
                          value={appointment.status}
                          onChange={(event) => void mutate({ action: "update_appointment_status", appointmentId: appointment.id, status: event.target.value }, "Appointment status updated")}
                          aria-label={`Status for ${appointment.contactName}`}
                        >
                          {["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"].map((status) => <option key={status}>{status}</option>)}
                        </select>
                        <button
                          type="button"
                          className="crm-calendar-delete"
                          onClick={() => void deleteAppointment(appointment)}
                          aria-label={`Delete appointment for ${appointment.contactName}`}
                          title="Delete appointment"
                        >
                          ×
                        </button>
                      </article>
                    );
                  })}
              </div>
            ))}
          </div>
          {!weekAppointments.length ? (
            <div className="crm-calendar-empty-overlay">
              <strong>Nothing scheduled this week</strong>
              <button type="button" onClick={onAddAppointment}>Book an appointment →</button>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="crm-calendar-list">
          {Object.entries(grouped).map(([day, items]) => (
            <article key={day}>
              <header>
                <strong>{new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</strong>
                <span>{items.length} appointment{items.length === 1 ? "" : "s"}</span>
              </header>
              {items.map((appointment) => (
                <div key={appointment.id}>
                  <time>{new Date(appointment.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time>
                  <span className="crm-avatar">{appointment.contactName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span>
                  <div>
                    <strong>{appointment.contactName}</strong>
                    <p>{appointment.serviceType} · {appointment.clientName}</p>
                    <small>{appointment.address ?? "Address not provided"}</small>
                  </div>
                  <div className="crm-calendar-list-actions">
                    <select value={appointment.status} onChange={(event) => void mutate({ action: "update_appointment_status", appointmentId: appointment.id, status: event.target.value }, "Appointment status updated")} aria-label={`Status for ${appointment.contactName}`}>
                      {["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"].map((status) => <option key={status}>{status}</option>)}
                    </select>
                    <button type="button" onClick={() => void deleteAppointment(appointment)} aria-label={`Delete appointment for ${appointment.contactName}`}>Delete</button>
                  </div>
                </div>
              ))}
            </article>
          ))}
          {!visible.length ? <EmptyState title="No appointments yet" description="Book an appointment from a qualified lead or contact." /> : null}
        </section>
      )}
    </div>
  );
}

export function ClientsView({ clients, leads, onAddClient, onDeleted, mutate, canDelete, adminEmail }: { clients: CrmClient[]; leads: CrmLead[]; onAddClient: () => void; onDeleted: () => void; mutate: Mutate; canDelete: boolean; adminEmail: string }) {
  const [deleteTarget, setDeleteTarget] = useState<CrmClient | null>(null);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");

  function closeDeleteDialog() {
    setDeleteTarget(null);
    setDeleteEmail("");
    setDeletePassword("");
    setDeleteError("");
  }

  async function deleteClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDelete || !deleteTarget) return;
    if (deleteEmail.trim().toLowerCase() !== adminEmail.trim().toLowerCase()) {
      setDeleteError("Enter the email address you used to sign in.");
      return;
    }
    setDeleteError("");
    try {
      await mutate(
        { action: "delete_client", clientId: deleteTarget.id, email: deleteEmail, password: deletePassword },
        `${deleteTarget.businessName} deleted`,
      );
      onDeleted();
      closeDeleteDialog();
    } catch (caught) {
      setDeletePassword("");
      setDeleteError(caught instanceof Error ? caught.message : "The email or password did not match.");
    }
  }

  return <div className="crm-view">
    <section className="crm-page-heading"><div><p>AGENCY · SUB-ACCOUNTS</p><h2>Agency</h2><span>Manage every sub-account under this agency: business profiles, budgets, service areas, and ownership.</span></div><button className="crm-button-primary" onClick={onAddClient}>+ Add Sub-Account</button></section>
    <section className="crm-client-grid">{clients.map((client) => {
      const clientLeads = leads.filter((lead) => lead.clientId === client.id);
      const revenue = clientLeads.reduce((sum, lead) => sum + lead.finalRevenueCents, 0);
      return <article key={client.id}><header><span className="crm-client-logo">{client.businessName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{client.businessName}</strong><small>{client.industry} · {client.city}, {client.state}</small></div><Badge tone="green">{client.status}</Badge></header><section><div><span>Leads</span><strong>{clientLeads.length}</strong></div><div><span>Revenue</span><strong>{money(revenue)}</strong></div><div><span>Ad budget</span><strong>{money(client.monthlyAdBudgetCents)}</strong></div></section><dl><div><dt>Account manager</dt><dd>{client.assignedAccountManager ?? "Unassigned"}</dd></div><div><dt>Service areas</dt><dd>{client.serviceAreas.join(", ") || "Not set"}</dd></div><div><dt>Website</dt><dd>{client.website ?? "Not connected"}</dd></div></dl><footer><span>Created {shortDate(client.createdAt)}</span>{canDelete ? <button className="danger" onClick={() => setDeleteTarget(client)}>Delete</button> : null}</footer></article>;
    })}</section>
    {deleteTarget ? <Modal title={`Delete ${deleteTarget.businessName}?`} eyebrow="ADMIN CONFIRMATION" onClose={closeDeleteDialog}>
      <form className="crm-form crm-delete-client-form" onSubmit={(event) => void deleteClient(event)}>
        <p className="crm-delete-warning">This permanently deletes the sub-account and all of its CRM data. This cannot be undone.</p>
        <label className="crm-field-span"><span>Your administrator email</span><input type="email" value={deleteEmail} onChange={(event) => setDeleteEmail(event.target.value)} autoComplete="email" placeholder={adminEmail} required /></label>
        <label className="crm-field-span"><span>Your current password</span><input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" required /></label>
        {deleteError ? <p className="crm-delete-error" role="alert">{deleteError}</p> : null}
        <footer><button type="button" onClick={closeDeleteDialog}>Cancel</button><button type="submit" className="crm-button-danger" disabled={!deleteEmail.trim() || !deletePassword}>Permanently delete</button></footer>
      </form>
    </Modal> : null}
  </div>;
}

export function ReportsView({ leads, clients }: { leads: CrmLead[]; clients: CrmClient[] }) {
  const stages = ["NEW", "CONTACTED", "QUALIFIED", "APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON"];
  const funnel = stages.map((status) => ({ status, count: leads.filter((lead) => lead.status === status).length }));
  const max = Math.max(1, ...funnel.map((item) => item.count));
  const sourceRows = Object.entries(leads.reduce<Record<string, { leads: number; revenue: number }>>((acc, lead) => { const row = acc[lead.source] ?? { leads: 0, revenue: 0 }; row.leads += 1; row.revenue += lead.status === "WON" ? lead.finalRevenueCents : 0; acc[lead.source] = row; return acc; }, {})).sort((a, b) => b[1].leads - a[1].leads);
  const spend = clients.reduce((sum, client) => sum + client.monthlyAdBudgetCents, 0);
  const revenue = leads.reduce((sum, lead) => sum + (lead.status === "WON" ? lead.finalRevenueCents : 0), 0);
  return <div className="crm-view crm-report-view"><section className="crm-page-heading"><div><p>PERFORMANCE REPORT</p><h2>Agency report</h2><span>Executive summary for the current client and date filters.</span></div><button className="crm-button-secondary" onClick={() => window.print()}>Print / Save PDF</button></section><div className="crm-report-note"><Badge tone="green">Live workspace</Badge><p>Ad-platform and call data are not connected yet. This report uses only real CRM records currently stored in Brizuela Leads.</p></div><section className="crm-report-summary"><article><span>Leads</span><strong>{leads.length}</strong></article><article><span>Revenue</span><strong>{money(revenue)}</strong></article><article><span>Ad spend</span><strong>{money(spend)}</strong></article><article><span>ROAS</span><strong>{spend ? `${(revenue / spend).toFixed(2)}x` : "0x"}</strong></article></section><section className="crm-dashboard-grid"><article className="crm-panel"><header><div><p>SALES FUNNEL</p><h3>Lead progression</h3></div></header><div className="crm-funnel">{funnel.map((item) => <div key={item.status}><span>{item.status.replaceAll("_", " ")}</span><i><b style={{ width: `${Math.max(5, (item.count / max) * 100)}%` }} /></i><strong>{item.count}</strong></div>)}</div></article><article className="crm-panel"><header><div><p>LEAD SOURCES</p><h3>Volume and revenue</h3></div></header><table className="crm-mini-table"><thead><tr><th>Source</th><th>Leads</th><th>Revenue</th></tr></thead><tbody>{sourceRows.map(([source, row]) => <tr key={source}><td>{source}</td><td>{row.leads}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table></article></section><section className="crm-panel crm-report-recommendations"><header><div><p>RECOMMENDATIONS</p><h3>What to do next</h3></div></header><ol><li><strong>Respond to new leads first.</strong><span>{leads.filter((lead) => lead.status === "NEW").length} leads still need a first response.</span></li><li><strong>Follow up on open estimates.</strong><span>{leads.filter((lead) => lead.status === "ESTIMATE_SENT").length} estimate-stage opportunities can be closed.</span></li><li><strong>Connect live marketing data.</strong><span>Meta Ads, Google Ads, and call tracking remain Phase 2 integrations.</span></li></ol></section></div>;
}

export function TeamView({ team, onInvite, mutate }: { team: CrmTeamMember[]; onInvite: () => void; mutate: Mutate }) {
  async function revoke(member: CrmTeamMember) {
    if (!window.confirm(`Remove ${member.displayName}'s access? They will no longer be able to open this workspace.`)) return;
    await mutate({ action: "revoke_member", memberId: member.id, scope: member.clientId ? "client" : "agency" }, "Access removed");
  }
  async function setPassword(member: CrmTeamMember) {
    const password = window.prompt(`Set a new password for ${member.displayName}. Give it to them directly — BrizBuilder cannot email it yet.\n\nAt least 12 characters:`);
    if (!password) return;
    await mutate({ action: "set_member_password", memberId: member.id, scope: member.clientId ? "client" : "agency", password }, `Password updated for ${member.displayName}`);
  }
  const active = team.filter((member) => member.status === "active");
  return <div className="crm-view"><section className="crm-page-heading"><div><p>ACCESS CONTROL</p><h2>Team</h2><span>Agency roles see every sub-account. Client roles only ever see the one they are assigned to, enforced on the server.</span></div><button className="crm-button-primary" onClick={onInvite}>+ Give Access</button></section>
    {active.length ? <section className="crm-table-panel"><table className="crm-table"><thead><tr><th>Person</th><th>Access</th><th>Role</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>{team.map((member) => <tr key={member.id}><td><span className="crm-table-person"><i>{member.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</i><span><strong>{member.displayName}</strong><small>{member.email}</small></span></span></td><td>{member.clientName ?? "Whole agency"}</td><td>{member.role.replaceAll("_", " ")}</td><td><Badge tone={member.status === "active" ? "green" : "red"}>{member.status}</Badge></td><td className="crm-lead-actions">{member.status === "active" ? <><button type="button" onClick={() => void setPassword(member)}>Set password</button><button type="button" className="crm-danger-link" onClick={() => void revoke(member)}>Remove</button></> : null}</td></tr>)}</tbody></table></section> : <EmptyState title="No one else has access yet" description="Give a client access to their own sub-account, or add an agency teammate who can see everything." action={<button className="crm-button-primary" onClick={onInvite}>Give Access</button>} />}
    <div className="crm-form-note" style={{ marginTop: 16 }}>After granting access here, add the person&apos;s email to your Cloudflare Access policy in Zero Trust — otherwise they cannot reach the sign-in page.</div>
  </div>;
}

export function SettingsView({ organizationName, viewerRole, clients }: { organizationName: string; viewerRole: string; clients: CrmClient[] }) {
  const [section, setSection] = useState<"workspace" | "security" | "integrations" | "privacy">("workspace");
  const sections = [
    { id: "workspace" as const, label: "Workspace", icon: "B" },
    { id: "security" as const, label: "Access & security", icon: "A" },
    { id: "integrations" as const, label: "Integrations", icon: "I" },
    { id: "privacy" as const, label: "Privacy", icon: "P" },
  ];

  return (
    <div className="crm-view crm-settings-view">
      <section className="crm-page-heading">
        <div>
          <p>ADMINISTRATION</p>
          <h2>Settings</h2>
          <span>Manage the workspace foundation for {organizationName}.</span>
        </div>
      </section>
      <section className="crm-settings-workspace">
        <aside aria-label="Settings sections">
          <header>
            <strong>Settings</strong>
            <small>Workspace configuration</small>
          </header>
          <nav>
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                className={section === item.id ? "active" : ""}
                onClick={() => setSection(item.id)}
                aria-current={section === item.id ? "page" : undefined}
              >
                <i aria-hidden="true">{item.icon}</i>
                {item.label}
              </button>
            ))}
          </nav>
        </aside>
        <div className="crm-settings-content">
          {section === "workspace" ? (
            <>
              <header>
                <h3>Workspace profile</h3>
                <p>Your organization identity and account scope.</p>
              </header>
              <article className="crm-settings-section">
                <h4>Organization</h4>
                <dl className="crm-settings-facts">
                  <div><dt>Workspace name</dt><dd>{organizationName}</dd></div>
                  <div><dt>Your role</dt><dd>{viewerRole.replaceAll("_", " ")}</dd></div>
                  <div><dt>Active sub-accounts</dt><dd>{clients.length}</dd></div>
                </dl>
              </article>
            </>
          ) : null}
          {section === "security" ? (
            <>
              <header>
                <h3>Access & security</h3>
                <p>Protections applied to every BrizBuilder session.</p>
              </header>
              <article className="crm-settings-section">
                <ul className="crm-settings-checklist">
                  <li><span>✓</span><div><strong>Verified account sessions</strong><p>Passwords and sessions are validated by BrizBuilder&apos;s authentication provider.</p></div></li>
                  <li><span>✓</span><div><strong>Server-side tenant isolation</strong><p>Every read and write is scoped to an authorized organization and sub-account.</p></div></li>
                  <li><span>✓</span><div><strong>Audit logging</strong><p>Important lead, task, client, appointment, and membership changes are recorded.</p></div></li>
                </ul>
              </article>
            </>
          ) : null}
          {section === "integrations" ? (
            <>
              <header>
                <h3>Integrations</h3>
                <p>Providers available across communications, growth, payments, and AI.</p>
              </header>
              <article className="crm-settings-section">
                <div className="crm-settings-provider-list">
                  {[
                    ["Twilio", "Phone and text messaging"],
                    ["Google Business Profile", "Locations and reviews"],
                    ["Stripe", "Connected payments"],
                    ["AI Connector", "Permission-scoped CRM access"],
                  ].map(([name, description]) => (
                    <div key={name}>
                      <span>{name.slice(0, 1)}</span>
                      <div><strong>{name}</strong><small>{description}</small></div>
                      <Badge tone="neutral">Manage in workspace</Badge>
                    </div>
                  ))}
                </div>
              </article>
            </>
          ) : null}
          {section === "privacy" ? (
            <>
              <header>
                <h3>Privacy controls</h3>
                <p>How customer data is retained and protected.</p>
              </header>
              <article className="crm-settings-section">
                <ul className="crm-settings-checklist">
                  <li><span>✓</span><div><strong>Consent status</strong><p>Consent evidence is stored separately for every contact and lead.</p></div></li>
                  <li><span>✓</span><div><strong>Recoverable archiving</strong><p>Archived records remain available for authorized audit and recovery.</p></div></li>
                  <li><span>—</span><div><strong>Automated retention</strong><p>Policy-based retention controls are not enabled yet.</p></div></li>
                </ul>
              </article>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
