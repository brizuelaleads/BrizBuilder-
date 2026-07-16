import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Legacy BrizBuilder access tables are retained so existing accounts and client
// assignments continue to work while the CRM data model is introduced.
export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  industry: text("industry").notNull().default("Service business"),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  domain: text("domain"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["admin", "client"] }).notNull(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastLoginAt: text("last_login_at"),
  },
  (table) => [index("accounts_client_id_idx").on(table.clientId)],
);

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    contactName: text("contact_name").notNull(),
    service: text("service").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("leads_client_id_idx").on(table.clientId)],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    targetId: text("target_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("audit_events_actor_idx").on(table.actorEmail)],
);

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const organizationMembers = sqliteTable(
  "organization_members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["SUPER_ADMIN", "AGENCY_OWNER", "AGENCY_ADMIN", "AGENCY_MEMBER"] }).notNull(),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("organization_members_org_account_uidx").on(table.organizationId, table.accountId),
    index("organization_members_account_idx").on(table.accountId),
  ],
);

export const crmClients = sqliteTable(
  "crm_clients",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    legacyClientId: text("legacy_client_id").references(() => clients.id, { onDelete: "set null" }),
    businessName: text("business_name").notNull(),
    logoUrl: text("logo_url"),
    industry: text("industry").notNull(),
    website: text("website"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    city: text("city").notNull().default(""),
    state: text("state").notNull().default(""),
    zip: text("zip").notNull().default(""),
    timeZone: text("time_zone").notNull().default("America/Chicago"),
    status: text("status", { enum: ["active", "paused", "archived"] }).notNull().default("active"),
    monthlyAdBudgetCents: integer("monthly_ad_budget_cents").notNull().default(0),
    assignedAccountManager: text("assigned_account_manager"),
    serviceAreasJson: text("service_areas_json").notNull().default("[]"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("crm_clients_org_status_idx").on(table.organizationId, table.status),
    uniqueIndex("crm_clients_legacy_uidx").on(table.legacyClientId),
  ],
);

export const clientMembers = sqliteTable(
  "client_members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["CLIENT_OWNER", "CLIENT_MANAGER", "CLIENT_EMPLOYEE"] }).notNull(),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("client_members_client_account_uidx").on(table.clientId, table.accountId),
    index("client_members_account_idx").on(table.accountId),
  ],
);

export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    industry: text("industry"),
    website: text("website"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    tagsJson: text("tags_json").notNull().default("[]"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("companies_org_client_name_idx").on(table.organizationId, table.clientId, table.name),
    index("companies_email_idx").on(table.email),
  ],
);

export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    company: text("company"),
    tagsJson: text("tags_json").notNull().default("[]"),
    notes: text("notes").notNull().default(""),
    marketingConsent: text("marketing_consent", { enum: ["unknown", "granted", "revoked"] }).notNull().default("unknown"),
    lastInteractionAt: text("last_interaction_at"),
    lifetimeValueCents: integer("lifetime_value_cents").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("contacts_org_client_idx").on(table.organizationId, table.clientId),
    index("contacts_phone_idx").on(table.phone),
    index("contacts_email_idx").on(table.email),
  ],
);

export const contactCompanyLinks = sqliteTable(
  "contact_company_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    relationship: text("relationship").notNull().default("employee"),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("contact_company_links_contact_company_uidx").on(table.contactId, table.companyId),
    index("contact_company_links_company_idx").on(table.companyId),
  ],
);

export const customFieldDefinitions = sqliteTable(
  "custom_field_definitions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: ["CONTACT", "COMPANY", "OPPORTUNITY"] }).notNull(),
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    optionsJson: text("options_json").notNull().default("[]"),
    isRequired: integer("is_required", { mode: "boolean" }).notNull().default(false),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("custom_field_definitions_client_entity_key_uidx").on(table.clientId, table.entityType, table.fieldKey),
    index("custom_field_definitions_scope_idx").on(table.organizationId, table.clientId, table.entityType, table.position),
  ],
);

export const customFieldValues = sqliteTable(
  "custom_field_values",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
    definitionId: text("definition_id").notNull().references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: ["CONTACT", "COMPANY", "OPPORTUNITY"] }).notNull(),
    entityId: text("entity_id").notNull(),
    valueJson: text("value_json").notNull().default("null"),
    updatedByEmail: text("updated_by_email").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("custom_field_values_definition_entity_uidx").on(table.definitionId, table.entityId),
    index("custom_field_values_entity_idx").on(table.organizationId, table.clientId, table.entityType, table.entityId),
  ],
);

export const customValues = sqliteTable(
  "custom_values",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
    valueKey: text("value_key").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("custom_values_client_key_uidx").on(table.clientId, table.valueKey),
    index("custom_values_scope_idx").on(table.organizationId, table.clientId),
  ],
);

export const featureFlags = sqliteTable(
  "feature_flags",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => crmClients.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    rolloutStatus: text("rollout_status", { enum: ["disabled", "beta", "enabled"] }).notNull().default("disabled"),
    source: text("source").notNull().default("platform"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("feature_flags_scope_module_uidx").on(table.organizationId, table.clientId, table.moduleKey),
    index("feature_flags_org_module_idx").on(table.organizationId, table.moduleKey),
  ],
);

export const pipelines = sqliteTable("pipelines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: text("client_id").references(() => crmClients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const pipelineStages = sqliteTable(
  "pipeline_stages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    pipelineId: text("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    color: text("color").notNull(),
    position: integer("position").notNull(),
    isWon: integer("is_won", { mode: "boolean" }).notNull().default(false),
    isLost: integer("is_lost", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    uniqueIndex("pipeline_stages_pipeline_slug_uidx").on(table.pipelineId, table.slug),
    index("pipeline_stages_position_idx").on(table.pipelineId, table.position),
  ],
);

export const crmLeads = sqliteTable(
  "crm_leads",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
    pipelineId: text("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "restrict" }),
    stageId: text("stage_id").notNull().references(() => pipelineStages.id, { onDelete: "restrict" }),
    serviceRequested: text("service_requested").notNull(),
    message: text("message").notNull().default(""),
    source: text("source").notNull().default("Manual"),
    campaign: text("campaign"),
    status: text("status", { enum: ["NEW", "CONTACTED", "QUALIFIED", "APPOINTMENT_BOOKED", "ESTIMATE_SENT", "WON", "LOST", "SPAM", "UNRESPONSIVE"] }).notNull().default("NEW"),
    assignedUser: text("assigned_user"),
    estimatedValueCents: integer("estimated_value_cents").notNull().default(0),
    finalRevenueCents: integer("final_revenue_cents").notNull().default(0),
    appointmentDate: text("appointment_date"),
    leadScore: integer("lead_score").notNull().default(50),
    tagsJson: text("tags_json").notNull().default("[]"),
    consentStatus: text("consent_status", { enum: ["unknown", "granted", "revoked"] }).notNull().default("unknown"),
    lostReason: text("lost_reason"),
    lastContactedAt: text("last_contacted_at"),
    nextFollowUpAt: text("next_follow_up_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("crm_leads_org_client_created_idx").on(table.organizationId, table.clientId, table.createdAt),
    index("crm_leads_org_stage_idx").on(table.organizationId, table.stageId),
    index("crm_leads_org_status_idx").on(table.organizationId, table.status),
    index("crm_leads_contact_idx").on(table.contactId),
  ],
);

export const leadStageHistory = sqliteTable(
  "lead_stage_history",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    leadId: text("lead_id").notNull().references(() => crmLeads.id, { onDelete: "cascade" }),
    fromStageId: text("from_stage_id").references(() => pipelineStages.id, { onDelete: "set null" }),
    toStageId: text("to_stage_id").notNull().references(() => pipelineStages.id, { onDelete: "restrict" }),
    changedByEmail: text("changed_by_email").notNull(),
    changedAt: text("changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("lead_stage_history_lead_idx").on(table.leadId, table.changedAt)],
);

export const crmNotes = sqliteTable(
  "crm_notes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
    leadId: text("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorEmail: text("author_email").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("crm_notes_lead_idx").on(table.leadId, table.createdAt)],
);

export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
    leadId: text("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("activities_lead_time_idx").on(table.leadId, table.occurredAt)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
    leadId: text("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    assignee: text("assignee"),
    dueAt: text("due_at"),
    priority: text("priority", { enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] }).notNull().default("MEDIUM"),
    status: text("status", { enum: ["TO_DO", "IN_PROGRESS", "COMPLETED", "CANCELED"] }).notNull().default("TO_DO"),
    reminderAt: text("reminder_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [index("tasks_org_status_due_idx").on(table.organizationId, table.status, table.dueAt)],
);

export const appointments = sqliteTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => crmClients.id, { onDelete: "cascade" }),
    leadId: text("lead_id").references(() => crmLeads.id, { onDelete: "set null" }),
    contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "restrict" }),
    assignedEmployee: text("assigned_employee"),
    serviceType: text("service_type").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    address: text("address"),
    notes: text("notes").notNull().default(""),
    status: text("status", { enum: ["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"] }).notNull().default("SCHEDULED"),
    reminderMinutes: integer("reminder_minutes").notNull().default(60),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("appointments_org_start_idx").on(table.organizationId, table.startsAt)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    recordType: text("record_type").notNull(),
    recordId: text("record_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("audit_logs_org_time_idx").on(table.organizationId, table.createdAt)],
);

export const domainEvents = sqliteTable(
  "domain_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => crmClients.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id"),
    payloadJson: text("payload_json").notNull().default("{}"),
    processingStatus: text("processing_status", { enum: ["pending", "processed", "failed"] }).notNull().default("pending"),
    occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    processedAt: text("processed_at"),
  },
  (table) => [
    index("domain_events_pending_idx").on(table.processingStatus, table.occurredAt),
    index("domain_events_org_type_idx").on(table.organizationId, table.eventType, table.occurredAt),
  ],
);
