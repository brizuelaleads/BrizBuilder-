"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CrmBootstrap, CrmLead, CrmPermission } from "../db/crm";
import { DashboardView } from "./crm/DashboardView";
import { LeadDetail, LeadsView, PipelineView } from "./crm/LeadsViews";
import {
  CalendarView,
  ClientsView,
  ReportsView,
  SettingsView,
  TasksView,
  TeamView,
} from "./crm/OperationsViews";
import {
  AddAppointmentModal,
  AddClientModal,
  AddContactModal,
  AddLeadModal,
  AddTaskModal,
  InviteMemberModal,
} from "./crm/ActionForms";
import {
  AddCompanyModal,
  AddCustomFieldModal,
  AddCustomValueModal,
  ContactImportModal,
} from "./crm/FoundationForms";
import {
  AuditLogView,
  CompaniesView,
  CustomDataView,
  FoundationContactsView,
} from "./crm/FoundationViews";
import { FutureModuleView, type FutureModule } from "./crm/FutureModuleViews";
import { WebsitesView } from "./crm/WebsitesView";
import { ConversationsView, PhoneSystemView } from "./crm/PhoneViews";
import { ConnectionsView, VisualAutomationsView } from "./crm/WorkflowViews";
import { GoogleProfilesView } from "./crm/GoogleProfilesView";
import { ReviewsView } from "./crm/ReviewsView";
import { Badge, initials, Modal } from "./crm/ui";

type View =
  | "dashboard"
  | "leads"
  | "pipeline"
  | "contacts"
  | "companies"
  | "calendar"
  | "tasks"
  | "clients"
  | "reports"
  | "websites"
  | "profiles"
  | "reviews"
  | "connections"
  | "phone-system"
  | "custom-data"
  | "audit"
  | "team"
  | "settings"
  | FutureModule;
type ModalName =
  | "lead"
  | "contact"
  | "contact-import"
  | "company"
  | "custom-field"
  | "custom-value"
  | "task"
  | "appointment"
  | "client"
  | "invite"
  | "search"
  | null;

const futureModules: FutureModule[] = [
  "forms",
  "payments",
  "ai",
  "funnels",
];

const nav: Array<{
  id: View;
  label: string;
  icon: string;
  agencyOnly?: boolean;
  permission?: CrmPermission;
  section?: string;
  preview?: boolean;
}> = [
  { id: "dashboard", label: "Dashboard", icon: "D", section: "Workspace" },
  { id: "leads", label: "Leads", icon: "L" },
  { id: "pipeline", label: "Pipeline", icon: "P" },
  { id: "contacts", label: "Contacts", icon: "C" },
  {
    id: "companies",
    label: "Companies",
    icon: "O",
    permission: "companies.write",
  },
  { id: "calendar", label: "Calendar", icon: "A", section: "Operations" },
  { id: "tasks", label: "Tasks", icon: "T" },
  { id: "clients", label: "Clients", icon: "B", agencyOnly: true },
  { id: "reports", label: "Reports", icon: "R", section: "Insights" },
  {
    id: "connections",
    label: "Connections",
    icon: "C",
    section: "Communication",
    permission: "phone_system.manage",
  },
  {
    id: "phone-system",
    label: "Phone System",
    icon: "☎",
    section: "Communication",
    permission: "phone_system.manage",
  },
  {
    id: "conversations",
    label: "Conversations",
    icon: "Q",
    permission: "messages.write",
  },
  {
    id: "automations",
    label: "Automations",
    icon: "W",
    permission: "automations.manage",
  },
  {
    id: "forms",
    label: "Forms",
    icon: "F",
    section: "Future previews",
    preview: true,
  },
  { id: "websites", label: "Websites", icon: "W" },
  {
    id: "profiles",
    label: "Google Profiles",
    icon: "G",
    section: "Reputation",
    permission: "profiles.manage",
  },
  {
    id: "reviews",
    label: "Reviews",
    icon: "★",
    section: "Reputation",
    permission: "reviews.read",
  },
  { id: "funnels", label: "Funnels", icon: "N", preview: true },
  { id: "payments", label: "Payments", icon: "$", preview: true },
  { id: "ai", label: "AI workspace", icon: "AI", preview: true },
  {
    id: "custom-data",
    label: "Custom data",
    icon: "V",
    permission: "custom_data.manage",
    section: "Manage",
  },
  { id: "audit", label: "Audit log", icon: "H", permission: "audit.read" },
  { id: "team", label: "Team", icon: "M", agencyOnly: true },
  { id: "settings", label: "Settings", icon: "S", agencyOnly: true },
];

const viewChangeEvent = "brizuela:crm-view-change";

function readViewFromLocation(): View {
  const requested = new URLSearchParams(window.location.search).get(
    "view",
  ) as View | null;
  return requested && nav.some((item) => item.id === requested)
    ? requested
    : "dashboard";
}

function subscribeToViewChange(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(viewChangeEvent, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(viewChangeEvent, onStoreChange);
  };
}

export function CrmApp({
  initialData,
  signOutPath,
}: {
  initialData: CrmBootstrap;
  signOutPath: string;
}) {
  const [data, setData] = useState(initialData);
  const requestedView = useSyncExternalStore(
    subscribeToViewChange,
    readViewFromLocation,
    () => "dashboard",
  );
  const [selectedClientId, setSelectedClientId] = useState(
    initialData.viewer.clientId ?? "all",
  );
  const [range, setRange] = useState("30");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalName>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const visibleNav = nav.filter(
    (item) =>
      (!item.agencyOnly || data.viewer.isAgency) &&
      (!item.permission || data.viewer.permissions.includes(item.permission)),
  );
  const view = visibleNav.some((item) => item.id === requestedView)
    ? requestedView
    : "dashboard";
  const title =
    visibleNav.find((item) => item.id === view)?.label ?? "Dashboard";

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setModal("search");
      }
      if (event.key === "Escape") {
        setModal(null);
        setSelectedLeadId(null);
        setMobileNav(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedClientId !== "all")
      url.searchParams.set("client", selectedClientId);
    else url.searchParams.delete("client");
    window.history.replaceState({}, "", url);
  }, [selectedClientId]);

  useEffect(() => {
    window.dispatchEvent(new Event(viewChangeEvent));
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      const requestedClient = query.get("client");
      if (
        requestedClient &&
        initialData.clients.some((client) => client.id === requestedClient)
      )
        setSelectedClientId(requestedClient);
      const connectionError = query.get("connection_error");
      if (connectionError) setError(connectionError);
      if (query.get("connected") === "twilio") {
        setToast(
          "Twilio connected. The customer keeps ownership and billing.",
        );
        window.setTimeout(() => setToast(""), 5000);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialData.clients]);

  const filteredLeads = useMemo(() => {
    const cutoff =
      range === "all"
        ? null
        : new Date(
            new Date(data.generatedAt).getTime() - Number(range) * 86400000,
          );
    return data.leads.filter(
      (lead) =>
        (selectedClientId === "all" || lead.clientId === selectedClientId) &&
        (!cutoff ||
          new Date(
            lead.createdAt.replace(" ", "T") +
              (lead.createdAt.includes("Z") ? "" : "Z"),
          ) >= cutoff),
    );
  }, [data.leads, data.generatedAt, selectedClientId, range]);
  const filteredContacts = data.contacts.filter(
    (contact) =>
      selectedClientId === "all" || contact.clientId === selectedClientId,
  );
  const filteredCompanies = data.companies.filter(
    (company) =>
      selectedClientId === "all" || company.clientId === selectedClientId,
  );
  const filteredWebsites = data.websites.filter(
    (website) =>
      selectedClientId === "all" || website.clientId === selectedClientId,
  );
  const filteredCustomFields = data.customFields.filter(
    (field) =>
      selectedClientId === "all" || field.clientId === selectedClientId,
  );
  const filteredCustomFieldValues = data.customFieldValues.filter(
    (value) =>
      selectedClientId === "all" || value.clientId === selectedClientId,
  );
  const filteredCustomValues = data.customValues.filter(
    (value) =>
      selectedClientId === "all" || value.clientId === selectedClientId,
  );
  const filteredFeatureFlags = data.featureFlags.filter(
    (flag) =>
      selectedClientId === "all" ||
      flag.clientId === null ||
      flag.clientId === selectedClientId,
  );
  const filteredTasks = data.tasks.filter(
    (task) => selectedClientId === "all" || task.clientId === selectedClientId,
  );
  const filteredAppointments = data.appointments.filter(
    (appointment) =>
      selectedClientId === "all" || appointment.clientId === selectedClientId,
  );
  const filteredClients = data.clients.filter(
    (client) => selectedClientId === "all" || client.id === selectedClientId,
  );
  const selectedLead =
    data.leads.find((lead) => lead.id === selectedLeadId) ?? null;

  async function refresh() {
    const response = await fetch("/api/crm", { cache: "no-store" });
    const body = (await response.json()) as {
      data?: CrmBootstrap;
      error?: string;
    };
    if (!response.ok || !body.data)
      throw new Error(body.error ?? "Could not refresh the workspace.");
    setData(body.data);
  }

  async function mutate(
    input: Record<string, unknown>,
    success: string,
  ): Promise<unknown> {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await response.json()) as {
        error?: string;
        result?: unknown;
      };
      if (!response.ok)
        throw new Error(body.error ?? "The change could not be saved.");
      await refresh();
      setToast(success);
      window.setTimeout(() => setToast(""), 3200);
      return body.result;
    } catch (caught) {
      try {
        await refresh();
      } catch {
        // Keep the original mutation error. A failed provider request may still
        // have created an audit or failed-delivery record worth refreshing.
      }
      const message =
        caught instanceof Error
          ? caught.message
          : "The change could not be saved.";
      setError(message);
      throw caught;
    } finally {
      setBusy(false);
    }
  }

  function navigate(next: View) {
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState({}, "", url);
    window.dispatchEvent(new Event(viewChangeEvent));
    setMobileNav(false);
  }

  function openConnections(clientId: string) {
    setSelectedClientId(clientId);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "connections");
    url.searchParams.set("client", clientId);
    window.history.replaceState({}, "", url);
    window.dispatchEvent(new Event(viewChangeEvent));
    setMobileNav(false);
  }

  function openGoogleProfiles(clientId: string) {
    setSelectedClientId(clientId);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "profiles");
    url.searchParams.set("client", clientId);
    window.history.replaceState({}, "", url);
    window.dispatchEvent(new Event(viewChangeEvent));
    setMobileNav(false);
  }

  function openLead(lead: CrmLead) {
    setSelectedLeadId(lead.id);
  }

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const needle = search.toLowerCase();
    return [
      ...data.leads
        .filter((lead) =>
          `${lead.firstName} ${lead.lastName} ${lead.phone ?? ""} ${lead.serviceRequested}`
            .toLowerCase()
            .includes(needle),
        )
        .slice(0, 6)
        .map((lead) => ({
          id: lead.id,
          type: "Lead",
          title: `${lead.firstName} ${lead.lastName}`,
          detail: lead.serviceRequested,
          lead,
        })),
      ...data.contacts
        .filter((contact) =>
          `${contact.firstName} ${contact.lastName} ${contact.phone ?? ""} ${contact.email ?? ""}`
            .toLowerCase()
            .includes(needle),
        )
        .slice(0, 4)
        .map((contact) => ({
          id: contact.id,
          type: "Contact",
          title: `${contact.firstName} ${contact.lastName}`,
          detail: contact.phone ?? contact.email ?? "No contact method",
          lead: null,
        })),
      ...data.companies
        .filter((company) =>
          `${company.name} ${company.industry ?? ""}`
            .toLowerCase()
            .includes(needle),
        )
        .slice(0, 4)
        .map((company) => ({
          id: company.id,
          type: "Company",
          title: company.name,
          detail: company.industry ?? "Company",
          lead: null,
        })),
      ...data.clients
        .filter((client) => client.businessName.toLowerCase().includes(needle))
        .slice(0, 3)
        .map((client) => ({
          id: client.id,
          type: "Client",
          title: client.businessName,
          detail: client.industry,
          lead: null,
        })),
    ];
  }, [search, data]);

  return (
    <div className="crm-shell">
      <aside className={`crm-sidebar ${mobileNav ? "crm-sidebar-open" : ""}`}>
        <div className="crm-brand">
          <span>BL</span>
          <div>
            <strong>Brizuela Leads</strong>
            <small>Agency CRM</small>
          </div>
          <button
            onClick={() => setMobileNav(false)}
            aria-label="Close navigation"
          >
            ×
          </button>
        </div>
        <div className="crm-org-card">
          <span>{initials(data.organization.name)}</span>
          <div>
            <strong>{data.organization.name}</strong>
            <small>
              {data.viewer.isAgency ? "Agency workspace" : "Client workspace"}
            </small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {visibleNav.map((item, index) => (
            <div key={item.id}>
              {item.section &&
              (index === 0 ||
                visibleNav[index - 1]?.section !== item.section) ? (
                <p>{item.section}</p>
              ) : null}
              <button
                className={view === item.id ? "active" : ""}
                onClick={() => navigate(item.id)}
                aria-current={view === item.id ? "page" : undefined}
              >
                <i>{item.icon}</i>
                <span>{item.label}</span>
                {item.id === "leads" && (
                  <em>
                    {
                      filteredLeads.filter((lead) => lead.status === "NEW")
                        .length
                    }
                  </em>
                )}
                {item.id === "tasks" && (
                  <em>
                    {
                      filteredTasks.filter(
                        (task) =>
                          !["COMPLETED", "CANCELED"].includes(task.status),
                      ).length
                    }
                  </em>
                )}
                {item.preview && <em className="crm-nav-preview">Preview</em>}
              </button>
            </div>
          ))}
        </nav>
        <div className="crm-sidebar-foot">
          <div>
            <span className="crm-avatar">{initials(data.viewer.name)}</span>
            <p>
              <strong>{data.viewer.name}</strong>
              <small>{data.viewer.role.replaceAll("_", " ")}</small>
            </p>
          </div>
          <a href={signOutPath}>Sign out</a>
        </div>
      </aside>
      {mobileNav ? (
        <button
          className="crm-nav-scrim"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        />
      ) : null}

      <main className="crm-main">
        <header className="crm-topbar">
          <div className="crm-topbar-title">
            <button
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              ☰
            </button>
            <div>
              <span>{data.organization.name}</span>
              <h1>{title}</h1>
            </div>
          </div>
          <div className="crm-topbar-filters">
            {data.viewer.isAgency ? (
              <select
                value={selectedClientId}
                onChange={(event) => setSelectedClientId(event.target.value)}
                aria-label="Filter workspace by client"
              >
                <option value="all">All clients</option>
                {data.clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.businessName}
                  </option>
                ))}
              </select>
            ) : null}
            {view !== "reviews" ? (
              <select
                value={range}
                onChange={(event) => setRange(event.target.value)}
                aria-label="Filter by date range"
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="all">All time</option>
              </select>
            ) : null}
            <button
              className="crm-command-button"
              onClick={() => setModal("search")}
            >
              <span>⌕ Search</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className="crm-button-primary crm-top-add"
              onClick={() => setModal("lead")}
            >
              + Add Lead
            </button>
          </div>
        </header>
        <div className="crm-mobile-filterbar">
          {data.viewer.isAgency ? (
            <select
              value={selectedClientId}
              onChange={(event) => setSelectedClientId(event.target.value)}
              aria-label="Filter workspace by client"
            >
              <option value="all">All clients</option>
              {data.clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.businessName}
                </option>
              ))}
            </select>
          ) : null}
          {view !== "reviews" ? (
            <select
              value={range}
              onChange={(event) => setRange(event.target.value)}
              aria-label="Filter by date range"
            >
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="all">All time</option>
            </select>
          ) : null}
        </div>
        <div className="crm-system-strip">
          <span>
            <i /> Tenant protected
          </span>
          <span>
            Last refreshed{" "}
            {new Date(data.generatedAt).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <Badge tone="green">Live workspace</Badge>
        </div>

        {view === "dashboard" && (
          <DashboardView
            leads={filteredLeads}
            clients={filteredClients}
            appointments={filteredAppointments}
            tasks={filteredTasks}
            generatedAt={data.generatedAt}
            onOpenLead={openLead}
            onNavigate={navigate}
          />
        )}
        {view === "leads" && (
          <LeadsView
            leads={filteredLeads}
            onOpenLead={openLead}
            onAddLead={() => setModal("lead")}
          />
        )}
        {view === "pipeline" && (
          <PipelineView
            leads={filteredLeads}
            stages={data.stages}
            mutate={mutate}
            onOpenLead={openLead}
          />
        )}
        {view === "contacts" && (
          <FoundationContactsView
            contacts={filteredContacts}
            clients={data.clients}
            onAddContact={() => setModal("contact")}
            onImportContacts={() => setModal("contact-import")}
            canImport={data.viewer.permissions.includes("contacts.import")}
          />
        )}
        {view === "companies" && (
          <CompaniesView
            companies={filteredCompanies}
            clients={data.clients}
            contacts={filteredContacts}
            mutate={mutate}
            onAddCompany={() => setModal("company")}
          />
        )}
        {view === "calendar" && (
          <CalendarView
            appointments={filteredAppointments}
            mutate={mutate}
            onAddAppointment={() => setModal("appointment")}
          />
        )}
        {view === "tasks" && (
          <TasksView
            tasks={filteredTasks}
            clients={data.clients}
            mutate={mutate}
            onAddTask={() => setModal("task")}
          />
        )}
        {view === "clients" && data.viewer.isAgency && (
          <ClientsView
            clients={data.clients}
            leads={data.leads}
            onAddClient={() => setModal("client")}
            mutate={mutate}
          />
        )}
        {view === "reports" && (
          <ReportsView leads={filteredLeads} clients={filteredClients} />
        )}
        {view === "websites" && (
          <WebsitesView
            websites={filteredWebsites}
            clients={data.clients}
            leads={filteredLeads}
            mutate={mutate}
            canManage={data.viewer.permissions.includes("websites.manage")}
          />
        )}
        {view === "profiles" && (
          <GoogleProfilesView
            clients={data.clients}
            profiles={data.googleProfiles}
            selectedClientId={selectedClientId}
            mutate={mutate}
            runtime={data.googleProfileRuntime}
            canManage={data.viewer.permissions.includes("profiles.manage")}
            canConnect={data.viewer.permissions.includes("profiles.connect")}
          />
        )}
        {view === "reviews" && (
          <ReviewsView
            clients={data.clients}
            contacts={data.contacts}
            phoneConfigs={data.phoneConfigs}
            googleProfiles={data.googleProfiles}
            reviewRequests={data.reviewRequests}
            reviewSettings={data.reviewSettings}
            connections={data.providerConnections}
            selectedClientId={selectedClientId}
            mutate={mutate}
            canReply={data.viewer.permissions.includes("reviews.reply")}
            canRequest={data.viewer.permissions.includes("reviews.request")}
            canManage={data.viewer.permissions.includes(
              "reviews.settings.manage",
            )}
            canManageGoogle={data.viewer.permissions.includes(
              "profiles.manage",
            )}
            canManageConnections={data.viewer.permissions.includes(
              "phone_system.manage",
            )}
            onOpenGoogleProfiles={openGoogleProfiles}
            onOpenConnections={openConnections}
          />
        )}
        {view === "connections" && (
          <ConnectionsView
            clients={data.clients}
            connections={data.providerConnections}
            selectedClientId={selectedClientId}
            mutate={mutate}
            canReadSharedBilling={data.viewer.permissions.includes(
              "billing.read_shared",
            )}
          />
        )}
        {view === "phone-system" && (
          <PhoneSystemView
            clients={data.clients}
            configs={data.phoneConfigs}
            connections={data.providerConnections}
            selectedClientId={selectedClientId}
            mutate={mutate}
            canManage={data.viewer.permissions.includes("phone_system.manage")}
            onOpenConnections={openConnections}
          />
        )}
        {view === "conversations" && (
          <ConversationsView
            clients={data.clients}
            conversations={data.conversations}
            messages={data.messages}
            calls={data.phoneCalls}
            selectedClientId={selectedClientId}
            mutate={mutate}
          />
        )}
        {view === "automations" && (
          <VisualAutomationsView
            clients={data.clients}
            connections={data.providerConnections}
            workflows={data.workflows}
            runs={data.workflowRuns}
            stages={data.stages}
            selectedClientId={selectedClientId}
            mutate={mutate}
            onOpenConnections={openConnections}
          />
        )}
        {futureModules.includes(view as FutureModule) && (
          <FutureModuleView module={view as FutureModule} />
        )}
        {view === "custom-data" &&
          data.viewer.permissions.includes("custom_data.manage") && (
            <CustomDataView
              clients={data.clients}
              contacts={filteredContacts}
              companies={filteredCompanies}
              leads={filteredLeads}
              fields={filteredCustomFields}
              fieldValues={filteredCustomFieldValues}
              customValues={filteredCustomValues}
              featureFlags={filteredFeatureFlags}
              mutate={mutate}
              onAddField={() => setModal("custom-field")}
              onAddValue={() => setModal("custom-value")}
            />
          )}
        {view === "audit" && data.viewer.permissions.includes("audit.read") && (
          <AuditLogView logs={data.auditLogs} />
        )}
        {view === "team" && data.viewer.isAgency && (
          <TeamView team={data.team} onInvite={() => setModal("invite")} />
        )}
        {view === "settings" && data.viewer.isAgency && (
          <SettingsView
            organizationName={data.organization.name}
            viewerRole={data.viewer.role}
            clients={data.clients}
          />
        )}
      </main>

      {selectedLead ? (
        <LeadDetail
          lead={selectedLead}
          stages={data.stages}
          notes={data.notes}
          activities={data.activities}
          tasks={data.tasks}
          appointments={data.appointments}
          mutate={mutate}
          onClose={() => setSelectedLeadId(null)}
        />
      ) : null}
      {modal === "lead" && (
        <AddLeadModal
          clients={data.clients}
          mutate={mutate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "contact" && (
        <AddContactModal
          clients={data.clients}
          mutate={mutate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "contact-import" && (
        <ContactImportModal
          clients={data.clients}
          mutate={mutate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "company" && (
        <AddCompanyModal
          clients={data.clients}
          mutate={mutate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "custom-field" && (
        <AddCustomFieldModal
          clients={data.clients}
          mutate={mutate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "custom-value" && (
        <AddCustomValueModal
          clients={data.clients}
          mutate={mutate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "task" && (
        <AddTaskModal
          clients={data.clients}
          leads={data.leads}
          mutate={mutate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "appointment" && (
        <AddAppointmentModal
          clients={data.clients}
          contacts={data.contacts}
          leads={data.leads}
          mutate={mutate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "client" && (
        <AddClientModal mutate={mutate} onClose={() => setModal(null)} />
      )}
      {modal === "invite" && (
        <InviteMemberModal mutate={mutate} onClose={() => setModal(null)} />
      )}
      {modal === "search" && (
        <Modal
          title="Search Brizuela Leads"
          eyebrow="COMMAND MENU"
          onClose={() => {
            setModal(null);
            setSearch("");
          }}
        >
          <div className="crm-command">
            <label>
              <span>⌕</span>
              <input
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search leads, contacts, companies, or clients"
              />
            </label>
            <div>
              {searchResults.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  onClick={() => {
                    setModal(null);
                    setSearch("");
                    if (result.lead) openLead(result.lead);
                    else
                      navigate(
                        result.type === "Client"
                          ? "clients"
                          : result.type === "Company"
                            ? "companies"
                            : "contacts",
                      );
                  }}
                >
                  <Badge tone="neutral">{result.type}</Badge>
                  <span>
                    <strong>{result.title}</strong>
                    <small>{result.detail}</small>
                  </span>
                </button>
              ))}
              {search && !searchResults.length ? (
                <p>No matching records.</p>
              ) : !search ? (
                <p>Start typing to search the protected workspace.</p>
              ) : null}
            </div>
          </div>
        </Modal>
      )}
      {toast ? (
        <div className="crm-toast" role="status">
          ✓ {toast}
        </div>
      ) : null}
      {error ? (
        <div className="crm-error-toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      ) : null}
      {busy ? <div className="crm-busy" aria-hidden="true" /> : null}
    </div>
  );
}
