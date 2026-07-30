"use client";

import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  ContactRound,
  CreditCard,
  Database,
  FileText,
  Funnel,
  Globe2,
  History,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Menu,
  MessageSquareText,
  PhoneCall,
  Plug,
  Settings as SettingsIcon,
  Sparkles,
  Star,
  UserRoundSearch,
  UsersRound,
  Workflow,
} from "lucide-react";
import type { CrmBootstrap, CrmLead, CrmPermission, CrmRole } from "../db/crm";
import type { CrmTheme } from "../db/theme";
import { CRM_THEMES } from "../db/theme";
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
import { PaymentsView } from "./crm/PaymentsView";
import { ReviewsView } from "./crm/ReviewsView";
import { AiConnectorView } from "./crm/AiConnectorView";
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
  | "payments"
  | "connections"
  | "phone-system"
  | "ai"
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
  "funnels",
];

const nav: Array<{
  id: View;
  label: string;
  icon: ReactNode;
  agencyOnly?: boolean;
  permission?: CrmPermission;
  section?: string;
  preview?: boolean;
}> = [
  // Every item carries an explicit section so hiding agency-only tabs can never
  // orphan a section label onto an unrelated item below it.
  // agencyOnly marks the tabs a client user must never see; their underlying
  // permissions are withheld from client roles too, so this is defence in depth
  // rather than the only gate.
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard />, section: "MAIN" },
  { id: "leads", label: "Leads", icon: <UserRoundSearch />, section: "MAIN" },
  { id: "contacts", label: "Contacts", icon: <ContactRound />, section: "MAIN" },
  {
    id: "companies",
    label: "Companies",
    icon: <Building2 />,
    section: "MAIN",
    permission: "companies.write",
  },
  { id: "calendar", label: "Calendar", icon: <CalendarDays />, section: "MAIN" },
  { id: "tasks", label: "Tasks", icon: <ListChecks />, section: "MAIN" },
  {
    id: "conversations",
    label: "Conversations",
    icon: <MessageSquareText />,
    section: "COMMUNICATIONS",
    permission: "messages.write",
  },
  {
    id: "connections",
    label: "Connections",
    icon: <Plug />,
    section: "COMMUNICATIONS",
    agencyOnly: true,
    permission: "phone_system.manage",
  },
  {
    id: "phone-system",
    label: "Phone & Texting",
    icon: <PhoneCall />,
    section: "COMMUNICATIONS",
    agencyOnly: true,
    permission: "phone_system.manage",
  },
  {
    id: "automations",
    label: "Automations",
    icon: <Workflow />,
    section: "COMMUNICATIONS",
    agencyOnly: true,
    permission: "automations.manage",
  },
  { id: "websites", label: "Websites", icon: <Globe2 />, section: "GROWTH" },
  {
    id: "reviews",
    label: "Reviews",
    icon: <Star />,
    section: "GROWTH",
    permission: "reviews.read",
  },
  {
    id: "profiles",
    label: "Google Profiles",
    icon: <MapPin />,
    section: "GROWTH",
    agencyOnly: true,
    permission: "profiles.manage",
  },
  {
    id: "forms",
    label: "Forms",
    icon: <FileText />,
    section: "GROWTH",
    agencyOnly: true,
    preview: true,
  },
  {
    id: "funnels",
    label: "Funnels",
    icon: <Funnel />,
    section: "GROWTH",
    agencyOnly: true,
    preview: true,
  },
  { id: "reports", label: "Reports", icon: <ChartNoAxesCombined />, section: "BUSINESS", permission: "reports.read" },
  {
    id: "payments",
    label: "Payments",
    icon: <CreditCard />,
    section: "BUSINESS",
    agencyOnly: true,
    permission: "payments.manage",
  },
  {
    id: "clients",
    label: "Sub-accounts",
    icon: <BriefcaseBusiness />,
    section: "BUSINESS",
    agencyOnly: true,
    permission: "clients.manage",
  },
  // Client owners manage their own staff here; the server restricts them to
  // client roles inside their own sub-account.
  { id: "team", label: "Team", icon: <UsersRound />, section: "BUSINESS", permission: "team.manage" },
  {
    id: "ai",
    label: "AI Connector",
    icon: <Sparkles />,
    section: "TOOLS",
    agencyOnly: true,
    permission: "ai_connector.manage",
  },
  {
    id: "custom-data",
    label: "Custom data",
    icon: <Database />,
    section: "TOOLS",
    agencyOnly: true,
    permission: "custom_data.manage",
  },
  {
    id: "audit",
    label: "Audit log",
    icon: <History />,
    section: "TOOLS",
    agencyOnly: true,
    permission: "audit.read",
  },
  { id: "settings", label: "Settings", icon: <SettingsIcon />, section: "TOOLS", agencyOnly: true, permission: "feature_flags.manage" },
];

const viewChangeEvent = "brizuela:crm-view-change";
const nestedViews: View[] = ["pipeline"];

function roleLabel(role: CrmRole) {
  const labels: Record<CrmRole, string> = {
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

function readViewFromLocation(): View {
  const requested = new URLSearchParams(window.location.search).get(
    "view",
  ) as View | null;
  return requested &&
    (nav.some((item) => item.id === requested) ||
      nestedViews.includes(requested))
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
    initialData.viewer.clientId ??
      (initialData.viewer.canViewAllClients
        ? "all"
        : initialData.clients[0]?.id ?? ""),
  );
  const [range, setRange] = useState("30");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalName>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  // Optimistic theme: apply instantly, persist through the CRM action, and
  // fall back to the server value once the bootstrap refresh lands.
  const [themeOverride, setThemeOverride] = useState<CrmTheme | null>(null);
  const theme: CrmTheme = themeOverride ?? data.viewer.theme ?? "classic";
  // Workspace switcher: agency users pick which sub-account they are managing.
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const firstVisibleClientId = data.clients[0]?.id ?? "";
  const effectiveSelectedClientId = data.viewer.isAgency
    ? data.viewer.canViewAllClients
      ? selectedClientId
      : data.clients.some((client) => client.id === selectedClientId)
        ? selectedClientId
        : firstVisibleClientId
    : data.viewer.clientId;

  const visibleNav = nav.filter(
    (item) =>
      (!item.agencyOnly || data.viewer.isAgency) &&
      (!item.permission || data.viewer.permissions.includes(item.permission)),
  );
  const scopedClient = data.clients.find(
    (client) => client.id === effectiveSelectedClientId,
  );
  const workspaceName = scopedClient?.businessName ?? data.organization.name;
  const view =
    requestedView === "pipeline" &&
    visibleNav.some((item) => item.id === "leads")
      ? requestedView
      : visibleNav.some((item) => item.id === requestedView)
        ? requestedView
        : "dashboard";
  const title =
    view === "pipeline"
      ? "Leads"
      : visibleNav.find((item) => item.id === view)?.label ?? "Dashboard";

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
        setSwitcherOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!switcherOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!switcherRef.current?.contains(event.target as Node))
        setSwitcherOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [switcherOpen]);

  useEffect(() => {
    if (!data.viewer.isAgency) {
      if (selectedClientId !== data.viewer.clientId) {
        // Keep client sessions pinned even if a stale agency query is present.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedClientId(data.viewer.clientId ?? "");
      }
      return;
    }

    if (!data.viewer.canViewAllClients) {
      const nextClientId = data.clients.some(
        (client) => client.id === selectedClientId,
      )
        ? selectedClientId
        : data.clients[0]?.id ?? "";
      if (selectedClientId !== nextClientId) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedClientId(nextClientId);
      }
      const url = new URL(window.location.href);
      if (nextClientId) url.searchParams.set("client", nextClientId);
      else url.searchParams.delete("client");
      window.history.replaceState({}, "", url);
      return;
    }

    const url = new URL(window.location.href);
    if (selectedClientId !== "all")
      url.searchParams.set("client", selectedClientId);
    else url.searchParams.delete("client");
    window.history.replaceState({}, "", url);
  }, [
    data.clients,
    data.viewer.canViewAllClients,
    data.viewer.clientId,
    data.viewer.isAgency,
    selectedClientId,
  ]);

  useEffect(() => {
    window.dispatchEvent(new Event(viewChangeEvent));
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      const requestedClient = query.get("client");
      if (
        initialData.viewer.isAgency &&
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
      } else if (query.get("connected") === "stripe") {
        setToast(
          "Stripe connected. The business keeps ownership, billing, and payouts.",
        );
        window.setTimeout(() => setToast(""), 5000);
      } else if (query.get("connected") === "google_calendar") {
        setToast(
          "Google Calendar linked. BrizBuilder appointments will sync automatically.",
        );
        window.setTimeout(() => setToast(""), 5000);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialData.clients, initialData.viewer.isAgency]);

  const workspaceLeads = useMemo(
    () =>
      data.leads.filter(
        (lead) =>
          effectiveSelectedClientId === "all" ||
          lead.clientId === effectiveSelectedClientId,
      ),
    [data.leads, effectiveSelectedClientId],
  );
  const filteredLeads = useMemo(() => {
    const cutoff =
      range === "all"
        ? null
        : new Date(
            new Date(data.generatedAt).getTime() - Number(range) * 86400000,
          );
    return workspaceLeads.filter(
      (lead) =>
        !cutoff ||
          new Date(
            lead.createdAt.includes("T")
              ? lead.createdAt
              : `${lead.createdAt.replace(" ", "T")}Z`,
          ) >= cutoff,
    );
  }, [data.generatedAt, range, workspaceLeads]);
  const filteredContacts = data.contacts.filter(
    (contact) =>
      effectiveSelectedClientId === "all" ||
      contact.clientId === effectiveSelectedClientId,
  );
  const filteredCompanies = data.companies.filter(
    (company) =>
      effectiveSelectedClientId === "all" ||
      company.clientId === effectiveSelectedClientId,
  );
  const filteredWebsites = data.websites.filter(
    (website) =>
      effectiveSelectedClientId === "all" ||
      website.clientId === effectiveSelectedClientId,
  );
  const filteredCustomFields = data.customFields.filter(
    (field) =>
      effectiveSelectedClientId === "all" ||
      field.clientId === effectiveSelectedClientId,
  );
  const filteredCustomFieldValues = data.customFieldValues.filter(
    (value) =>
      effectiveSelectedClientId === "all" ||
      value.clientId === effectiveSelectedClientId,
  );
  const filteredCustomValues = data.customValues.filter(
    (value) =>
      effectiveSelectedClientId === "all" ||
      value.clientId === effectiveSelectedClientId,
  );
  const filteredFeatureFlags = data.featureFlags.filter(
    (flag) =>
      effectiveSelectedClientId === "all" ||
      flag.clientId === null ||
      flag.clientId === effectiveSelectedClientId,
  );
  const filteredTasks = data.tasks.filter(
    (task) =>
      effectiveSelectedClientId === "all" ||
      task.clientId === effectiveSelectedClientId,
  );
  const filteredAppointments = data.appointments.filter(
    (appointment) =>
      effectiveSelectedClientId === "all" ||
      appointment.clientId === effectiveSelectedClientId,
  );
  const filteredConversations = data.conversations.filter(
    (conversation) =>
      effectiveSelectedClientId === "all" ||
      conversation.clientId === effectiveSelectedClientId,
  );
  const filteredMessages = data.messages.filter(
    (message) =>
      effectiveSelectedClientId === "all" ||
      message.clientId === effectiveSelectedClientId,
  );
  const filteredClients = data.clients.filter(
    (client) =>
      effectiveSelectedClientId === "all" ||
      client.id === effectiveSelectedClientId,
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

  async function changeOwnPassword() {
    const password = window.prompt(
      "Choose a new password for your own account (at least 12 characters):",
    );
    if (!password) return;
    try {
      await mutate({ action: "change_own_password", password }, "Password changed.");
    } catch {
      // mutate surfaces the error banner already.
    }
  }

  async function switchTheme(next: CrmTheme) {
    if (next === theme) return;
    setThemeOverride(next);
    try {
      await mutate({ action: "set_theme", theme: next }, "Theme updated.");
    } catch {
      // mutate already refreshed and surfaced the error; the override clear
      // below reverts the UI to the server's stored theme.
    } finally {
      setThemeOverride(null);
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

  function openAiConnector(clientId: string) {
    setSelectedClientId(clientId);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "ai");
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

  const openTaskCount = filteredTasks.filter(
    (task) => !["COMPLETED", "CANCELED"].includes(task.status),
  ).length;
  const topbarDetail =
    view === "leads"
      ? `${filteredLeads.length} ${filteredLeads.length === 1 ? "lead" : "leads"}`
      : view === "pipeline"
        ? `${workspaceLeads.length} ${workspaceLeads.length === 1 ? "lead" : "leads"}`
      : view === "contacts"
        ? `${filteredContacts.length} ${filteredContacts.length === 1 ? "contact" : "contacts"}`
        : view === "companies"
          ? `${filteredCompanies.length} ${filteredCompanies.length === 1 ? "company" : "companies"}`
          : view === "calendar"
            ? `${filteredAppointments.length} ${filteredAppointments.length === 1 ? "appointment" : "appointments"}`
            : view === "tasks"
              ? `${openTaskCount} open`
              : view === "clients"
                ? `${data.clients.length} ${data.clients.length === 1 ? "sub-account" : "sub-accounts"}`
                : view === "team"
                  ? `${data.team.length} ${data.team.length === 1 ? "team member" : "team members"}`
                  : null;
  const showRangeFilter = ["dashboard", "leads", "reports"].includes(
    view,
  );

  return (
    <div className="crm-shell" data-theme={theme === "classic" ? undefined : theme}>
      <aside className={`crm-sidebar ${mobileNav ? "crm-sidebar-open" : ""}`}>
        <div className="crm-brand">
          <button
            type="button"
            className="crm-brand-home"
            onClick={() => navigate("dashboard")}
            aria-label="Open BrizBuilder dashboard"
          >
            <strong>BrizBuilder</strong>
          </button>
          <button
            type="button"
            className="crm-sidebar-close"
            onClick={() => setMobileNav(false)}
            aria-label="Close navigation"
          >
            ×
          </button>
        </div>
        <div className="crm-org-switcher" ref={switcherRef}>
          {data.viewer.isAgency ? (
            <>
              <button
                type="button"
                className="crm-org-card crm-org-card-button"
                aria-haspopup="listbox"
                aria-expanded={switcherOpen}
                onClick={() => setSwitcherOpen((open) => !open)}
              >
                <span>{initials(workspaceName)}</span>
                <div>
                  <strong>{workspaceName}</strong>
                  <small>
                    {scopedClient ? "Managing sub-account" : "LB Marketing"}
                  </small>
                </div>
                <b aria-hidden="true">⌄</b>
              </button>
              {switcherOpen ? (
                <div className="crm-org-menu" role="listbox" aria-label="Choose workspace">
                  {data.viewer.canViewAllClients ? (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selectedClientId === "all"}
                      className={selectedClientId === "all" ? "active" : ""}
                      onClick={() => {
                        setSelectedClientId("all");
                        setSwitcherOpen(false);
                      }}
                    >
                      <strong>All sub-accounts</strong>
                      <small>Every sub-account</small>
                    </button>
                  ) : null}
                  {data.clients.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      role="option"
                      aria-selected={selectedClientId === client.id}
                      className={selectedClientId === client.id ? "active" : ""}
                      onClick={() => {
                        setSelectedClientId(client.id);
                        setSwitcherOpen(false);
                      }}
                    >
                      <strong>{client.businessName}</strong>
                      <small>{client.industry || "Sub-account"}</small>
                    </button>
                  ))}
                  {!data.clients.length ? (
                    <p>No sub-accounts yet. Add one from the Sub-accounts tab.</p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="crm-org-card">
              <span>{initials(workspaceName)}</span>
              <div>
                <strong>{workspaceName}</strong>
                <small>Client workspace</small>
              </div>
            </div>
          )}
        </div>
        <nav className="crm-primary-nav" aria-label="Main navigation">
          {visibleNav.map((item, index) => (
            <div className="crm-nav-item" key={item.id}>
              {item.section &&
              (index === 0 ||
                visibleNav[index - 1]?.section !== item.section) ? (
                <p className="crm-nav-section">{item.section}</p>
              ) : null}
              <button
                className={
                  view === item.id ||
                  (item.id === "leads" && view === "pipeline")
                    ? "active"
                    : ""
                }
                onClick={() => navigate(item.id)}
                aria-current={
                  view === item.id ||
                  (item.id === "leads" && view === "pipeline")
                    ? "page"
                    : undefined
                }
              >
                <i aria-hidden="true">{item.icon}</i>
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
        <div className="crm-theme-picker">
          <label htmlFor="crm-theme">Appearance</label>
          <select
            id="crm-theme"
            value={theme}
            onChange={(event) =>
              void switchTheme(event.target.value as CrmTheme)
            }
          >
            {CRM_THEMES.map((option) => (
              <option key={option} value={option}>
                {option === "cyberpunk"
                  ? "Cyber"
                  : option === "midnight"
                    ? "Midnight"
                    : "Classic"}
              </option>
            ))}
          </select>
        </div>
        <div className="crm-sidebar-foot">
          <div className="crm-user-summary">
            <span className="crm-avatar">{initials(data.viewer.name)}</span>
            <p>
              <strong>{data.viewer.name}</strong>
              <small>{roleLabel(data.viewer.role)}</small>
            </p>
          </div>
          <div className="crm-sidebar-foot-actions">
            <button
              type="button"
              onClick={() => void changeOwnPassword()}
              aria-label="Change password"
              title="Change password"
            >
              Key
            </button>
            {/* POST so a prefetch or stray link can never sign someone out. */}
            <form method="post" action={signOutPath}>
              <button type="submit" aria-label="Sign out" title="Sign out">
                Exit
              </button>
            </form>
          </div>
        </div>
      </aside>
      {mobileNav ? (
        <button
          className="crm-nav-scrim"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        />
      ) : null}

      <main className={`crm-main crm-main-${view}`}>
        <header className={`crm-topbar crm-topbar-${view}`}>
          <div className="crm-topbar-title">
            <button
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              ☰
            </button>
            <div>
              <h1>{title}</h1>
              <span>{topbarDetail ?? workspaceName}</span>
            </div>
          </div>
          <div className="crm-topbar-filters crm-topbar-actions">
            {showRangeFilter ? (
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
            {view === "contacts" &&
            data.viewer.permissions.includes("contacts.import") ? (
              <button
                type="button"
                className="crm-topbar-action"
                onClick={() => setModal("contact-import")}
              >
                Import
              </button>
            ) : null}
            {["dashboard", "leads", "pipeline"].includes(view) ? (
              <button
                type="button"
                className="crm-topbar-action crm-topbar-action-primary"
                onClick={() => setModal("lead")}
              >
                + Add lead
              </button>
            ) : null}
            {view === "contacts" ? (
              <button
                type="button"
                className="crm-topbar-action crm-topbar-action-primary"
                onClick={() => setModal("contact")}
              >
                + Add contact
              </button>
            ) : null}
            {view === "companies" ? (
              <button
                type="button"
                className="crm-topbar-action crm-topbar-action-primary"
                onClick={() => setModal("company")}
              >
                + Add company
              </button>
            ) : null}
            {view === "calendar" ? (
              <button
                type="button"
                className="crm-topbar-action crm-topbar-action-primary"
                onClick={() => setModal("appointment")}
              >
                + New appointment
              </button>
            ) : null}
            {view === "tasks" ? (
              <button
                type="button"
                className="crm-topbar-action crm-topbar-action-primary"
                onClick={() => setModal("task")}
              >
                + New task
              </button>
            ) : null}
            {view === "clients" && data.viewer.isAgency ? (
              <button
                type="button"
                className="crm-topbar-action crm-topbar-action-primary"
                onClick={() => setModal("client")}
              >
                + Add sub-account
              </button>
            ) : null}
            {view === "team" &&
            data.viewer.permissions.includes("team.manage") ? (
              <button
                type="button"
                className="crm-topbar-action crm-topbar-action-primary"
                onClick={() => setModal("invite")}
              >
                + Invite
              </button>
            ) : null}
            {["phone-system", "automations", "payments", "ai"].includes(view) &&
            visibleNav.some((item) => item.id === "connections") ? (
              <button
                type="button"
                className="crm-topbar-action"
                onClick={() => navigate("connections")}
              >
                Connections
              </button>
            ) : null}
            {view === "reviews" &&
            visibleNav.some((item) => item.id === "profiles") ? (
              <button
                type="button"
                className="crm-topbar-action"
                onClick={() => navigate("profiles")}
              >
                Google Profiles
              </button>
            ) : null}
            <button
              className="crm-command-button"
              type="button"
              onClick={() => setModal("search")}
              aria-label="Search workspace"
            >
              <span>⌕ Search</span>
              <kbd>Ctrl K</kbd>
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
          {showRangeFilter ? (
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
        {view === "dashboard" && (
          <DashboardView
            leads={filteredLeads}
            pipelineLeads={workspaceLeads}
            clients={filteredClients}
            appointments={filteredAppointments}
            tasks={filteredTasks}
            stages={data.stages}
            conversations={filteredConversations}
            messages={filteredMessages}
            generatedAt={data.generatedAt}
            canViewConversations={data.viewer.permissions.includes(
              "messages.write",
            )}
            onOpenLead={openLead}
            onNavigate={navigate}
          />
        )}
        {view === "leads" && (
          <LeadsView
            leads={filteredLeads}
            onOpenLead={openLead}
            onAddLead={() => setModal("lead")}
            mutate={mutate}
            onShowPipeline={() => navigate("pipeline")}
          />
        )}
        {view === "pipeline" && (
          <PipelineView
            leads={workspaceLeads}
            stages={data.stages}
            mutate={mutate}
            onOpenLead={openLead}
            onShowList={() => navigate("leads")}
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
            selectedClientId={
              effectiveSelectedClientId === "all"
                ? null
                : effectiveSelectedClientId
            }
            clients={data.clients}
            googleCalendarConnections={data.providerConnections.filter(
              (connection) => connection.provider === "google_calendar",
            )}
            googleCalendarConfigured={
              data.googleProfileRuntime.configured
            }
            canConnectGoogleCalendar={data.viewer.permissions.includes(
              "calendar.connect",
            )}
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
            onDeleted={() => setSelectedClientId("all")}
            mutate={mutate}
            canDelete={data.viewer.permissions.includes("clients.delete")}
            adminEmail={data.viewer.email}
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
            selectedClientId={effectiveSelectedClientId ?? ""}
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
            selectedClientId={effectiveSelectedClientId ?? ""}
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
        {view === "payments" && (
          <PaymentsView
            clients={data.clients}
            connections={data.providerConnections}
            selectedClientId={effectiveSelectedClientId ?? ""}
            viewerRole={data.viewer.role}
            mutate={mutate}
          />
        )}
        {view === "connections" && (
          <ConnectionsView
            clients={data.clients}
            connections={data.providerConnections}
            aiAuthorizations={data.aiAuthorizations}
            selectedClientId={effectiveSelectedClientId ?? ""}
            mutate={mutate}
            canReadSharedBilling={data.viewer.permissions.includes(
              "billing.read_shared",
            )}
            onOpenAiConnector={openAiConnector}
          />
        )}
        {view === "phone-system" && (
          <PhoneSystemView
            clients={data.clients}
            configs={data.phoneConfigs}
            connections={data.providerConnections}
            selectedClientId={effectiveSelectedClientId ?? ""}
            mutate={mutate}
            canManage={data.viewer.permissions.includes("phone_system.manage")}
            onOpenConnections={openConnections}
          />
        )}
        {view === "conversations" && (
          <ConversationsView
            clients={data.clients}
            contacts={filteredContacts}
            connections={data.providerConnections}
            conversations={data.conversations}
            messages={data.messages}
            calls={data.phoneCalls}
            selectedClientId={effectiveSelectedClientId ?? ""}
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
            selectedClientId={effectiveSelectedClientId ?? ""}
            mutate={mutate}
            onOpenConnections={openConnections}
          />
        )}
        {view === "ai" &&
          data.viewer.permissions.includes("ai_connector.manage") && (
            <AiConnectorView
              clients={data.clients}
              authorizations={data.aiAuthorizations}
              activities={data.aiActivities}
              runtime={data.aiConnectorRuntime}
              selectedClientId={effectiveSelectedClientId ?? ""}
              mutate={mutate}
              canManage={data.viewer.permissions.includes(
                "ai_connector.manage",
              )}
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
        {view === "team" && data.viewer.permissions.includes("team.manage") && (
          <TeamView team={data.team} onInvite={() => setModal("invite")} mutate={mutate} />
        )}
        {view === "settings" && data.viewer.isAgency && (
          <SettingsView
            organizationName={data.organization.name}
            viewerRole={data.viewer.role}
            clients={data.clients}
          />
        )}
      </main>

      <nav className="crm-mobile-dock" aria-label="Mobile quick navigation">
        <button
          type="button"
          className={view === "dashboard" ? "active" : ""}
          onClick={() => navigate("dashboard")}
        >
          <LayoutDashboard aria-hidden="true" />
          Dashboard
        </button>
        <button
          type="button"
          className={["leads", "pipeline"].includes(view) ? "active" : ""}
          onClick={() => navigate("leads")}
        >
          <UserRoundSearch aria-hidden="true" />
          Leads
        </button>
        {visibleNav.some((item) => item.id === "conversations") ? (
          <button
            type="button"
            className={view === "conversations" ? "active" : ""}
            onClick={() => navigate("conversations")}
          >
            <MessageSquareText aria-hidden="true" />
            Conversations
          </button>
        ) : null}
        <button
          type="button"
          className={view === "calendar" ? "active" : ""}
          onClick={() => navigate("calendar")}
        >
          <CalendarDays aria-hidden="true" />
          Calendar
        </button>
        <button
          type="button"
          className={mobileNav ? "active" : ""}
          aria-expanded={mobileNav}
          onClick={() => setMobileNav(true)}
        >
          <Menu aria-hidden="true" />
          More
        </button>
      </nav>

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
          clients={filteredClients}
          mutate={async (input, success) => {
            const result = await mutate(input, success);
            // Show the new lead even if it created/used a different business.
            setSelectedClientId(data.viewer.isAgency ? "all" : data.viewer.clientId ?? "");
            return result;
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "contact" && (
        <AddContactModal
          clients={filteredClients}
          mutate={mutate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "contact-import" && (
        <ContactImportModal
          clients={filteredClients}
          mutate={mutate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "company" && (
        <AddCompanyModal
          clients={filteredClients}
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
          clients={filteredClients}
          leads={filteredLeads}
          mutate={mutate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "appointment" && (
        <AddAppointmentModal
          clients={filteredClients}
          contacts={filteredContacts}
          leads={filteredLeads}
          mutate={mutate}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "client" && (
        <AddClientModal mutate={mutate} onClose={() => setModal(null)} />
      )}
      {modal === "invite" && (
        <InviteMemberModal clients={filteredClients} isAgency={data.viewer.isAgency} viewerRole={data.viewer.role} mutate={mutate} onClose={() => setModal(null)} />
      )}
      {modal === "search" && (
        <Modal
          title="Search BrizBuilder"
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
