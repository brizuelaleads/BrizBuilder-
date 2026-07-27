"use client";

import {
  BriefcaseBusiness,
  CalendarDays,
  FileText,
  ListChecks,
  ScrollText,
} from "lucide-react";
import type {
  CrmAppointment,
  CrmClient,
  CrmConversation,
  CrmLead,
  CrmMessage,
  CrmStage,
  CrmTask,
} from "../../db/crm";
import { Badge, dateTime, initials, money } from "./ui";

type DashboardDestination =
  | "leads"
  | "pipeline"
  | "calendar"
  | "tasks"
  | "reports"
  | "conversations";

function timestamp(value: string | null) {
  if (!value) return 0;
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function displayStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function appointmentTone(
  status: string,
): "neutral" | "green" | "orange" | "red" | "blue" {
  if (status === "COMPLETED" || status === "CONFIRMED") return "green";
  if (status === "CANCELED") return "red";
  if (status === "PENDING") return "orange";
  return "blue";
}

type DashboardSkeletonVariant =
  | "chart"
  | "sources"
  | "list"
  | "schedule"
  | "pipeline"
  | "conversations";

const skeletonChartHeights = [38, 64, 48, 76, 56, 84, 46];

function DashboardSkeleton({
  variant,
  caption,
  rows = 3,
}: {
  variant: DashboardSkeletonVariant;
  caption: string;
  rows?: number;
}) {
  return (
    <div className={`crm-dashboard-placeholder is-${variant}`}>
      {variant === "chart" ? (
        <div
          className="crm-dashboard-placeholder-chart"
          aria-hidden="true"
        >
          {skeletonChartHeights.map((height, index) => (
            <span key={index} style={{ height: `${height}%` }} />
          ))}
        </div>
      ) : (
        <div className="crm-dashboard-placeholder-rows" aria-hidden="true">
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="crm-dashboard-placeholder-row">
              {!["sources", "pipeline"].includes(variant) ? <i /> : null}
              <span>
                <b />
                <small />
              </span>
              <em />
            </div>
          ))}
        </div>
      )}
      <p>{caption}</p>
    </div>
  );
}

export function DashboardView({
  leads,
  pipelineLeads,
  clients,
  appointments,
  tasks,
  stages,
  conversations,
  messages,
  generatedAt,
  canViewConversations,
  onOpenLead,
  onNavigate,
}: {
  leads: CrmLead[];
  pipelineLeads: CrmLead[];
  clients: CrmClient[];
  appointments: CrmAppointment[];
  tasks: CrmTask[];
  stages: CrmStage[];
  conversations: CrmConversation[];
  messages: CrmMessage[];
  generatedAt: string;
  canViewConversations: boolean;
  onOpenLead: (lead: CrmLead) => void;
  onNavigate: (view: DashboardDestination) => void;
}) {
  const won = leads.filter((lead) => lead.status === "WON");
  const newLeads = leads.filter((lead) => lead.status === "NEW");
  const revenue = won.reduce(
    (sum, lead) => sum + lead.finalRevenueCents,
    0,
  );
  const spend = clients.reduce(
    (sum, client) => sum + client.monthlyAdBudgetCents,
    0,
  );
  const booked = leads.filter((lead) =>
    ["APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON"].includes(lead.status),
  ).length;
  const closeRate = leads.length
    ? Math.round((won.length / leads.length) * 100)
    : 0;
  const roas = spend ? revenue / spend : 0;
  const openTasks = tasks
    .filter((task) => !["COMPLETED", "CANCELED"].includes(task.status))
    .sort((first, second) => {
      if (!first.dueAt && !second.dueAt) return 0;
      if (!first.dueAt) return 1;
      if (!second.dueAt) return -1;
      return timestamp(first.dueAt) - timestamp(second.dueAt);
    });
  const futureAppointments = appointments
    .filter(
      (appointment) =>
        appointment.status !== "CANCELED" &&
        timestamp(appointment.startsAt) >= timestamp(generatedAt),
    )
    .sort(
      (first, second) =>
        timestamp(first.startsAt) - timestamp(second.startsAt),
    );

  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(generatedAt);
    date.setUTCDate(date.getUTCDate() - 6 + index);
    const iso = date.toISOString().slice(0, 10);
    return {
      label: date.toLocaleDateString("en-US", { weekday: "short" }),
      value: leads.filter((lead) => lead.createdAt.slice(0, 10) === iso)
        .length,
    };
  });
  const maxDaily = Math.max(1, ...daily.map((item) => item.value));
  const hasDailyLeadActivity = daily.some((item) => item.value > 0);

  const sources = Object.entries(
    leads.reduce<Record<string, number>>((acc, lead) => {
      const source = lead.source || "Unknown";
      acc[source] = (acc[source] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((first, second) => second[1] - first[1]);
  const maxSource = Math.max(1, ...sources.map(([, count]) => count));

  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const groupedStages = new Map<
    string,
    {
      name: string;
      position: number;
      count: number;
      valueCents: number;
      isWon: boolean;
      isLost: boolean;
    }
  >();

  [...stages]
    .sort((first, second) => first.position - second.position)
    .forEach((stage) => {
      const key = stage.slug || stage.name.toLowerCase();
      const current = groupedStages.get(key);
      if (!current) {
        groupedStages.set(key, {
          name: stage.name,
          position: stage.position,
          count: 0,
          valueCents: 0,
          isWon: stage.isWon,
          isLost: stage.isLost,
        });
      } else {
        current.position = Math.min(current.position, stage.position);
        current.isWon ||= stage.isWon;
        current.isLost &&= stage.isLost;
      }
    });

  pipelineLeads.forEach((lead) => {
    const stage = stageById.get(lead.stageId);
    const key =
      stage?.slug ||
      lead.stageName.toLowerCase().replaceAll(" ", "-") ||
      lead.status.toLowerCase();
    let row = groupedStages.get(key);
    if (!row) {
      row = {
        name: lead.stageName || displayStatus(lead.status),
        position: Number.MAX_SAFE_INTEGER,
        count: 0,
        valueCents: 0,
        isWon: lead.status === "WON",
        isLost: lead.status === "LOST",
      };
      groupedStages.set(key, row);
    }
    row.count += 1;
    row.valueCents += row.isWon
      ? lead.finalRevenueCents
      : lead.estimatedValueCents;
  });

  const pipelineSnapshot = [...groupedStages.values()]
    .filter((stage) => !stage.isLost)
    .sort((first, second) => first.position - second.position);
  const hasPipelineActivity = pipelineSnapshot.some(
    (stage) => stage.count > 0,
  );
  const maxPipelineStage = Math.max(
    1,
    ...pipelineSnapshot.map((stage) => stage.count),
  );
  const openPipeline = pipelineLeads.filter(
    (lead) =>
      !["WON", "LOST", "SPAM", "UNRESPONSIVE"].includes(lead.status),
  );
  const openPipelineValue = openPipeline.reduce(
    (sum, lead) => sum + lead.estimatedValueCents,
    0,
  );

  const latestMessageByConversation = new Map<string, CrmMessage>();
  messages.forEach((message) => {
    const current = latestMessageByConversation.get(message.conversationId);
    if (
      !current ||
      timestamp(message.createdAt) > timestamp(current.createdAt)
    ) {
      latestMessageByConversation.set(message.conversationId, message);
    }
  });
  const recentConversations = conversations
    .map((conversation) => {
      const latestMessage = latestMessageByConversation.get(conversation.id);
      const previewIsCurrent =
        latestMessage &&
        (!conversation.lastMessageAt ||
          timestamp(latestMessage.createdAt) >=
            timestamp(conversation.lastMessageAt));
      return {
        conversation,
        latestMessage: previewIsCurrent ? latestMessage : null,
        lastActivityAt:
          conversation.lastMessageAt ?? latestMessage?.createdAt ?? null,
      };
    })
    .sort(
      (first, second) =>
        timestamp(second.lastActivityAt) - timestamp(first.lastActivityAt),
    )
    .slice(0, 4);

  const quotes = pipelineLeads.filter(
    (lead) => lead.status === "ESTIMATE_SENT",
  );
  const quoteValue = quotes.reduce(
    (sum, lead) => sum + lead.estimatedValueCents,
    0,
  );
  const jobs = pipelineLeads.filter((lead) => lead.status === "WON");
  const jobValue = jobs.reduce(
    (sum, lead) => sum + lead.finalRevenueCents,
    0,
  );

  const metrics = [
    {
      label: "Leads in range",
      value: String(leads.length),
      detail: "Selected reporting period",
    },
    {
      label: "New leads",
      value: String(newLeads.length),
      detail: "Need first response",
    },
    {
      label: "Booked leads",
      value: String(booked),
      detail: "Appointment stage or later",
    },
    {
      label: "Won opportunities",
      value: String(won.length),
      detail: leads.length
        ? `${closeRate}% close rate`
        : "Add leads to calculate",
    },
    {
      label: "Recorded won value",
      value: money(revenue, true),
      detail: "From won opportunities",
    },
    {
      label: "Monthly ad budget",
      value: clients.length ? money(spend, true) : "—",
      detail: clients.length
        ? "Across selected clients"
        : "Add a client budget",
    },
    {
      label: "Budget per lead",
      value:
        leads.length && spend
          ? money(Math.round(spend / leads.length))
          : "—",
      detail: !leads.length
        ? "Add leads to calculate"
        : spend
          ? "Monthly budget ÷ leads"
          : "Add a client budget",
    },
    {
      label: "Value / budget",
      value: spend ? `${roas.toFixed(1)}x` : "—",
      detail: spend
        ? "Recorded won value ÷ budget"
        : "Add a client budget",
    },
  ];

  return (
    <div className="crm-view crm-dashboard-view">
      <section className="crm-welcome-row">
        <div>
          <p>AGENCY COMMAND CENTER</p>
          <h2>Every lead, next step, and dollar in one view.</h2>
          <span>
            Performance cards follow the selected date range. Operational
            panels below show current workspace records.
          </span>
        </div>
        <Badge tone="green">Live workspace</Badge>
      </section>

      <section
        className="crm-metric-grid"
        aria-label="Key performance indicators"
      >
        {metrics.map(({ label, value, detail }, index) => (
          <article
            key={label}
            className={index === 0 ? "crm-metric-primary" : ""}
          >
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>

      <section className="crm-dashboard-grid">
        <article className="crm-panel crm-chart-panel">
          <header>
            <div>
              <p>LEAD VOLUME</p>
              <h3>New inquiries this week</h3>
            </div>
            <span>7 days</span>
          </header>
          {hasDailyLeadActivity ? (
            <div
              className="crm-column-chart"
              role="img"
              aria-label={`Lead volume by day: ${daily
                .map((item) => `${item.label} ${item.value}`)
                .join(", ")}`}
            >
              {daily.map((item) => (
                <div key={item.label}>
                  <strong>{item.value}</strong>
                  <span
                    style={{
                      height: `${Math.max(8, (item.value / maxDaily) * 100)}%`,
                    }}
                  />
                  <small>{item.label}</small>
                </div>
              ))}
            </div>
          ) : (
            <DashboardSkeleton
              variant="chart"
              caption="No inquiries were recorded in the last 7 days."
            />
          )}
        </article>

        <article className="crm-panel crm-source-panel">
          <header>
            <div>
              <p>ATTRIBUTION</p>
              <h3>Leads by source</h3>
            </div>
            <button type="button" onClick={() => onNavigate("reports")}>
              Full report
            </button>
          </header>
          <div className="crm-bar-list">
            {sources.length ? (
              sources.map(([source, count]) => (
                <div key={source}>
                  <div>
                    <span>{source}</span>
                    <strong>{count}</strong>
                  </div>
                  <i>
                    <span style={{ width: `${(count / maxSource) * 100}%` }} />
                  </i>
                </div>
              ))
            ) : (
              <DashboardSkeleton
                variant="sources"
                caption="Sources such as Meta and Google will appear here."
              />
            )}
          </div>
        </article>
      </section>

      <section className="crm-dashboard-grid crm-dashboard-lower">
        <article className="crm-panel crm-recent-panel">
          <header>
            <div>
              <p>RECENT LEADS</p>
              <h3>Newest opportunities</h3>
            </div>
            <button type="button" onClick={() => onNavigate("leads")}>
              View all
            </button>
          </header>
          <div className="crm-compact-list">
            {leads.length ? (
              leads.slice(0, 5).map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => onOpenLead(lead)}
                >
                  <span className="crm-avatar">
                    {lead.firstName[0]}
                    {lead.lastName[0]}
                  </span>
                  <span>
                    <strong>
                      {lead.firstName} {lead.lastName}
                    </strong>
                    <small>
                      {lead.serviceRequested}
                      {" · "}
                      {lead.source}
                    </small>
                  </span>
                  <Badge
                    tone={
                      lead.status === "NEW"
                        ? "purple"
                        : lead.status === "WON"
                          ? "green"
                          : "neutral"
                    }
                  >
                    {displayStatus(lead.status)}
                  </Badge>
                </button>
              ))
            ) : (
              <DashboardSkeleton
                variant="list"
                caption="New leads will appear here as they arrive."
              />
            )}
          </div>
        </article>

        <article className="crm-panel crm-next-panel">
          <header>
            <div>
              <p>NEXT UP</p>
              <h3>Appointments and tasks</h3>
            </div>
          </header>
          {futureAppointments.slice(0, 2).map((appointment) => (
            <button
              key={appointment.id}
              type="button"
              onClick={() => onNavigate("calendar")}
            >
              <span className="crm-next-icon">
                <CalendarDays aria-hidden="true" />
              </span>
              <span>
                <strong>{appointment.contactName}</strong>
                <small>
                  {appointment.serviceType}
                  {" · "}
                  {dateTime(appointment.startsAt)}
                </small>
              </span>
            </button>
          ))}
          {openTasks.slice(0, 3).map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onNavigate("tasks")}
            >
              <span className="crm-next-icon crm-next-task">
                <ListChecks aria-hidden="true" />
              </span>
              <span>
                <strong>{task.title}</strong>
                <small>
                  {displayStatus(task.priority)} priority
                  {" · "}
                  {dateTime(task.dueAt)}
                </small>
              </span>
            </button>
          ))}
          {!futureAppointments.length && !openTasks.length ? (
            <DashboardSkeleton
              variant="list"
              caption="Upcoming appointments and tasks will appear here."
            />
          ) : null}
        </article>
      </section>

      <section className="crm-dashboard-bottom-grid crm-dashboard-bottom-primary">
        <article className="crm-panel crm-upcoming-schedule-panel">
          <header>
            <div>
              <p>UPCOMING SCHEDULE</p>
              <h3>Appointments ahead</h3>
            </div>
            <button type="button" onClick={() => onNavigate("calendar")}>
              Open calendar
            </button>
          </header>
          <div className="crm-schedule-list">
            {futureAppointments.slice(0, 4).map((appointment) => (
              <button
                key={appointment.id}
                type="button"
                onClick={() => onNavigate("calendar")}
              >
                <span className="crm-dashboard-row-icon">
                  <CalendarDays aria-hidden="true" />
                </span>
                <span className="crm-dashboard-row-copy">
                  <strong>{appointment.contactName}</strong>
                  <small>
                    {appointment.serviceType}
                    {" · "}
                    {appointment.clientName}
                  </small>
                </span>
                <time dateTime={appointment.startsAt}>
                  {dateTime(appointment.startsAt)}
                </time>
                <Badge tone={appointmentTone(appointment.status)}>
                  {displayStatus(appointment.status)}
                </Badge>
              </button>
            ))}
            {!futureAppointments.length ? (
              <DashboardSkeleton
                variant="schedule"
                caption="Scheduled appointments will appear here."
              />
            ) : null}
          </div>
        </article>

        <article className="crm-panel crm-pipeline-snapshot-panel">
          <header>
            <div>
              <p>PIPELINE SNAPSHOT</p>
              <h3>Opportunity progress</h3>
            </div>
            <button type="button" onClick={() => onNavigate("pipeline")}>
              Open pipeline
            </button>
          </header>
          {hasPipelineActivity ? (
            <>
              <div className="crm-pipeline-snapshot-summary">
                <div>
                  <strong>{money(openPipelineValue, true)}</strong>
                  <span>Open pipeline value</span>
                </div>
                <Badge tone="green">{openPipeline.length} open</Badge>
              </div>
              <div className="crm-pipeline-snapshot-list">
                {pipelineSnapshot.map((stage) => (
                  <button
                    key={`${stage.name}-${stage.position}`}
                    type="button"
                    onClick={() => onNavigate("pipeline")}
                  >
                    <span>
                      <strong>{stage.name}</strong>
                      <small>{money(stage.valueCents, true)}</small>
                    </span>
                    <i aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.max(
                            stage.count ? 7 : 0,
                            (stage.count / maxPipelineStage) * 100,
                          )}%`,
                        }}
                      />
                    </i>
                    <b>{stage.count}</b>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <DashboardSkeleton
              variant="pipeline"
              rows={4}
              caption="Pipeline counts and values will appear with your first active opportunity."
            />
          )}
        </article>
      </section>

      <section className="crm-dashboard-bottom-grid crm-dashboard-bottom-secondary">
        <article className="crm-panel crm-recent-conversations-panel">
          <header>
            <div>
              <p>RECENT CONVERSATIONS</p>
              <h3>Recent text activity</h3>
            </div>
            {canViewConversations ? (
              <button
                type="button"
                onClick={() => onNavigate("conversations")}
              >
                Open inbox
              </button>
            ) : (
              <span>Restricted</span>
            )}
          </header>
          <div className="crm-conversation-preview-list">
            {canViewConversations
              ? recentConversations.map(
                  ({ conversation, latestMessage, lastActivityAt }) => (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => onNavigate("conversations")}
                    >
                      <span className="crm-dashboard-avatar">
                        {initials(conversation.contactName)}
                      </span>
                      <span className="crm-dashboard-row-copy">
                        <strong>{conversation.contactName}</strong>
                        <small>
                          {latestMessage?.body ||
                            "Open the inbox to view the latest message"}
                        </small>
                      </span>
                      <span className="crm-conversation-preview-meta">
                        <time dateTime={lastActivityAt ?? undefined}>
                          {dateTime(lastActivityAt)}
                        </time>
                        {conversation.unreadCount > 0 ? (
                          <b aria-label={`${conversation.unreadCount} unread`}>
                            {conversation.unreadCount}
                          </b>
                        ) : null}
                      </span>
                    </button>
                  ),
                )
              : null}
            {canViewConversations && !recentConversations.length ? (
              <DashboardSkeleton
                variant="conversations"
                caption="Customer conversations will appear here."
              />
            ) : null}
            {!canViewConversations ? (
              <p className="crm-dashboard-empty-row">
                Messaging access is not available for your role.
              </p>
            ) : null}
          </div>
        </article>

        <article className="crm-panel crm-business-snapshot-panel">
          <header>
            <div>
              <p>BUSINESS</p>
              <h3>Invoices, quotes, and jobs</h3>
            </div>
            <span>Stage-based totals</span>
          </header>
          <div className="crm-business-snapshot-list">
            <div className="is-unavailable">
              <span className="crm-dashboard-row-icon">
                <FileText aria-hidden="true" />
              </span>
              <span className="crm-dashboard-row-copy">
                <strong>Invoices</strong>
                <small>Invoice tracking is not available yet</small>
              </span>
              <b aria-label="Not tracked">—</b>
            </div>
            <button type="button" onClick={() => onNavigate("pipeline")}>
              <span className="crm-dashboard-row-icon">
                <ScrollText aria-hidden="true" />
              </span>
              <span className="crm-dashboard-row-copy">
                <strong>Quotes</strong>
                <small>
                  {money(quoteValue, true)} in estimate-stage opportunities
                </small>
              </span>
              <b>{quotes.length}</b>
            </button>
            <button type="button" onClick={() => onNavigate("pipeline")}>
              <span className="crm-dashboard-row-icon">
                <BriefcaseBusiness aria-hidden="true" />
              </span>
              <span className="crm-dashboard-row-copy">
                <strong>Jobs</strong>
                <small>{money(jobValue, true)} in won opportunities</small>
              </span>
              <b>{jobs.length}</b>
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
