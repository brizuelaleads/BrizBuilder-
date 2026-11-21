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
import { ChevronLeft, ChevronRight, Clock3, Globe, MapPin, Pencil, Settings2, Trash2, UserRound, X } from "lucide-react";
import type { TenantBranding } from "../../db/branding";
import { Badge, BusinessMark, dateTime, EmptyState, Field, getFormValue, localDateTimeInputValue, Modal, money, shortDate } from "./ui";

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
  canEditAppointments,
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
  canEditAppointments: boolean;
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
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);
  const [googleDisconnectMessage, setGoogleDisconnectMessage] = useState<string | null>(null);
  // Canceled starts hidden, which is what the week view always showed.
  const [hiddenStatuses, setHiddenStatuses] = useState<ReadonlySet<string>>(() => new Set(["CANCELED"]));
  // Month paging is relative to the week on screen, so the mini calendar follows
  // week navigation without an effect keeping two dates in sync.
  const [monthPaging, setMonthPaging] = useState({ week: "", offset: 0 });
  const [openEvent, setOpenEvent] = useState<{ id: string; dayIndex: number; top: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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
  async function disconnectGoogle() {
    if (!googleCalendarClientId || !canConnectGoogleCalendar || disconnectingGoogle) return;
    if (!window.confirm("Disconnect Google for this client? This stops Calendar syncing and disconnects Business Profile too, because Google may revoke both permissions together. Existing appointments and Google Calendar events will remain.")) return;
    setDisconnectingGoogle(true);
    setGoogleDisconnectMessage(null);
    try {
      const result = await mutate(
        { action: "disconnect_google_calendar", clientId: googleCalendarClientId },
        "Google disconnected",
      );
      if (result && typeof result === "object" && "revocationWarning" in result &&
        typeof result.revocationWarning === "string") {
        setGoogleDisconnectMessage(result.revocationWarning);
      }
    } catch (error) {
      setGoogleDisconnectMessage(error instanceof Error ? error.message : "Google could not be disconnected. Try again.");
    } finally {
      setDisconnectingGoogle(false);
    }
  }
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
  const editingAppointment = canEditAppointments
    ? appointments.find((appointment) => appointment.id === editingId)
    : undefined;
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
      <section className="crm-cal-card crm-cal-sync" aria-labelledby="crm-cal-sync-title">
        <header>
          <div className="crm-cal-sync-title">
            <h3 id="crm-cal-sync-title">Google Calendar</h3>
            <span role="status">
              <Badge tone={googleCalendarNeedsAttention ? "orange" : googleCalendarLinked ? "green" : "neutral"}>
                {!googleCalendarClientId ? "Select a workspace" : googleCalendarNeedsAttention ? "Needs attention" : googleCalendarLinked ? "Connected" : "Not connected"}
              </Badge>
            </span>
          </div>
          <p>
            {!googleCalendarClientId
              ? "Choose a sub-account to see its connection."
              : googleCalendarNeedsAttention
                ? "Reconnect Google Calendar to resume syncing appointments."
                : googleCalendarLinked
                  ? "New appointments sync to the connected Google Calendar."
                  : "Link Google Calendar to sync appointments from this workspace."}
          </p>
        </header>
        <div className="crm-cal-sync-actions">
          {!selectedClientId && clients.length > 1 && (
            <select
              className="crm-google-calendar-client-select"
              value={connectionClientId}
              onChange={(event) => setConnectionClientId(event.target.value)}
              aria-label="Client calendar to connect"
            >
              <option value="">Choose a sub-account</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.businessName}
                </option>
              ))}
            </select>
          )}
          {(!googleCalendarLinked || googleCalendarNeedsAttention) && (
            googleCalendarClientId && canConnectGoogleCalendar && googleCalendarConfigured ? (
              <a
                className="crm-google-calendar-link"
                href={"/api/integrations/google-calendar/connect?clientId=" + encodeURIComponent(googleCalendarClientId)}
              >
                {googleCalendarNeedsAttention ? "Reconnect Google Calendar" : "Link Google Calendar"}
              </a>
            ) : (
              <button
                type="button"
                className="crm-google-calendar-link"
                disabled
                title={
                  !googleCalendarClientId
                    ? "Choose a sub-account before linking a calendar."
                    : !canConnectGoogleCalendar
                      ? "Ask a workspace admin to link Google Calendar."
                      : "Google Calendar setup is pending."
                }
              >
                {googleCalendarNeedsAttention ? "Reconnect Google Calendar" : "Link Google Calendar"}
              </button>
            )
          )}
          {googleCalendarLinked && canConnectGoogleCalendar && (
            <button
              type="button"
              className="crm-button-secondary"
              disabled={disconnectingGoogle}
              onClick={() => void disconnectGoogle()}
            >
              {disconnectingGoogle ? "Disconnecting?" : "Disconnect Google Calendar"}
            </button>
          )}
        </div>
        {googleDisconnectMessage && <p className="crm-cal-sync-message" role="status">{googleDisconnectMessage}</p>}
      </section>

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
                        onEdit={canEditAppointments ? () => {
                          closeEvent();
                          setEditingId(openAppointment.id);
                        } : undefined}
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
                        {canEditAppointments ? (
                          <>
                            <select value={appointment.status} onChange={(event) => void mutate({ action: "update_appointment_status", appointmentId: appointment.id, status: event.target.value }, "Appointment status updated")} aria-label={`Status for ${appointment.contactName}`}>
                              {APPOINTMENT_STATUSES.map((status) => <option key={status} value={status}>{APPOINTMENT_STATUS_LABELS[status]}</option>)}
                            </select>
                            <button className="crm-button-secondary" type="button" onClick={() => setEditingId(appointment.id)} aria-label={`Edit appointment for ${appointment.contactName}`}>Edit</button>
                            <button className="crm-cal-delete" type="button" onClick={() => void deleteAppointment(appointment)} aria-label={`Delete appointment for ${appointment.contactName}`}>Delete</button>
                          </>
                        ) : <span>{APPOINTMENT_STATUS_LABELS[appointment.status] ?? appointment.status}</span>}
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
              {canEditAppointments ? <button type="button" onClick={onAddAppointment}>Book an appointment</button> : null}
            </div>
          ) : null}
        </div>
      </div>
      {editingAppointment ? (
        <EditAppointmentModal key={editingAppointment.id} appointment={editingAppointment} mutate={mutate} onClose={() => setEditingId(null)} />
      ) : null}
    </div>
  );
}

function EditAppointmentModal({ appointment, mutate, onClose }: {
  appointment: CrmAppointment;
  mutate: Mutate;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const storedStart = Date.parse(appointment.startsAt);
  const storedEnd = Date.parse(appointment.endsAt);
  const endTime = storedEnd > storedStart ? appointment.endsAt
    : Number.isFinite(storedStart) ? new Date(storedStart + 30 * 60_000).toISOString() : "";
  const initialStart = localDateTimeInputValue(appointment.startsAt);
  const initialEnd = localDateTimeInputValue(endTime);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const startValue = getFormValue(form, "startsAt");
    const endValue = getFormValue(form, "endsAt");
    const start = new Date(startValue === initialStart ? appointment.startsAt : startValue);
    const end = new Date(endValue === initialEnd ? endTime : endValue);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      setError("Enter an end time after the start time.");
      return;
    }
    setBusy(true);
    setError("");
    const serviceType = getFormValue(form, "serviceType");
    const assignedEmployee = getFormValue(form, "assignedEmployee");
    const notes = getFormValue(form, "notes");
    try {
      await mutate({
        action: "update_appointment",
        appointmentId: appointment.id,
        status: getFormValue(form, "status"),
        ...(start.getTime() !== storedStart || end.getTime() !== storedEnd
          ? { startsAt: start.toISOString(), endsAt: end.toISOString() }
          : {}),
        ...(serviceType !== appointment.serviceType ? { serviceType } : {}),
        ...(assignedEmployee !== (appointment.assignedEmployee ?? "") ? { assignedEmployee } : {}),
        ...(notes !== appointment.notes ? { notes } : {}),
      }, "Appointment updated");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The appointment could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit appointment" eyebrow={appointment.contactName} onClose={() => { if (!busy) onClose(); }}>
      <form className="crm-form" onSubmit={(event) => void save(event)}>
        <Field label="Service type" span><input name="serviceType" defaultValue={appointment.serviceType} maxLength={160} required /></Field>
        <Field label="Start time"><input name="startsAt" type="datetime-local" defaultValue={initialStart} required /></Field>
        <Field label="End time"><input name="endsAt" type="datetime-local" defaultValue={initialEnd} required /></Field>
        <Field label="Status">
          <select name="status" defaultValue={appointment.status}>
            {APPOINTMENT_STATUSES.map((status) => <option key={status} value={status}>{APPOINTMENT_STATUS_LABELS[status]}</option>)}
          </select>
        </Field>
        <Field label="Assigned employee"><input name="assignedEmployee" defaultValue={appointment.assignedEmployee ?? ""} maxLength={120} /></Field>
        <Field label="Appointment notes" span><textarea name="notes" defaultValue={appointment.notes} maxLength={1000} rows={3} /></Field>
        {error ? <p className="crm-form-note crm-field-span" role="alert">{error}</p> : null}
        <footer>
          <button type="button" className="crm-button-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="crm-button-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        </footer>
      </form>
    </Modal>
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
  onEdit,
}: {
  appointment: CrmAppointment;
  onOpenLead?: () => void;
  dayIndex: number;
  top: number;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  mutate: Mutate;
  onDelete: (appointment: CrmAppointment) => Promise<void>;
  onEdit?: () => void;
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
      {onEdit ? (
        <>
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
            <button type="button" className="crm-button-secondary" onClick={onEdit} aria-label={`Edit appointment for ${appointment.contactName}`}>
              <Pencil aria-hidden="true" />
              Edit
            </button>
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
        </>
      ) : null}
    </section>
  );
}

export function ClientsView({ clients, leads, onDeleted, mutate, canDelete, adminEmail, branding = [], onEdit }: { clients: CrmClient[]; leads: CrmLead[]; onDeleted: () => void; mutate: Mutate; canDelete: boolean; adminEmail: string; branding?: TenantBranding[]; /** Opens the business in Settings; passed only to roles that can edit businesses. */ onEdit?: (clientId: string) => void }) {
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
    <section className="crm-biz-grid">{clients.map((client) => {
      const clientLeads = leads.filter((lead) => lead.clientId === client.id);
      const revenue = clientLeads.reduce((sum, lead) => sum + lead.finalRevenueCents, 0);
      const logoUrl = branding.find((entry) => entry.clientId === client.id)?.logoUrl ?? null;
      const place = [client.city, client.state].map((part) => part?.trim()).filter(Boolean).join(", ");
      const about = [client.industry, place].filter(Boolean).join(" · ");
      const site = client.website?.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "") ?? "";
      const areas = client.serviceAreas.slice(0, 3).join(", ") + (client.serviceAreas.length > 3 ? ` +${client.serviceAreas.length - 3} more` : "");
      return <article key={client.id} className="crm-panel crm-biz-card">
        <header>
          <BusinessMark name={client.businessName} logoUrl={logoUrl} className="crm-biz-logo" />
          <div><strong>{client.businessName}</strong>{about ? <small>{about}</small> : null}</div>
          <span className={`crm-biz-status is-${client.status === "active" ? "on" : "off"}`}><i aria-hidden="true" />{client.status === "active" ? "Active" : client.status}</span>
        </header>
        <dl className="crm-biz-stats">
          <div><dt>Leads</dt><dd>{clientLeads.length.toLocaleString()}</dd></div>
          <div><dt>Revenue</dt><dd>{money(revenue)}</dd></div>
          <div><dt>Ad budget</dt><dd>{client.monthlyAdBudgetCents ? money(client.monthlyAdBudgetCents) : "—"}</dd></div>
        </dl>
        <ul className="crm-biz-facts">
          <li><UserRound aria-hidden="true" /><span>{client.assignedAccountManager?.trim() || "No account manager"}</span></li>
          <li><MapPin aria-hidden="true" /><span>{areas || "No service areas"}</span></li>
          <li><Globe aria-hidden="true" /><span>{site || "No website"}</span></li>
        </ul>
        <footer><span>Created {shortDate(client.createdAt)}</span><div className="crm-biz-actions">{onEdit ? <button type="button" className="crm-biz-edit" onClick={() => onEdit(client.id)}><Settings2 aria-hidden="true" />Settings</button> : null}{canDelete ? <button className="danger" onClick={() => setDeleteTarget(client)}>Delete</button> : null}</div></footer>
      </article>;
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

export function TeamView({ team, clients, canManage, onEditAdmin, onInvite, mutate }: {
  team: CrmTeamMember[];
  clients: CrmClient[];
  canManage: boolean;
  onEditAdmin?: (memberId: string) => void;
  onInvite: () => void;
  mutate: Mutate;
}) {
  async function revoke(member: CrmTeamMember) {
    if (!window.confirm("Remove " + member.displayName + "'s access?")) return;
    await mutate({ action: "revoke_member", memberId: member.id, scope: member.clientId ? "client" : "agency" }, "Access removed");
  }

  async function sendReset(member: CrmTeamMember) {
    if (!window.confirm("Send a password reset email to " + member.displayName + "?")) return;
    await mutate({ action: "send_member_password_reset", memberId: member.id, scope: member.clientId ? "client" : "agency" }, "Password reset sent to " + member.displayName);
  }

  function accountNames(member: CrmTeamMember) {
    if (member.assignedClientIds) {
      return clients
        .filter((client) => member.assignedClientIds?.includes(client.id))
        .map((client) => client.businessName)
        .join(", ") || "No assigned sub-accounts";
    }
    return member.clientName ?? "All sub-accounts";
  }

  return (
    <div className="crm-view">
      <section className="crm-page-heading">
        <div>
          <p>ACCESS CONTROL</p>
          <h2>Team</h2>
          <span>Manage access to the agency and its sub-accounts.</span>
        </div>
      </section>
      {team.length ? (
        <section className="crm-table-panel">
          <table className="crm-table">
            <thead>
              <tr><th>Person</th><th>Access</th><th>Role</th><th>Status</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {team.map((member) => (
                <tr key={member.id}>
                  <td>
                    <span className="crm-table-person">
                      <i>{member.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</i>
                      <span><strong>{member.displayName}</strong><small>{member.email}</small></span>
                    </span>
                  </td>
                  <td>{accountNames(member)}</td>
                  <td>{roleLabel(member.role)}</td>
                  <td><Badge tone={member.status === "active" ? "green" : "red"}>{member.status}</Badge></td>
                  <td className="crm-lead-actions">
                    {canManage && member.status === "active" && (
                      <>
                        {onEditAdmin && (member.assignedClientIds || member.role.startsWith("CLIENT_")) && (
                          <button type="button" onClick={() => onEditAdmin(member.id)}>
                            {member.assignedClientIds ? "Edit access" : "Make admin"}
                          </button>
                        )}
                        <button type="button" onClick={() => void sendReset(member)}>Send reset</button>
                        {!isProtectedOwnerRole(member.role) && (
                          <button type="button" className="crm-danger-link" onClick={() => void revoke(member)}>Remove</button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <EmptyState title="No team members found" description="People with access to these sub-accounts will appear here."
          action={canManage ? <button className="crm-button-primary" onClick={onInvite}>Give access</button> : undefined} />
      )}
      {canManage && (
        <div className="crm-form-note" style={{ marginTop: 16 }}>
          If your sign-in page uses a Cloudflare Access policy, include the invitee in that policy.
        </div>
      )}
    </div>
  );
}
