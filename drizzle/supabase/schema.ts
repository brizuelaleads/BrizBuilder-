import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
