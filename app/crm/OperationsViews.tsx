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
import type { TenantBranding } from "../../db/branding";
import { ChevronLeft, ChevronRight, Clock3, Trash2, X } from "lucide-react";
import { BrandingSettings } from "./BrandingSettings";
import { Badge, dateTime, EmptyState, Modal, money, shortDate } from "./ui";

type Mutate = (input: Record<string, unknown>, success: string) => Promise<unknown>;

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    LB_OWNER: "LB Owner",
    LB_ADMIN: "LB Admin",
    LB_TEAM_MEMBER: "LB Team Member",
    SUPER_ADMIN: "LB Owner",
    AGENCY_OWNER: "LB Owner",
    AGENCY_ADMIN: "LB Admin",
    AGENCY_MEMBER: "LB Team Member",
    CLIENT_OWNER: "Client Owner",
    CLIENT_MANAGER: "Client Manager",
    CLIENT_EMPLOYEE: "Client Employee",
  };
  return labels[role] ?? role.replaceAll("_", " ");
}

function isProtectedOwnerRole(role: string) {
  return ["LB_OWNER", "SUPER_ADMIN", "AGENCY_OWNER"].includes(role);
}

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
export function TasksView({ tasks, clients, mutate }: { tasks: CrmTask[]; clients: CrmClient[]; mutate: Mutate }) {
  const [filter, setFilter] = useState("OPEN");
  const visible = tasks.filter((task) => filter === "ALL" || (filter === "OPEN" ? !["COMPLETED", "CANCELED"].includes(task.status) : task.status === filter));
  return <div className="crm-view"><section className="crm-page-heading"><div><p>FOLLOW-UP WORK</p><h2>Tasks</h2><span>Keep every callback, estimate follow-up, and reminder accountable.</span></div></section><section className="crm-tabs">{["OPEN", "IN_PROGRESS", "COMPLETED", "ALL"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item.replaceAll("_", " ")}</button>)}</section><section className="crm-task-list">{visible.map((task) => <article key={task.id} className={task.status === "COMPLETED" ? "crm-task-complete" : ""}><button className="crm-task-check" onClick={() => void mutate({ action: "toggle_task", taskId: task.id }, task.status === "COMPLETED" ? "Task reopened" : "Task completed")} aria-label={task.status === "COMPLETED" ? `Reopen ${task.title}` : `Complete ${task.title}`}>{task.status === "COMPLETED" ? "✓" : ""}</button><div><strong>{task.title}</strong><p>{task.description || "No description"}</p><span>{clients.find((client) => client.id === task.clientId)?.businessName} · {task.assignee ?? "Unassigned"}</span></div><div><Badge tone={task.priority === "URGENT" ? "red" : task.priority === "HIGH" ? "orange" : "neutral"}>{task.priority}</Badge><small>{dateTime(task.dueAt)}</small></div></article>)}{!visible.length ? <EmptyState title="No tasks in this view" description="Create a task when a lead needs a clear next step." /> : null}</section></div>;
}

const APPOINTMENT_STATUSES = ["SCHEDULED", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELED"] as const;
const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
  CANCELED: "Canceled",
};
const CALENDAR_TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const CALENDAR_WEEK_RANGE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

function statusClass(status: string) {
  return `status-${status.toLowerCase().replaceAll("_", "-")}`;
}

function timeRange(start: Date, end: Date) {
  try {
    return CALENDAR_TIME.formatRange(start, end);
  } catch {
    return `${CALENDAR_TIME.format(start)} – ${CALENDAR_TIME.format(end)}`;
  }
}

/** ISO week number of the Monday inside a Sunday-first week. */
function isoWeekNumber(date: Date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(utc.getUTCFullYear(), 0, 1);
  return Math.ceil(((utc.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

function formatBookedTime(milliseconds: number) {
  const minutes = Math.round(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function CalendarView({
  appointments,
  leads,
  onOpenLead,
  mutate,
  onAddAppointment,
  selectedClientId,
  clients,
  googleCalendarConnections,
  googleCalendarConfigured,
  canConnectGoogleCalendar,
}: {
  appointments: CrmAppointment[];
  leads: CrmLead[];
  onOpenLead: (lead: CrmLead) => void;
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
  // Canceled starts hidden, which is what the week view always showed.
  const [hiddenStatuses, setHiddenStatuses] = useState<ReadonlySet<string>>(() => new Set(["CANCELED"]));
  // Month paging is relative to the week on screen, so the mini calendar follows
  // week navigation without an effect keeping two dates in sync.
  const [monthPaging, setMonthPaging] = useState({ week: "", offset: 0 });
  const [openEvent, setOpenEvent] = useState<{ id: string; dayIndex: number; top: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const calendarScrollRef = useRef<HTMLElement>(null);
  const popoverCloseRef = useRef<HTMLButtonElement>(null);
  const today = now;
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
  const statusShown = (appointment: CrmAppointment) => !hiddenStatuses.has(appointment.status);
  const visible = appointments
    .filter((appointment) =>
      statusShown(appointment) &&
      (mode === "week" ||
        agendaFilter === "all" ||
        !["COMPLETED", "CANCELED"].includes(appointment.status)),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const overlapsWeek = (appointment: CrmAppointment) =>
    new Date(appointment.startsAt).getTime() < weekEnd.getTime() &&
    new Date(appointment.endsAt).getTime() > weekStart.getTime();
  const weekAppointments = visible.filter(overlapsWeek);
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

  // Booked time per status in the week on screen, hidden statuses included.
  const bookedByStatus = appointments.filter(overlapsWeek).reduce<Record<string, number>>((totals, appointment) => {
    const start = Math.max(new Date(appointment.startsAt).getTime(), weekStart.getTime());
    const end = Math.min(new Date(appointment.endsAt).getTime(), weekEnd.getTime());
    totals[appointment.status] = (totals[appointment.status] ?? 0) + Math.max(0, end - start);
    return totals;
  }, {});
  const toggleStatus = (status: string) => {
    setHiddenStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const weekKey = dayKey(weekStart);
  const monthOffset = monthPaging.week === weekKey ? monthPaging.offset : 0;
  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + monthOffset, 1);
  const monthLabel = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - monthStart.getDay());
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const monthCells = Array.from(
    { length: Math.ceil((monthStart.getDay() + daysInMonth) / 7) * 7 },
    (_, index) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      return day;
    },
  );
  const statusesByDay = appointments.filter(statusShown).reduce<Record<string, string[]>>((days, appointment) => {
    const statuses = (days[dayKey(new Date(appointment.startsAt))] ??= []);
    if (!statuses.includes(appointment.status)) statuses.push(appointment.status);
    return days;
  }, {});
  const pageMonth = (step: number) => setMonthPaging({ week: weekKey, offset: monthOffset + step });

  const openAppointment = openEvent
    ? appointments.find((appointment) => appointment.id === openEvent.id) ?? null
    : null;
  const closeEvent = () => {
    const id = openEvent?.id;
    setOpenEvent(null);
    if (id) document.querySelector<HTMLButtonElement>(`[data-appointment-open="${CSS.escape(id)}"]`)?.focus();
  };
  const nowHour = now.getHours() + now.getMinutes() / 60;
  // Open the grid at 6 AM, or earlier when the week has an earlier appointment.
  const firstWeekHour = Math.floor(
    weekAppointments.reduce((earliest, appointment) => {
      const startsAt = new Date(appointment.startsAt);
      const hour = startsAt < weekStart ? 0 : startsAt.getHours() + startsAt.getMinutes() / 60;
      return Math.min(earliest, hour);
    }, 6),
  );

  useEffect(() => {
    if (mode !== "week") return;
    const frame = window.requestAnimationFrame(() => {
      calendarScrollRef.current?.scrollTo({ top: Math.max(0, firstWeekHour * 64 - 24) });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [anchorDate, mode, firstWeekHour]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!openEvent) return;
    popoverCloseRef.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest(".crm-cal-popover, .crm-cal-event")) return;
      setOpenEvent(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [openEvent]);

  return (
    <div className="crm-view crm-calendar-view">
      <div className="crm-cal-layout">
        <aside className="crm-cal-sidebar" aria-label="Calendar tools">
          <section className="crm-cal-card crm-cal-month" aria-label={`Month of ${monthLabel}`}>
            <header>
              <h3>{monthLabel}</h3>
              <div className="crm-cal-icon-pair">
                <button type="button" onClick={() => pageMonth(-1)} aria-label="Previous month"><ChevronLeft aria-hidden="true" /></button>
                <button type="button" onClick={() => pageMonth(1)} aria-label="Next month"><ChevronRight aria-hidden="true" /></button>
              </div>
            </header>
            <div className="crm-cal-month-grid">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((weekday) => (
                <span key={weekday} className="crm-cal-month-weekday" aria-hidden="true">{weekday}</span>
              ))}
              {monthCells.map((day) => {
                const key = dayKey(day);
                const statuses = statusesByDay[key] ?? [];
                const inWeek = day >= weekStart && day < weekEnd;
                return (
                  <button
                    type="button"
                    key={key}
                    className={[
                      "crm-cal-month-day",
                      day.getMonth() !== monthStart.getMonth() ? "outside" : "",
                      inWeek ? "in-week" : "",
                      isToday(day) ? "today" : "",
                    ].filter(Boolean).join(" ")}
                    aria-current={isToday(day) ? "date" : undefined}
                    aria-pressed={inWeek}
                    aria-label={`${day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}${statuses.length ? ", has appointments" : ""}`}
                    onClick={() => setAnchorDate(day)}
                  >
                    <span>{day.getDate()}</span>
                    {statuses.length ? (
                      <i aria-hidden="true">
                        {statuses.slice(0, 3).map((status) => <b key={status} className={statusClass(status)} />)}
                      </i>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="crm-cal-card crm-cal-statuses" aria-labelledby="crm-cal-statuses-title">
            <header>
              <h3 id="crm-cal-statuses-title">Appointment status</h3>
              <p>Booked time this week</p>
            </header>
            <div className="crm-cal-status-list">
              {APPOINTMENT_STATUSES.map((status) => (
                <label key={status} className={`crm-cal-status ${statusClass(status)}`}>
                  <input
                    type="checkbox"
                    checked={!hiddenStatuses.has(status)}
                    onChange={() => toggleStatus(status)}
                  />
                  <span>{APPOINTMENT_STATUS_LABELS[status]}</span>
                  <small><Clock3 aria-hidden="true" />{formatBookedTime(bookedByStatus[status] ?? 0)}</small>
                </label>
              ))}
            </div>
          </section>

          <section className="crm-cal-card crm-cal-sync" aria-labelledby="crm-cal-sync-title">
            <header>
              <h3 id="crm-cal-sync-title">Google Calendar</h3>
              <p>
                {!googleCalendarClientId
                  ? "Choose a client to link their calendar."
                  : googleCalendarNeedsAttention
                    ? "The link stopped working. Reconnect to keep syncing."
                    : googleCalendarLinked
                      ? "Appointments sync to this client’s Google Calendar."
                      : "Not linked. Appointments stay in BrizBuilder only."}
              </p>
            </header>
            {!selectedClientId && clients.length > 1 ? (
              <label className="crm-cal-field">
                <span>Client</span>
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
              </label>
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
          </section>
        </aside>

        <div className="crm-cal-main">
          <section className="crm-cal-toolbar" aria-label="Calendar navigation">
            <div className="crm-cal-toolbar-start">
              <div className="crm-cal-icon-pair">
                <button type="button" onClick={() => shiftWeek(-7)} aria-label="Previous week"><ChevronLeft aria-hidden="true" /></button>
                <button type="button" onClick={() => shiftWeek(7)} aria-label="Next week"><ChevronRight aria-hidden="true" /></button>
              </div>
              <h2>{CALENDAR_WEEK_RANGE.formatRange(weekDays[0], weekDays[6])}</h2>
              <span className="crm-cal-week-badge">Week {isoWeekNumber(weekDays[1])}</span>
            </div>
            <div className="crm-cal-toolbar-end">
              <button type="button" className="crm-cal-today" onClick={() => setAnchorDate(new Date())}>Today</button>
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
            </div>
          </section>

          {mode === "week" ? (
            <section
              className="crm-week-calendar"
              ref={calendarScrollRef}
              tabIndex={0}
              aria-label={`Week of ${weekStart.toLocaleDateString("en-US")}`}
            >
              <div className="crm-cal-grid">
                <header className="crm-cal-days-header">
                  <span aria-hidden="true" />
                  {weekDays.map((day) => (
                    <div className={isToday(day) ? "today" : ""} key={dayKey(day)} aria-current={isToday(day) ? "date" : undefined}>
                      <small>{day.toLocaleDateString("en-US", { weekday: "short" })}</small>
                      <strong>{day.getDate()}</strong>
                    </div>
                  ))}
                </header>
                <div className="crm-cal-body">
                  <div className="crm-cal-hours" aria-hidden="true">
                    {hours.map((hour) => (
                      <span
                        key={hour}
                        style={{ top: `${hour * 64}px` }}
                      >
                        {hour ? new Date(2000, 0, 1, hour).toLocaleTimeString("en-US", { hour: "numeric" }) : ""}
                      </span>
                    ))}
                  </div>
                  <div className="crm-cal-days">
                    {weekDays.map((day, dayIndex) => (
                      <div className={`crm-cal-day${isToday(day) ? " today" : ""}`} key={dayKey(day)}>
                        {layoutCalendarDay(
                          calendarSegmentsForDay(weekAppointments, day),
                        ).map(({ segment, lane, laneCount }) => {
                          const { appointment, startsAt, endsAt } = segment;
                          const startHour = startsAt.getHours() + startsAt.getMinutes() / 60;
                          const duration = Math.max(
                            0.5,
                            (endsAt.getTime() - startsAt.getTime()) / 3_600_000,
                          );
                          const expanded = openEvent?.id === appointment.id;
                          return (
                            <article
                              className={`crm-cal-event ${statusClass(appointment.status)}${expanded ? " open" : ""}`}
                              key={appointment.id}
                              style={{
                                top: `${startHour * 64}px`,
                                height: `${duration * 64 - 2}px`,
                                // Side-by-side lanes give up most of their gutter to the text.
                                left: `calc(${(lane / laneCount) * 100}% + ${laneCount > 1 ? 2 : 4}px)`,
                                width: `calc(${100 / laneCount}% - ${laneCount > 1 ? 4 : 8}px)`,
                              }}
                            >
                              <button
                                type="button"
                                data-appointment-open={appointment.id}
                                aria-haspopup="dialog"
                                aria-expanded={expanded}
                                onClick={() => setOpenEvent(expanded ? null : { id: appointment.id, dayIndex, top: startHour * 64 })}
                              >
                                <strong>{appointment.contactName}</strong>
                                <span>
                                  {segment.continuesIntoNextDay
                                    ? `${appointment.serviceType} · continues tomorrow`
                                    : appointment.serviceType}
                                </span>
                                <time>
                                  {segment.continuesFromPreviousDay ? (
                                    "Continued"
                                  ) : (
                                    <>
                                      <span className="crm-cal-time-full">{timeRange(startsAt, endsAt)}</span>
                                      <span className="crm-cal-time-short" aria-hidden="true">{CALENDAR_TIME.format(startsAt)}</span>
                                    </>
                                  )}
                                </time>
                              </button>
                            </article>
                          );
                        })}
                        {isToday(day) ? (
                          <div className="crm-cal-now" style={{ top: `${nowHour * 64}px` }} aria-hidden="true" />
                        ) : null}
                      </div>
                    ))}
                    {openAppointment && openEvent ? (
                      <CalendarEventPopover
                        appointment={openAppointment}
                        onOpenLead={(() => {
                          const matches = leads.filter((lead) => lead.clientId === openAppointment.clientId && (openAppointment.leadId ? lead.id === openAppointment.leadId : lead.contactId === openAppointment.contactId));
                          return matches.length === 1 ? () => { closeEvent(); onOpenLead(matches[0]); } : undefined;
                        })()}
                        dayIndex={openEvent.dayIndex}
                        top={openEvent.top}
                        closeRef={popoverCloseRef}
                        onClose={closeEvent}
                        mutate={mutate}
                        onDelete={deleteAppointment}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
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
                    <div key={appointment.id} className={`crm-cal-agenda-row ${statusClass(appointment.status)}`}>
                      <time>{new Date(appointment.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time>
                      <span className="crm-avatar">{appointment.contactName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span>
                      <div>
                        <strong>{appointment.contactName}</strong>
                        <p>{appointment.serviceType} · {appointment.clientName}</p>
                        <small>{appointment.address ?? "Address not provided"}</small>
                      </div>
                      <div className="crm-calendar-list-actions">
                        <select value={appointment.status} onChange={(event) => void mutate({ action: "update_appointment_status", appointmentId: appointment.id, status: event.target.value }, "Appointment status updated")} aria-label={`Status for ${appointment.contactName}`}>
                          {APPOINTMENT_STATUSES.map((status) => <option key={status} value={status}>{APPOINTMENT_STATUS_LABELS[status]}</option>)}
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
          {/* Outside the scroller: the grid opens at 6 AM, which would scroll an
              in-grid message out of view. */}
          {mode === "week" && !weekAppointments.length ? (
            <div className="crm-cal-empty">
              <strong>Nothing scheduled this week</strong>
              <button type="button" onClick={onAddAppointment}>Book an appointment</button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** shadcn Popover: vertical auto layout, 17px padding, 16px gap, 6px radius. */
function CalendarEventPopover({
  appointment,
  onOpenLead,
  dayIndex,
  top,
  closeRef,
  onClose,
  mutate,
  onDelete,
}: {
  appointment: CrmAppointment;
  onOpenLead?: () => void;
  dayIndex: number;
  top: number;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  mutate: Mutate;
  onDelete: (appointment: CrmAppointment) => Promise<void>;
}) {
  const starts = new Date(appointment.startsAt);
  const ends = new Date(appointment.endsAt);
  const deleteAppointment = onDelete;
  return (
    <section
      className={`crm-cal-popover ${statusClass(appointment.status)}`}
      role="dialog"
      aria-label={`Appointment with ${appointment.contactName}`}
      style={{
        top: `${Math.max(0, Math.min(top, 24 * 64 - 360))}px`,
        ...(dayIndex < 4
          ? { left: `calc(${((dayIndex + 1) / 7) * 100}% + 8px)` }
          : { right: `calc(${((7 - dayIndex) / 7) * 100}% + 8px)` }),
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <header>
        <span className="crm-cal-popover-status">{APPOINTMENT_STATUS_LABELS[appointment.status] ?? appointment.status}</span>
        <button type="button" ref={closeRef} onClick={onClose} aria-label="Close appointment details"><X aria-hidden="true" /></button>
      </header>
      <div className="crm-cal-popover-title">
        <h3>{onOpenLead ? <button type="button" className="crm-cal-lead-link" onClick={onOpenLead} aria-label={`Open lead details for ${appointment.contactName}`}>{appointment.contactName}</button> : appointment.contactName}</h3>
        <p>{appointment.serviceType}</p>
      </div>
      <dl>
        <div><dt>When</dt><dd>{starts.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, {timeRange(starts, ends)}</dd></div>
        <div><dt>Client</dt><dd>{appointment.clientName}</dd></div>
        {appointment.assignedEmployee ? <div><dt>Assigned</dt><dd>{appointment.assignedEmployee}</dd></div> : null}
        {appointment.address ? <div><dt>Address</dt><dd>{appointment.address}</dd></div> : null}
      </dl>
      <label className="crm-cal-field">
        <span>Status</span>
        <select
          value={appointment.status}
          onChange={(event) => void mutate({ action: "update_appointment_status", appointmentId: appointment.id, status: event.target.value }, "Appointment status updated")}
          aria-label={`Status for ${appointment.contactName}`}
        >
          {APPOINTMENT_STATUSES.map((status) => <option key={status} value={status}>{APPOINTMENT_STATUS_LABELS[status]}</option>)}
        </select>
      </label>
      <footer>
        <button
          type="button"
          className="crm-cal-delete"
          onClick={() => void deleteAppointment(appointment)}
          aria-label={`Delete appointment for ${appointment.contactName}`}
        >
          <Trash2 aria-hidden="true" />
          Delete appointment
        </button>
      </footer>
    </section>
  );
}

export function ClientsView({ clients, leads, onDeleted, mutate, canDelete, adminEmail }: { clients: CrmClient[]; leads: CrmLead[]; onDeleted: () => void; mutate: Mutate; canDelete: boolean; adminEmail: string }) {
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
    <section className="crm-page-heading"><div><p>AGENCY · SUB-ACCOUNTS</p><h2>Agency</h2><span>Manage every sub-account under this agency: business profiles, budgets, service areas, and ownership.</span></div></section>
    <section className="crm-client-grid">{clients.map((client) => {
      const clientLeads = leads.filter((lead) => lead.clientId === client.id);
      const revenue = clientLeads.reduce((sum, lead) => sum + lead.finalRevenueCents, 0);
      return <article key={client.id}><header><span className="crm-client-logo">{client.businessName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{client.businessName}</strong><small>{client.industry} · {client.city}, {client.state}</small></div><Badge tone="green">{client.status}</Badge></header><section><div><span>Leads</span><strong>{clientLeads.length}</strong></div><div><span>Revenue</span><strong>{money(revenue)}</strong></div><div><span>Ad budget</span><strong>{money(client.monthlyAdBudgetCents)}</strong></div></section><dl><div><dt>Account manager</dt><dd>{client.assignedAccountManager?.trim() || "Unassigned"}</dd></div><div><dt>Service areas</dt><dd>{client.serviceAreas.join(", ") || "Not set"}</dd></div><div><dt>Website</dt><dd>{client.website?.trim() || "Not connected"}</dd></div></dl><footer><span>Created {shortDate(client.createdAt)}</span>{canDelete ? <button className="danger" onClick={() => setDeleteTarget(client)}>Delete</button> : null}</footer></article>;
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
  return <div className="crm-view crm-report-view"><section className="crm-page-heading"><div><p>PERFORMANCE REPORT</p><h2>Agency report</h2><span>Executive summary for the current client and date filters.</span></div><button className="crm-button-secondary" onClick={() => window.print()}>Print / Save PDF</button></section><div className="crm-report-note"><Badge tone="green">Live workspace</Badge><p>Ad-platform and call data are not connected yet. This report uses only real CRM records currently stored in LB Marketing.</p></div><section className="crm-report-summary"><article><span>Leads</span><strong>{leads.length}</strong></article><article><span>Revenue</span><strong>{money(revenue)}</strong></article><article><span>Ad spend</span><strong>{money(spend)}</strong></article><article><span>ROAS</span><strong>{spend ? `${(revenue / spend).toFixed(2)}x` : "0x"}</strong></article></section><section className="crm-dashboard-grid"><article className="crm-panel"><header><div><p>SALES FUNNEL</p><h3>Lead progression</h3></div></header><div className="crm-funnel">{funnel.map((item) => <div key={item.status}><span>{item.status.replaceAll("_", " ")}</span><i><b style={{ width: `${Math.max(5, (item.count / max) * 100)}%` }} /></i><strong>{item.count}</strong></div>)}</div></article><article className="crm-panel"><header><div><p>LEAD SOURCES</p><h3>Volume and revenue</h3></div></header><table className="crm-mini-table"><thead><tr><th>Source</th><th>Leads</th><th>Revenue</th></tr></thead><tbody>{sourceRows.map(([source, row]) => <tr key={source}><td>{source}</td><td>{row.leads}</td><td>{money(row.revenue)}</td></tr>)}</tbody></table></article></section><section className="crm-panel crm-report-recommendations"><header><div><p>RECOMMENDATIONS</p><h3>What to do next</h3></div></header><ol><li><strong>Respond to new leads first.</strong><span>{leads.filter((lead) => lead.status === "NEW").length} leads still need a first response.</span></li><li><strong>Follow up on open estimates.</strong><span>{leads.filter((lead) => lead.status === "ESTIMATE_SENT").length} estimate-stage opportunities can be closed.</span></li><li><strong>Connect live marketing data.</strong><span>Meta Ads, Google Ads, and call tracking remain Phase 2 integrations.</span></li></ol></section></div>;
}

export function TeamView({ team, onInvite, mutate }: { team: CrmTeamMember[]; onInvite: () => void; mutate: Mutate }) {
  async function revoke(member: CrmTeamMember) {
    if (!window.confirm(`Remove ${member.displayName}'s access? They will no longer be able to open this workspace.`)) return;
    await mutate({ action: "revoke_member", memberId: member.id, scope: member.clientId ? "client" : "agency" }, "Access removed");
  }
  async function sendReset(member: CrmTeamMember) {
    if (!window.confirm(`Send a password reset email to ${member.displayName}?`)) return;
    await mutate({ action: "send_member_password_reset", memberId: member.id, scope: member.clientId ? "client" : "agency" }, `Password reset sent to ${member.displayName}`);
  }
  const active = team.filter((member) => member.status === "active");
  return <div className="crm-view"><section className="crm-page-heading"><div><p>ACCESS CONTROL</p><h2>Team</h2><span>LB Marketing users work from assigned access. Client users only ever see their own sub-account, enforced on the server.</span></div></section>
    {active.length ? <section className="crm-table-panel"><table className="crm-table"><thead><tr><th>Person</th><th>Access</th><th>Role</th><th>Status</th><th aria-label="Actions" /></tr></thead><tbody>{team.map((member) => <tr key={member.id}><td><span className="crm-table-person"><i>{member.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</i><span><strong>{member.displayName}</strong><small>{member.email}</small></span></span></td><td>{member.clientName ?? "All sub-accounts"}</td><td>{roleLabel(member.role)}</td><td><Badge tone={member.status === "active" ? "green" : "red"}>{member.status}</Badge></td><td className="crm-lead-actions">{member.status === "active" ? <><button type="button" onClick={() => void sendReset(member)}>Send reset</button>{isProtectedOwnerRole(member.role) ? null : <button type="button" className="crm-danger-link" onClick={() => void revoke(member)}>Remove</button>}</> : null}</td></tr>)}</tbody></table></section> : <EmptyState title="No one else has access yet" description="Give a client access to their own sub-account, or add an LB teammate to assigned workspaces." action={<button className="crm-button-primary" onClick={onInvite}>Give Access</button>} />}
    <div className="crm-form-note" style={{ marginTop: 16 }}>After granting access here, add the person&apos;s email to your Cloudflare Access policy in Zero Trust — otherwise they cannot reach the sign-in page.</div>
  </div>;
}

export function SettingsView({
  organizationName,
  viewerRole,
  clients,
  branding,
  mutate,
  tenantRootDomain,
}: {
  organizationName: string;
  viewerRole: string;
  clients: CrmClient[];
  branding: TenantBranding[];
  mutate: Mutate;
  tenantRootDomain: string | null;
}) {
  const [section, setSection] = useState<"workspace" | "branding" | "security" | "integrations" | "privacy">("workspace");
  const sections = [
    { id: "workspace" as const, label: "Workspace", icon: "B" },
    { id: "branding" as const, label: "Client App", icon: "C" },
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
      <section className={`crm-settings-workspace${section === "branding" ? " has-client-app" : ""}`}>
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
                  <div><dt>Your role</dt><dd>{roleLabel(viewerRole)}</dd></div>
                  <div><dt>Active sub-accounts</dt><dd>{clients.length}</dd></div>
                </dl>
              </article>
              <button
                type="button"
                className="crm-settings-client-app-entry"
                onClick={() => setSection("branding")}
              >
                <span aria-hidden="true">C</span>
                <div>
                  <strong>Client App</strong>
                  <small>Brand the app, choose notifications, and preview the install experience.</small>
                </div>
                <i aria-hidden="true">→</i>
              </button>
            </>
          ) : null}
          {section === "branding" ? (
            <>
              <header>
                <h3>Client App</h3>
                <p>
                  Give each client a polished, installable workspace using the
                  branding and notification settings already built into BrizBuilder.
                </p>
              </header>
              <BrandingSettings
                clients={clients}
                branding={branding}
                mutate={mutate}
                tenantRootDomain={tenantRootDomain}
              />
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
