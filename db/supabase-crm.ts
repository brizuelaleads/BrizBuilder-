import type { ChatGPTUser } from "../app/chatgpt-auth";
import { MAIN_ADMIN_EMAIL } from "../app/auth-config";
import { getSupabaseAdminClient } from "../lib/supabase/server";
import { getTwilioRuntimeStatus, sendTwilioMessage } from "../lib/twilio";
import type {
  CrmAction,
  CrmAppointment,
  CrmAuditLog,
  CrmBootstrap,
  CrmClient,
  CrmCompany,
  CrmContact,
  CrmFeatureFlag,
  CrmLead,
  CrmNote,
  CrmPermission,
  CrmRole,
  CrmStage,
  CrmTask,
  CrmWebsite,
  CrmPhoneConfig,
  CrmPhoneCall,
  CrmConversation,
  CrmMessage,
  CrmAutomationRule,
  CrmAutomationRun,
} from "./crm";

type TenantContext = {
  organizationId: string;
  organizationName: string;
  email: string;
  name: string;
  role: CrmRole;
  clientId: string | null;
};

// Supabase relation payloads are dynamic until generated database types are added.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PIPELINE_ID = "00000000-0000-4000-8000-000000000101";

const STAGES = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    name: "New",
    slug: "new",
    color: "#60a5fa",
    position: 1,
    is_won: false,
    is_lost: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000202",
    name: "Attempting Contact",
    slug: "attempting-contact",
    color: "#818cf8",
    position: 2,
    is_won: false,
    is_lost: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000203",
    name: "Contacted",
    slug: "contacted",
    color: "#f59e0b",
    position: 3,
    is_won: false,
    is_lost: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000204",
    name: "Qualified",
    slug: "qualified",
    color: "#a855f7",
    position: 4,
    is_won: false,
    is_lost: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000205",
    name: "Appointment Booked",
    slug: "appointment-booked",
    color: "#06b6d4",
    position: 5,
    is_won: false,
    is_lost: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000206",
    name: "Estimate Sent",
    slug: "estimate-sent",
    color: "#22c55e",
    position: 6,
    is_won: false,
    is_lost: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000207",
    name: "Won",
    slug: "won",
    color: "#16a34a",
    position: 7,
    is_won: true,
    is_lost: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000208",
    name: "Lost",
    slug: "lost",
    color: "#ef4444",
    position: 8,
    is_won: false,
    is_lost: true,
  },
];

const rolePermissions: Record<CrmRole, CrmPermission[]> = {
  SUPER_ADMIN: ["clients.manage", "contacts.write", "contacts.import", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "websites.manage", "phone_system.manage", "messages.write", "automations.manage", "custom_data.manage", "team.manage", "audit.read", "feature_flags.manage"],
  AGENCY_OWNER: ["clients.manage", "contacts.write", "contacts.import", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "websites.manage", "phone_system.manage", "messages.write", "automations.manage", "custom_data.manage", "team.manage", "audit.read", "feature_flags.manage"],
  AGENCY_ADMIN: ["clients.manage", "contacts.write", "contacts.import", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "websites.manage", "phone_system.manage", "messages.write", "automations.manage", "custom_data.manage", "team.manage", "audit.read", "feature_flags.manage"],
  AGENCY_MEMBER: ["contacts.write", "contacts.import", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "websites.manage", "messages.write"],
  CLIENT_OWNER: ["contacts.write", "contacts.import", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "websites.manage", "messages.write", "custom_data.manage"],
  CLIENT_MANAGER: ["contacts.write", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "websites.manage", "messages.write", "custom_data.manage"],
  CLIENT_EMPLOYEE: ["contacts.write", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "messages.write"],
};

function supabase() {
  return getSupabaseAdminClient();
}

function nullable(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function requireText(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim().slice(0, max);
}

function optionalText(value: unknown, max = 500): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, max);
}

function normalizeDomain(value: unknown): string {
  const raw = requireText(value, "Website domain", 240);
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url.hostname.includes(".")) throw new Error("invalid");
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    throw new Error("Enter a valid website domain, such as example.com.");
  }
}

function cents(value: unknown): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) throw new Error("Enter a valid amount.");
  return Math.round(amount);
}

function requirePermission(context: TenantContext, permission: CrmPermission) {
  if (!rolePermissions[context.role].includes(permission)) throw new Error("Forbidden");
}

function serviceAreas(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30);
  return [];
}

function tags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(/[;,]/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
  return [];
}

function phoneNumber(value: unknown, label: string, required = false): string | null {
  const text = optionalText(value, 30);
  if (!text) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  const normalized = text.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new Error(`${label} must include the country code, for example +13125550123.`);
  return normalized;
}

function nestedOne<T extends AnyRecord>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function assertOk<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

function requireRow<T>(row: T, message: string): NonNullable<T> {
  if (!row) throw new Error(message);
  return row as NonNullable<T>;
}

async function ensureSupabaseBaseline() {
  await assertOk(
    supabase().from("organizations").upsert(
      {
        id: ORGANIZATION_ID,
        name: "Brizuela Leads",
        slug: "brizuela-leads",
        status: "active",
      },
      { onConflict: "id" },
    ),
  );

  await assertOk(
    supabase().from("pipelines").upsert(
      {
        id: PIPELINE_ID,
        organization_id: ORGANIZATION_ID,
        client_id: null,
        name: "Default Service Pipeline",
        is_default: true,
      },
      { onConflict: "id" },
    ),
  );

  await assertOk(
    supabase().from("pipeline_stages").upsert(
      STAGES.map((stage) => ({
        ...stage,
        organization_id: ORGANIZATION_ID,
        pipeline_id: PIPELINE_ID,
      })),
      { onConflict: "id" },
    ),
  );
}

async function getTenantContext(user: ChatGPTUser): Promise<TenantContext> {
  await ensureSupabaseBaseline();
  const email = user.email.trim().toLowerCase();

  if (email === MAIN_ADMIN_EMAIL) {
    return {
      organizationId: ORGANIZATION_ID,
      organizationName: "Brizuela Leads",
      email,
      name: user.displayName,
      role: "AGENCY_OWNER",
      clientId: null,
    };
  }

  const profile = await assertOk(
    supabase()
      .from("profiles")
      .select("id,email,display_name,status")
      .eq("email", email)
      .eq("status", "active")
      .maybeSingle(),
  );
  if (!profile?.id) throw new Error("Forbidden");

  const agencyMembership = await assertOk(
    supabase()
      .from("organization_members")
      .select("role,organizations(id,name)")
      .eq("profile_id", profile.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  );
  if (agencyMembership?.role) {
    const organization = nestedOne(agencyMembership.organizations);
    return {
      organizationId: String(organization?.id ?? ORGANIZATION_ID),
      organizationName: String(organization?.name ?? "Brizuela Leads"),
      email,
      name: String(profile.display_name ?? user.displayName),
      role: String(agencyMembership.role) as CrmRole,
      clientId: null,
    };
  }

  const clientMembership = await assertOk(
    supabase()
      .from("client_members")
      .select("role,client_id,clients(id,business_name,organization_id,organizations(id,name))")
      .eq("profile_id", profile.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  );
  const client = nestedOne(clientMembership?.clients);
  if (!client?.id) throw new Error("Forbidden");
  const organization = nestedOne(client.organizations);

  return {
    organizationId: String(organization?.id ?? client.organization_id ?? ORGANIZATION_ID),
    organizationName: String(organization?.name ?? "Brizuela Leads"),
    email,
    name: String(profile.display_name ?? user.displayName),
    role: String(clientMembership?.role ?? "CLIENT_OWNER") as CrmRole,
    clientId: String(client.id),
  };
}

async function requireClient(context: TenantContext, clientId: string) {
  if (context.clientId && context.clientId !== clientId) throw new Error("Forbidden");
  const client = await assertOk(
    supabase()
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .eq("organization_id", context.organizationId)
      .neq("status", "archived")
      .maybeSingle(),
  );
  if (!client) throw new Error("Client not found.");
}

async function audit(context: TenantContext, action: string, recordType: string, recordId: string | null, metadata: Record<string, unknown> = {}, clientId: string | null = context.clientId) {
  await assertOk(
    supabase().from("audit_events").insert({
      organization_id: context.organizationId,
      client_id: clientId,
      actor_email: context.email,
      action,
      record_type: recordType,
      record_id: recordId,
      metadata,
    }),
  );
}

function mapClient(row: AnyRecord): CrmClient {
  return {
    id: String(row.id),
    businessName: String(row.business_name),
    industry: String(row.industry),
    website: nullable(row.website),
    phone: nullable(row.phone),
    email: nullable(row.email),
    address: nullable(row.address),
    city: String(row.city ?? ""),
    state: String(row.state ?? ""),
    zip: String(row.zip ?? ""),
    timeZone: String(row.time_zone ?? "America/Chicago"),
    status: String(row.status),
    monthlyAdBudgetCents: Number(row.monthly_ad_budget_cents ?? 0),
    assignedAccountManager: nullable(row.assigned_account_manager),
    serviceAreas: serviceAreas(row.service_areas),
    notes: String(row.notes ?? ""),
    createdAt: String(row.created_at),
  };
}

function mapContact(row: AnyRecord): CrmContact {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    firstName: String(row.first_name),
    lastName: String(row.last_name ?? ""),
    phone: nullable(row.phone),
    email: nullable(row.email),
    address: nullable(row.address),
    city: nullable(row.city),
    state: nullable(row.state),
    zip: nullable(row.zip),
    tags: tags(row.tags),
    marketingConsent: String(row.marketing_consent ?? "unknown"),
    lastInteractionAt: nullable(row.last_interaction_at),
    lifetimeValueCents: Number(row.lifetime_value_cents ?? 0),
    createdAt: String(row.created_at),
  };
}

function mapCompany(row: AnyRecord): CrmCompany {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    name: String(row.name),
    industry: nullable(row.industry),
    website: nullable(row.website),
    phone: nullable(row.phone),
    email: nullable(row.email),
    address: nullable(row.address),
    city: nullable(row.city),
    state: nullable(row.state),
    zip: nullable(row.zip),
    tags: tags(row.tags),
    notes: String(row.notes ?? ""),
    contactCount: 0,
    createdAt: String(row.created_at),
  };
}

function mapLead(row: AnyRecord): CrmLead {
  const contact = nestedOne(row.contacts) ?? {};
  const client = nestedOne(row.clients) ?? {};
  const stage = nestedOne(row.pipeline_stages) ?? {};
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    clientName: String(client.business_name ?? "Client"),
    contactId: String(row.contact_id ?? ""),
    firstName: String(contact.first_name ?? ""),
    lastName: String(contact.last_name ?? ""),
    phone: nullable(contact.phone),
    email: nullable(contact.email),
    address: nullable(contact.address),
    city: nullable(contact.city),
    state: nullable(contact.state),
    zip: nullable(contact.zip),
    stageId: String(row.stage_id ?? ""),
    stageName: String(stage.name ?? "New"),
    stageColor: String(stage.color ?? "#60a5fa"),
    serviceRequested: String(row.service_requested),
    message: String(row.message ?? ""),
    source: String(row.source ?? "Manual"),
    campaign: nullable(row.campaign),
    status: String(row.status ?? "NEW"),
    assignedUser: nullable(row.assigned_user),
    estimatedValueCents: Number(row.estimated_value_cents ?? 0),
    finalRevenueCents: Number(row.final_revenue_cents ?? 0),
    appointmentDate: nullable(row.appointment_date),
    leadScore: Number(row.lead_score ?? 50),
    tags: tags(row.tags),
    consentStatus: String(row.consent_status ?? "unknown"),
    lostReason: nullable(row.lost_reason),
    lastContactedAt: nullable(row.last_contacted_at),
    nextFollowUpAt: nullable(row.next_follow_up_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapWebsite(row: AnyRecord): CrmWebsite {
  const analytics = row.analytics && typeof row.analytics === "object" ? row.analytics as Record<string, unknown> : {};
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    name: String(row.name),
    domain: nullable(row.domain),
    status: String(row.status ?? "connected"),
    platform: String(analytics.platform ?? "other"),
    leadCaptureEnabled: analytics.leadCaptureEnabled !== false,
    lastLeadAt: nullable(analytics.lastLeadAt),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapPhoneConfig(row: AnyRecord): CrmPhoneConfig {
  return {
    id: String(row.id), clientId: String(row.client_id), provider: String(row.provider ?? "twilio"),
    phoneNumber: nullable(row.phone_number), forwardingNumber: nullable(row.forwarding_number),
    ringTimeoutSeconds: Number(row.ring_timeout_seconds ?? 20), voicemailEnabled: Boolean(row.voicemail_enabled),
    missedCallTextEnabled: Boolean(row.missed_call_text_enabled), missedCallMessage: String(row.missed_call_message ?? ""),
    cooldownMinutes: Number(row.cooldown_minutes ?? 20), providerStatus: String(row.provider_status ?? "not_configured"),
    a2pStatus: String(row.a2p_status ?? "not_started"), lastTestedAt: nullable(row.last_tested_at),
  };
}

function mapPhoneCall(row: AnyRecord): CrmPhoneCall {
  return { id: String(row.id), clientId: String(row.client_id), contactId: nullable(row.contact_id), fromNumber: String(row.from_number), toNumber: String(row.to_number), status: String(row.status), direction: String(row.direction), durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds), startedAt: String(row.started_at), missedCallTextSentAt: nullable(row.missed_call_text_sent_at) };
}

function mapConversation(row: AnyRecord): CrmConversation {
  const contact = nestedOne(row.contacts) ?? {};
  return { id: String(row.id), clientId: String(row.client_id), contactId: String(row.contact_id), contactName: `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || String(contact.phone ?? "Unknown contact"), contactPhone: nullable(contact.phone), status: String(row.status ?? "open"), unreadCount: Number(row.unread_count ?? 0), lastMessageAt: nullable(row.last_message_at) };
}

function mapMessage(row: AnyRecord): CrmMessage {
  return { id: String(row.id), clientId: String(row.client_id), conversationId: String(row.conversation_id), contactId: String(row.contact_id), direction: String(row.direction), body: String(row.body), status: String(row.status), automationKey: nullable(row.automation_key), createdAt: String(row.created_at) };
}

function mapAutomationRule(row: AnyRecord): CrmAutomationRule {
  return { id: String(row.id), clientId: String(row.client_id), name: String(row.name), triggerKey: String(row.trigger_key), enabled: Boolean(row.enabled), config: row.config && typeof row.config === "object" ? row.config : {}, updatedAt: String(row.updated_at) };
}

function mapAutomationRun(row: AnyRecord): CrmAutomationRun {
  return { id: String(row.id), clientId: String(row.client_id), ruleId: nullable(row.rule_id), triggerEventId: String(row.trigger_event_id), status: String(row.status), error: nullable(row.error), startedAt: String(row.started_at), completedAt: nullable(row.completed_at) };
}

export async function getSupabaseCrmBootstrap(user: ChatGPTUser): Promise<CrmBootstrap> {
  const context = await getTenantContext(user);
  const clientFilter = context.clientId ? { column: "client_id", value: context.clientId } : null;

  // The generic documents the expected row shape until generated Supabase types are available.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const query = <T>(table: string, select = "*") => {
    let builder = supabase().from(table).select(select).eq("organization_id", context.organizationId);
    if (clientFilter) builder = builder.eq(clientFilter.column, clientFilter.value);
    return builder;
  };

  const [
    clients,
    contacts,
    companies,
    websites,
    leads,
    stages,
    tasks,
    appointments,
    notes,
    auditEvents,
    phoneConfigs,
    phoneCalls,
    conversations,
    messages,
    automationRules,
    automationRuns,
  ] = await Promise.all([
    (() => {
      let builder = query<AnyRecord>("clients").neq("status", "archived").order("business_name");
      if (context.clientId) builder = builder.eq("id", context.clientId);
      return assertOk(builder);
    })(),
    assertOk(query<AnyRecord>("contacts").is("archived_at", null).order("created_at", { ascending: false })),
    assertOk(query<AnyRecord>("companies").is("archived_at", null).order("name")),
    assertOk(query<AnyRecord>("websites").order("updated_at", { ascending: false })),
    assertOk(
      query<AnyRecord>(
        "leads",
        "*,clients(business_name),contacts(first_name,last_name,phone,email,address,city,state,zip),pipeline_stages(name,color,slug)",
      )
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
    ),
    assertOk(supabase().from("pipeline_stages").select("*").eq("organization_id", context.organizationId).order("position")),
    assertOk(query<AnyRecord>("tasks").order("due_at", { ascending: true, nullsFirst: false })),
    assertOk(
      query<AnyRecord>(
        "appointments",
        "*,clients(business_name),contacts(first_name,last_name)",
      ).order("starts_at", { ascending: true }),
    ),
    assertOk(query<AnyRecord>("notes").order("created_at", { ascending: false }).limit(200)),
    rolePermissions[context.role].includes("audit.read")
      ? assertOk(supabase().from("audit_events").select("*").eq("organization_id", context.organizationId).order("created_at", { ascending: false }).limit(150))
      : Promise.resolve([]),
    assertOk(query<AnyRecord>("phone_system_configs").order("updated_at", { ascending: false })),
    assertOk(query<AnyRecord>("phone_calls").order("started_at", { ascending: false }).limit(200)),
    assertOk(query<AnyRecord>("conversations", "*,contacts(first_name,last_name,phone)").order("last_message_at", { ascending: false, nullsFirst: false }).limit(200)),
    assertOk(query<AnyRecord>("messages").order("created_at", { ascending: true }).limit(500)),
    assertOk(query<AnyRecord>("automation_rules").order("updated_at", { ascending: false })),
    assertOk(query<AnyRecord>("automation_runs").order("started_at", { ascending: false }).limit(200)),
  ]);

  const clientRows = (clients ?? []) as AnyRecord[];
  const contactRows = (contacts ?? []) as AnyRecord[];
  const companyRows = (companies ?? []) as AnyRecord[];
  const websiteRows = (websites ?? []) as AnyRecord[];
  const leadRows = (leads ?? []) as AnyRecord[];
  const stageRows = (stages ?? []) as AnyRecord[];
  const taskRows = (tasks ?? []) as AnyRecord[];
  const appointmentRows = (appointments ?? []) as AnyRecord[];
  const noteRows = (notes ?? []) as AnyRecord[];
  const auditRows = (auditEvents ?? []) as AnyRecord[];

  return {
    viewer: {
      name: context.name,
      email: context.email,
      role: context.role,
      clientId: context.clientId,
      isAgency: !context.clientId,
      permissions: rolePermissions[context.role],
    },
    organization: { id: context.organizationId, name: context.organizationName },
    clients: clientRows.map(mapClient),
    leads: leadRows.map(mapLead),
    contacts: contactRows.map(mapContact),
    companies: companyRows.map(mapCompany),
    websites: websiteRows.map(mapWebsite),
    phoneConfigs: ((phoneConfigs ?? []) as AnyRecord[]).map(mapPhoneConfig),
    phoneCalls: ((phoneCalls ?? []) as AnyRecord[]).map(mapPhoneCall),
    conversations: ((conversations ?? []) as AnyRecord[]).map(mapConversation),
    messages: ((messages ?? []) as AnyRecord[]).map(mapMessage),
    automationRules: ((automationRules ?? []) as AnyRecord[]).map(mapAutomationRule),
    automationRuns: ((automationRuns ?? []) as AnyRecord[]).map(mapAutomationRun),
    customFields: [],
    customFieldValues: [],
    customValues: [],
    featureFlags: defaultFeatureFlags(clientRows),
    auditLogs: auditRows.map((row: AnyRecord): CrmAuditLog => ({
      id: String(row.id),
      actorEmail: String(row.actor_email ?? "system"),
      action: String(row.action),
      recordType: String(row.record_type),
      recordId: nullable(row.record_id),
      metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
      createdAt: String(row.created_at),
    })),
    stages: stageRows.map((row: AnyRecord): CrmStage => ({
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      color: String(row.color),
      position: Number(row.position),
      isWon: Boolean(row.is_won),
      isLost: Boolean(row.is_lost),
    })),
    tasks: taskRows.map((row: AnyRecord): CrmTask => ({
      id: String(row.id),
      clientId: String(row.client_id),
      leadId: nullable(row.lead_id),
      contactId: nullable(row.contact_id),
      title: String(row.title),
      description: String(row.description ?? ""),
      assignee: nullable(row.assignee),
      dueAt: nullable(row.due_at),
      priority: String(row.priority),
      status: String(row.status),
      createdAt: String(row.created_at),
    })),
    appointments: appointmentRows.map((row: AnyRecord): CrmAppointment => {
      const contact = nestedOne(row.contacts) ?? {};
      const client = nestedOne(row.clients) ?? {};
      return {
        id: String(row.id),
        clientId: String(row.client_id),
        clientName: String(client.business_name ?? "Client"),
        leadId: nullable(row.lead_id),
        contactId: String(row.contact_id ?? ""),
        contactName: `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || "Unknown contact",
        assignedEmployee: nullable(row.assigned_employee),
        serviceType: String(row.service_type),
        startsAt: String(row.starts_at),
        endsAt: String(row.ends_at ?? row.starts_at),
        address: null,
        notes: String(row.notes ?? ""),
        status: String(row.status),
      };
    }),
    activities: [],
    notes: noteRows.map((row: AnyRecord): CrmNote => ({
      id: String(row.id),
      clientId: String(row.client_id),
      leadId: nullable(row.lead_id),
      contactId: nullable(row.contact_id),
      body: String(row.body),
      authorEmail: "team",
      createdAt: String(row.created_at),
    })),
    team: [
      {
        id: "main-admin",
        email: MAIN_ADMIN_EMAIL,
        displayName: context.name,
        role: "AGENCY_OWNER",
        status: "active",
        lastLoginAt: null,
      },
    ],
    demoData: false,
    generatedAt: new Date().toISOString(),
  };
}

function defaultFeatureFlags(clients: AnyRecord[]): CrmFeatureFlag[] {
  const modules = ["crm", "calendar", "tasks", "contacts", "companies", "websites", "forms", "payments", "automations", "reviews"];
  return modules.map((moduleKey) => ({
    id: `supabase-flag-${moduleKey}`,
    clientId: null,
    moduleKey,
    enabled: ["crm", "calendar", "tasks", "contacts", "companies", "websites", "forms", "payments", "automations", "reviews"].includes(moduleKey),
    rolloutStatus: "enabled",
    source: clients.length ? "supabase" : "platform",
  }));
}

export async function executeSupabaseCrmAction(user: ChatGPTUser, input: CrmAction) {
  const context = await getTenantContext(user);
  const action = requireText(input.action, "Action", 50);

  if (action === "save_phone_settings") {
    requirePermission(context, "phone_system.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    const client = requireRow(await assertOk(supabase().from("clients").select("business_name").eq("id", clientId).eq("organization_id", context.organizationId).single()), "Client not found.");
    const twilio = getTwilioRuntimeStatus();
    const assignedNumber = phoneNumber(input.phoneNumber, "Twilio phone number");
    const forwardingNumber = phoneNumber(input.forwardingNumber, "Forwarding phone number");
    const a2pStatus = ["not_started", "in_progress", "approved", "rejected"].includes(String(input.a2pStatus)) ? String(input.a2pStatus) : "not_started";
    const wantsMissedCallText = Boolean(input.missedCallTextEnabled);
    if (wantsMissedCallText && (!twilio.configured || !assignedNumber)) throw new Error("Connect Twilio and assign a phone number before turning on missed-call text back.");
    if (wantsMissedCallText && a2pStatus !== "approved") throw new Error("A2P registration must be approved before missed-call texting can be turned on.");
    const message = requireText(input.missedCallMessage, "Missed-call message", 1000);
    const ringTimeout = Math.max(10, Math.min(60, Number(input.ringTimeoutSeconds ?? 20)));
    const cooldown = Math.max(1, Math.min(1440, Number(input.cooldownMinutes ?? 20)));
    const providerStatus = twilio.configured && assignedNumber ? "connected" : "not_configured";
    const config = requireRow(await assertOk(supabase().from("phone_system_configs").upsert({
      organization_id: context.organizationId, client_id: clientId, provider: "twilio",
      provider_account_sid: optionalText(input.providerAccountSid, 80), phone_number_sid: optionalText(input.phoneNumberSid, 80),
      messaging_service_sid: optionalText(input.messagingServiceSid, 80), phone_number: assignedNumber, forwarding_number: forwardingNumber,
      ring_timeout_seconds: ringTimeout, voicemail_enabled: input.voicemailEnabled !== false,
      missed_call_text_enabled: wantsMissedCallText, missed_call_message: message, cooldown_minutes: cooldown,
      provider_status: providerStatus, a2p_status: a2pStatus, updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,client_id" }).select("id").single()), "Phone settings were not saved.");
    await assertOk(supabase().from("automation_rules").upsert({
      organization_id: context.organizationId, client_id: clientId, name: "Missed call text back", trigger_key: "call.missed",
      enabled: wantsMissedCallText, config: { message, cooldownMinutes: cooldown, businessName: String(client.business_name) }, updated_at: new Date().toISOString(),
    }, { onConflict: "client_id,trigger_key" }));
    await audit(context, "phone.settings_updated", "phone_system_config", config.id, { providerStatus, a2pStatus, missedCallTextEnabled: wantsMissedCallText }, clientId);
    return { id: config.id, providerStatus };
  }

  if (action === "send_sms") {
    requirePermission(context, "messages.write");
    const clientId = requireText(input.clientId, "Client", 100);
    const contactId = requireText(input.contactId, "Contact", 100);
    await requireClient(context, clientId);
    const [contactResult, config] = await Promise.all([
      assertOk(supabase().from("contacts").select("id,phone,marketing_consent").eq("id", contactId).eq("client_id", clientId).eq("organization_id", context.organizationId).single()),
      assertOk(supabase().from("phone_system_configs").select("*").eq("client_id", clientId).eq("organization_id", context.organizationId).maybeSingle()),
    ]);
    const contact = requireRow(contactResult, "Contact not found.");
    if (!contact.phone) throw new Error("This contact does not have a phone number.");
    if (String(contact.marketing_consent).toLowerCase() === "opt_out") throw new Error("This contact opted out of text messages.");
    if (!config || config.provider_status !== "connected") throw new Error("Connect this client's Twilio phone system before sending messages.");
    if (config.a2p_status !== "approved") throw new Error("A2P registration must be approved before sending messages.");
    const body = requireText(input.body, "Message", 1600);
    const conversation = requireRow(await assertOk(supabase().from("conversations").upsert({ organization_id: context.organizationId, client_id: clientId, contact_id: contactId, channel: "sms", status: "open", last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "client_id,contact_id,channel" }).select("id").single()), "Conversation was not created.");
    const sent = await sendTwilioMessage({ accountSid: nullable(config.provider_account_sid), fromNumber: nullable(config.phone_number), messagingServiceSid: nullable(config.messaging_service_sid), to: String(contact.phone), body });
    const message = requireRow(await assertOk(supabase().from("messages").insert({ organization_id: context.organizationId, client_id: clientId, conversation_id: conversation.id, contact_id: contactId, provider_message_sid: sent.sid, direction: "outbound", channel: "sms", from_number: String(config.phone_number ?? ""), to_number: String(contact.phone), body, status: sent.status, sent_at: new Date().toISOString() }).select("id").single()), "Message was not saved.");
    await audit(context, "message.sent", "message", message.id, { providerMessageSid: sent.sid }, clientId);
    return { id: message.id, status: sent.status };
  }

  if (action === "create_client") {
    requirePermission(context, "clients.manage");
    const businessName = requireText(input.businessName, "Business name", 160);
    const slugBase = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || crypto.randomUUID();
    const client = await assertOk(
      supabase()
        .from("clients")
        .insert({
          organization_id: context.organizationId,
          business_name: businessName,
          slug: `${slugBase}-${crypto.randomUUID().slice(0, 6)}`,
          industry: requireText(input.industry, "Industry", 100),
          website: optionalText(input.website, 200),
          phone: optionalText(input.phone, 40),
          email: optionalText(input.email, 160)?.toLowerCase() ?? null,
          address: optionalText(input.address, 240),
          city: optionalText(input.city, 80) ?? "",
          state: optionalText(input.state, 30) ?? "",
          zip: optionalText(input.zip, 20) ?? "",
          time_zone: optionalText(input.timeZone, 80) ?? "America/Chicago",
          monthly_ad_budget_cents: cents(input.monthlyAdBudgetCents),
          assigned_account_manager: optionalText(input.assignedAccountManager, 120) ?? context.name,
          service_areas: serviceAreas(input.serviceAreas),
          notes: optionalText(input.notes, 1500) ?? "",
        })
        .select("id")
        .single(),
    );
    const createdClient = requireRow(client, "Client was not created.");
    await audit(context, "client.created", "client", createdClient.id);
    return { id: createdClient.id };
  }

  if (action === "save_website") {
    requirePermission(context, "websites.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    const websiteId = optionalText(input.websiteId, 100);
    const name = requireText(input.name, "Website name", 160);
    const domain = normalizeDomain(input.domain);
    const platform = optionalText(input.platform, 40)?.toLowerCase() ?? "other";
    const analytics = { platform, leadCaptureEnabled: true };
    if (websiteId) {
      const existing = await assertOk(supabase().from("websites").select("id,analytics").eq("id", websiteId).eq("organization_id", context.organizationId).eq("client_id", clientId).maybeSingle());
      if (!existing) throw new Error("Website connection not found.");
      const currentAnalytics = existing.analytics && typeof existing.analytics === "object" ? existing.analytics as Record<string, unknown> : {};
      await assertOk(supabase().from("websites").update({ name, domain, status: "connected", analytics: { ...currentAnalytics, ...analytics }, updated_at: new Date().toISOString() }).eq("id", websiteId).eq("organization_id", context.organizationId));
      await audit(context, "website.updated", "website", websiteId, { domain, platform }, clientId);
      return { id: websiteId };
    }
    const website = await assertOk(supabase().from("websites").insert({ organization_id: context.organizationId, client_id: clientId, name, domain, status: "connected", analytics }).select("id").single());
    const createdWebsite = requireRow(website, "Website connection was not created.");
    await audit(context, "website.connected", "website", createdWebsite.id, { domain, platform }, clientId);
    return { id: createdWebsite.id };
  }

  if (action === "disconnect_website") {
    requirePermission(context, "websites.manage");
    const websiteId = requireText(input.websiteId, "Website", 100);
    const website = await assertOk(supabase().from("websites").select("client_id,analytics").eq("id", websiteId).eq("organization_id", context.organizationId).maybeSingle());
    if (!website) throw new Error("Website connection not found.");
    await requireClient(context, String(website.client_id));
    const currentAnalytics = website.analytics && typeof website.analytics === "object" ? website.analytics as Record<string, unknown> : {};
    await assertOk(supabase().from("websites").update({ status: "disconnected", analytics: { ...currentAnalytics, leadCaptureEnabled: false }, updated_at: new Date().toISOString() }).eq("id", websiteId).eq("organization_id", context.organizationId));
    await audit(context, "website.disconnected", "website", websiteId, {}, String(website.client_id));
    return { id: websiteId };
  }

  if (action === "archive_client") {
    requirePermission(context, "clients.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    await assertOk(supabase().from("clients").update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", clientId).eq("organization_id", context.organizationId));
    await audit(context, "client.archived", "client", clientId);
    return { id: clientId };
  }

  if (action === "create_contact") {
    requirePermission(context, "contacts.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const contact = await assertOk(
      supabase()
        .from("contacts")
        .insert({
          organization_id: context.organizationId,
          client_id: clientId,
          first_name: requireText(input.firstName, "First name", 80),
          last_name: requireText(input.lastName, "Last name", 80),
          phone: optionalText(input.phone, 40),
          email: optionalText(input.email, 160)?.toLowerCase() ?? null,
          address: optionalText(input.address, 200),
          city: optionalText(input.city, 80),
          state: optionalText(input.state, 30),
          zip: optionalText(input.zip, 20),
          marketing_consent: input.marketingConsent === "granted" ? "granted" : "unknown",
          last_interaction_at: new Date().toISOString(),
        })
        .select("id")
        .single(),
    );
    const createdContact = requireRow(contact, "Contact was not created.");
    await audit(context, "contact.created", "contact", createdContact.id, {}, clientId);
    return { id: createdContact.id };
  }

  if (action === "create_lead") {
    requirePermission(context, "opportunities.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const firstName = requireText(input.firstName, "First name", 80);
    const lastName = requireText(input.lastName, "Last name", 80);
    const phone = optionalText(input.phone, 40);
    const email = optionalText(input.email, 160)?.toLowerCase() ?? null;
    if (!phone && !email) throw new Error("A phone number or email is required.");

    let existingContact: AnyRecord | null = null;
    if (email) {
      existingContact = await assertOk(supabase().from("contacts").select("id").eq("organization_id", context.organizationId).eq("client_id", clientId).eq("email", email).is("archived_at", null).limit(1).maybeSingle());
    }
    if (!existingContact && phone) {
      existingContact = await assertOk(supabase().from("contacts").select("id").eq("organization_id", context.organizationId).eq("client_id", clientId).eq("phone", phone).is("archived_at", null).limit(1).maybeSingle());
    }
    if (!existingContact) {
      existingContact = await assertOk(
        supabase()
          .from("contacts")
          .insert({
            organization_id: context.organizationId,
            client_id: clientId,
            first_name: firstName,
            last_name: lastName,
            phone,
            email,
            address: optionalText(input.address, 200),
            city: optionalText(input.city, 80),
            state: optionalText(input.state, 30),
            zip: optionalText(input.zip, 20),
            marketing_consent: input.consentStatus === "granted" ? "granted" : "unknown",
            last_interaction_at: new Date().toISOString(),
          })
          .select("id")
          .single(),
      );
    }

    const lead = await assertOk(
      supabase()
        .from("leads")
        .insert({
          organization_id: context.organizationId,
          client_id: clientId,
          contact_id: requireRow(existingContact, "Contact was not created.").id,
          pipeline_id: PIPELINE_ID,
          stage_id: STAGES[0].id,
          service_requested: requireText(input.serviceRequested, "Service", 160),
          message: optionalText(input.message, 1200) ?? "",
          source: optionalText(input.source, 100) ?? "Manual",
          campaign: optionalText(input.campaign, 160),
          status: "NEW",
          assigned_user: context.name,
          estimated_value_cents: cents(input.estimatedValueCents),
          lead_score: Math.max(0, Math.min(100, Number(input.leadScore ?? 50))),
          tags: tags(input.tags),
          consent_status: input.consentStatus === "granted" ? "granted" : "unknown",
        })
        .select("id")
        .single(),
    );
    const createdLead = requireRow(lead, "Lead was not created.");
    await audit(context, "lead.created", "lead", createdLead.id, {}, clientId);
    return { id: createdLead.id };
  }

  if (action === "update_lead") {
    requirePermission(context, "opportunities.write");
    const leadId = requireText(input.leadId, "Lead", 100);
    const lead = await assertOk(supabase().from("leads").select("*").eq("id", leadId).eq("organization_id", context.organizationId).is("archived_at", null).maybeSingle());
    if (!lead) throw new Error("Lead not found.");
    await requireClient(context, lead.client_id);
    const allowedStatuses = new Set(["NEW", "CONTACTED", "QUALIFIED", "APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON", "LOST", "SPAM", "UNRESPONSIVE"]);
    const status = typeof input.status === "string" && allowedStatuses.has(input.status) ? input.status : String(lead.status);
    await assertOk(
      supabase()
        .from("leads")
        .update({
          status,
          assigned_user: optionalText(input.assignedUser, 120) ?? lead.assigned_user,
          estimated_value_cents: input.estimatedValueCents === undefined ? lead.estimated_value_cents : cents(input.estimatedValueCents),
          final_revenue_cents: input.finalRevenueCents === undefined ? lead.final_revenue_cents : cents(input.finalRevenueCents),
          lost_reason: optionalText(input.lostReason, 240) ?? lead.lost_reason,
          next_follow_up_at: optionalText(input.nextFollowUpAt, 40) ?? lead.next_follow_up_at,
          last_contacted_at: ["CONTACTED", "QUALIFIED", "APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON", "LOST"].includes(status) ? new Date().toISOString() : lead.last_contacted_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .eq("organization_id", context.organizationId),
    );
    await audit(context, "lead.updated", "lead", leadId, { status }, lead.client_id);
    return { id: leadId };
  }

  if (action === "move_lead") {
    requirePermission(context, "opportunities.write");
    const leadId = requireText(input.leadId, "Lead", 100);
    const stageId = requireText(input.stageId, "Stage", 100);
    const lead = await assertOk(supabase().from("leads").select("client_id").eq("id", leadId).eq("organization_id", context.organizationId).is("archived_at", null).maybeSingle());
    if (!lead) throw new Error("Lead not found.");
    await requireClient(context, lead.client_id);
    const stage = await assertOk(supabase().from("pipeline_stages").select("id,name,slug").eq("id", stageId).eq("organization_id", context.organizationId).maybeSingle());
    if (!stage) throw new Error("Pipeline stage not found.");
    const statusByStage: Record<string, string> = { new: "NEW", "attempting-contact": "NEW", contacted: "CONTACTED", qualified: "QUALIFIED", "appointment-booked": "APPOINTMENT_BOOKED", "estimate-sent": "ESTIMATE_SENT", won: "WON", lost: "LOST" };
    await assertOk(supabase().from("leads").update({ stage_id: stageId, status: statusByStage[stage.slug] ?? "NEW", updated_at: new Date().toISOString() }).eq("id", leadId).eq("organization_id", context.organizationId));
    await audit(context, "lead.stage_changed", "lead", leadId, { stageId }, lead.client_id);
    return { id: leadId };
  }

  if (action === "archive_lead") {
    requirePermission(context, "opportunities.write");
    const leadId = requireText(input.leadId, "Lead", 100);
    const lead = await assertOk(supabase().from("leads").select("client_id").eq("id", leadId).eq("organization_id", context.organizationId).is("archived_at", null).maybeSingle());
    if (!lead) throw new Error("Lead not found.");
    await requireClient(context, lead.client_id);
    await assertOk(supabase().from("leads").update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", leadId).eq("organization_id", context.organizationId));
    await audit(context, "lead.archived", "lead", leadId, {}, lead.client_id);
    return { id: leadId };
  }

  if (action === "add_note") {
    requirePermission(context, "opportunities.write");
    const leadId = requireText(input.leadId, "Lead", 100);
    const lead = await assertOk(supabase().from("leads").select("client_id,contact_id").eq("id", leadId).eq("organization_id", context.organizationId).is("archived_at", null).maybeSingle());
    if (!lead) throw new Error("Lead not found.");
    await requireClient(context, lead.client_id);
    const note = await assertOk(supabase().from("notes").insert({ organization_id: context.organizationId, client_id: lead.client_id, lead_id: leadId, contact_id: lead.contact_id, body: requireText(input.body, "Note", 2000) }).select("id").single());
    const createdNote = requireRow(note, "Note was not created.");
    await audit(context, "note.created", "lead", leadId, {}, lead.client_id);
    return { id: createdNote.id };
  }

  if (action === "create_task") {
    requirePermission(context, "tasks.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const priority = ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(String(input.priority)) ? String(input.priority) : "MEDIUM";
    const task = await assertOk(supabase().from("tasks").insert({ organization_id: context.organizationId, client_id: clientId, lead_id: optionalText(input.leadId, 100), contact_id: optionalText(input.contactId, 100), title: requireText(input.title, "Task title", 180), description: optionalText(input.description, 1000) ?? "", assignee: optionalText(input.assignee, 120) ?? context.name, due_at: optionalText(input.dueAt, 40), priority, status: "TO_DO" }).select("id").single());
    const createdTask = requireRow(task, "Task was not created.");
    await audit(context, "task.created", "task", createdTask.id, {}, clientId);
    return { id: createdTask.id };
  }

  if (action === "toggle_task") {
    requirePermission(context, "tasks.write");
    const taskId = requireText(input.taskId, "Task", 100);
    const task = await assertOk(supabase().from("tasks").select("client_id,status").eq("id", taskId).eq("organization_id", context.organizationId).maybeSingle());
    if (!task) throw new Error("Task not found.");
    await requireClient(context, task.client_id);
    const nextStatus = task.status === "COMPLETED" ? "TO_DO" : "COMPLETED";
    await assertOk(supabase().from("tasks").update({ status: nextStatus, completed_at: nextStatus === "COMPLETED" ? new Date().toISOString() : null }).eq("id", taskId).eq("organization_id", context.organizationId));
    await audit(context, "task.status_changed", "task", taskId, { status: nextStatus }, task.client_id);
    return { id: taskId, status: nextStatus };
  }

  if (action === "create_appointment") {
    requirePermission(context, "appointments.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const contactId = requireText(input.contactId, "Contact", 100);
    const contact = await assertOk(supabase().from("contacts").select("id").eq("id", contactId).eq("client_id", clientId).eq("organization_id", context.organizationId).maybeSingle());
    if (!contact) throw new Error("Contact not found.");
    const startsAt = requireText(input.startsAt, "Start time", 40);
    const endsAt = requireText(input.endsAt, "End time", 40);
    if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error("End time must be after the start time.");
    const appointment = await assertOk(supabase().from("appointments").insert({ organization_id: context.organizationId, client_id: clientId, lead_id: optionalText(input.leadId, 100), contact_id: contactId, assigned_employee: optionalText(input.assignedEmployee, 120), service_type: requireText(input.serviceType, "Service", 160), starts_at: startsAt, ends_at: endsAt, notes: optionalText(input.notes, 1000) ?? "", status: "SCHEDULED" }).select("id").single());
    const createdAppointment = requireRow(appointment, "Appointment was not created.");
    await audit(context, "appointment.created", "appointment", createdAppointment.id, {}, clientId);
    return { id: createdAppointment.id };
  }

  if (action === "update_appointment_status") {
    requirePermission(context, "appointments.write");
    const appointmentId = requireText(input.appointmentId, "Appointment", 100);
    const status = requireText(input.status, "Status", 30);
    if (!["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"].includes(status)) throw new Error("Invalid appointment status.");
    const appointment = await assertOk(supabase().from("appointments").select("client_id").eq("id", appointmentId).eq("organization_id", context.organizationId).maybeSingle());
    if (!appointment) throw new Error("Appointment not found.");
    await requireClient(context, appointment.client_id);
    await assertOk(supabase().from("appointments").update({ status }).eq("id", appointmentId).eq("organization_id", context.organizationId));
    await audit(context, "appointment.status_changed", "appointment", appointmentId, { status }, appointment.client_id);
    return { id: appointmentId, status };
  }

  if (action === "create_company") {
    requirePermission(context, "companies.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const company = await assertOk(supabase().from("companies").insert({ organization_id: context.organizationId, client_id: clientId, name: requireText(input.name, "Company name", 160), industry: optionalText(input.industry, 100), website: optionalText(input.website, 240), phone: optionalText(input.phone, 40), email: optionalText(input.email, 160)?.toLowerCase() ?? null, address: optionalText(input.address, 240), city: optionalText(input.city, 80), state: optionalText(input.state, 30), zip: optionalText(input.zip, 20), tags: tags(input.tags), notes: optionalText(input.notes, 1500) ?? "" }).select("id").single());
    const createdCompany = requireRow(company, "Company was not created.");
    await audit(context, "company.created", "company", createdCompany.id, {}, clientId);
    return { id: createdCompany.id };
  }

  if (action === "archive_company") {
    requirePermission(context, "companies.write");
    const companyId = requireText(input.companyId, "Company", 100);
    const company = await assertOk(supabase().from("companies").select("client_id").eq("id", companyId).eq("organization_id", context.organizationId).is("archived_at", null).maybeSingle());
    if (!company) throw new Error("Company not found.");
    await requireClient(context, company.client_id);
    await assertOk(supabase().from("companies").update({ archived_at: new Date().toISOString() }).eq("id", companyId).eq("organization_id", context.organizationId));
    await audit(context, "company.archived", "company", companyId, {}, company.client_id);
    return { id: companyId };
  }

  if (action === "import_contacts") {
    throw new Error("CSV contact import is not connected to Supabase yet. Use single contact creation for now.");
  }

  if (action.includes("custom_") || action === "link_contact_company" || action === "invite_member") {
    throw new Error("This advanced Supabase feature is not connected yet.");
  }

  throw new Error("Unsupported action.");
}
