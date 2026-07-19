import { env } from "cloudflare:workers";
import type { ChatGPTUser } from "../app/chatgpt-auth";
import { MAIN_ADMIN_EMAIL } from "../app/auth-config";
import { ensureAccessSchema, getAccountAccess } from "./access";

export type CrmRole =
  | "SUPER_ADMIN"
  | "AGENCY_OWNER"
  | "AGENCY_ADMIN"
  | "AGENCY_MEMBER"
  | "CLIENT_OWNER"
  | "CLIENT_MANAGER"
  | "CLIENT_EMPLOYEE";

export type CrmPermission =
  | "clients.manage"
  | "contacts.write"
  | "contacts.import"
  | "companies.write"
  | "opportunities.write"
  | "tasks.write"
  | "appointments.write"
  | "websites.manage"
  | "phone_system.manage"
  | "messages.write"
  | "automations.manage"
  | "custom_data.manage"
  | "team.manage"
  | "audit.read"
  | "feature_flags.manage";

const rolePermissions: Record<CrmRole, CrmPermission[]> = {
  SUPER_ADMIN: ["clients.manage", "contacts.write", "contacts.import", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "websites.manage", "phone_system.manage", "messages.write", "automations.manage", "custom_data.manage", "team.manage", "audit.read", "feature_flags.manage"],
  AGENCY_OWNER: ["clients.manage", "contacts.write", "contacts.import", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "websites.manage", "phone_system.manage", "messages.write", "automations.manage", "custom_data.manage", "team.manage", "audit.read", "feature_flags.manage"],
  AGENCY_ADMIN: ["clients.manage", "contacts.write", "contacts.import", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "websites.manage", "phone_system.manage", "messages.write", "automations.manage", "custom_data.manage", "team.manage", "audit.read", "feature_flags.manage"],
  AGENCY_MEMBER: ["contacts.write", "contacts.import", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "websites.manage", "messages.write"],
  CLIENT_OWNER: ["contacts.write", "contacts.import", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "websites.manage", "phone_system.manage", "messages.write", "automations.manage", "custom_data.manage"],
  CLIENT_MANAGER: ["contacts.write", "contacts.import", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "websites.manage", "phone_system.manage", "messages.write", "automations.manage", "custom_data.manage"],
  CLIENT_EMPLOYEE: ["contacts.write", "companies.write", "opportunities.write", "tasks.write", "appointments.write", "messages.write"],
};

export type CrmClient = {
  id: string;
  businessName: string;
  industry: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string;
  state: string;
  zip: string;
  timeZone: string;
  status: string;
  monthlyAdBudgetCents: number;
  assignedAccountManager: string | null;
  serviceAreas: string[];
  notes: string;
  createdAt: string;
};

export type CrmContact = {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  tags: string[];
  marketingConsent: string;
  lastInteractionAt: string | null;
  lifetimeValueCents: number;
  createdAt: string;
};

export type CrmCompany = {
  id: string;
  clientId: string;
  name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  tags: string[];
  notes: string;
  contactCount: number;
  createdAt: string;
};

export type CrmCustomFieldDefinition = {
  id: string;
  clientId: string;
  entityType: "CONTACT" | "COMPANY" | "OPPORTUNITY";
  fieldKey: string;
  label: string;
  fieldType: string;
  options: string[];
  isRequired: boolean;
  position: number;
};

export type CrmCustomFieldValue = {
  id: string;
  clientId: string;
  definitionId: string;
  entityType: "CONTACT" | "COMPANY" | "OPPORTUNITY";
  entityId: string;
  value: string | number | boolean | string[] | null;
  updatedAt: string;
};

export type CrmCustomValue = {
  id: string;
  clientId: string;
  valueKey: string;
  label: string;
  value: string;
  updatedAt: string;
};

export type CrmFeatureFlag = {
  id: string;
  clientId: string | null;
  moduleKey: string;
  enabled: boolean;
  rolloutStatus: "disabled" | "beta" | "enabled";
  source: string;
};

export type CrmAuditLog = {
  id: string;
  actorEmail: string;
  action: string;
  recordType: string;
  recordId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CrmLead = {
  id: string;
  clientId: string;
  clientName: string;
  contactId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  stageId: string;
  stageName: string;
  stageColor: string;
  serviceRequested: string;
  message: string;
  source: string;
  campaign: string | null;
  status: string;
  assignedUser: string | null;
  estimatedValueCents: number;
  finalRevenueCents: number;
  appointmentDate: string | null;
  leadScore: number;
  tags: string[];
  consentStatus: string;
  lostReason: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmStage = {
  id: string;
  name: string;
  slug: string;
  color: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
};

export type CrmTask = {
  id: string;
  clientId: string;
  leadId: string | null;
  contactId: string | null;
  title: string;
  description: string;
  assignee: string | null;
  dueAt: string | null;
  priority: string;
  status: string;
  createdAt: string;
};

export type CrmAppointment = {
  id: string;
  clientId: string;
  clientName: string;
  leadId: string | null;
  contactId: string;
  contactName: string;
  assignedEmployee: string | null;
  serviceType: string;
  startsAt: string;
  endsAt: string;
  address: string | null;
  notes: string;
  status: string;
};

export type CrmActivity = {
  id: string;
  clientId: string;
  leadId: string | null;
  contactId: string | null;
  type: string;
  title: string;
  detail: string | null;
  occurredAt: string;
};

export type CrmNote = {
  id: string;
  clientId: string;
  leadId: string | null;
  contactId: string | null;
  body: string;
  authorEmail: string;
  createdAt: string;
};

export type CrmTeamMember = {
  id: string;
  email: string;
  displayName: string;
  role: CrmRole;
  status: string;
  lastLoginAt: string | null;
};

export type CrmWebsite = {
  id: string;
  clientId: string;
  name: string;
  domain: string | null;
  status: string;
  platform: string;
  leadCaptureEnabled: boolean;
  lastLeadAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmPhoneConfig = {
  id: string;
  clientId: string;
  provider: string;
  phoneNumber: string | null;
  forwardingNumber: string | null;
  ringTimeoutSeconds: number;
  voicemailEnabled: boolean;
  missedCallTextEnabled: boolean;
  missedCallMessage: string;
  cooldownMinutes: number;
  providerStatus: string;
  a2pStatus: string;
  lastTestedAt: string | null;
};

export type CrmPhoneCall = {
  id: string;
  clientId: string;
  contactId: string | null;
  fromNumber: string;
  toNumber: string;
  status: string;
  direction: string;
  durationSeconds: number | null;
  startedAt: string;
  missedCallTextSentAt: string | null;
};

export type CrmConversation = {
  id: string;
  clientId: string;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
};

export type CrmMessage = {
  id: string;
  clientId: string;
  conversationId: string;
  contactId: string;
  direction: string;
  body: string;
  status: string;
  automationKey: string | null;
  createdAt: string;
};

export type CrmAutomationRule = {
  id: string;
  clientId: string;
  name: string;
  triggerKey: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updatedAt: string;
};

export type CrmAutomationRun = {
  id: string;
  clientId: string;
  ruleId: string | null;
  triggerEventId: string;
  status: string;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type CrmProviderConnection = {
  id: string;
  clientId: string;
  provider: string;
  status: string;
  isLinked: boolean;
  isActive: boolean;
  billingOwner: string;
  accountLabel: string | null;
  accountStatus: string | null;
  scopes: string[];
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastHealthCheckAt: string | null;
  lastError: string | null;
};

export type CrmWorkflowNode = {
  id: string;
  type: "trigger" | "send_sms" | "create_task" | "add_tag" | "update_stage" | "condition";
  label: string;
  x: number;
  y: number;
  config: Record<string, string | number | boolean>;
};

export type CrmWorkflowEdge = { id: string; source: string; target: string; branch?: "always" | "yes" | "no" };

export type CrmWorkflow = {
  id: string;
  clientId: string;
  name: string;
  description: string;
  status: string;
  triggerKey: string;
  currentVersion: number;
  publishedVersion: number | null;
  graph: { nodes: CrmWorkflowNode[]; edges: CrmWorkflowEdge[] };
  updatedAt: string;
};

export type CrmWorkflowRun = {
  id: string;
  clientId: string;
  workflowId: string;
  version: number;
  triggerKey: string;
  status: string;
  isTest: boolean;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type CrmBootstrap = {
  viewer: {
    name: string;
    email: string;
    role: CrmRole;
    clientId: string | null;
    isAgency: boolean;
    permissions: CrmPermission[];
  };
  organization: { id: string; name: string };
  clients: CrmClient[];
  leads: CrmLead[];
  contacts: CrmContact[];
  companies: CrmCompany[];
  websites: CrmWebsite[];
  phoneConfigs: CrmPhoneConfig[];
  phoneCalls: CrmPhoneCall[];
  conversations: CrmConversation[];
  messages: CrmMessage[];
  automationRules: CrmAutomationRule[];
  automationRuns: CrmAutomationRun[];
  providerConnections: CrmProviderConnection[];
  workflows: CrmWorkflow[];
  workflowRuns: CrmWorkflowRun[];
  customFields: CrmCustomFieldDefinition[];
  customFieldValues: CrmCustomFieldValue[];
  customValues: CrmCustomValue[];
  featureFlags: CrmFeatureFlag[];
  auditLogs: CrmAuditLog[];
  stages: CrmStage[];
  tasks: CrmTask[];
  appointments: CrmAppointment[];
  activities: CrmActivity[];
  notes: CrmNote[];
  team: CrmTeamMember[];
  demoData: boolean;
  generatedAt: string;
};

type TenantContext = {
  organizationId: string;
  organizationName: string;
  accountId: string;
  email: string;
  name: string;
  role: CrmRole;
  clientId: string | null;
};

const ORGANIZATION_ID = "org_brizuela_leads";
const PIPELINE_ID = "pipeline_brizuela_default";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS organization_members (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(organization_id, account_id))`,
  `CREATE TABLE IF NOT EXISTS crm_clients (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, legacy_client_id TEXT UNIQUE REFERENCES clients(id) ON DELETE SET NULL, business_name TEXT NOT NULL, logo_url TEXT, industry TEXT NOT NULL, website TEXT, phone TEXT, email TEXT, address TEXT, city TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', zip TEXT NOT NULL DEFAULT '', time_zone TEXT NOT NULL DEFAULT 'America/Chicago', status TEXT NOT NULL DEFAULT 'active', monthly_ad_budget_cents INTEGER NOT NULL DEFAULT 0, assigned_account_manager TEXT, service_areas_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, archived_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS client_members (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(client_id, account_id))`,
  `CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, name TEXT NOT NULL, industry TEXT, website TEXT, phone TEXT, email TEXT, address TEXT, city TEXT, state TEXT, zip TEXT, tags_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, archived_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, city TEXT, state TEXT, zip TEXT, company TEXT, tags_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', marketing_consent TEXT NOT NULL DEFAULT 'unknown', last_interaction_at TEXT, lifetime_value_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, archived_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS contact_company_links (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, relationship TEXT NOT NULL DEFAULT 'employee', is_primary INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(contact_id, company_id))`,
  `CREATE TABLE IF NOT EXISTS custom_field_definitions (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, entity_type TEXT NOT NULL, field_key TEXT NOT NULL, label TEXT NOT NULL, field_type TEXT NOT NULL, options_json TEXT NOT NULL DEFAULT '[]', is_required INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(client_id, entity_type, field_key))`,
  `CREATE TABLE IF NOT EXISTS custom_field_values (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, definition_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, value_json TEXT NOT NULL DEFAULT 'null', updated_by_email TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(definition_id, entity_id))`,
  `CREATE TABLE IF NOT EXISTS custom_values (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, value_key TEXT NOT NULL, label TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(client_id, value_key))`,
  `CREATE TABLE IF NOT EXISTS feature_flags (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT REFERENCES crm_clients(id) ON DELETE CASCADE, module_key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, rollout_status TEXT NOT NULL DEFAULT 'disabled', source TEXT NOT NULL DEFAULT 'platform', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(organization_id, client_id, module_key))`,
  `CREATE TABLE IF NOT EXISTS pipelines (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT REFERENCES crm_clients(id) ON DELETE CASCADE, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS pipeline_stages (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE, name TEXT NOT NULL, slug TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL, is_won INTEGER NOT NULL DEFAULT 0, is_lost INTEGER NOT NULL DEFAULT 0, UNIQUE(pipeline_id, slug))`,
  `CREATE TABLE IF NOT EXISTS crm_leads (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT, pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE RESTRICT, stage_id TEXT NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT, service_requested TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'Manual', campaign TEXT, status TEXT NOT NULL DEFAULT 'NEW', assigned_user TEXT, estimated_value_cents INTEGER NOT NULL DEFAULT 0, final_revenue_cents INTEGER NOT NULL DEFAULT 0, appointment_date TEXT, lead_score INTEGER NOT NULL DEFAULT 50, tags_json TEXT NOT NULL DEFAULT '[]', consent_status TEXT NOT NULL DEFAULT 'unknown', lost_reason TEXT, last_contacted_at TEXT, next_follow_up_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, archived_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS lead_stage_history (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, lead_id TEXT NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE, from_stage_id TEXT REFERENCES pipeline_stages(id) ON DELETE SET NULL, to_stage_id TEXT NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT, changed_by_email TEXT NOT NULL, changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS crm_notes (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, lead_id TEXT REFERENCES crm_leads(id) ON DELETE CASCADE, contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE, body TEXT NOT NULL, author_email TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, lead_id TEXT REFERENCES crm_leads(id) ON DELETE CASCADE, contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, detail TEXT, occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, lead_id TEXT REFERENCES crm_leads(id) ON DELETE CASCADE, contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', assignee TEXT, due_at TEXT, priority TEXT NOT NULL DEFAULT 'MEDIUM', status TEXT NOT NULL DEFAULT 'TO_DO', reminder_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, lead_id TEXT REFERENCES crm_leads(id) ON DELETE SET NULL, contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT, assigned_employee TEXT, service_type TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, address TEXT, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'SCHEDULED', reminder_minutes INTEGER NOT NULL DEFAULT 60, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS websites (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES crm_clients(id) ON DELETE CASCADE, name TEXT NOT NULL, domain TEXT, status TEXT NOT NULL DEFAULT 'connected', platform TEXT NOT NULL DEFAULT 'other', lead_capture_enabled INTEGER NOT NULL DEFAULT 1, last_lead_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, actor_email TEXT NOT NULL, action TEXT NOT NULL, record_type TEXT NOT NULL, record_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS domain_events (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, client_id TEXT REFERENCES crm_clients(id) ON DELETE CASCADE, event_type TEXT NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT, payload_json TEXT NOT NULL DEFAULT '{}', processing_status TEXT NOT NULL DEFAULT 'pending', occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, processed_at TEXT)`,
  "CREATE INDEX IF NOT EXISTS organization_members_account_idx ON organization_members(account_id)",
  "CREATE INDEX IF NOT EXISTS crm_clients_org_status_idx ON crm_clients(organization_id, status)",
  "CREATE INDEX IF NOT EXISTS client_members_account_idx ON client_members(account_id)",
  "CREATE INDEX IF NOT EXISTS companies_org_client_name_idx ON companies(organization_id, client_id, name)",
  "CREATE INDEX IF NOT EXISTS companies_email_idx ON companies(email)",
  "CREATE INDEX IF NOT EXISTS contacts_org_client_idx ON contacts(organization_id, client_id)",
  "CREATE INDEX IF NOT EXISTS contacts_phone_idx ON contacts(phone)",
  "CREATE INDEX IF NOT EXISTS contacts_email_idx ON contacts(email)",
  "CREATE INDEX IF NOT EXISTS contact_company_links_company_idx ON contact_company_links(company_id)",
  "CREATE INDEX IF NOT EXISTS custom_field_definitions_scope_idx ON custom_field_definitions(organization_id, client_id, entity_type, position)",
  "CREATE INDEX IF NOT EXISTS custom_field_values_entity_idx ON custom_field_values(organization_id, client_id, entity_type, entity_id)",
  "CREATE INDEX IF NOT EXISTS custom_values_scope_idx ON custom_values(organization_id, client_id)",
  "CREATE INDEX IF NOT EXISTS feature_flags_org_module_idx ON feature_flags(organization_id, module_key)",
  "CREATE INDEX IF NOT EXISTS pipeline_stages_position_idx ON pipeline_stages(pipeline_id, position)",
  "CREATE INDEX IF NOT EXISTS crm_leads_org_client_created_idx ON crm_leads(organization_id, client_id, created_at)",
  "CREATE INDEX IF NOT EXISTS crm_leads_org_stage_idx ON crm_leads(organization_id, stage_id)",
  "CREATE INDEX IF NOT EXISTS crm_leads_org_status_idx ON crm_leads(organization_id, status)",
  "CREATE INDEX IF NOT EXISTS crm_notes_lead_idx ON crm_notes(lead_id, created_at)",
  "CREATE INDEX IF NOT EXISTS activities_lead_time_idx ON activities(lead_id, occurred_at)",
  "CREATE INDEX IF NOT EXISTS tasks_org_status_due_idx ON tasks(organization_id, status, due_at)",
  "CREATE INDEX IF NOT EXISTS appointments_org_start_idx ON appointments(organization_id, starts_at)",
  "CREATE INDEX IF NOT EXISTS websites_org_client_idx ON websites(organization_id, client_id)",
  "CREATE INDEX IF NOT EXISTS audit_logs_org_time_idx ON audit_logs(organization_id, created_at)",
  "CREATE INDEX IF NOT EXISTS domain_events_pending_idx ON domain_events(processing_status, occurred_at)",
  "CREATE INDEX IF NOT EXISTS domain_events_org_type_idx ON domain_events(organization_id, event_type, occurred_at)",
];

let initialization: Promise<void> | null = null;

function database(): D1Database {
  if (!env.DB) throw new Error("The CRM database is unavailable.");
  return env.DB;
}

export async function ensureCrmSchema(): Promise<void> {
  if (!initialization) {
    initialization = initializeCrm().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

async function initializeCrm() {
  await ensureAccessSchema();
  const db = database();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  await removeOldDemoRecords(db);
  await ensureAgencyBaseline(db);
}

async function removeOldDemoRecords(db: D1Database) {
  const cleanupStatements = [
    "DELETE FROM custom_field_values WHERE id IN ('custom_field_value_ava_property')",
    "DELETE FROM contact_company_links WHERE id IN ('company_link_noah')",
    "DELETE FROM crm_notes WHERE id IN ('note_marcus') OR lead_id IN ('lead_ava','lead_marcus','lead_nina','lead_jordan','lead_elena','lead_noah','lead_sophia','lead_liam')",
    "DELETE FROM activities WHERE id IN ('activity_lead_ava','activity_lead_marcus','activity_lead_nina','activity_lead_jordan','activity_lead_elena','activity_lead_noah','activity_lead_sophia','activity_lead_liam') OR lead_id IN ('lead_ava','lead_marcus','lead_nina','lead_jordan','lead_elena','lead_noah','lead_sophia','lead_liam')",
    "DELETE FROM tasks WHERE id IN ('task_marcus','task_jordan','task_noah','task_review')",
    "DELETE FROM appointments WHERE id IN ('appointment_marcus','appointment_elena','appointment_ava')",
    "DELETE FROM audit_logs WHERE record_id IN ('crm_client_segovia','lead_ava','lead_marcus','lead_nina','lead_jordan','lead_elena','lead_noah','lead_sophia','lead_liam','contact_ava','contact_marcus','contact_nina','contact_jordan','contact_elena','contact_noah','contact_sophia','contact_liam','company_hill_country_bakery','company_lone_star_property')",
    "DELETE FROM audit_events WHERE target_id IN ('client_segovia','client_summit','client_coolbreeze','client_oakstone','client_greenline')",
    "DELETE FROM lead_stage_history WHERE lead_id IN ('lead_ava','lead_marcus','lead_nina','lead_jordan','lead_elena','lead_noah','lead_sophia','lead_liam')",
    "DELETE FROM crm_leads WHERE id IN ('lead_ava','lead_marcus','lead_nina','lead_jordan','lead_elena','lead_noah','lead_sophia','lead_liam')",
    "DELETE FROM custom_values WHERE id IN ('custom_value_business_name','custom_value_business_phone','custom_value_booking_link','custom_value_review_link','custom_value_offer')",
    "DELETE FROM custom_field_definitions WHERE id IN ('custom_field_property_type','custom_field_preferred_contact','custom_field_service_frequency')",
    "DELETE FROM feature_flags WHERE client_id = 'crm_client_segovia'",
    "DELETE FROM companies WHERE id IN ('company_hill_country_bakery','company_lone_star_property')",
    "DELETE FROM contacts WHERE id IN ('contact_ava','contact_marcus','contact_nina','contact_jordan','contact_elena','contact_noah','contact_sophia','contact_liam')",
    "DELETE FROM client_members WHERE client_id = 'crm_client_segovia'",
    "DELETE FROM crm_clients WHERE id = 'crm_client_segovia'",
    "DELETE FROM leads WHERE id IN ('lead_summit_1','lead_summit_2','lead_coolbreeze_1','lead_oakstone_1','lead_greenline_1')",
    "DELETE FROM clients WHERE id IN ('client_segovia','client_summit','client_coolbreeze','client_oakstone','client_greenline')",
  ];
  await db.batch(cleanupStatements.map((statement) => db.prepare(statement)));
}

async function ensureAgencyBaseline(db: D1Database) {
  await db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug, status) VALUES (?, ?, ?, 'active')`)
    .bind(ORGANIZATION_ID, "Brizuela Leads", "brizuela-leads")
    .run();
  await db.prepare(`INSERT OR IGNORE INTO pipelines (id, organization_id, name, is_default) VALUES (?, ?, 'Default sales pipeline', 1)`)
    .bind(PIPELINE_ID, ORGANIZATION_ID)
    .run();

  const moduleFlags = [
    ["crm", 1, "enabled"],
    ["companies", 1, "enabled"],
    ["custom_data", 1, "enabled"],
    ["audit", 1, "enabled"],
    ["conversations", 0, "disabled"],
    ["communications", 0, "disabled"],
    ["workflows", 0, "disabled"],
    ["forms", 0, "disabled"],
    ["sites", 0, "disabled"],
    ["payments", 0, "disabled"],
    ["reputation", 0, "disabled"],
    ["social", 0, "disabled"],
    ["memberships", 0, "disabled"],
    ["ai", 0, "disabled"],
    ["saas", 0, "disabled"],
    ["developer_platform", 0, "disabled"],
  ];
  for (const flag of moduleFlags) {
    await db.prepare(`INSERT OR IGNORE INTO feature_flags (id, organization_id, client_id, module_key, enabled, rollout_status, source) VALUES (?, ?, NULL, ?, ?, ?, 'platform')`)
      .bind(`flag_${flag[0]}`, ORGANIZATION_ID, ...flag)
      .run();
  }

  const stages = [
    ["stage_new", "New Lead", "new", "#6D5DFB", 1, 0, 0],
    ["stage_attempting", "Attempting Contact", "attempting-contact", "#E59A32", 2, 0, 0],
    ["stage_contacted", "Contacted", "contacted", "#2788D4", 3, 0, 0],
    ["stage_qualified", "Qualified", "qualified", "#0E9F81", 4, 0, 0],
    ["stage_appointment", "Appointment Booked", "appointment-booked", "#8657D4", 5, 0, 0],
    ["stage_estimate", "Estimate Sent", "estimate-sent", "#4266C9", 6, 0, 0],
    ["stage_won", "Won", "won", "#17845F", 7, 1, 0],
    ["stage_lost", "Lost", "lost", "#A84A5A", 8, 0, 1],
  ];
  for (const stage of stages) {
    await db.prepare(`INSERT OR IGNORE INTO pipeline_stages (id, organization_id, pipeline_id, name, slug, color, position, is_won, is_lost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(stage[0], ORGANIZATION_ID, PIPELINE_ID, ...stage.slice(1))
      .run();
  }

  const baselineAccount = await db.prepare("SELECT id FROM accounts WHERE lower(email) = ? LIMIT 1").bind(MAIN_ADMIN_EMAIL).first<{ id: string }>();
  if (baselineAccount?.id) {
    await db.prepare(`INSERT OR IGNORE INTO organization_members (id, organization_id, account_id, role, status) VALUES ('org_member_owner', ?, ?, 'AGENCY_OWNER', 'active')`)
      .bind(ORGANIZATION_ID, baselineAccount.id)
      .run();
  }

}

async function getTenantContext(user: ChatGPTUser): Promise<TenantContext> {
  const access = await getAccountAccess(user);
  if (!access) throw new Error("Forbidden");
  await ensureCrmSchema();
  const db = database();
  const account = await db.prepare("SELECT id FROM accounts WHERE lower(email) = ? AND status = 'active' LIMIT 1")
    .bind(user.email.toLowerCase())
    .first<{ id: string }>();
  if (!account) throw new Error("Forbidden");

  if (access.role === "admin") {
    const membership = await db.prepare(`SELECT om.role, o.id AS organization_id, o.name AS organization_name FROM organization_members om JOIN organizations o ON o.id = om.organization_id WHERE om.account_id = ? AND om.status = 'active' AND o.status = 'active' LIMIT 1`)
      .bind(account.id)
      .first<{ role: CrmRole; organization_id: string; organization_name: string }>();
    if (!membership) throw new Error("Forbidden");
    return { organizationId: membership.organization_id, organizationName: membership.organization_name, accountId: account.id, email: access.email, name: access.displayName, role: membership.role, clientId: null };
  }

  const client = await db.prepare(`SELECT cc.id, cc.organization_id, o.name AS organization_name, cm.role FROM crm_clients cc JOIN organizations o ON o.id = cc.organization_id LEFT JOIN client_members cm ON cm.client_id = cc.id AND cm.account_id = ? AND cm.status = 'active' WHERE cc.legacy_client_id = ? AND cc.status = 'active' LIMIT 1`)
    .bind(account.id, access.client?.id ?? "")
    .first<{ id: string; organization_id: string; organization_name: string; role: CrmRole | null }>();
  if (!client) throw new Error("Forbidden");
  return { organizationId: client.organization_id, organizationName: client.organization_name, accountId: account.id, email: access.email, name: access.displayName, role: client.role ?? "CLIENT_OWNER", clientId: client.id };
}

function clientClause(context: TenantContext, alias: string) {
  return context.clientId ? { sql: ` AND ${alias}.client_id = ?`, values: [context.clientId] } : { sql: "", values: [] as string[] };
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonValue(value: unknown): string | number | boolean | string[] | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") return parsed;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : null;
  } catch {
    return null;
  }
}

export async function getCrmBootstrap(user: ChatGPTUser): Promise<CrmBootstrap> {
  const context = await getTenantContext(user);
  const db = database();
  const scope = clientClause(context, "x");
  const clientListScope = context.clientId ? { sql: " AND x.id = ?", values: [context.clientId] } : { sql: "", values: [] as string[] };

  const [clientRows, leadRows, contactRows, companyRows, websiteRows, customFieldRows, customFieldValueRows, customValueRows, featureFlagRows, stageRows, taskRows, appointmentRows, activityRows, noteRows, teamRows, auditRows] = await Promise.all([
    db.prepare(`SELECT * FROM crm_clients x WHERE x.organization_id = ? AND x.status != 'archived'${clientListScope.sql} ORDER BY x.business_name`).bind(context.organizationId, ...clientListScope.values).all<Record<string, unknown>>(),
    db.prepare(`SELECT x.*, c.first_name, c.last_name, c.phone, c.email, c.address, c.city, c.state, c.zip, cc.business_name AS client_name, ps.name AS stage_name, ps.color AS stage_color FROM crm_leads x JOIN contacts c ON c.id = x.contact_id JOIN crm_clients cc ON cc.id = x.client_id JOIN pipeline_stages ps ON ps.id = x.stage_id WHERE x.organization_id = ? AND x.archived_at IS NULL${scope.sql} ORDER BY x.created_at DESC`).bind(context.organizationId, ...scope.values).all<Record<string, unknown>>(),
    db.prepare(`SELECT x.* FROM contacts x WHERE x.organization_id = ? AND x.archived_at IS NULL${scope.sql} ORDER BY x.last_interaction_at DESC, x.created_at DESC`).bind(context.organizationId, ...scope.values).all<Record<string, unknown>>(),
    db.prepare(`SELECT x.*, COUNT(ccl.id) AS contact_count FROM companies x LEFT JOIN contact_company_links ccl ON ccl.company_id = x.id WHERE x.organization_id = ? AND x.archived_at IS NULL${scope.sql} GROUP BY x.id ORDER BY x.name`).bind(context.organizationId, ...scope.values).all<Record<string, unknown>>(),
    db.prepare(`SELECT x.* FROM websites x WHERE x.organization_id = ?${scope.sql} ORDER BY x.updated_at DESC`).bind(context.organizationId, ...scope.values).all<Record<string, unknown>>(),
    db.prepare(`SELECT x.* FROM custom_field_definitions x WHERE x.organization_id = ? AND x.is_active = 1${scope.sql} ORDER BY x.entity_type, x.position, x.label`).bind(context.organizationId, ...scope.values).all<Record<string, unknown>>(),
    db.prepare(`SELECT x.* FROM custom_field_values x WHERE x.organization_id = ?${scope.sql} ORDER BY x.updated_at DESC`).bind(context.organizationId, ...scope.values).all<Record<string, unknown>>(),
    db.prepare(`SELECT x.* FROM custom_values x WHERE x.organization_id = ?${scope.sql} ORDER BY x.label`).bind(context.organizationId, ...scope.values).all<Record<string, unknown>>(),
    context.clientId
      ? db.prepare(`SELECT x.* FROM feature_flags x WHERE x.organization_id = ? AND (x.client_id IS NULL OR x.client_id = ?) ORDER BY x.module_key`).bind(context.organizationId, context.clientId).all<Record<string, unknown>>()
      : db.prepare(`SELECT x.* FROM feature_flags x WHERE x.organization_id = ? ORDER BY x.client_id, x.module_key`).bind(context.organizationId).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, name, slug, color, position, is_won, is_lost FROM pipeline_stages WHERE organization_id = ? ORDER BY position`).bind(context.organizationId).all<Record<string, unknown>>(),
    db.prepare(`SELECT x.* FROM tasks x WHERE x.organization_id = ?${scope.sql} ORDER BY CASE x.status WHEN 'COMPLETED' THEN 1 ELSE 0 END, x.due_at`).bind(context.organizationId, ...scope.values).all<Record<string, unknown>>(),
    db.prepare(`SELECT x.*, c.first_name || ' ' || c.last_name AS contact_name, cc.business_name AS client_name FROM appointments x JOIN contacts c ON c.id = x.contact_id JOIN crm_clients cc ON cc.id = x.client_id WHERE x.organization_id = ?${scope.sql} ORDER BY x.starts_at`).bind(context.organizationId, ...scope.values).all<Record<string, unknown>>(),
    db.prepare(`SELECT x.* FROM activities x WHERE x.organization_id = ?${scope.sql} ORDER BY x.occurred_at DESC LIMIT 200`).bind(context.organizationId, ...scope.values).all<Record<string, unknown>>(),
    db.prepare(`SELECT x.* FROM crm_notes x WHERE x.organization_id = ?${scope.sql} ORDER BY x.created_at DESC LIMIT 200`).bind(context.organizationId, ...scope.values).all<Record<string, unknown>>(),
    context.clientId ? Promise.resolve({ results: [] as Record<string, unknown>[] }) : db.prepare(`SELECT om.id, a.email, a.display_name, om.role, om.status, a.last_login_at FROM organization_members om JOIN accounts a ON a.id = om.account_id WHERE om.organization_id = ? ORDER BY CASE om.role WHEN 'AGENCY_OWNER' THEN 0 WHEN 'AGENCY_ADMIN' THEN 1 ELSE 2 END, a.display_name`).bind(context.organizationId).all<Record<string, unknown>>(),
    rolePermissions[context.role].includes("audit.read") ? db.prepare(`SELECT id, actor_email, action, record_type, record_id, metadata_json, created_at FROM audit_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT 150`).bind(context.organizationId).all<Record<string, unknown>>() : Promise.resolve({ results: [] as Record<string, unknown>[] }),
  ]);

  return {
    viewer: { name: context.name, email: context.email, role: context.role, clientId: context.clientId, isAgency: !context.clientId, permissions: rolePermissions[context.role] },
    organization: { id: context.organizationId, name: context.organizationName },
    clients: clientRows.results.map(mapClient),
    leads: leadRows.results.map(mapLead),
    contacts: contactRows.results.map(mapContact),
    companies: companyRows.results.map((row) => ({ id: String(row.id), clientId: String(row.client_id), name: String(row.name), industry: nullable(row.industry), website: nullable(row.website), phone: nullable(row.phone), email: nullable(row.email), address: nullable(row.address), city: nullable(row.city), state: nullable(row.state), zip: nullable(row.zip), tags: parseStringArray(row.tags_json), notes: String(row.notes ?? ""), contactCount: Number(row.contact_count ?? 0), createdAt: String(row.created_at) })),
    websites: websiteRows.results.map((row) => ({ id: String(row.id), clientId: String(row.client_id), name: String(row.name), domain: nullable(row.domain), status: String(row.status), platform: String(row.platform ?? "other"), leadCaptureEnabled: Boolean(row.lead_capture_enabled), lastLeadAt: nullable(row.last_lead_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })),
    phoneConfigs: [],
    phoneCalls: [],
    conversations: [],
    messages: [],
    automationRules: [],
    automationRuns: [],
    providerConnections: [],
    workflows: [],
    workflowRuns: [],
    customFields: customFieldRows.results.map((row) => ({ id: String(row.id), clientId: String(row.client_id), entityType: String(row.entity_type) as CrmCustomFieldDefinition["entityType"], fieldKey: String(row.field_key), label: String(row.label), fieldType: String(row.field_type), options: parseStringArray(row.options_json), isRequired: Boolean(row.is_required), position: Number(row.position ?? 0) })),
    customFieldValues: customFieldValueRows.results.map((row) => ({ id: String(row.id), clientId: String(row.client_id), definitionId: String(row.definition_id), entityType: String(row.entity_type) as CrmCustomFieldValue["entityType"], entityId: String(row.entity_id), value: parseJsonValue(row.value_json), updatedAt: String(row.updated_at) })),
    customValues: customValueRows.results.map((row) => ({ id: String(row.id), clientId: String(row.client_id), valueKey: String(row.value_key), label: String(row.label), value: String(row.value), updatedAt: String(row.updated_at) })),
    featureFlags: featureFlagRows.results.map((row) => ({ id: String(row.id), clientId: nullable(row.client_id), moduleKey: String(row.module_key), enabled: Boolean(row.enabled), rolloutStatus: String(row.rollout_status) as CrmFeatureFlag["rolloutStatus"], source: String(row.source) })),
    stages: stageRows.results.map((row) => ({ id: String(row.id), name: String(row.name), slug: String(row.slug), color: String(row.color), position: Number(row.position), isWon: Boolean(row.is_won), isLost: Boolean(row.is_lost) })),
    tasks: taskRows.results.map((row) => ({ id: String(row.id), clientId: String(row.client_id), leadId: nullable(row.lead_id), contactId: nullable(row.contact_id), title: String(row.title), description: String(row.description ?? ""), assignee: nullable(row.assignee), dueAt: nullable(row.due_at), priority: String(row.priority), status: String(row.status), createdAt: String(row.created_at) })),
    appointments: appointmentRows.results.map((row) => ({ id: String(row.id), clientId: String(row.client_id), clientName: String(row.client_name), leadId: nullable(row.lead_id), contactId: String(row.contact_id), contactName: String(row.contact_name), assignedEmployee: nullable(row.assigned_employee), serviceType: String(row.service_type), startsAt: String(row.starts_at), endsAt: String(row.ends_at), address: nullable(row.address), notes: String(row.notes ?? ""), status: String(row.status) })),
    activities: activityRows.results.map((row) => ({ id: String(row.id), clientId: String(row.client_id), leadId: nullable(row.lead_id), contactId: nullable(row.contact_id), type: String(row.type), title: String(row.title), detail: nullable(row.detail), occurredAt: String(row.occurred_at) })),
    notes: noteRows.results.map((row) => ({ id: String(row.id), clientId: String(row.client_id), leadId: nullable(row.lead_id), contactId: nullable(row.contact_id), body: String(row.body), authorEmail: String(row.author_email), createdAt: String(row.created_at) })),
    team: teamRows.results.map((row) => ({ id: String(row.id), email: String(row.email), displayName: String(row.display_name), role: String(row.role) as CrmRole, status: String(row.status), lastLoginAt: nullable(row.last_login_at) })),
    auditLogs: auditRows.results.map((row) => ({ id: String(row.id), actorEmail: String(row.actor_email), action: String(row.action), recordType: String(row.record_type), recordId: nullable(row.record_id), metadata: (() => { try { return JSON.parse(String(row.metadata_json ?? "{}")) as Record<string, unknown>; } catch { return {}; } })(), createdAt: String(row.created_at) })),
    demoData: false,
    generatedAt: new Date().toISOString(),
  };
}

function mapClient(row: Record<string, unknown>): CrmClient {
  return { id: String(row.id), businessName: String(row.business_name), industry: String(row.industry), website: nullable(row.website), phone: nullable(row.phone), email: nullable(row.email), address: nullable(row.address), city: String(row.city ?? ""), state: String(row.state ?? ""), zip: String(row.zip ?? ""), timeZone: String(row.time_zone), status: String(row.status), monthlyAdBudgetCents: Number(row.monthly_ad_budget_cents ?? 0), assignedAccountManager: nullable(row.assigned_account_manager), serviceAreas: parseStringArray(row.service_areas_json), notes: String(row.notes ?? ""), createdAt: String(row.created_at) };
}

function mapContact(row: Record<string, unknown>): CrmContact {
  return { id: String(row.id), clientId: String(row.client_id), firstName: String(row.first_name), lastName: String(row.last_name), phone: nullable(row.phone), email: nullable(row.email), address: nullable(row.address), city: nullable(row.city), state: nullable(row.state), zip: nullable(row.zip), tags: parseStringArray(row.tags_json), marketingConsent: String(row.marketing_consent), lastInteractionAt: nullable(row.last_interaction_at), lifetimeValueCents: Number(row.lifetime_value_cents ?? 0), createdAt: String(row.created_at) };
}

function mapLead(row: Record<string, unknown>): CrmLead {
  return { id: String(row.id), clientId: String(row.client_id), clientName: String(row.client_name), contactId: String(row.contact_id), firstName: String(row.first_name), lastName: String(row.last_name), phone: nullable(row.phone), email: nullable(row.email), address: nullable(row.address), city: nullable(row.city), state: nullable(row.state), zip: nullable(row.zip), stageId: String(row.stage_id), stageName: String(row.stage_name), stageColor: String(row.stage_color), serviceRequested: String(row.service_requested), message: String(row.message ?? ""), source: String(row.source), campaign: nullable(row.campaign), status: String(row.status), assignedUser: nullable(row.assigned_user), estimatedValueCents: Number(row.estimated_value_cents ?? 0), finalRevenueCents: Number(row.final_revenue_cents ?? 0), appointmentDate: nullable(row.appointment_date), leadScore: Number(row.lead_score ?? 0), tags: parseStringArray(row.tags_json), consentStatus: String(row.consent_status), lostReason: nullable(row.lost_reason), lastContactedAt: nullable(row.last_contacted_at), nextFollowUpAt: nullable(row.next_follow_up_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function nullable(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function requirePermission(context: TenantContext, permission: CrmPermission) {
  if (!rolePermissions[context.role].includes(permission)) throw new Error("Forbidden");
}

export function renderCrmTemplate(template: string, values: Record<string, string | number | boolean | null | undefined>): string {
  const safeTemplate = template.slice(0, 100_000);
  return safeTemplate.replace(/\{\{\s*([a-z][a-z0-9_.]{0,79})\s*\}\}/gi, (_match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const value = values[key];
    return value === null || value === undefined ? "" : String(value).slice(0, 10_000);
  });
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

async function requireClient(context: TenantContext, clientId: string) {
  if (context.clientId && context.clientId !== clientId) throw new Error("Forbidden");
  const client = await database().prepare("SELECT id FROM crm_clients WHERE id = ? AND organization_id = ? AND status != 'archived' LIMIT 1").bind(clientId, context.organizationId).first();
  if (!client) throw new Error("Client not found.");
}

async function audit(context: TenantContext, action: string, recordType: string, recordId: string | null, metadata: Record<string, unknown> = {}, clientId: string | null = context.clientId) {
  const payload = JSON.stringify(metadata);
  const db = database();
  await db.batch([
    db.prepare("INSERT INTO audit_logs (id, organization_id, actor_email, action, record_type, record_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(`audit_${crypto.randomUUID()}`, context.organizationId, context.email.toLowerCase(), action, recordType, recordId, payload),
    db.prepare("INSERT INTO domain_events (id, organization_id, client_id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(`event_${crypto.randomUUID()}`, context.organizationId, clientId, action, recordType, recordId, payload),
  ]);
}

export type CrmAction = { action?: unknown; [key: string]: unknown };

export async function executeCrmAction(user: ChatGPTUser, input: CrmAction) {
  const context = await getTenantContext(user);
  const action = requireText(input.action, "Action", 50);
  const db = database();

  if (action === "create_lead") {
    requirePermission(context, "opportunities.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const firstName = requireText(input.firstName, "First name", 80);
    const lastName = requireText(input.lastName, "Last name", 80);
    const phone = optionalText(input.phone, 40);
    const email = optionalText(input.email, 160)?.toLowerCase() ?? null;
    if (!phone && !email) throw new Error("A phone number or email is required.");
    let contact = await db.prepare(`SELECT id FROM contacts WHERE organization_id = ? AND client_id = ? AND archived_at IS NULL AND ((? IS NOT NULL AND lower(email) = ?) OR (? IS NOT NULL AND phone = ?)) LIMIT 1`)
      .bind(context.organizationId, clientId, email, email, phone, phone)
      .first<{ id: string }>();
    if (!contact) {
      contact = { id: `contact_${crypto.randomUUID()}` };
      await db.prepare(`INSERT INTO contacts (id, organization_id, client_id, first_name, last_name, phone, email, address, city, state, zip, marketing_consent, last_interaction_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(contact.id, context.organizationId, clientId, firstName, lastName, phone, email, optionalText(input.address, 200), optionalText(input.city, 80), optionalText(input.state, 30), optionalText(input.zip, 20), input.consentStatus === "granted" ? "granted" : "unknown")
        .run();
    }
    const stage = await db.prepare("SELECT id FROM pipeline_stages WHERE organization_id = ? AND slug = 'new' LIMIT 1").bind(context.organizationId).first<{ id: string }>();
    if (!stage) throw new Error("Pipeline is unavailable.");
    const leadId = `lead_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO crm_leads (id, organization_id, client_id, contact_id, pipeline_id, stage_id, service_requested, message, source, campaign, status, assigned_user, estimated_value_cents, lead_score, tags_json, consent_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?, ?)`)
      .bind(leadId, context.organizationId, clientId, contact.id, PIPELINE_ID, stage.id, requireText(input.serviceRequested, "Service", 160), optionalText(input.message, 1200) ?? "", optionalText(input.source, 100) ?? "Manual", optionalText(input.campaign, 160), context.name, cents(input.estimatedValueCents), Math.max(0, Math.min(100, Number(input.leadScore ?? 50))), JSON.stringify(Array.isArray(input.tags) ? input.tags.slice(0, 10) : []), input.consentStatus === "granted" ? "granted" : "unknown")
      .run();
    await db.prepare(`INSERT INTO activities (id, organization_id, client_id, lead_id, contact_id, type, title, detail) VALUES (?, ?, ?, ?, ?, 'lead_created', 'Lead created', ?)`)
      .bind(`activity_${crypto.randomUUID()}`, context.organizationId, clientId, leadId, contact.id, `${optionalText(input.source, 100) ?? "Manual"} lead added`)
      .run();
    await audit(context, "lead.created", "lead", leadId);
    return { id: leadId };
  }

  if (action === "create_contact") {
    requirePermission(context, "contacts.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const id = `contact_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO contacts (id, organization_id, client_id, first_name, last_name, phone, email, address, city, state, zip, marketing_consent, last_interaction_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
      .bind(id, context.organizationId, clientId, requireText(input.firstName, "First name", 80), requireText(input.lastName, "Last name", 80), optionalText(input.phone, 40), optionalText(input.email, 160)?.toLowerCase() ?? null, optionalText(input.address, 200), optionalText(input.city, 80), optionalText(input.state, 30), optionalText(input.zip, 20), input.marketingConsent === "granted" ? "granted" : "unknown")
      .run();
    await audit(context, "contact.created", "contact", id);
    return { id };
  }

  if (action === "update_lead") {
    requirePermission(context, "opportunities.write");
    const leadId = requireText(input.leadId, "Lead", 100);
    const lead = await db.prepare("SELECT * FROM crm_leads WHERE id = ? AND organization_id = ? AND archived_at IS NULL LIMIT 1").bind(leadId, context.organizationId).first<Record<string, unknown>>();
    if (!lead) throw new Error("Lead not found.");
    await requireClient(context, String(lead.client_id));
    const allowedStatuses = new Set(["NEW", "CONTACTED", "QUALIFIED", "APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON", "LOST", "SPAM", "UNRESPONSIVE"]);
    const status = typeof input.status === "string" && allowedStatuses.has(input.status) ? input.status : String(lead.status);
    await db.prepare(`UPDATE crm_leads SET status = ?, assigned_user = ?, estimated_value_cents = ?, final_revenue_cents = ?, lost_reason = ?, next_follow_up_at = ?, last_contacted_at = CASE WHEN ? IN ('CONTACTED','QUALIFIED','APPOINTMENT_BOOKED','ESTIMATE_SENT','WON','LOST') THEN CURRENT_TIMESTAMP ELSE last_contacted_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
      .bind(status, optionalText(input.assignedUser, 120) ?? nullable(lead.assigned_user), input.estimatedValueCents === undefined ? Number(lead.estimated_value_cents) : cents(input.estimatedValueCents), input.finalRevenueCents === undefined ? Number(lead.final_revenue_cents) : cents(input.finalRevenueCents), optionalText(input.lostReason, 240) ?? nullable(lead.lost_reason), optionalText(input.nextFollowUpAt, 40) ?? nullable(lead.next_follow_up_at), status, leadId, context.organizationId)
      .run();
    await db.prepare(`INSERT INTO activities (id, organization_id, client_id, lead_id, contact_id, type, title, detail) VALUES (?, ?, ?, ?, ?, 'status_changed', 'Lead status updated', ?)`)
      .bind(`activity_${crypto.randomUUID()}`, context.organizationId, String(lead.client_id), leadId, String(lead.contact_id), status)
      .run();
    await audit(context, "lead.updated", "lead", leadId, { status });
    return { id: leadId };
  }

  if (action === "move_lead") {
    requirePermission(context, "opportunities.write");
    const leadId = requireText(input.leadId, "Lead", 100);
    const stageId = requireText(input.stageId, "Stage", 100);
    const lead = await db.prepare("SELECT client_id, contact_id, stage_id FROM crm_leads WHERE id = ? AND organization_id = ? AND archived_at IS NULL LIMIT 1").bind(leadId, context.organizationId).first<Record<string, unknown>>();
    if (!lead) throw new Error("Lead not found.");
    await requireClient(context, String(lead.client_id));
    const stage = await db.prepare("SELECT id, name, slug FROM pipeline_stages WHERE id = ? AND organization_id = ? LIMIT 1").bind(stageId, context.organizationId).first<{ id: string; name: string; slug: string }>();
    if (!stage) throw new Error("Pipeline stage not found.");
    const statusByStage: Record<string, string> = { new: "NEW", "attempting-contact": "NEW", contacted: "CONTACTED", qualified: "QUALIFIED", "appointment-booked": "APPOINTMENT_BOOKED", "estimate-sent": "ESTIMATE_SENT", won: "WON", lost: "LOST" };
    await db.prepare("UPDATE crm_leads SET stage_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(stageId, statusByStage[stage.slug] ?? "NEW", leadId, context.organizationId).run();
    await db.batch([
      db.prepare("INSERT INTO lead_stage_history (id, organization_id, lead_id, from_stage_id, to_stage_id, changed_by_email) VALUES (?, ?, ?, ?, ?, ?)").bind(`history_${crypto.randomUUID()}`, context.organizationId, leadId, String(lead.stage_id), stageId, context.email),
      db.prepare("INSERT INTO activities (id, organization_id, client_id, lead_id, contact_id, type, title, detail) VALUES (?, ?, ?, ?, ?, 'stage_changed', 'Pipeline stage changed', ?)").bind(`activity_${crypto.randomUUID()}`, context.organizationId, String(lead.client_id), leadId, String(lead.contact_id), stage.name),
    ]);
    await audit(context, "lead.stage_changed", "lead", leadId, { stageId });
    return { id: leadId };
  }

  if (action === "archive_lead") {
    requirePermission(context, "opportunities.write");
    const leadId = requireText(input.leadId, "Lead", 100);
    const lead = await db.prepare("SELECT client_id FROM crm_leads WHERE id = ? AND organization_id = ? AND archived_at IS NULL LIMIT 1").bind(leadId, context.organizationId).first<{ client_id: string }>();
    if (!lead) throw new Error("Lead not found.");
    await requireClient(context, lead.client_id);
    await db.prepare("UPDATE crm_leads SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(leadId, context.organizationId).run();
    await audit(context, "lead.archived", "lead", leadId);
    return { id: leadId };
  }

  if (action === "add_note") {
    requirePermission(context, "opportunities.write");
    const leadId = requireText(input.leadId, "Lead", 100);
    const lead = await db.prepare("SELECT client_id, contact_id FROM crm_leads WHERE id = ? AND organization_id = ? AND archived_at IS NULL LIMIT 1").bind(leadId, context.organizationId).first<{ client_id: string; contact_id: string }>();
    if (!lead) throw new Error("Lead not found.");
    await requireClient(context, lead.client_id);
    const id = `note_${crypto.randomUUID()}`;
    await db.batch([
      db.prepare("INSERT INTO crm_notes (id, organization_id, client_id, lead_id, contact_id, body, author_email) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, context.organizationId, lead.client_id, leadId, lead.contact_id, requireText(input.body, "Note", 2000), context.email),
      db.prepare("INSERT INTO activities (id, organization_id, client_id, lead_id, contact_id, type, title, detail) VALUES (?, ?, ?, ?, ?, 'note_added', 'Note added', ?)").bind(`activity_${crypto.randomUUID()}`, context.organizationId, lead.client_id, leadId, lead.contact_id, `Added by ${context.name}`),
    ]);
    await audit(context, "note.created", "lead", leadId);
    return { id };
  }

  if (action === "create_task") {
    requirePermission(context, "tasks.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const id = `task_${crypto.randomUUID()}`;
    const priority = ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(String(input.priority)) ? String(input.priority) : "MEDIUM";
    await db.prepare(`INSERT INTO tasks (id, organization_id, client_id, lead_id, contact_id, title, description, assignee, due_at, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TO_DO')`)
      .bind(id, context.organizationId, clientId, optionalText(input.leadId, 100), optionalText(input.contactId, 100), requireText(input.title, "Task title", 180), optionalText(input.description, 1000) ?? "", optionalText(input.assignee, 120) ?? context.name, optionalText(input.dueAt, 40), priority)
      .run();
    await audit(context, "task.created", "task", id);
    return { id };
  }

  if (action === "toggle_task") {
    requirePermission(context, "tasks.write");
    const taskId = requireText(input.taskId, "Task", 100);
    const task = await db.prepare("SELECT client_id, status FROM tasks WHERE id = ? AND organization_id = ? LIMIT 1").bind(taskId, context.organizationId).first<{ client_id: string; status: string }>();
    if (!task) throw new Error("Task not found.");
    await requireClient(context, task.client_id);
    const nextStatus = task.status === "COMPLETED" ? "TO_DO" : "COMPLETED";
    await db.prepare("UPDATE tasks SET status = ?, completed_at = CASE WHEN ? = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ? AND organization_id = ?").bind(nextStatus, nextStatus, taskId, context.organizationId).run();
    await audit(context, "task.status_changed", "task", taskId, { status: nextStatus });
    return { id: taskId, status: nextStatus };
  }

  if (action === "create_appointment") {
    requirePermission(context, "appointments.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const contactId = requireText(input.contactId, "Contact", 100);
    const contact = await db.prepare("SELECT id FROM contacts WHERE id = ? AND client_id = ? AND organization_id = ? LIMIT 1").bind(contactId, clientId, context.organizationId).first();
    if (!contact) throw new Error("Contact not found.");
    const startsAt = requireText(input.startsAt, "Start time", 40);
    const endsAt = requireText(input.endsAt, "End time", 40);
    if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error("End time must be after the start time.");
    const id = `appointment_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO appointments (id, organization_id, client_id, lead_id, contact_id, assigned_employee, service_type, starts_at, ends_at, address, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED')`)
      .bind(id, context.organizationId, clientId, optionalText(input.leadId, 100), contactId, optionalText(input.assignedEmployee, 120), requireText(input.serviceType, "Service", 160), startsAt, endsAt, optionalText(input.address, 240), optionalText(input.notes, 1000) ?? "")
      .run();
    await audit(context, "appointment.created", "appointment", id);
    return { id };
  }

  if (action === "update_appointment_status") {
    requirePermission(context, "appointments.write");
    const appointmentId = requireText(input.appointmentId, "Appointment", 100);
    const status = requireText(input.status, "Status", 30);
    if (!["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"].includes(status)) throw new Error("Invalid appointment status.");
    const appointment = await db.prepare("SELECT client_id FROM appointments WHERE id = ? AND organization_id = ? LIMIT 1").bind(appointmentId, context.organizationId).first<{ client_id: string }>();
    if (!appointment) throw new Error("Appointment not found.");
    await requireClient(context, appointment.client_id);
    await db.prepare("UPDATE appointments SET status = ? WHERE id = ? AND organization_id = ?").bind(status, appointmentId, context.organizationId).run();
    await audit(context, "appointment.status_changed", "appointment", appointmentId, { status });
    return { id: appointmentId, status };
  }

  if (action === "import_contacts") {
    requirePermission(context, "contacts.import");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    if (!Array.isArray(input.rows) || input.rows.length === 0) throw new Error("Choose a CSV file containing at least one contact.");
    if (input.rows.length > 500) throw new Error("A single import can contain at most 500 contacts.");

    const normalizedRows = input.rows.map((raw, index) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`CSV row ${index + 2} is invalid.`);
      const row = raw as Record<string, unknown>;
      const firstName = requireText(row.firstName, `First name on row ${index + 2}`, 80);
      const lastName = requireText(row.lastName, `Last name on row ${index + 2}`, 80);
      const phone = optionalText(row.phone, 40);
      const email = optionalText(row.email, 160)?.toLowerCase() ?? null;
      if (!phone && !email) throw new Error(`Row ${index + 2} needs a phone number or email address.`);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Row ${index + 2} contains an invalid email address.`);
      return {
        firstName,
        lastName,
        phone,
        email,
        address: optionalText(row.address, 200),
        city: optionalText(row.city, 80),
        state: optionalText(row.state, 30),
        zip: optionalText(row.zip, 20),
        companyName: optionalText(row.company, 160),
        tags: typeof row.tags === "string" ? row.tags.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20) : [],
        marketingConsent: row.marketingConsent === "granted" || row.marketingConsent === "revoked" ? row.marketingConsent : "unknown",
      };
    });

    let imported = 0;
    let skipped = 0;
    for (const row of normalizedRows) {
      const duplicate = await db.prepare(`SELECT id FROM contacts WHERE organization_id = ? AND client_id = ? AND archived_at IS NULL AND ((? IS NOT NULL AND lower(email) = ?) OR (? IS NOT NULL AND phone = ?)) LIMIT 1`)
        .bind(context.organizationId, clientId, row.email, row.email, row.phone, row.phone)
        .first<{ id: string }>();
      if (duplicate) {
        skipped += 1;
        continue;
      }
      const contactId = `contact_${crypto.randomUUID()}`;
      await db.prepare(`INSERT INTO contacts (id, organization_id, client_id, first_name, last_name, phone, email, address, city, state, zip, tags_json, marketing_consent, last_interaction_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(contactId, context.organizationId, clientId, row.firstName, row.lastName, row.phone, row.email, row.address, row.city, row.state, row.zip, JSON.stringify(row.tags), row.marketingConsent)
        .run();
      if (row.companyName) {
        let company = await db.prepare("SELECT id FROM companies WHERE organization_id = ? AND client_id = ? AND lower(name) = lower(?) AND archived_at IS NULL LIMIT 1")
          .bind(context.organizationId, clientId, row.companyName)
          .first<{ id: string }>();
        if (!company) {
          company = { id: `company_${crypto.randomUUID()}` };
          await db.prepare("INSERT INTO companies (id, organization_id, client_id, name) VALUES (?, ?, ?, ?)")
            .bind(company.id, context.organizationId, clientId, row.companyName)
            .run();
        }
        await db.prepare("INSERT OR IGNORE INTO contact_company_links (id, organization_id, client_id, contact_id, company_id, relationship, is_primary) VALUES (?, ?, ?, ?, ?, 'employee', 1)")
          .bind(`company_link_${crypto.randomUUID()}`, context.organizationId, clientId, contactId, company.id)
          .run();
      }
      imported += 1;
    }
    await audit(context, "contacts.imported", "contact_import", null, { imported, skipped, total: normalizedRows.length }, clientId);
    return { imported, skipped, total: normalizedRows.length };
  }

  if (action === "create_company") {
    requirePermission(context, "companies.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const name = requireText(input.name, "Company name", 160);
    const duplicate = await db.prepare("SELECT id FROM companies WHERE organization_id = ? AND client_id = ? AND lower(name) = lower(?) AND archived_at IS NULL LIMIT 1")
      .bind(context.organizationId, clientId, name)
      .first();
    if (duplicate) throw new Error("A company with that name already exists for this client.");
    const id = `company_${crypto.randomUUID()}`;
    const tags = typeof input.tags === "string" ? input.tags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 20) : [];
    await db.prepare(`INSERT INTO companies (id, organization_id, client_id, name, industry, website, phone, email, address, city, state, zip, tags_json, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, context.organizationId, clientId, name, optionalText(input.industry, 100), optionalText(input.website, 240), optionalText(input.phone, 40), optionalText(input.email, 160)?.toLowerCase() ?? null, optionalText(input.address, 240), optionalText(input.city, 80), optionalText(input.state, 30), optionalText(input.zip, 20), JSON.stringify(tags), optionalText(input.notes, 1500) ?? "")
      .run();
    await audit(context, "company.created", "company", id, { name }, clientId);
    return { id };
  }

  if (action === "archive_company") {
    requirePermission(context, "companies.write");
    const companyId = requireText(input.companyId, "Company", 100);
    const company = await db.prepare("SELECT client_id FROM companies WHERE id = ? AND organization_id = ? AND archived_at IS NULL LIMIT 1")
      .bind(companyId, context.organizationId)
      .first<{ client_id: string }>();
    if (!company) throw new Error("Company not found.");
    await requireClient(context, company.client_id);
    await db.prepare("UPDATE companies SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?")
      .bind(companyId, context.organizationId)
      .run();
    await audit(context, "company.archived", "company", companyId, {}, company.client_id);
    return { id: companyId };
  }

  if (action === "link_contact_company") {
    requirePermission(context, "companies.write");
    const companyId = requireText(input.companyId, "Company", 100);
    const contactId = requireText(input.contactId, "Contact", 100);
    const linkScope = await db.prepare(`SELECT co.client_id FROM companies co JOIN contacts ct ON ct.client_id = co.client_id AND ct.organization_id = co.organization_id WHERE co.id = ? AND ct.id = ? AND co.organization_id = ? AND co.archived_at IS NULL AND ct.archived_at IS NULL LIMIT 1`)
      .bind(companyId, contactId, context.organizationId)
      .first<{ client_id: string }>();
    if (!linkScope) throw new Error("The company and contact must belong to the same client.");
    await requireClient(context, linkScope.client_id);
    await db.prepare(`INSERT INTO contact_company_links (id, organization_id, client_id, contact_id, company_id, relationship, is_primary) VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(contact_id, company_id) DO UPDATE SET relationship = excluded.relationship, is_primary = 1`)
      .bind(`company_link_${crypto.randomUUID()}`, context.organizationId, linkScope.client_id, contactId, companyId, optionalText(input.relationship, 80) ?? "employee")
      .run();
    await audit(context, "company.contact_linked", "company", companyId, { contactId }, linkScope.client_id);
    return { id: companyId };
  }

  if (action === "create_custom_field") {
    requirePermission(context, "custom_data.manage");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const label = requireText(input.label, "Field label", 120);
    const entityType = String(input.entityType).toUpperCase();
    if (!["CONTACT", "COMPANY", "OPPORTUNITY"].includes(entityType)) throw new Error("Select a supported record type.");
    const fieldType = String(input.fieldType).toUpperCase();
    const supportedTypes = new Set(["TEXT", "TEXTAREA", "NUMBER", "CURRENCY", "PERCENTAGE", "DATE", "DATETIME", "CHECKBOX", "RADIO", "DROPDOWN", "MULTI_SELECT", "PHONE", "EMAIL", "URL", "ADDRESS", "USER", "CONTACT"]);
    if (!supportedTypes.has(fieldType)) throw new Error("Select a supported field type.");
    const fieldKey = (optionalText(input.fieldKey, 80) ?? label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
    if (!fieldKey) throw new Error("The field key is invalid.");
    const duplicate = await db.prepare("SELECT id FROM custom_field_definitions WHERE client_id = ? AND entity_type = ? AND field_key = ? LIMIT 1")
      .bind(clientId, entityType, fieldKey)
      .first();
    if (duplicate) throw new Error("That custom field key is already in use.");
    const options = typeof input.options === "string" ? input.options.split(/[\n,]/).map((option) => option.trim()).filter(Boolean).slice(0, 50) : [];
    if (["RADIO", "DROPDOWN", "MULTI_SELECT"].includes(fieldType) && options.length < 2) throw new Error("Choice fields need at least two options.");
    const position = await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM custom_field_definitions WHERE client_id = ? AND entity_type = ?")
      .bind(clientId, entityType)
      .first<{ next_position: number }>();
    const id = `custom_field_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO custom_field_definitions (id, organization_id, client_id, entity_type, field_key, label, field_type, options_json, is_required, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, context.organizationId, clientId, entityType, fieldKey, label, fieldType, JSON.stringify(options), input.isRequired === true, Number(position?.next_position ?? 1))
      .run();
    await audit(context, "custom_field.created", "custom_field", id, { entityType, fieldKey }, clientId);
    return { id };
  }

  if (action === "archive_custom_field") {
    requirePermission(context, "custom_data.manage");
    const fieldId = requireText(input.fieldId, "Custom field", 100);
    const field = await db.prepare("SELECT client_id FROM custom_field_definitions WHERE id = ? AND organization_id = ? AND is_active = 1 LIMIT 1")
      .bind(fieldId, context.organizationId)
      .first<{ client_id: string }>();
    if (!field) throw new Error("Custom field not found.");
    await requireClient(context, field.client_id);
    await db.prepare("UPDATE custom_field_definitions SET is_active = 0 WHERE id = ? AND organization_id = ?")
      .bind(fieldId, context.organizationId)
      .run();
    await audit(context, "custom_field.archived", "custom_field", fieldId, {}, field.client_id);
    return { id: fieldId };
  }

  if (action === "set_custom_field_value") {
    requirePermission(context, "custom_data.manage");
    const fieldId = requireText(input.fieldId, "Custom field", 100);
    const entityId = requireText(input.entityId, "Record", 100);
    const field = await db.prepare("SELECT client_id, entity_type, field_type, is_required FROM custom_field_definitions WHERE id = ? AND organization_id = ? AND is_active = 1 LIMIT 1")
      .bind(fieldId, context.organizationId)
      .first<{ client_id: string; entity_type: string; field_type: string; is_required: number }>();
    if (!field) throw new Error("Custom field not found.");
    await requireClient(context, field.client_id);
    const tableByEntity: Record<string, string> = { CONTACT: "contacts", COMPANY: "companies", OPPORTUNITY: "crm_leads" };
    const table = tableByEntity[field.entity_type];
    if (!table) throw new Error("Unsupported custom-field record type.");
    const record = await db.prepare(`SELECT id FROM ${table} WHERE id = ? AND organization_id = ? AND client_id = ? AND archived_at IS NULL LIMIT 1`)
      .bind(entityId, context.organizationId, field.client_id)
      .first();
    if (!record) throw new Error("The selected record was not found.");
    let value: string | number | boolean | string[] | null = null;
    if (["NUMBER", "CURRENCY", "PERCENTAGE"].includes(field.field_type)) {
      const numberValue = Number(input.value);
      if (!Number.isFinite(numberValue)) throw new Error("Enter a valid number.");
      value = numberValue;
    } else if (field.field_type === "CHECKBOX") {
      value = input.value === true || input.value === "true";
    } else if (field.field_type === "MULTI_SELECT") {
      value = Array.isArray(input.value) ? input.value.filter((item): item is string => typeof item === "string").slice(0, 50) : [];
    } else {
      value = optionalText(input.value, 2000);
    }
    if (field.is_required && (value === null || value === "" || (Array.isArray(value) && !value.length))) throw new Error("This custom field is required.");
    const id = `custom_field_value_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO custom_field_values (id, organization_id, client_id, definition_id, entity_type, entity_id, value_json, updated_by_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(definition_id, entity_id) DO UPDATE SET value_json = excluded.value_json, updated_by_email = excluded.updated_by_email, updated_at = CURRENT_TIMESTAMP`)
      .bind(id, context.organizationId, field.client_id, fieldId, field.entity_type, entityId, JSON.stringify(value), context.email)
      .run();
    await audit(context, "custom_field.value_updated", field.entity_type.toLowerCase(), entityId, { fieldId }, field.client_id);
    return { id };
  }

  if (action === "upsert_custom_value") {
    requirePermission(context, "custom_data.manage");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const label = requireText(input.label, "Label", 120);
    let valueKey = requireText(input.valueKey, "Key", 100).toLowerCase().replace(/\s+/g, "_");
    if (!valueKey.includes(".")) valueKey = `custom.${valueKey}`;
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(valueKey)) throw new Error("Use a key such as custom.offer or business.phone.");
    const value = requireText(input.value, "Value", 5000);
    const existing = await db.prepare("SELECT id FROM custom_values WHERE client_id = ? AND value_key = ? LIMIT 1").bind(clientId, valueKey).first<{ id: string }>();
    const id = existing?.id ?? `custom_value_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO custom_values (id, organization_id, client_id, value_key, label, value) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(client_id, value_key) DO UPDATE SET label = excluded.label, value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
      .bind(id, context.organizationId, clientId, valueKey, label, value)
      .run();
    await audit(context, existing ? "custom_value.updated" : "custom_value.created", "custom_value", id, { valueKey }, clientId);
    return { id };
  }

  if (action === "delete_custom_value") {
    requirePermission(context, "custom_data.manage");
    const valueId = requireText(input.valueId, "Custom value", 100);
    const customValue = await db.prepare("SELECT client_id FROM custom_values WHERE id = ? AND organization_id = ? LIMIT 1")
      .bind(valueId, context.organizationId)
      .first<{ client_id: string }>();
    if (!customValue) throw new Error("Custom value not found.");
    await requireClient(context, customValue.client_id);
    await db.prepare("DELETE FROM custom_values WHERE id = ? AND organization_id = ?").bind(valueId, context.organizationId).run();
    await audit(context, "custom_value.deleted", "custom_value", valueId, {}, customValue.client_id);
    return { id: valueId };
  }

  if (action === "create_client") {
    requirePermission(context, "clients.manage");
    const businessName = requireText(input.businessName, "Business name", 160);
    const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || crypto.randomUUID();
    const legacyId = `client_${crypto.randomUUID()}`;
    const clientId = `crm_client_${crypto.randomUUID()}`;
    await db.batch([
      db.prepare("INSERT INTO clients (id, name, slug, industry, city, state, domain) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(legacyId, businessName, `${slug}-${crypto.randomUUID().slice(0, 6)}`, requireText(input.industry, "Industry", 100), optionalText(input.city, 80) ?? "", optionalText(input.state, 30) ?? "", optionalText(input.website, 200)?.replace(/^https?:\/\//, "") ?? null),
      db.prepare(`INSERT INTO crm_clients (id, organization_id, legacy_client_id, business_name, industry, website, phone, email, address, city, state, zip, time_zone, status, monthly_ad_budget_cents, assigned_account_manager, service_areas_json, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
        .bind(clientId, context.organizationId, legacyId, businessName, requireText(input.industry, "Industry", 100), optionalText(input.website, 200), optionalText(input.phone, 40), optionalText(input.email, 160), optionalText(input.address, 240), optionalText(input.city, 80) ?? "", optionalText(input.state, 30) ?? "", optionalText(input.zip, 20) ?? "", optionalText(input.timeZone, 80) ?? "America/Chicago", cents(input.monthlyAdBudgetCents), optionalText(input.assignedAccountManager, 120) ?? context.name, JSON.stringify(typeof input.serviceAreas === "string" ? input.serviceAreas.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30) : []), optionalText(input.notes, 1500) ?? ""),
    ]);
    await audit(context, "client.created", "client", clientId);
    return { id: clientId };
  }

  if (action === "save_website") {
    requirePermission(context, "websites.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    const websiteId = optionalText(input.websiteId, 100);
    const name = requireText(input.name, "Website name", 160);
    const domain = normalizeDomain(input.domain);
    const platform = optionalText(input.platform, 40)?.toLowerCase() ?? "other";
    if (websiteId) {
      const existing = await db.prepare("SELECT id FROM websites WHERE id = ? AND organization_id = ? AND client_id = ? LIMIT 1").bind(websiteId, context.organizationId, clientId).first();
      if (!existing) throw new Error("Website connection not found.");
      await db.prepare("UPDATE websites SET name = ?, domain = ?, platform = ?, status = 'connected', lead_capture_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(name, domain, platform, websiteId, context.organizationId).run();
      await audit(context, "website.updated", "website", websiteId, { domain, platform }, clientId);
      return { id: websiteId };
    }
    const id = `website_${crypto.randomUUID()}`;
    await db.prepare("INSERT INTO websites (id, organization_id, client_id, name, domain, status, platform, lead_capture_enabled) VALUES (?, ?, ?, ?, ?, 'connected', ?, 1)").bind(id, context.organizationId, clientId, name, domain, platform).run();
    await audit(context, "website.connected", "website", id, { domain, platform }, clientId);
    return { id };
  }

  if (action === "disconnect_website") {
    requirePermission(context, "websites.manage");
    const websiteId = requireText(input.websiteId, "Website", 100);
    const website = await db.prepare("SELECT client_id FROM websites WHERE id = ? AND organization_id = ? LIMIT 1").bind(websiteId, context.organizationId).first<{ client_id: string }>();
    if (!website) throw new Error("Website connection not found.");
    await requireClient(context, website.client_id);
    await db.prepare("UPDATE websites SET status = 'disconnected', lead_capture_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(websiteId, context.organizationId).run();
    await audit(context, "website.disconnected", "website", websiteId, {}, website.client_id);
    return { id: websiteId };
  }

  if (action === "archive_client") {
    requirePermission(context, "clients.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    await db.prepare("UPDATE crm_clients SET status = 'archived', archived_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?").bind(clientId, context.organizationId).run();
    await audit(context, "client.archived", "client", clientId);
    return { id: clientId };
  }

  if (action === "invite_member") {
    requirePermission(context, "team.manage");
    const email = requireText(input.email, "Email", 160).toLowerCase();
    if (!email.includes("@")) throw new Error("Enter a valid email address.");
    const displayName = requireText(input.displayName, "Name", 120);
    const role = String(input.role) as CrmRole;
    if (!["AGENCY_ADMIN", "AGENCY_MEMBER"].includes(role)) throw new Error("Select a valid agency role.");
    const existing = await db.prepare("SELECT id FROM accounts WHERE lower(email) = ? LIMIT 1").bind(email).first<{ id: string }>();
    const accountId = existing?.id ?? `account_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO accounts (id, email, display_name, role, status) VALUES (?, ?, ?, 'admin', 'active') ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, role = 'admin', status = 'active'`)
      .bind(accountId, email, displayName)
      .run();
    await db.prepare(`INSERT INTO organization_members (id, organization_id, account_id, role, status) VALUES (?, ?, ?, ?, 'active') ON CONFLICT(organization_id, account_id) DO UPDATE SET role = excluded.role, status = 'active'`)
      .bind(`org_member_${crypto.randomUUID()}`, context.organizationId, accountId, role)
      .run();
    await audit(context, "member.invited", "account", accountId, { role });
    return { id: accountId };
  }

  throw new Error("Unsupported action.");
}
