import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appRole = pgEnum("app_role", [
  "SUPER_ADMIN",
  "AGENCY_OWNER",
  "AGENCY_ADMIN",
  "AGENCY_MEMBER",
  "CLIENT_OWNER",
  "CLIENT_MANAGER",
  "CLIENT_EMPLOYEE",
]);

export const recordStatus = pgEnum("record_status", [
  "active",
  "paused",
  "archived",
]);

export const leadStatus = pgEnum("lead_status", [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "APPOINTMENT_BOOKED",
  "ESTIMATE_SENT",
  "WON",
  "LOST",
  "SPAM",
  "UNRESPONSIVE",
]);

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: recordStatus("status").notNull().default("active"),
  createdAt,
  updatedAt,
});

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  status: recordStatus("status").notNull().default("active"),
  createdAt,
  updatedAt,
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: appRole("role").notNull(),
    status: recordStatus("status").notNull().default("active"),
    createdAt,
  },
  (table) => [
    uniqueIndex("organization_members_org_profile_uidx").on(
      table.organizationId,
      table.profileId,
    ),
    index("organization_members_profile_idx").on(table.profileId),
  ],
);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    businessName: text("business_name").notNull(),
    slug: text("slug").notNull(),
    industry: text("industry").notNull(),
    website: text("website"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    city: text("city").notNull().default(""),
    state: text("state").notNull().default(""),
    zip: text("zip").notNull().default(""),
    timeZone: text("time_zone").notNull().default("America/Chicago"),
    status: recordStatus("status").notNull().default("active"),
    monthlyAdBudgetCents: integer("monthly_ad_budget_cents")
      .notNull()
      .default(0),
    assignedAccountManager: text("assigned_account_manager"),
    serviceAreas: text("service_areas")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text("notes").notNull().default(""),
    createdAt,
    updatedAt,
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("clients_org_slug_uidx").on(table.organizationId, table.slug),
    uniqueIndex("clients_organization_id_id_uidx").on(
      table.organizationId,
      table.id,
    ),
    index("clients_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const clientMembers = pgTable(
  "client_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: appRole("role").notNull(),
    status: recordStatus("status").notNull().default("active"),
    createdAt,
  },
  (table) => [
    uniqueIndex("client_members_client_profile_uidx").on(
      table.clientId,
      table.profileId,
    ),
    index("client_members_profile_idx").on(table.profileId),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    company: text("company"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    marketingConsent: text("marketing_consent").notNull().default("unknown"),
    notes: text("notes").notNull().default(""),
    lifetimeValueCents: integer("lifetime_value_cents").notNull().default(0),
    lastInteractionAt: timestamp("last_interaction_at", {
      withTimezone: true,
    }),
    createdAt,
    updatedAt,
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("contacts_client_idx").on(table.organizationId, table.clientId),
  ],
);

export const pipelines = pgTable("pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(true),
  createdAt,
});

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    color: text("color").notNull().default("#2563eb"),
    position: integer("position").notNull().default(0),
    isWon: boolean("is_won").notNull().default(false),
    isLost: boolean("is_lost").notNull().default(false),
  },
  (table) => [
    uniqueIndex("pipeline_stages_pipeline_slug_uidx").on(
      table.pipelineId,
      table.slug,
    ),
    index("pipeline_stages_position_idx").on(table.pipelineId, table.position),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    pipelineId: uuid("pipeline_id").references(() => pipelines.id, {
      onDelete: "set null",
    }),
    stageId: uuid("stage_id").references(() => pipelineStages.id, {
      onDelete: "set null",
    }),
    serviceRequested: text("service_requested").notNull(),
    message: text("message").notNull().default(""),
    source: text("source").notNull().default("Manual"),
    campaign: text("campaign"),
    status: leadStatus("status").notNull().default("NEW"),
    assignedUser: text("assigned_user"),
    estimatedValueCents: integer("estimated_value_cents").notNull().default(0),
    finalRevenueCents: integer("final_revenue_cents").notNull().default(0),
    appointmentDate: timestamp("appointment_date", { withTimezone: true }),
    leadScore: integer("lead_score").notNull().default(50),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    consentStatus: text("consent_status").notNull().default("unknown"),
    lostReason: text("lost_reason"),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    createdAt,
    updatedAt,
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("leads_client_status_idx").on(
      table.organizationId,
      table.clientId,
      table.status,
    ),
    index("leads_stage_idx").on(table.stageId),
  ],
);

export const websites = pgTable("websites", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  domain: text("domain"),
  status: text("status").notNull().default("draft"),
  brandColors: jsonb("brand_colors").notNull().default({}),
  seo: jsonb("seo").notNull().default({}),
  analytics: jsonb("analytics").notNull().default({}),
  createdAt,
  updatedAt,
});

export const phoneSystemConfigs = pgTable("phone_system_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("twilio"),
  providerAccountSid: text("provider_account_sid"),
  phoneNumberSid: text("phone_number_sid"),
  messagingServiceSid: text("messaging_service_sid"),
  phoneNumber: text("phone_number"),
  forwardingNumber: text("forwarding_number"),
  ringTimeoutSeconds: integer("ring_timeout_seconds").notNull().default(20),
  voicemailEnabled: boolean("voicemail_enabled").notNull().default(true),
  missedCallTextEnabled: boolean("missed_call_text_enabled").notNull().default(false),
  missedCallMessage: text("missed_call_message").notNull(),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(20),
  businessHours: jsonb("business_hours").notNull().default({}),
  providerStatus: text("provider_status").notNull().default("not_configured"),
  a2pStatus: text("a2p_status").notNull().default("not_started"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  createdAt,
  updatedAt,
}, (table) => [uniqueIndex("phone_configs_org_client_uidx").on(table.organizationId, table.clientId), index("phone_configs_number_idx").on(table.phoneNumber)]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("sms"),
  status: text("status").notNull().default("open"),
  assignedTo: text("assigned_to"),
  unreadCount: integer("unread_count").notNull().default(0),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt,
  updatedAt,
}, (table) => [uniqueIndex("conversations_client_contact_channel_uidx").on(table.clientId, table.contactId, table.channel), index("conversations_scope_time_idx").on(table.organizationId, table.clientId, table.lastMessageAt)]);

export const phoneCalls = pgTable("phone_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  providerCallSid: text("provider_call_sid").notNull().unique(),
  direction: text("direction").notNull().default("inbound"),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  forwardedTo: text("forwarded_to"),
  status: text("status").notNull().default("initiated"),
  answeredBy: text("answered_by"),
  durationSeconds: integer("duration_seconds"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  missedCallTextSentAt: timestamp("missed_call_text_sent_at", { withTimezone: true }),
  rawEvent: jsonb("raw_event").notNull().default({}),
  createdAt,
  updatedAt,
}, (table) => [index("phone_calls_scope_time_idx").on(table.organizationId, table.clientId, table.startedAt)]);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  providerMessageSid: text("provider_message_sid").unique(),
  direction: text("direction").notNull(),
  channel: text("channel").notNull().default("sms"),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("queued"),
  automationKey: text("automation_key"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt,
  updatedAt,
}, (table) => [index("messages_conversation_time_idx").on(table.conversationId, table.createdAt)]);

export const automationRules = pgTable("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  triggerKey: text("trigger_key").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  config: jsonb("config").notNull().default({}),
  createdAt,
  updatedAt,
}, (table) => [uniqueIndex("automation_rules_client_trigger_uidx").on(table.clientId, table.triggerKey)]);

export const automationRuns = pgTable("automation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  ruleId: uuid("rule_id").references(() => automationRules.id, { onDelete: "set null" }),
  triggerEventId: text("trigger_event_id").notNull(),
  status: text("status").notNull().default("started"),
  input: jsonb("input").notNull().default({}),
  output: jsonb("output").notNull().default({}),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [uniqueIndex("automation_runs_client_event_uidx").on(table.clientId, table.triggerEventId)]);

export const providerConnections = pgTable("provider_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("not_connected"),
  billingOwner: text("billing_owner").notNull().default("customer"),
  externalAccountId: text("external_account_id"),
  externalAccountName: text("external_account_name"),
  scopes: jsonb("scopes").notNull().default([]),
  publicConfig: jsonb("public_config").notNull().default({}),
  connectedByEmail: text("connected_by_email"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt,
  updatedAt,
}, (table) => [uniqueIndex("provider_connections_org_client_provider_uidx").on(table.organizationId, table.clientId, table.provider), index("provider_connections_scope_idx").on(table.organizationId, table.clientId, table.provider)]);

export const providerAuthorizationStates = pgTable("provider_authorization_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  stateHash: text("state_hash").notNull().unique(),
  requestedByEmail: text("requested_by_email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt,
}, (table) => [index("provider_auth_expiry_idx").on(table.provider, table.expiresAt)]);

export const googleBusinessProfiles = pgTable("google_business_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("not_connected"),
  accountName: text("account_name"),
  accountId: text("account_id"),
  locationName: text("location_name"),
  locationId: text("location_id"),
  businessName: text("business_name"),
  address: text("address"),
  phone: text("phone"),
  website: text("website"),
  primaryCategory: text("primary_category"),
  googleReviewUrl: text("google_review_url"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt,
  updatedAt,
}, (table) => [
  unique("google_business_profiles_organization_id_client_id_key").on(table.organizationId, table.clientId),
  foreignKey({
    columns: [table.organizationId, table.clientId],
    foreignColumns: [clients.organizationId, clients.id],
    name: "google_business_profiles_organization_client_fk",
  }).onDelete("cascade"),
  index("google_business_profiles_scope_idx").on(table.organizationId, table.clientId, table.status),
]);

export const googleBusinessCredentials = pgTable("google_business_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
  refreshTokenIv: text("refresh_token_iv").notNull(),
  scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
  connectedByEmail: text("connected_by_email").notNull(),
  createdAt,
  updatedAt,
}, (table) => [
  unique("google_business_credentials_organization_id_client_id_key").on(table.organizationId, table.clientId),
  foreignKey({
    columns: [table.organizationId, table.clientId],
    foreignColumns: [clients.organizationId, clients.id],
    name: "google_business_credentials_organization_client_fk",
  }).onDelete("cascade"),
  index("google_business_credentials_scope_idx").on(table.organizationId, table.clientId),
]);

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("draft"),
  triggerKey: text("trigger_key").notNull().default("lead.created"),
  currentVersion: integer("current_version").notNull().default(1),
  publishedVersion: integer("published_version"),
  createdByEmail: text("created_by_email").notNull(),
  createdAt,
  updatedAt,
}, (table) => [index("workflows_scope_status_idx").on(table.organizationId, table.clientId, table.status, table.updatedAt)]);

export const workflowVersions = pgTable("workflow_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  graph: jsonb("graph").notNull().default({ nodes: [], edges: [] }),
  validationErrors: jsonb("validation_errors").notNull().default([]),
  createdByEmail: text("created_by_email").notNull(),
  createdAt,
}, (table) => [uniqueIndex("workflow_versions_workflow_version_uidx").on(table.workflowId, table.version)]);

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  triggerKey: text("trigger_key").notNull(),
  triggerEventId: text("trigger_event_id").notNull(),
  status: text("status").notNull().default("running"),
  isTest: boolean("is_test").notNull().default(false),
  input: jsonb("input").notNull().default({}),
  output: jsonb("output").notNull().default({}),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [uniqueIndex("workflow_runs_workflow_event_uidx").on(table.workflowId, table.triggerEventId), index("workflow_runs_scope_time_idx").on(table.organizationId, table.clientId, table.startedAt)]);

export const workflowRunSteps = pgTable("workflow_run_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull(),
  status: text("status").notNull(),
  input: jsonb("input").notNull().default({}),
  output: jsonb("output").notNull().default({}),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [index("workflow_run_steps_run_idx").on(table.runId, table.startedAt)]);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    actorProfileId: uuid("actor_profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    recordType: text("record_type").notNull(),
    recordId: text("record_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt,
  },
  (table) => [
    index("audit_events_org_time_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);
