import type { ChatGPTUser } from "../app/chatgpt-auth";
import { MAIN_ADMIN_EMAIL } from "../app/auth-config";
import { getSupabaseAdminClient } from "../lib/supabase/server";
import { getAiConnectorRuntime } from "../lib/ai-connector/config";
import {
  buildGoogleAuthorizationUrl,
  decryptGoogleSecret,
  encryptGoogleSecret,
  exchangeGoogleAuthorizationCode,
  getGoogleBusinessRuntimeStatus,
  listGoogleBusinessReviews,
  listGoogleBusinessLocations,
  deleteGoogleBusinessReviewReply,
  refreshGoogleAccessToken,
  revokeGoogleRefreshToken,
  updateGoogleBusinessReviewReply,
  type GoogleBusinessLocation,
} from "../lib/google-business";
import {
  buildTwilioConnectUrl,
  checkTwilioConnectedAccount,
  configureTwilioNumber,
  getTwilioConnectStatus,
  getTwilioRuntimeStatus,
  getTwilioVisibleBalance,
  listTwilioNumbers,
  purchaseTwilioNumber,
  renderMessageTemplate,
  searchTwilioNumbers,
  sendTwilioMessage,
  TwilioMessageDeliveryUnknownError,
} from "../lib/twilio";
import {
  executeWorkflow,
  runPublishedWorkflowsForEvent,
  validateWorkflowGraph,
  type WorkflowGraph,
} from "../lib/workflow-engine";
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
  CrmProviderConnection,
  CrmAiAuthorization,
  CrmAiActivity,
  CrmWorkflow,
  CrmWorkflowRun,
  CrmGoogleProfile,
  CrmReviewRequest,
  CrmReviewSettings,
} from "./crm";

type TenantContext = {
  organizationId: string;
  organizationName: string;
  email: string;
  name: string;
  role: CrmRole;
  clientId: string | null;
};

export type SupabaseTenantContext = TenantContext;

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
  SUPER_ADMIN: [
    "clients.manage",
    "contacts.write",
    "contacts.import",
    "companies.write",
    "opportunities.write",
    "tasks.write",
    "appointments.write",
    "websites.manage",
    "profiles.manage",
    "profiles.connect",
    "reviews.read",
    "reviews.reply",
    "reviews.request",
    "reviews.settings.manage",
    "phone_system.manage",
    "billing.read_shared",
    "messages.write",
    "automations.manage",
    "ai_connector.manage",
    "custom_data.manage",
    "team.manage",
    "audit.read",
    "feature_flags.manage",
  ],
  AGENCY_OWNER: [
    "clients.manage",
    "contacts.write",
    "contacts.import",
    "companies.write",
    "opportunities.write",
    "tasks.write",
    "appointments.write",
    "websites.manage",
    "profiles.manage",
    "profiles.connect",
    "reviews.read",
    "reviews.reply",
    "reviews.request",
    "reviews.settings.manage",
    "phone_system.manage",
    "billing.read_shared",
    "messages.write",
    "automations.manage",
    "ai_connector.manage",
    "custom_data.manage",
    "team.manage",
    "audit.read",
    "feature_flags.manage",
  ],
  AGENCY_ADMIN: [
    "clients.manage",
    "contacts.write",
    "contacts.import",
    "companies.write",
    "opportunities.write",
    "tasks.write",
    "appointments.write",
    "websites.manage",
    "profiles.manage",
    "profiles.connect",
    "reviews.read",
    "reviews.reply",
    "reviews.request",
    "reviews.settings.manage",
    "phone_system.manage",
    "billing.read_shared",
    "messages.write",
    "automations.manage",
    "ai_connector.manage",
    "custom_data.manage",
    "team.manage",
    "audit.read",
    "feature_flags.manage",
  ],
  AGENCY_MEMBER: [
    "contacts.write",
    "contacts.import",
    "companies.write",
    "opportunities.write",
    "tasks.write",
    "appointments.write",
    "websites.manage",
    "profiles.manage",
    "reviews.read",
    "reviews.reply",
    "reviews.request",
    "messages.write",
  ],
  CLIENT_OWNER: [
    "contacts.write",
    "contacts.import",
    "companies.write",
    "opportunities.write",
    "tasks.write",
    "appointments.write",
    "websites.manage",
    "profiles.manage",
    "profiles.connect",
    "reviews.read",
    "reviews.reply",
    "reviews.request",
    "reviews.settings.manage",
    "phone_system.manage",
    "billing.read_shared",
    "messages.write",
    "automations.manage",
    "ai_connector.manage",
    "custom_data.manage",
  ],
  CLIENT_MANAGER: [
    "contacts.write",
    "companies.write",
    "opportunities.write",
    "tasks.write",
    "appointments.write",
    "websites.manage",
    "profiles.manage",
    "reviews.read",
    "reviews.reply",
    "reviews.request",
    "reviews.settings.manage",
    "phone_system.manage",
    "messages.write",
    "automations.manage",
    "ai_connector.manage",
    "custom_data.manage",
  ],
  CLIENT_EMPLOYEE: [
    "contacts.write",
    "companies.write",
    "opportunities.write",
    "tasks.write",
    "appointments.write",
    "reviews.read",
    "messages.write",
  ],
};

function supabase() {
  return getSupabaseAdminClient();
}

function googleProfileRuntime() {
  return {
    configured: getGoogleBusinessRuntimeStatus().ready,
  };
}

function nullable(value: unknown): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : String(value);
}

function requireText(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} is required.`);
  return value.trim().slice(0, max);
}

function optionalText(value: unknown, max = 500): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, max);
}

const DEFAULT_REVIEW_SMS_TEMPLATE =
  "Hi {{first_name}}, thank you for choosing {{business_name}}. Would you share your honest experience? {{review_link}} Reply STOP to opt out.";
const DEFAULT_REVIEW_FOLLOW_UP_TEMPLATE =
  "A quick reminder from {{business_name}}: if you have a moment, you can share your honest experience here: {{review_link}} Reply STOP to opt out.";

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function reviewTemplate(value: unknown, label: string) {
  const template = requireText(value, label, 1500);
  if (!template.includes("{{review_link}}")) {
    throw new Error(`${label} must include {{review_link}}.`);
  }
  if (!template.includes("{{business_name}}")) {
    throw new Error(`${label} must include {{business_name}}.`);
  }
  if (!/\bSTOP\b/i.test(template)) {
    throw new Error(`${label} must tell the customer they can reply STOP.`);
  }
  if (
    /\b(?:discount|gift(?:\s+card)?|reward|coupon|cash|compensation)\b/i.test(
      template,
    ) ||
    /\b(?:5\s*[- ]?star|five\s*[- ]?star|only if|if you (?:were|are|'re) (?:happy|satisfied))\b/i.test(
      template,
    )
  ) {
    throw new Error(
      `${label} must be neutral and cannot offer rewards, request a specific rating, or ask only happy customers.`,
    );
  }
  return template;
}

function quietHour(value: unknown, label: string) {
  const entry = requireText(value, label, 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(entry)) {
    throw new Error(`${label} must use a 24-hour time such as 20:00.`);
  }
  return entry;
}

function notificationEmails(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,;]+/)
      : [];
  const emails = [...new Set(raw.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean))];
  if (emails.length > 20) throw new Error("Add no more than 20 notification emails.");
  for (const email of emails) {
    if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Enter a valid notification email: ${email.slice(0, 80)}`);
    }
  }
  return emails;
}

function minutesInTimeZone(timeZone: string, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (Number.isInteger(hour) && Number.isInteger(minute)) return hour * 60 + minute;
  } catch {
    throw new Error(
      "This business has an invalid time zone. Fix the client profile before sending review requests.",
    );
  }
  throw new Error(
    "BrizBuilder could not confirm the business's local time. Try again later.",
  );
}

function isWithinQuietHours(current: number, start: string, end: string) {
  const toMinutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (startMinutes === endMinutes) return false;
  return startMinutes < endMinutes
    ? current >= startMinutes && current < endMinutes
    : current >= startMinutes || current < endMinutes;
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

function normalizeGoogleReviewUrl(value: unknown): string | null {
  const raw = optionalText(value, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password
    ) {
      throw new Error("invalid");
    }
    const hostname = url.hostname.toLowerCase();
    const path = url.pathname;
    const isGoogleReviewPage =
      hostname === "g.page" &&
      /^\/(?:r\/[A-Za-z0-9_-]+|[A-Za-z0-9][A-Za-z0-9_-]{0,127})\/review\/?$/.test(
        path,
      );
    const isGoogleMapsShortLink =
      hostname === "maps.app.goo.gl" &&
      /^\/[A-Za-z0-9_-]{4,256}\/?$/.test(path);
    const placeId = url.searchParams.get("placeid") ?? "";
    const isGoogleWriteReviewLink =
      hostname === "search.google.com" &&
      path === "/local/writereview" &&
      /^[A-Za-z0-9:_-]{8,256}$/.test(placeId);
    const googleMapsHosts = [
      "google.com",
      "www.google.com",
      "maps.google.com",
    ];
    const cid = url.searchParams.get("cid") ?? "";
    const isGoogleMapsCidLink =
      googleMapsHosts.includes(hostname) &&
      path === "/maps" &&
      /^\d{1,30}$/.test(cid);
    const isGoogleMapsPlaceLink =
      ["google.com", "www.google.com"].includes(hostname) &&
      /^\/maps\/place\/[^/]+(?:\/.*)?$/.test(path);
    if (
      !isGoogleReviewPage &&
      !isGoogleMapsShortLink &&
      !isGoogleWriteReviewLink &&
      !isGoogleMapsCidLink &&
      !isGoogleMapsPlaceLink
    ) {
      throw new Error("invalid");
    }
    return url.toString();
  } catch {
    throw new Error("Paste the HTTPS Google review link from the client's Business Profile.");
  }
}

function cents(value: unknown): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000)
    throw new Error("Enter a valid amount.");
  return Math.round(amount);
}

function requirePermission(context: TenantContext, permission: CrmPermission) {
  if (!rolePermissions[context.role].includes(permission))
    throw new Error("Forbidden");
}

function serviceAreas(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string")
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 30);
  return [];
}

function tags(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string")
    return value
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
  return [];
}

function phoneNumber(
  value: unknown,
  label: string,
  required = false,
): string | null {
  const text = optionalText(value, 30);
  if (!text) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  const normalized = text.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized))
    throw new Error(
      `${label} must include the country code, for example +13125550123.`,
    );
  return normalized;
}

function nestedOne<T extends AnyRecord>(
  value: T | T[] | null | undefined,
): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

async function assertOk<T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
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
    supabase()
      .from("pipeline_stages")
      .upsert(
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

  if (email === MAIN_ADMIN_EMAIL.trim().toLowerCase()) {
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
      .select(
        "role,client_id,clients(id,business_name,organization_id,organizations(id,name))",
      )
      .eq("profile_id", profile.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  );
  const client = nestedOne(clientMembership?.clients);
  if (!client?.id) throw new Error("Forbidden");
  const organization = nestedOne(client.organizations);

  return {
    organizationId: String(
      organization?.id ?? client.organization_id ?? ORGANIZATION_ID,
    ),
    organizationName: String(organization?.name ?? "Brizuela Leads"),
    email,
    name: String(profile.display_name ?? user.displayName),
    role: String(clientMembership?.role ?? "CLIENT_OWNER") as CrmRole,
    clientId: String(client.id),
  };
}

async function requireClient(context: TenantContext, clientId: string) {
  if (context.clientId && context.clientId !== clientId)
    throw new Error("Forbidden");
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

const UNLINKED_PROVIDER_STATUSES = new Set([
  "disconnected",
  "not_connected",
  "revoked",
]);

function providerAccountStatus(row: AnyRecord | null | undefined) {
  const config =
    row?.public_config && typeof row.public_config === "object"
      ? row.public_config
      : {};
  return nullable(config.accountStatus)?.toLowerCase() ?? null;
}

function providerIsLinked(row: AnyRecord | null | undefined) {
  if (!row?.external_account_id || row.disconnected_at) return false;
  return !UNLINKED_PROVIDER_STATUSES.has(
    String(row.status ?? "not_connected").toLowerCase(),
  );
}

function providerIsActive(row: AnyRecord | null | undefined) {
  return (
    providerIsLinked(row) &&
    String(row?.status ?? "").toLowerCase() === "connected" &&
    providerAccountStatus(row) === "active"
  );
}

async function requireActiveTwilioConnection(
  context: TenantContext,
  clientId: string,
) {
  const connection = await assertOk(
    supabase()
      .from("provider_connections")
      .select(
        "id,status,external_account_id,disconnected_at,public_config",
      )
      .eq("organization_id", context.organizationId)
      .eq("client_id", clientId)
      .eq("provider", "twilio")
      .maybeSingle(),
  );
  if (!connection || !providerIsLinked(connection))
    throw new Error(
      "Connect the customer's Twilio account before using Communications.",
    );
  if (!providerIsActive(connection))
    throw new Error(
      "The connected Twilio account is not active. Refresh its status or fix the account in Twilio before using Communications.",
    );
  return connection;
}

async function stateHash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function beginSupabaseTwilioConnect(
  user: ChatGPTUser,
  clientId: string,
) {
  const context = await getTenantContext(user);
  requirePermission(context, "phone_system.manage");
  await requireClient(context, clientId);
  if (!getTwilioConnectStatus().ready)
    throw new Error(
      "BrizBuilder's Twilio Connect app needs to be configured first.",
    );
  const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
    "-",
    "",
  );
  const connectUrl = await buildTwilioConnectUrl(state);
  await assertOk(
    supabase()
      .from("provider_authorization_states")
      .insert({
        organization_id: context.organizationId,
        client_id: clientId,
        provider: "twilio",
        state_hash: await stateHash(state),
        requested_by_email: context.email,
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      }),
  );
  return connectUrl;
}

export async function finishSupabaseTwilioConnect(
  state: string,
  accountSid: string,
) {
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid))
    throw new Error("Twilio did not return a valid customer account.");
  const now = new Date().toISOString();
  const authorization = await assertOk(
    supabase()
      .from("provider_authorization_states")
      .select("*")
      .eq("provider", "twilio")
      .eq("state_hash", await stateHash(state))
      .is("used_at", null)
      .gt("expires_at", now)
      .maybeSingle(),
  );
  if (!authorization)
    throw new Error(
      "This connection request expired. Start again from BrizBuilder.",
    );
  const account = await checkTwilioConnectedAccount(accountSid);
  const accountStatus = String(account.status ?? "unknown").toLowerCase();
  const isAccountActive = accountStatus === "active";
  const existingPhoneConfig = await assertOk(
    supabase()
      .from("phone_system_configs")
      .select("provider_account_sid")
      .eq("organization_id", authorization.organization_id)
      .eq("client_id", authorization.client_id)
      .maybeSingle(),
  );
  const accountChanged = Boolean(
    existingPhoneConfig &&
      String(existingPhoneConfig.provider_account_sid ?? "") !== account.sid,
  );
  await assertOk(
    supabase()
      .from("provider_connections")
      .upsert(
        {
          organization_id: authorization.organization_id,
          client_id: authorization.client_id,
          provider: "twilio",
          status: isAccountActive ? "connected" : "inactive",
          billing_owner: "customer",
          external_account_id: account.sid,
          external_account_name: account.name,
          scopes: ["get-all", "post-all"],
          public_config: {
            accountStatus,
            accountType: account.accountType,
            currency: account.currency,
            todaySpend: account.today.spend,
            monthSpend: account.month.spend,
            monthCalls: account.month.calls,
            monthMessages: account.month.messages,
          },
          connected_by_email: authorization.requested_by_email,
          connected_at: now,
          disconnected_at: null,
          last_health_check_at: now,
          last_error: isAccountActive
            ? null
            : `Twilio account is ${accountStatus}.`,
          updated_at: now,
        },
        { onConflict: "organization_id,client_id,provider" },
      ),
  );
  await Promise.all([
    assertOk(
      supabase()
        .from("provider_authorization_states")
        .update({ used_at: now })
        .eq("id", authorization.id),
    ),
    assertOk(
      supabase()
        .from("phone_system_configs")
        .upsert(
          {
            organization_id: authorization.organization_id,
            client_id: authorization.client_id,
            provider: "twilio",
            provider_account_sid: account.sid,
            provider_status: isAccountActive ? "connected" : "inactive",
            ...((accountChanged || !isAccountActive) && {
              missed_call_text_enabled: false,
            }),
            ...(accountChanged && {
              phone_number_sid: null,
              phone_number: null,
              messaging_service_sid: null,
            }),
            updated_at: now,
          },
          { onConflict: "organization_id,client_id" },
        ),
    ),
  ]);
  return String(authorization.client_id);
}

const GOOGLE_BUSINESS_PROVIDER = "google_business_profile";

class GoogleConnectionDisconnectedError extends Error {
  constructor() {
    super("Connect this business's Google account first.");
    this.name = "GoogleConnectionDisconnectedError";
  }
}

function safeIntegrationError(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Google Business Profile request failed.";
}

async function googleCredential(
  organizationId: string,
  clientId: string,
) {
  return assertOk(
    supabase()
      .from("google_business_credentials")
      .select(
        "id,refresh_token_ciphertext,refresh_token_iv,scopes,connected_by_email",
      )
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .maybeSingle(),
  );
}

async function authorizedGoogleLocations(
  organizationId: string,
  clientId: string,
) {
  const [credential, profile] = await Promise.all([
    googleCredential(organizationId, clientId),
    assertOk(
      supabase()
        .from("google_business_profiles")
        .select("status")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .maybeSingle(),
    ),
  ]);
  if (!credential) {
    throw new Error("Connect this business's Google account first.");
  }
  if (String(profile?.status ?? "").toLowerCase() === "disconnected") {
    throw new GoogleConnectionDisconnectedError();
  }
  const refreshToken = await decryptGoogleSecret({
    ciphertext: String(credential.refresh_token_ciphertext),
    iv: String(credential.refresh_token_iv),
  }, organizationId, clientId);
  const tokens = await refreshGoogleAccessToken(refreshToken);
  return listGoogleBusinessLocations(tokens.accessToken);
}

async function authorizedGoogleReviewContext(
  context: TenantContext,
  clientId: string,
) {
  await requireClient(context, clientId);
  const [credential, profile] = await Promise.all([
    googleCredential(context.organizationId, clientId),
    assertOk(
      supabase()
        .from("google_business_profiles")
        .select("status,account_id,location_id")
        .eq("organization_id", context.organizationId)
        .eq("client_id", clientId)
        .maybeSingle(),
    ),
  ]);
  if (!credential || !profile) {
    throw new Error("Connect this business's Google account first.");
  }
  if (String(profile.status).toLowerCase() !== "connected") {
    throw new Error("Choose an active Google Business Profile location first.");
  }
  const accountResourceName = requireText(
    profile.account_id,
    "Google account",
    240,
  );
  const locationResourceName = requireText(
    profile.location_id,
    "Google location",
    240,
  );
  const refreshToken = await decryptGoogleSecret(
    {
      ciphertext: String(credential.refresh_token_ciphertext),
      iv: String(credential.refresh_token_iv),
    },
    context.organizationId,
    clientId,
  );
  const tokens = await refreshGoogleAccessToken(refreshToken);
  return {
    accessToken: tokens.accessToken,
    accountResourceName,
    locationResourceName,
  };
}

export async function getSupabaseGoogleReviews(
  user: ChatGPTUser,
  clientId: string,
  pageToken?: string | null,
) {
  const context = await getTenantContext(user);
  requirePermission(context, "reviews.read");
  const authorized = await authorizedGoogleReviewContext(context, clientId);
  return listGoogleBusinessReviews(
    authorized.accessToken,
    authorized.accountResourceName,
    authorized.locationResourceName,
    pageToken,
  );
}

async function saveGoogleLocation(
  organizationId: string,
  clientId: string,
  location: GoogleBusinessLocation,
  connectedAt?: string,
) {
  const existing = await assertOk(
    supabase()
      .from("google_business_profiles")
      .select("account_id,location_id,google_review_url,connected_at")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .maybeSingle(),
  );
  const now = new Date().toISOString();
  const sameLocation = Boolean(
    existing?.account_id === location.accountResourceName &&
      existing?.location_id === location.locationResourceName,
  );
  await assertOk(
    supabase()
      .from("google_business_profiles")
      .upsert(
        {
          organization_id: organizationId,
          client_id: clientId,
          status: "connected",
          account_id: location.accountResourceName,
          account_name: location.accountName,
          location_name: location.businessName,
          location_id: location.locationResourceName,
          business_name: location.businessName,
          address: location.address,
          phone: location.phone,
          website: location.website,
          primary_category: location.primaryCategory,
          google_review_url: sameLocation
            ? (existing?.google_review_url ?? location.reviewUrl ?? null)
            : (location.reviewUrl ?? null),
          last_synced_at: now,
          connected_at: sameLocation
            ? (existing?.connected_at ?? connectedAt ?? now)
            : (connectedAt ?? now),
          last_error: null,
          updated_at: now,
        },
        { onConflict: "organization_id,client_id" },
      ),
  );
}

async function markGoogleProfileAttention(
  organizationId: string,
  clientId: string,
  message: string,
  connectedAt?: string,
) {
  const now = new Date().toISOString();
  await assertOk(
    supabase()
      .from("google_business_profiles")
      .upsert(
        {
          organization_id: organizationId,
          client_id: clientId,
          status: "attention",
          connected_at: connectedAt ?? now,
          last_error: message.slice(0, 500),
          updated_at: now,
        },
        { onConflict: "organization_id,client_id" },
      ),
  );
}

function knownCrmRole(value: unknown): CrmRole | null {
  if (
    typeof value !== "string" ||
    !Object.prototype.hasOwnProperty.call(rolePermissions, value)
  ) {
    return null;
  }
  return value as CrmRole;
}

async function revalidateGoogleCallbackAuthorization(
  authorization: AnyRecord,
): Promise<TenantContext> {
  const organizationId = String(authorization.organization_id ?? "");
  const clientId = String(authorization.client_id ?? "");
  const email = String(authorization.requested_by_email ?? "")
    .trim()
    .toLowerCase();
  if (!organizationId || !clientId || !email) {
    throw new Error(
      "This Google connection request is invalid. Start again from BrizBuilder.",
    );
  }

  const [organization, client] = await Promise.all([
    assertOk(
      supabase()
        .from("organizations")
        .select("id,name")
        .eq("id", organizationId)
        .eq("status", "active")
        .maybeSingle(),
    ),
    assertOk(
      supabase()
        .from("clients")
        .select("id,business_name")
        .eq("id", clientId)
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .is("archived_at", null)
        .maybeSingle(),
    ),
  ]);
  if (!organization || !client) {
    throw new Error(
      "This business is no longer active. Start again from BrizBuilder.",
    );
  }

  if (email === MAIN_ADMIN_EMAIL) {
    if (organizationId !== ORGANIZATION_ID) throw new Error("Forbidden");
    const context: TenantContext = {
      organizationId,
      organizationName: String(organization.name ?? "Brizuela Leads"),
      email,
      name: email,
      role: "AGENCY_OWNER",
      clientId: null,
    };
    requirePermission(context, "profiles.connect");
    return context;
  }

  const profile = await assertOk(
    supabase()
      .from("profiles")
      .select("id,display_name")
      .eq("email", email)
      .eq("status", "active")
      .maybeSingle(),
  );
  if (!profile?.id) throw new Error("Forbidden");

  const [organizationMembership, clientMembership] = await Promise.all([
    assertOk(
      supabase()
        .from("organization_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("profile_id", profile.id)
        .eq("status", "active")
        .maybeSingle(),
    ),
    assertOk(
      supabase()
        .from("client_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .eq("profile_id", profile.id)
        .eq("status", "active")
        .maybeSingle(),
    ),
  ]);

  const agencyRole = knownCrmRole(organizationMembership?.role);
  if (
    agencyRole &&
    ["SUPER_ADMIN", "AGENCY_OWNER", "AGENCY_ADMIN", "AGENCY_MEMBER"].includes(
      agencyRole,
    )
  ) {
    const context: TenantContext = {
      organizationId,
      organizationName: String(organization.name ?? "BrizBuilder agency"),
      email,
      name: String(profile.display_name ?? email),
      role: agencyRole,
      clientId: null,
    };
    requirePermission(context, "profiles.connect");
    return context;
  }

  const clientRole = knownCrmRole(clientMembership?.role);
  if (
    clientRole &&
    ["CLIENT_OWNER", "CLIENT_MANAGER", "CLIENT_EMPLOYEE"].includes(clientRole)
  ) {
    const context: TenantContext = {
      organizationId,
      organizationName: String(organization.name ?? "BrizBuilder agency"),
      email,
      name: String(profile.display_name ?? email),
      role: clientRole,
      clientId,
    };
    requirePermission(context, "profiles.connect");
    return context;
  }

  throw new Error("Forbidden");
}

export async function beginSupabaseGoogleConnect(
  user: ChatGPTUser,
  clientId: string,
) {
  const context = await getTenantContext(user);
  requirePermission(context, "profiles.connect");
  await requireClient(context, clientId);
  if (!getGoogleBusinessRuntimeStatus().ready) {
    throw new Error(
      "BrizBuilder's Google Business Profile connection needs to be configured first.",
    );
  }
  const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
    "-",
    "",
  );
  const now = new Date();
  await assertOk(
    supabase()
      .from("provider_authorization_states")
      .delete()
      .eq("provider", GOOGLE_BUSINESS_PROVIDER)
      .lt("expires_at", now.toISOString()),
  );
  await assertOk(
    supabase()
      .from("provider_authorization_states")
      .insert({
        organization_id: context.organizationId,
        client_id: clientId,
        provider: GOOGLE_BUSINESS_PROVIDER,
        state_hash: await stateHash(state),
        requested_by_email: context.email,
        expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
      }),
  );
  return buildGoogleAuthorizationUrl(state);
}

export async function finishSupabaseGoogleConnect(
  state: string,
  code: string,
) {
  if (!state || state.length < 40 || !code) {
    throw new Error("Google did not return a valid connection request.");
  }
  const now = new Date().toISOString();
  const authorization = await assertOk(
    supabase()
      .from("provider_authorization_states")
      .select("*")
      .eq("provider", GOOGLE_BUSINESS_PROVIDER)
      .eq("state_hash", await stateHash(state))
      .is("used_at", null)
      .gt("expires_at", now)
      .maybeSingle(),
  );
  if (!authorization) {
    throw new Error(
      "This Google connection request expired. Start again from BrizBuilder.",
    );
  }
  try {
    const callbackContext = await revalidateGoogleCallbackAuthorization(
      authorization,
    );
    const consumed = await assertOk(
      supabase()
        .from("provider_authorization_states")
        .update({ used_at: now })
        .eq("id", authorization.id)
        .is("used_at", null)
        .select("id")
        .maybeSingle(),
    );
    if (!consumed) {
      throw new Error(
        "This Google connection request was already used. Start again from BrizBuilder.",
      );
    }

    const tokens = await exchangeGoogleAuthorizationCode(code, state);
    const refreshToken = tokens.refreshToken;
    if (!refreshToken) {
      throw new Error(
        "Google did not grant fresh offline access. Remove BrizBuilder from your Google Account permissions, then connect again.",
      );
    }
    const organizationId = String(authorization.organization_id);
    const clientId = String(authorization.client_id);
    const encrypted = await encryptGoogleSecret(
      refreshToken,
      organizationId,
      clientId,
    );
    await assertOk(
      supabase()
        .from("google_business_credentials")
        .upsert(
          {
            organization_id: authorization.organization_id,
            client_id: authorization.client_id,
            refresh_token_ciphertext: encrypted.ciphertext,
            refresh_token_iv: encrypted.iv,
            scopes: tokens.scopes,
            connected_by_email: callbackContext.email,
            updated_at: now,
          },
          { onConflict: "organization_id,client_id" },
        ),
    );

    let locations: GoogleBusinessLocation[];
    try {
      locations = await listGoogleBusinessLocations(tokens.accessToken);
    } catch (error) {
      const message = safeIntegrationError(error);
      await markGoogleProfileAttention(organizationId, clientId, message, now);
      await audit(
        callbackContext,
        "google_profile.authorized",
        "google_business_profile",
        clientId,
        { locationCount: 0, status: "attention" },
        clientId,
      );
      return {
        clientId,
        status: "attention" as const,
        message,
      };
    }

    if (locations.length === 1) {
      await saveGoogleLocation(organizationId, clientId, locations[0], now);
    } else {
      const message = locations.length
        ? "Choose the Google Business Profile location to manage."
        : "Google did not return any Business Profile locations for this account.";
      await markGoogleProfileAttention(organizationId, clientId, message, now);
    }

    await audit(
      callbackContext,
      "google_profile.authorized",
      "google_business_profile",
      clientId,
      { locationCount: locations.length },
      clientId,
    );
    return {
      clientId,
      status:
        locations.length === 1 ? ("connected" as const) : ("select" as const),
      message: null,
    };
  } finally {
    await assertOk(
      supabase()
        .from("provider_authorization_states")
        .delete()
        .eq("id", authorization.id),
    );
  }
}

export async function listSupabaseGoogleLocations(
  user: ChatGPTUser,
  clientId: string,
) {
  const context = await getTenantContext(user);
  requirePermission(context, "profiles.connect");
  await requireClient(context, clientId);
  try {
    return await authorizedGoogleLocations(context.organizationId, clientId);
  } catch (error) {
    if (!(error instanceof GoogleConnectionDisconnectedError)) {
      await markGoogleProfileAttention(
        context.organizationId,
        clientId,
        safeIntegrationError(error),
      );
    }
    throw error;
  }
}

export async function selectSupabaseGoogleLocation(
  user: ChatGPTUser,
  clientId: string,
  accountResourceName: string,
  locationResourceName: string,
) {
  const context = await getTenantContext(user);
  requirePermission(context, "profiles.connect");
  await requireClient(context, clientId);
  const locations = await authorizedGoogleLocations(
    context.organizationId,
    clientId,
  );
  const selected = locations.find(
    (location) =>
      location.accountResourceName === accountResourceName &&
      location.locationResourceName === locationResourceName,
  );
  if (!selected) {
    throw new Error(
      "That Google location is no longer available. Reload the list and try again.",
    );
  }
  await saveGoogleLocation(context.organizationId, clientId, selected);
  await audit(
    context,
    "google_profile.location_selected",
    "google_business_profile",
    clientId,
    {
      accountResourceName: selected.accountResourceName,
      locationResourceName: selected.locationResourceName,
    },
    clientId,
  );
  return { connected: true };
}

export async function refreshSupabaseGoogleProfile(
  user: ChatGPTUser,
  clientId: string,
) {
  const context = await getTenantContext(user);
  requirePermission(context, "profiles.manage");
  await requireClient(context, clientId);
  const profile = await assertOk(
    supabase()
      .from("google_business_profiles")
      .select("account_id,location_id")
      .eq("organization_id", context.organizationId)
      .eq("client_id", clientId)
      .maybeSingle(),
  );
  if (!profile?.account_id || !profile?.location_id) {
    throw new Error("Choose a Google Business Profile location first.");
  }
  try {
    const locations = await authorizedGoogleLocations(
      context.organizationId,
      clientId,
    );
    const selected = locations.find(
      (location) =>
        location.accountResourceName === profile.account_id &&
        location.locationResourceName === profile.location_id,
    );
    if (!selected) {
      throw new Error(
        "The connected Google location is no longer available to this Google account.",
      );
    }
    await saveGoogleLocation(context.organizationId, clientId, selected);
    return { refreshed: true };
  } catch (error) {
    if (!(error instanceof GoogleConnectionDisconnectedError)) {
      await markGoogleProfileAttention(
        context.organizationId,
        clientId,
        safeIntegrationError(error),
      );
    }
    throw error;
  }
}

export async function disconnectSupabaseGoogleProfile(
  user: ChatGPTUser,
  clientId: string,
) {
  const context = await getTenantContext(user);
  requirePermission(context, "profiles.connect");
  await requireClient(context, clientId);
  const credential = await googleCredential(context.organizationId, clientId);
  let refreshToken: string | null = null;
  let revocationWarning: string | null = null;
  if (credential) {
    try {
      refreshToken = await decryptGoogleSecret({
        ciphertext: String(credential.refresh_token_ciphertext),
        iv: String(credential.refresh_token_iv),
      }, context.organizationId, clientId);
    } catch {
      revocationWarning =
        "BrizBuilder disconnected locally, but could not read the saved authorization to revoke it at Google. Remove BrizBuilder from your Google Account permissions.";
    }
  }
  const now = new Date().toISOString();
  await assertOk(
    supabase()
      .from("google_business_profiles")
      .upsert(
        {
          organization_id: context.organizationId,
          client_id: clientId,
          status: "disconnected",
          account_id: null,
          account_name: null,
          location_name: null,
          location_id: null,
          business_name: null,
          address: null,
          phone: null,
          website: null,
          primary_category: null,
          last_synced_at: null,
          connected_at: null,
          last_error: null,
          updated_at: now,
        },
        { onConflict: "organization_id,client_id" },
      ),
  );

  let googleRevocationConfirmed = !credential;
  if (refreshToken) {
    try {
      await revokeGoogleRefreshToken(refreshToken);
      googleRevocationConfirmed = true;
    } catch (error) {
      revocationWarning = safeIntegrationError(error);
    }
  }
  const revocationRetryAvailable = Boolean(
    credential && refreshToken && !googleRevocationConfirmed,
  );
  if (!credential || googleRevocationConfirmed || !refreshToken) {
    await assertOk(
      supabase()
        .from("google_business_credentials")
        .delete()
        .eq("organization_id", context.organizationId)
        .eq("client_id", clientId),
    );
  }
  if (revocationWarning) {
    await assertOk(
      supabase()
        .from("google_business_profiles")
        .update({
          last_error: revocationWarning.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", context.organizationId)
        .eq("client_id", clientId),
    );
  }
  await audit(
    context,
    "google_profile.disconnected",
    "google_business_profile",
    clientId,
    { googleRevocationConfirmed, revocationRetryAvailable },
    clientId,
  );
  return {
    disconnected: true,
    revocationWarning,
    googleRevocationConfirmed,
    revocationRetryAvailable,
  };
}

export async function getSupabaseTwilioVisibleBalance(
  user: ChatGPTUser,
  clientId: string,
  bypassCache = false,
) {
  const context = await getTenantContext(user);
  requirePermission(context, "billing.read_shared");
  await requireClient(context, clientId);
  const connection = await assertOk(
    supabase()
      .from("provider_connections")
      .select("external_account_id,status,disconnected_at")
      .eq("organization_id", context.organizationId)
      .eq("client_id", clientId)
      .eq("provider", "twilio")
      .maybeSingle(),
  );
  if (!connection || !providerIsLinked(connection))
    throw new Error("Connect the customer's Twilio account first.");
  return getTwilioVisibleBalance(
    String(connection.external_account_id),
    bypassCache,
  );
}

export async function revokeSupabaseTwilioConnection(accountSid: string) {
  if (!accountSid) return;
  const now = new Date().toISOString();
  const found = await assertOk(
    supabase()
      .from("provider_connections")
      .select("client_id")
      .eq("provider", "twilio")
      .eq("external_account_id", accountSid)
      .maybeSingle(),
  );
  if (!found) return;
  await Promise.all([
    assertOk(
      supabase()
        .from("provider_connections")
        .update({
          status: "revoked",
          disconnected_at: now,
          last_error: "Authorization was revoked in Twilio.",
          updated_at: now,
        })
        .eq("external_account_id", accountSid),
    ),
    assertOk(
      supabase()
        .from("phone_system_configs")
        .update({
          provider_status: "revoked",
          missed_call_text_enabled: false,
          updated_at: now,
        })
        .eq("client_id", found.client_id),
    ),
  ]);
}

async function audit(
  context: TenantContext,
  action: string,
  recordType: string,
  recordId: string | null,
  metadata: Record<string, unknown> = {},
  clientId: string | null = context.clientId,
) {
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

// Remote connectors use the same tenant and role checks as the dashboard, but
// they fail closed and never use the D1 fallback.
export async function getSupabaseTenantContext(
  user: ChatGPTUser,
): Promise<SupabaseTenantContext> {
  return getTenantContext(user);
}

export function supabaseRoleHasPermission(
  context: SupabaseTenantContext,
  permission: CrmPermission,
): boolean {
  return rolePermissions[context.role].includes(permission);
}

export async function requireSupabaseClientAccess(
  context: SupabaseTenantContext,
  clientId: string,
): Promise<void> {
  await requireClient(context, clientId);
}

export async function writeSupabaseAuditEvent(
  context: SupabaseTenantContext,
  action: string,
  recordType: string,
  recordId: string | null,
  metadata: Record<string, unknown> = {},
  clientId: string | null = context.clientId,
): Promise<void> {
  await audit(context, action, recordType, recordId, metadata, clientId);
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
  const analytics =
    row.analytics && typeof row.analytics === "object"
      ? (row.analytics as Record<string, unknown>)
      : {};
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
    id: String(row.id),
    clientId: String(row.client_id),
    provider: String(row.provider ?? "twilio"),
    phoneNumber: nullable(row.phone_number),
    forwardingNumber: nullable(row.forwarding_number),
    ringTimeoutSeconds: Number(row.ring_timeout_seconds ?? 20),
    voicemailEnabled: Boolean(row.voicemail_enabled),
    missedCallTextEnabled: Boolean(row.missed_call_text_enabled),
    missedCallMessage: String(row.missed_call_message ?? ""),
    cooldownMinutes: Number(row.cooldown_minutes ?? 20),
    providerStatus: String(row.provider_status ?? "not_configured"),
    a2pStatus: String(row.a2p_status ?? "not_started"),
    lastTestedAt: nullable(row.last_tested_at),
  };
}

function mapPhoneCall(row: AnyRecord): CrmPhoneCall {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    contactId: nullable(row.contact_id),
    fromNumber: String(row.from_number),
    toNumber: String(row.to_number),
    status: String(row.status),
    direction: String(row.direction),
    durationSeconds:
      row.duration_seconds == null ? null : Number(row.duration_seconds),
    startedAt: String(row.started_at),
    missedCallTextSentAt: nullable(row.missed_call_text_sent_at),
  };
}

function mapConversation(row: AnyRecord): CrmConversation {
  const contact = nestedOne(row.contacts) ?? {};
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    contactId: String(row.contact_id),
    contactName:
      `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ||
      String(contact.phone ?? "Unknown contact"),
    contactPhone: nullable(contact.phone),
    status: String(row.status ?? "open"),
    unreadCount: Number(row.unread_count ?? 0),
    lastMessageAt: nullable(row.last_message_at),
  };
}

function mapMessage(row: AnyRecord): CrmMessage {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    conversationId: String(row.conversation_id),
    contactId: String(row.contact_id),
    direction: String(row.direction),
    body: String(row.body),
    status: String(row.status),
    automationKey: nullable(row.automation_key),
    createdAt: String(row.created_at),
  };
}

function mapAutomationRule(row: AnyRecord): CrmAutomationRule {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    name: String(row.name),
    triggerKey: String(row.trigger_key),
    enabled: Boolean(row.enabled),
    config: row.config && typeof row.config === "object" ? row.config : {},
    updatedAt: String(row.updated_at),
  };
}

function mapAutomationRun(row: AnyRecord): CrmAutomationRun {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    ruleId: nullable(row.rule_id),
    triggerEventId: String(row.trigger_event_id),
    status: String(row.status),
    error: nullable(row.error),
    startedAt: String(row.started_at),
    completedAt: nullable(row.completed_at),
  };
}

function mapProviderConnection(row: AnyRecord): CrmProviderConnection {
  const publicConfig =
    row.public_config && typeof row.public_config === "object"
      ? (row.public_config as Record<string, unknown>)
      : {};
  const isLinked = providerIsLinked(row);
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    provider: String(row.provider),
    status: String(row.status),
    isLinked,
    isActive: providerIsActive(row),
    billingOwner: String(row.billing_owner ?? "customer"),
    accountLabel: nullable(row.external_account_name),
    accountStatus: providerAccountStatus(row),
    accountType: nullable(publicConfig.accountType),
    balance: null,
    balanceStatus: isLinked ? "shared" : "unavailable",
    currency: nullable(publicConfig.currency),
    todaySpend: publicConfig.todaySpend == null ? null : Number(publicConfig.todaySpend),
    monthSpend: publicConfig.monthSpend == null ? null : Number(publicConfig.monthSpend),
    monthCalls: publicConfig.monthCalls == null ? null : Number(publicConfig.monthCalls),
    monthMessages: publicConfig.monthMessages == null ? null : Number(publicConfig.monthMessages),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    connectedAt: nullable(row.connected_at),
    disconnectedAt: nullable(row.disconnected_at),
    lastHealthCheckAt: nullable(row.last_health_check_at),
    lastError: nullable(row.last_error),
  };
}

function redactSharedBalance(
  connection: CrmProviderConnection,
  canReadSharedBilling: boolean,
) {
  if (canReadSharedBilling) return connection;
  return {
    ...connection,
    balance: null,
    balanceStatus: connection.isLinked ? "restricted" : "unavailable",
  };
}

function mapWorkflow(row: AnyRecord, versions: AnyRecord[]): CrmWorkflow {
  const version = versions.find(
    (item) =>
      String(item.workflow_id) === String(row.id) &&
      Number(item.version) === Number(row.current_version),
  );
  const graph = validateWorkflowGraph(version?.graph).graph;
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    name: String(row.name),
    description: String(row.description ?? ""),
    status: String(row.status),
    triggerKey: String(row.trigger_key),
    currentVersion: Number(row.current_version ?? 1),
    publishedVersion:
      row.published_version == null ? null : Number(row.published_version),
    graph,
    updatedAt: String(row.updated_at),
  };
}

function mapWorkflowRun(row: AnyRecord): CrmWorkflowRun {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    workflowId: String(row.workflow_id),
    version: Number(row.version),
    triggerKey: String(row.trigger_key),
    status: String(row.status),
    isTest: Boolean(row.is_test),
    error: nullable(row.error),
    startedAt: String(row.started_at),
    completedAt: nullable(row.completed_at),
  };
}

export async function getSupabaseCrmBootstrap(
  user: ChatGPTUser,
): Promise<CrmBootstrap> {
  const context = await getTenantContext(user);
  const clientFilter = context.clientId
    ? { column: "client_id", value: context.clientId }
    : null;

  // The generic documents the expected row shape until generated Supabase types are available.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const query = <T>(table: string, select = "*") => {
    let builder = supabase()
      .from(table)
      .select(select)
      .eq("organization_id", context.organizationId);
    if (clientFilter)
      builder = builder.eq(clientFilter.column, clientFilter.value);
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
    providerConnections,
    aiAuthorizations,
    aiActivityEvents,
    googleProfiles,
    googleCredentialRefs,
    reviewRequests,
    reviewSettings,
    workflows,
    workflowVersions,
    workflowRuns,
  ] = await Promise.all([
    (() => {
      let builder = query<AnyRecord>("clients")
        .neq("status", "archived")
        .order("business_name");
      if (context.clientId) builder = builder.eq("id", context.clientId);
      return assertOk(builder);
    })(),
    assertOk(
      query<AnyRecord>("contacts")
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
    ),
    assertOk(
      query<AnyRecord>("companies").is("archived_at", null).order("name"),
    ),
    assertOk(
      query<AnyRecord>("websites").order("updated_at", { ascending: false }),
    ),
    assertOk(
      query<AnyRecord>(
        "leads",
        "*,clients(business_name),contacts(first_name,last_name,phone,email,address,city,state,zip),pipeline_stages(name,color,slug)",
      )
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
    ),
    assertOk(
      supabase()
        .from("pipeline_stages")
        .select("*")
        .eq("organization_id", context.organizationId)
        .order("position"),
    ),
    assertOk(
      query<AnyRecord>("tasks").order("due_at", {
        ascending: true,
        nullsFirst: false,
      }),
    ),
    assertOk(
      query<AnyRecord>(
        "appointments",
        "*,clients(business_name),contacts(first_name,last_name)",
      ).order("starts_at", { ascending: true }),
    ),
    assertOk(
      query<AnyRecord>("notes")
        .order("created_at", { ascending: false })
        .limit(200),
    ),
    rolePermissions[context.role].includes("audit.read")
      ? assertOk(
          supabase()
            .from("audit_events")
            .select("*")
            .eq("organization_id", context.organizationId)
            .order("created_at", { ascending: false })
            .limit(150),
        )
      : Promise.resolve([]),
    assertOk(
      query<AnyRecord>("phone_system_configs").order("updated_at", {
        ascending: false,
      }),
    ),
    assertOk(
      query<AnyRecord>("phone_calls")
        .order("started_at", { ascending: false })
        .limit(200),
    ),
    assertOk(
      query<AnyRecord>(
        "conversations",
        "*,contacts(first_name,last_name,phone)",
      )
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(200),
    ),
    assertOk(
      query<AnyRecord>("messages")
        .order("created_at", { ascending: true })
        .limit(500),
    ),
    assertOk(
      query<AnyRecord>("automation_rules").order("updated_at", {
        ascending: false,
      }),
    ),
    assertOk(
      query<AnyRecord>("automation_runs")
        .order("started_at", { ascending: false })
        .limit(200),
    ),
    assertOk(
      query<AnyRecord>("provider_connections").order("updated_at", {
        ascending: false,
      }),
    ),
    rolePermissions[context.role].includes("ai_connector.manage")
      ? (() => {
          let builder = supabase()
            .from("ai_authorizations")
            .select("*,ai_oauth_clients(client_name)")
            .eq("organization_id", context.organizationId)
            .order("connected_at", { ascending: false })
            .limit(100);
          if (context.clientId) {
            builder = builder.contains("allowed_client_ids", [context.clientId]);
          }
          return assertOk(builder).catch((error) => {
            console.error("AI connector tables are not migrated yet.", error);
            return [] as AnyRecord[];
          });
        })()
      : Promise.resolve([] as AnyRecord[]),
    rolePermissions[context.role].includes("ai_connector.manage")
      ? (() => {
          let builder = supabase()
            .from("audit_events")
            .select("id,client_id,action,record_id,metadata,created_at")
            .eq("organization_id", context.organizationId)
            .like("action", "ai.%")
            .order("created_at", { ascending: false })
            .limit(100);
          if (context.clientId) builder = builder.eq("client_id", context.clientId);
          return assertOk(builder);
        })()
      : Promise.resolve([] as AnyRecord[]),
    assertOk(
      query<AnyRecord>("google_business_profiles").order("updated_at", {
        ascending: false,
      }),
    ).catch((error) => {
      console.error("Google Business Profile table is not migrated yet.", error);
      return [] as AnyRecord[];
    }),
    rolePermissions[context.role].includes("profiles.connect")
      ? assertOk(
          query<AnyRecord>("google_business_credentials", "client_id"),
        ).catch((error) => {
          console.error("Google credential table is not migrated yet.", error);
          return [] as AnyRecord[];
        })
      : Promise.resolve([] as AnyRecord[]),
    assertOk(
      query<AnyRecord>(
        "review_requests",
        "*,contacts(first_name,last_name)",
      )
        .order("created_at", { ascending: false })
        .limit(250),
    ).catch((error) => {
      console.error("Reviews workspace tables are not migrated yet.", error);
      return [] as AnyRecord[];
    }),
    assertOk(
      query<AnyRecord>("review_settings").order("updated_at", {
        ascending: false,
      }),
    ).catch((error) => {
      console.error("Review settings table is not migrated yet.", error);
      return [] as AnyRecord[];
    }),
    assertOk(
      query<AnyRecord>("workflows").order("updated_at", { ascending: false }),
    ),
    assertOk(
      query<AnyRecord>("workflow_versions").order("version", {
        ascending: false,
      }),
    ),
    assertOk(
      query<AnyRecord>("workflow_runs")
        .order("started_at", { ascending: false })
        .limit(200),
    ),
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
  const providerConnectionRows = (providerConnections ?? []) as AnyRecord[];
  const aiAuthorizationRows = (aiAuthorizations ?? []) as AnyRecord[];
  const aiActivityRows = (aiActivityEvents ?? []) as AnyRecord[];
  const googleProfileRows = (googleProfiles ?? []) as AnyRecord[];
  const reviewRequestRows = (reviewRequests ?? []) as AnyRecord[];
  const reviewSettingRows = (reviewSettings ?? []) as AnyRecord[];
  const googleCredentialClientIds = new Set(
    ((googleCredentialRefs ?? []) as AnyRecord[]).map((row) =>
      String(row.client_id),
    ),
  );
  const legacyBalanceRows = providerConnectionRows.filter((row) => {
    const publicConfig =
      row.public_config && typeof row.public_config === "object"
        ? (row.public_config as Record<string, unknown>)
        : {};
    return (
      String(row.provider) === "twilio" &&
      (Object.prototype.hasOwnProperty.call(publicConfig, "balance") ||
        Object.prototype.hasOwnProperty.call(publicConfig, "balanceStatus"))
    );
  });
  if (legacyBalanceRows.length) {
    try {
      await Promise.all(
        legacyBalanceRows.map((row) => {
          const publicConfig = {
            ...(row.public_config as Record<string, unknown>),
          };
          delete publicConfig.balance;
          delete publicConfig.balanceStatus;
          row.public_config = publicConfig;
          return assertOk(
            supabase()
              .from("provider_connections")
              .update({
                public_config: publicConfig,
                updated_at: new Date().toISOString(),
              })
              .eq("id", String(row.id))
              .eq("organization_id", context.organizationId),
          );
        }),
      );
    } catch (error) {
      console.error("Could not remove a legacy stored Twilio balance.", error);
    }
  }

  return {
    viewer: {
      name: context.name,
      email: context.email,
      role: context.role,
      clientId: context.clientId,
      isAgency: !context.clientId,
      permissions: rolePermissions[context.role],
    },
    organization: {
      id: context.organizationId,
      name: context.organizationName,
    },
    clients: clientRows.map(mapClient),
    leads: leadRows.map(mapLead),
    contacts: contactRows.map(mapContact),
    companies: companyRows.map(mapCompany),
    websites: websiteRows.map(mapWebsite),
    phoneConfigs: ((phoneConfigs ?? []) as AnyRecord[]).map(mapPhoneConfig),
    phoneCalls: ((phoneCalls ?? []) as AnyRecord[]).map(mapPhoneCall),
    conversations: ((conversations ?? []) as AnyRecord[]).map(mapConversation),
    messages: ((messages ?? []) as AnyRecord[]).map(mapMessage),
    automationRules: ((automationRules ?? []) as AnyRecord[]).map(
      mapAutomationRule,
    ),
    automationRuns: ((automationRuns ?? []) as AnyRecord[]).map(
      mapAutomationRun,
    ),
    providerConnections: providerConnectionRows.map(
      (row) =>
        redactSharedBalance(
          mapProviderConnection(row),
          rolePermissions[context.role].includes("billing.read_shared"),
        ),
    ),
    aiAuthorizations: aiAuthorizationRows.map(
      (row: AnyRecord): CrmAiAuthorization => {
        const oauthClient = nestedOne(row.ai_oauth_clients) ?? {};
        return {
          id: String(row.id),
          appName: String(oauthClient.client_name ?? "Compatible AI app"),
          status: String(row.status) === "revoked" ? "revoked" : "active",
          clientIds: Array.isArray(row.allowed_client_ids)
            ? row.allowed_client_ids.map(String)
            : [],
          scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
          connectedByEmail: String(row.actor_email ?? ""),
          connectedAt: String(row.connected_at),
          lastUsedAt: nullable(row.last_used_at),
          lastSuccessAt: nullable(row.last_success_at),
          lastError: nullable(row.last_error),
        };
      },
    ),
    aiActivities: aiActivityRows.map((row: AnyRecord): CrmAiActivity => {
      const metadata =
        row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const outcomeValue = String(metadata.outcome ?? "success");
      return {
        id: String(row.id),
        authorizationId: nullable(metadata.authorizationId ?? row.record_id),
        appName: String(
          metadata.appName ?? metadata.oauth_client_name ?? "AI app",
        ),
        clientId: nullable(row.client_id),
        action: String(row.action),
        outcome:
          outcomeValue === "denied"
            ? "denied"
            : outcomeValue === "error"
              ? "error"
              : "success",
        createdAt: String(row.created_at),
      };
    }),
    aiConnectorRuntime: getAiConnectorRuntime(),
    googleProfiles: googleProfileRows.map((row: AnyRecord): CrmGoogleProfile => ({
      id: String(row.id),
      clientId: String(row.client_id),
      status: String(row.status ?? "not_connected") as CrmGoogleProfile["status"],
      accountName: nullable(row.account_name),
      locationName: nullable(row.location_name),
      locationId: nullable(row.location_id),
      businessName: nullable(row.business_name),
      address: nullable(row.address),
      phone: nullable(row.phone),
      website: nullable(row.website),
      primaryCategory: nullable(row.primary_category),
      googleReviewUrl: nullable(row.google_review_url),
      lastSyncedAt: nullable(row.last_synced_at),
      connectedAt: nullable(row.connected_at),
      lastError: nullable(row.last_error),
      revocationRetryAvailable:
        String(row.status) === "disconnected" &&
        googleCredentialClientIds.has(String(row.client_id)),
    })),
    googleProfileRuntime: googleProfileRuntime(),
    reviewRequests: reviewRequestRows.map(
      (row: AnyRecord): CrmReviewRequest => {
        const contact = nestedOne(row.contacts) ?? {};
        return {
          id: String(row.id),
          clientId: String(row.client_id),
          contactId: String(row.contact_id),
          contactName:
            `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ||
            "Unknown contact",
          channel: "sms",
          status: String(row.status) as CrmReviewRequest["status"],
          messageBody: String(row.message_body ?? ""),
          requestedByEmail: String(row.requested_by_email ?? ""),
          sentAt: nullable(row.sent_at),
          deliveredAt: nullable(row.delivered_at),
          failedAt: nullable(row.failed_at),
          errorMessage: nullable(row.error_message),
          createdAt: String(row.created_at),
        };
      },
    ),
    reviewSettings: reviewSettingRows.map(
      (row: AnyRecord): CrmReviewSettings => ({
        id: String(row.id),
        clientId: String(row.client_id),
        smsEnabled: Boolean(row.sms_enabled),
        defaultSmsTemplate: String(row.default_sms_template ?? ""),
        followUpEnabled: Boolean(row.follow_up_enabled),
        followUpTemplate: String(row.follow_up_template ?? ""),
        followUpDelayHours: Number(row.follow_up_delay_hours ?? 72),
        quietHoursStart: String(row.quiet_hours_start ?? "20:00").slice(0, 5),
        quietHoursEnd: String(row.quiet_hours_end ?? "08:00").slice(0, 5),
        dailyLimit: Number(row.daily_limit ?? 25),
        notificationEmails: Array.isArray(row.notification_emails)
          ? row.notification_emails.map(String)
          : [],
        updatedAt: String(row.updated_at),
      }),
    ),
    workflows: ((workflows ?? []) as AnyRecord[]).map((row) =>
      mapWorkflow(row, (workflowVersions ?? []) as AnyRecord[]),
    ),
    workflowRuns: ((workflowRuns ?? []) as AnyRecord[]).map(mapWorkflowRun),
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
      metadata:
        row.metadata && typeof row.metadata === "object" ? row.metadata : {},
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
        contactName:
          `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ||
          "Unknown contact",
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
  const modules = [
    "crm",
    "calendar",
    "tasks",
    "contacts",
    "companies",
    "websites",
    "forms",
    "payments",
    "automations",
    "reviews",
  ];
  return modules.map((moduleKey) => ({
    id: `supabase-flag-${moduleKey}`,
    clientId: null,
    moduleKey,
    enabled: [
      "crm",
      "calendar",
      "tasks",
      "contacts",
      "companies",
      "websites",
      "forms",
      "payments",
      "automations",
      "reviews",
    ].includes(moduleKey),
    rolloutStatus: "enabled",
    source: clients.length ? "supabase" : "platform",
  }));
}

export async function executeSupabaseCrmAction(
  user: ChatGPTUser,
  input: CrmAction,
) {
  const context = await getTenantContext(user);
  const action = requireText(input.action, "Action", 50);

  if (action === "revoke_ai_authorization") {
    requirePermission(context, "ai_connector.manage");
    const authorizationId = requireText(
      input.authorizationId,
      "AI connection",
      100,
    );
    const authorization = await assertOk(
      supabase()
        .from("ai_authorizations")
        .select("id,allowed_client_ids,status")
        .eq("id", authorizationId)
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
    );
    if (!authorization) throw new Error("AI connection not found.");
    const allowedClientIds = Array.isArray(authorization.allowed_client_ids)
      ? authorization.allowed_client_ids.map(String)
      : [];
    if (context.clientId && !allowedClientIds.includes(context.clientId)) {
      throw new Error("Forbidden");
    }
    if (String(authorization.status) === "revoked") {
      return { revoked: true, alreadyRevoked: true };
    }
    const now = new Date().toISOString();
    await assertOk(
      supabase()
        .from("ai_authorizations")
        .update({
          status: "revoked",
          revoked_at: now,
          revoked_by_email: context.email,
          last_error: null,
        })
        .eq("id", authorizationId)
        .eq("organization_id", context.organizationId),
    );
    await Promise.all([
      assertOk(
        supabase()
          .from("ai_oauth_access_tokens")
          .update({ revoked_at: now })
          .eq("authorization_id", authorizationId)
          .is("revoked_at", null),
      ),
      assertOk(
        supabase()
          .from("ai_oauth_refresh_tokens")
          .update({ revoked_at: now })
          .eq("authorization_id", authorizationId)
          .is("revoked_at", null),
      ),
    ]);
    await audit(
      context,
      "ai.authorization.revoked",
      "ai_authorization",
      authorizationId,
      { outcome: "success", authorizationId },
      context.clientId ?? (allowedClientIds.length === 1 ? allowedClientIds[0] : null),
    );
    return { revoked: true };
  }

  if (action === "save_google_profile_settings") {
    requirePermission(context, "profiles.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    const reviewUrl = normalizeGoogleReviewUrl(input.googleReviewUrl);
    const existing = await assertOk(
      supabase()
        .from("google_business_profiles")
        .select("id,status")
        .eq("organization_id", context.organizationId)
        .eq("client_id", clientId)
        .maybeSingle(),
    );
    const now = new Date().toISOString();
    await assertOk(
      supabase()
        .from("google_business_profiles")
        .upsert(
          {
            organization_id: context.organizationId,
            client_id: clientId,
            status: String(existing?.status ?? "not_connected"),
            google_review_url: reviewUrl,
            updated_at: now,
          },
          { onConflict: "organization_id,client_id" },
        ),
    );
    await audit(
      context,
      "google_profile.settings_saved",
      "google_business_profile",
      String(existing?.id ?? clientId),
      { hasReviewUrl: Boolean(reviewUrl) },
      clientId,
    );
    return { saved: true };
  }

  if (action === "save_review_settings") {
    requirePermission(context, "reviews.settings.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    const smsTemplate = reviewTemplate(
      input.defaultSmsTemplate ?? DEFAULT_REVIEW_SMS_TEMPLATE,
      "SMS template",
    );
    const followUpTemplate = reviewTemplate(
      input.followUpTemplate ?? DEFAULT_REVIEW_FOLLOW_UP_TEMPLATE,
      "Follow-up template",
    );
    const quietHoursStart = quietHour(
      input.quietHoursStart ?? "20:00",
      "Quiet hours start",
    );
    const quietHoursEnd = quietHour(
      input.quietHoursEnd ?? "08:00",
      "Quiet hours end",
    );
    if (quietHoursStart === quietHoursEnd) {
      throw new Error("Quiet hours must have different start and end times.");
    }
    const now = new Date().toISOString();
    const settings = requireRow(
      await assertOk(
        supabase()
          .from("review_settings")
          .upsert(
            {
              organization_id: context.organizationId,
              client_id: clientId,
              sms_enabled: input.smsEnabled === true,
              default_sms_template: smsTemplate,
              follow_up_enabled: input.followUpEnabled === true,
              follow_up_template: followUpTemplate,
              follow_up_delay_hours: boundedInteger(
                input.followUpDelayHours ?? 72,
                "Follow-up delay",
                1,
                720,
              ),
              quiet_hours_start: quietHoursStart,
              quiet_hours_end: quietHoursEnd,
              daily_limit: boundedInteger(
                input.dailyLimit ?? 25,
                "Daily sending limit",
                1,
                250,
              ),
              notification_emails: notificationEmails(
                input.notificationEmails,
              ),
              updated_at: now,
            },
            { onConflict: "organization_id,client_id" },
          )
          .select("id")
          .single(),
      ),
      "Review settings were not saved.",
    );
    await audit(
      context,
      "review.settings_updated",
      "review_settings",
      String(settings.id),
      {
        smsEnabled: input.smsEnabled === true,
        followUpEnabled: input.followUpEnabled === true,
      },
      clientId,
    );
    return { id: settings.id };
  }

  if (action === "send_review_request") {
    requirePermission(context, "reviews.request");
    const clientId = requireText(input.clientId, "Client", 100);
    const contactId = requireText(input.contactId, "Contact", 100);
    const idempotencyKey = requireText(
      input.idempotencyKey,
      "Request identifier",
      100,
    );
    if (!/^[A-Za-z0-9_-]{12,100}$/.test(idempotencyKey)) {
      throw new Error("The request identifier is invalid. Refresh and try again.");
    }
    if (input.consentConfirmed !== true) {
      throw new Error(
        "Confirm that this customer agreed to receive this review request by text.",
      );
    }
    await requireClient(context, clientId);

    const duplicate = await assertOk(
      supabase()
        .from("review_requests")
        .select("id,status")
        .eq("organization_id", context.organizationId)
        .eq("client_id", clientId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle(),
    );
    if (duplicate) {
      return { id: duplicate.id, status: duplicate.status, duplicate: true };
    }
    await requireActiveTwilioConnection(context, clientId);

    const [client, contact, config, profile, settings] = await Promise.all([
      assertOk(
        supabase()
          .from("clients")
          .select("business_name,time_zone")
          .eq("organization_id", context.organizationId)
          .eq("id", clientId)
          .single(),
      ),
      assertOk(
        supabase()
          .from("contacts")
          .select("id,first_name,last_name,phone,marketing_consent")
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .eq("id", contactId)
          .is("archived_at", null)
          .maybeSingle(),
      ),
      assertOk(
        supabase()
          .from("phone_system_configs")
          .select("*")
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .maybeSingle(),
      ),
      assertOk(
        supabase()
          .from("google_business_profiles")
          .select("google_review_url")
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .maybeSingle(),
      ),
      assertOk(
        supabase()
          .from("review_settings")
          .select("*")
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .maybeSingle(),
      ),
    ]);
    const selectedClient = requireRow(client, "Client not found.");
    const selectedContact = requireRow(contact, "Contact not found.");
    if (!selectedContact.phone) {
      throw new Error("This contact does not have a phone number.");
    }
    if (String(selectedContact.marketing_consent).toLowerCase() === "opt_out") {
      throw new Error("This contact opted out of text messages.");
    }
    if (!settings?.sms_enabled) {
      throw new Error("Turn on SMS review requests in Reviews settings first.");
    }
    const reviewUrl = normalizeGoogleReviewUrl(profile?.google_review_url);
    if (!reviewUrl) {
      throw new Error("Save this business's official Google review link first.");
    }
    if (
      !config ||
      String(config.provider_status ?? "").toLowerCase() !== "connected"
    ) {
      throw new Error("Connect this client's Twilio phone system first.");
    }
    if (String(config.a2p_status ?? "").toLowerCase() !== "approved") {
      throw new Error(
        "A2P registration must be approved before sending review requests.",
      );
    }
    const start = quietHour(settings.quiet_hours_start, "Quiet hours start");
    const end = quietHour(settings.quiet_hours_end, "Quiet hours end");
    const localMinutes = minutesInTimeZone(
      String(selectedClient.time_zone ?? "America/Chicago"),
    );
    if (
      localMinutes < 8 * 60 ||
      localMinutes >= 20 * 60 ||
      isWithinQuietHours(localMinutes, start, end)
    ) {
      throw new Error(
        `Review requests are paused outside the allowed local sending window and during quiet hours (${start}-${end}).`,
      );
    }

    const dailyLimit = boundedInteger(
      settings.daily_limit,
      "Daily sending limit",
      1,
      250,
    );

    const now = new Date().toISOString();
    const template = reviewTemplate(
      settings.default_sms_template ?? DEFAULT_REVIEW_SMS_TEMPLATE,
      "SMS template",
    );
    const messageBody = renderMessageTemplate(template, {
      first_name: String(selectedContact.first_name ?? "there"),
      last_name: String(selectedContact.last_name ?? ""),
      business_name: String(selectedClient.business_name),
      review_link: reviewUrl,
    });
    if (!messageBody.includes(reviewUrl)) {
      throw new Error("The review request must include the official Google review link.");
    }
    if (messageBody.length > 1600) {
      throw new Error(
        "The final review request is longer than 1,600 characters. Shorten the saved template and review it again.",
      );
    }
    if (typeof input.body !== "string" || input.body !== messageBody) {
      throw new Error(
        "The saved message changed after this preview loaded. Refresh Reviews and approve the exact message again.",
      );
    }

    const reservation = requireRow(
      await assertOk(
        supabase()
          .rpc("reserve_review_request", {
            p_organization_id: context.organizationId,
            p_client_id: clientId,
            p_contact_id: contactId,
            p_idempotency_key: idempotencyKey,
            p_message_body: messageBody,
            p_requested_by_email: context.email,
            p_consent_evidence: {
              confirmedBy: context.email,
              confirmedAt: now,
              contactConsentStatus: String(
                selectedContact.marketing_consent ?? "unknown",
              ),
            },
            p_daily_limit: dailyLimit,
          })
          .single(),
      ),
      "Review request was not reserved.",
    ) as AnyRecord;
    const requestRow = {
      id: String(reservation.request_id),
      status: String(reservation.request_status),
    };
    if (reservation.duplicate === true) {
      return { id: requestRow.id, status: requestRow.status, duplicate: true };
    }

    let conversation: AnyRecord;
    try {
      conversation = requireRow(
        await assertOk(
          supabase()
            .from("conversations")
            .upsert(
              {
                organization_id: context.organizationId,
                client_id: clientId,
                contact_id: contactId,
                channel: "sms",
                status: "open",
                last_message_at: now,
                updated_at: now,
              },
              { onConflict: "client_id,contact_id,channel" },
            )
            .select("id")
            .single(),
        ),
        "Conversation was not created.",
      );
    } catch (error) {
      const failure =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Conversation was not created.";
      await assertOk(
        supabase()
          .from("review_requests")
          .update({
            status: "failed",
            failed_at: new Date().toISOString(),
            error_message: failure,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .eq("id", requestRow.id),
      );
      throw new Error(failure);
    }

    let sent: { sid: string; status: string };
    try {
      sent = await sendTwilioMessage({
        accountSid: nullable(config.provider_account_sid),
        fromNumber: nullable(config.phone_number),
        messagingServiceSid: nullable(config.messaging_service_sid),
        to: String(selectedContact.phone),
        body: messageBody,
        allowPlatformFallback: false,
      });
    } catch (error) {
      const deliveryUnknown =
        error instanceof TwilioMessageDeliveryUnknownError;
      const failure =
        error instanceof Error ? error.message.slice(0, 500) : "Twilio could not send the review request.";
      const failureTime = new Date().toISOString();
      await assertOk(
        supabase()
          .from("review_requests")
          .update({
            status: deliveryUnknown ? "reconciling" : "failed",
            failed_at: deliveryUnknown ? null : failureTime,
            error_message: failure,
            updated_at: failureTime,
          })
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .eq("id", requestRow.id),
      );
      await audit(
        context,
        deliveryUnknown
          ? "review_request.delivery_unknown"
          : "review_request.failed",
        "review_request",
        String(requestRow.id),
        {},
        clientId,
      );
      throw new Error(failure);
    }

    const requestStatus = sent.status === "sent" ? "sent" : "queued";
    try {
      const message = requireRow(
        await assertOk(
          supabase()
            .from("messages")
            .insert({
              organization_id: context.organizationId,
              client_id: clientId,
              conversation_id: conversation.id,
              contact_id: contactId,
              provider_message_sid: sent.sid,
              direction: "outbound",
              channel: "sms",
              from_number: String(config.phone_number ?? ""),
              to_number: String(selectedContact.phone),
              body: messageBody,
              status: sent.status,
              automation_key: "review_request",
              sent_at: new Date().toISOString(),
            })
            .select("id")
            .single(),
        ),
        "Message was not saved.",
      );
      await assertOk(
        supabase()
          .from("review_requests")
          .update({
            message_id: message.id,
            status: requestStatus,
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .eq("id", requestRow.id),
      );
    } catch (error) {
      const warning =
        error instanceof Error ? error.message.slice(0, 500) : "The sent request was not linked to message history.";
      await assertOk(
        supabase()
          .from("review_requests")
          .update({
            status: requestStatus,
            sent_at: new Date().toISOString(),
            error_message: warning,
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .eq("id", requestRow.id),
      );
    }
    await audit(
      context,
      "review_request.sent",
      "review_request",
      String(requestRow.id),
      { providerMessageSid: sent.sid },
      clientId,
    );
    return { id: requestRow.id, status: requestStatus };
  }

  if (action === "publish_google_review_reply") {
    requirePermission(context, "reviews.reply");
    if (input.confirmed !== true) {
      throw new Error("Review the exact reply and confirm before publishing it.");
    }
    const clientId = requireText(input.clientId, "Client", 100);
    const reviewId = requireText(input.reviewId, "Google review", 300);
    if (typeof input.comment !== "string" || !input.comment.trim()) {
      throw new Error("Reply is required.");
    }
    const comment = input.comment.trim();
    if (new TextEncoder().encode(comment).byteLength > 4096) {
      throw new Error("Google review replies must be 4,096 bytes or less.");
    }
    const authorized = await authorizedGoogleReviewContext(context, clientId);
    await updateGoogleBusinessReviewReply(
      authorized.accessToken,
      authorized.accountResourceName,
      authorized.locationResourceName,
      reviewId,
      comment,
    );
    await audit(
      context,
      "google_review.reply_published",
      "google_business_profile",
      clientId,
      { source: "manual_confirmed_publish" },
      clientId,
    );
    return { published: true };
  }

  if (action === "delete_google_review_reply") {
    requirePermission(context, "reviews.reply");
    if (input.confirmed !== true) {
      throw new Error("Confirm before deleting this Google review reply.");
    }
    const clientId = requireText(input.clientId, "Client", 100);
    const reviewId = requireText(input.reviewId, "Google review", 300);
    const authorized = await authorizedGoogleReviewContext(context, clientId);
    await deleteGoogleBusinessReviewReply(
      authorized.accessToken,
      authorized.accountResourceName,
      authorized.locationResourceName,
      reviewId,
    );
    await audit(
      context,
      "google_review.reply_deleted",
      "google_business_profile",
      clientId,
      { source: "manual_confirmed_delete" },
      clientId,
    );
    return { deleted: true };
  }

  if (action === "disconnect_google_profile") {
    const clientId = requireText(input.clientId, "Client", 100);
    return disconnectSupabaseGoogleProfile(user, clientId);
  }

  if (action === "refresh_google_profile") {
    const clientId = requireText(input.clientId, "Client", 100);
    if (!googleProfileRuntime().configured)
      throw new Error("Google Business Profile OAuth is not configured yet.");
    return refreshSupabaseGoogleProfile(user, clientId);
  }

  if (action === "list_google_profile_locations") {
    const clientId = requireText(input.clientId, "Client", 100);
    return listSupabaseGoogleLocations(user, clientId);
  }

  if (action === "select_google_profile_location") {
    const clientId = requireText(input.clientId, "Client", 100);
    const accountResourceName = requireText(
      input.accountResourceName,
      "Google account",
      250,
    );
    const locationResourceName = requireText(
      input.locationResourceName,
      "Google location",
      250,
    );
    return selectSupabaseGoogleLocation(
      user,
      clientId,
      accountResourceName,
      locationResourceName,
    );
  }

  if (action === "disconnect_provider") {
    requirePermission(context, "phone_system.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    const now = new Date().toISOString();
    await Promise.all([
      assertOk(
        supabase()
          .from("provider_connections")
          .update({
            status: "disconnected",
            disconnected_at: now,
            external_account_id: null,
            last_error: null,
            updated_at: now,
          })
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .eq("provider", "twilio"),
      ),
      assertOk(
        supabase()
          .from("phone_system_configs")
          .update({
            provider_status: "disconnected",
            provider_account_sid: null,
            phone_number_sid: null,
            messaging_service_sid: null,
            phone_number: null,
            missed_call_text_enabled: false,
            updated_at: now,
          })
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId),
      ),
    ]);
    await audit(
      context,
      "provider.disconnected",
      "provider_connection",
      null,
      { provider: "twilio" },
      clientId,
    );
    return { disconnected: true };
  }

  if (action === "check_provider_connection") {
    requirePermission(context, "phone_system.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    const connection = await assertOk(
      supabase()
        .from("provider_connections")
        .select(
          "id,status,external_account_id,disconnected_at,public_config",
        )
        .eq("organization_id", context.organizationId)
        .eq("client_id", clientId)
        .eq("provider", "twilio")
        .maybeSingle(),
    );
    if (!connection || !providerIsLinked(connection))
      throw new Error("Connect the customer's Twilio account first.");
    try {
      const account = await checkTwilioConnectedAccount(
        String(connection.external_account_id),
      );
      const accountStatus = String(account.status ?? "unknown").toLowerCase();
      const isActive = accountStatus === "active";
      const status = isActive ? "connected" : "inactive";
      const lastError = isActive ? null : `Twilio account is ${accountStatus}.`;
      const now = new Date().toISOString();
      await Promise.all([
        assertOk(
          supabase()
            .from("provider_connections")
            .update({
              status,
              external_account_name: account.name,
              public_config: {
                accountStatus,
                accountType: account.accountType,
                currency: account.currency,
                todaySpend: account.today.spend,
                monthSpend: account.month.spend,
                monthCalls: account.month.calls,
                monthMessages: account.month.messages,
              },
              last_health_check_at: now,
              last_error: lastError,
              updated_at: now,
            })
            .eq("id", connection.id),
        ),
        assertOk(
          supabase()
            .from("phone_system_configs")
            .update({
              provider_status: status,
              ...(!isActive && { missed_call_text_enabled: false }),
              updated_at: now,
            })
            .eq("organization_id", context.organizationId)
            .eq("client_id", clientId),
        ),
      ]);
      const canReadSharedBilling = rolePermissions[context.role].includes(
        "billing.read_shared",
      );
      return {
        ...account,
        balance: canReadSharedBilling ? account.balance : null,
        balanceStatus: canReadSharedBilling
          ? account.balanceStatus
          : "restricted",
        status,
        isLinked: true,
        isActive,
        healthy: isActive,
        error: lastError,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Connection failed";
      const now = new Date().toISOString();
      await Promise.all([
        assertOk(
          supabase()
            .from("provider_connections")
            .update({
              status: "error",
              last_health_check_at: now,
              last_error: message,
              updated_at: now,
            })
            .eq("id", connection.id),
        ),
        assertOk(
          supabase()
            .from("phone_system_configs")
            .update({
              provider_status: "error",
              missed_call_text_enabled: false,
              updated_at: now,
            })
            .eq("organization_id", context.organizationId)
            .eq("client_id", clientId),
        ),
      ]);
      return {
        status: "error",
        isLinked: true,
        isActive: false,
        healthy: false,
        error: message,
      };
    }
  }

  if (action === "search_twilio_numbers") {
    requirePermission(context, "phone_system.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    const connection = await requireActiveTwilioConnection(context, clientId);
    return {
      numbers: await searchTwilioNumbers(
        String(connection.external_account_id),
        optionalText(input.areaCode, 3) ?? "",
      ),
    };
  }

  if (action === "list_twilio_numbers") {
    requirePermission(context, "phone_system.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    const connection = await requireActiveTwilioConnection(context, clientId);
    return {
      numbers: await listTwilioNumbers(String(connection.external_account_id)),
    };
  }

  if (action === "connect_twilio_number") {
    requirePermission(context, "phone_system.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    const phoneNumberSid = requireText(input.phoneNumberSid, "Twilio number", 80);
    if (!/^PN[0-9a-f]{32}$/i.test(phoneNumberSid))
      throw new Error("Choose a valid number from the connected Twilio account.");
    const connection = await requireActiveTwilioConnection(context, clientId);
    const configured = await configureTwilioNumber(
      String(connection.external_account_id),
      phoneNumberSid,
    );
    await assertOk(
      supabase().from("phone_system_configs").upsert(
        {
          organization_id: context.organizationId,
          client_id: clientId,
          provider: "twilio",
          provider_account_sid: connection.external_account_id,
          phone_number_sid: configured.sid,
          phone_number: configured.phoneNumber,
          provider_status: "connected",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,client_id" },
      ),
    );
    await audit(
      context,
      "phone.existing_number_connected",
      "phone_number",
      configured.sid,
      { phoneNumber: configured.phoneNumber, billingOwner: "customer" },
      clientId,
    );
    return configured;
  }

  if (action === "buy_twilio_number") {
    requirePermission(context, "phone_system.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    if (input.confirmCharge !== true)
      throw new Error(
        "Confirm that Twilio will charge the customer before purchasing the number.",
      );
    const requestedNumber = phoneNumber(
      input.phoneNumber,
      "Phone number",
      true,
    )!;
    const connection = await requireActiveTwilioConnection(context, clientId);
    const purchased = await purchaseTwilioNumber(
      String(connection.external_account_id),
      requestedNumber,
    );
    await assertOk(
      supabase()
        .from("phone_system_configs")
        .upsert(
          {
            organization_id: context.organizationId,
            client_id: clientId,
            provider: "twilio",
            provider_account_sid: connection.external_account_id,
            phone_number_sid: purchased.sid,
            phone_number: purchased.phoneNumber,
            provider_status: "connected",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,client_id" },
        ),
    );
    await audit(
      context,
      "phone.number_purchased",
      "phone_number",
      purchased.sid,
      { phoneNumber: purchased.phoneNumber, billingOwner: "customer" },
      clientId,
    );
    return purchased;
  }

  if (action === "create_workflow") {
    requirePermission(context, "automations.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    await requireActiveTwilioConnection(context, clientId);
    const triggerKey = ["lead.created", "sms.received", "call.missed"].includes(
      String(input.triggerKey),
    )
      ? String(input.triggerKey)
      : "lead.created";
    const workflow = requireRow(
      await assertOk(
        supabase()
          .from("workflows")
          .insert({
            organization_id: context.organizationId,
            client_id: clientId,
            name: requireText(input.name, "Workflow name", 160),
            description: optionalText(input.description, 500) ?? "",
            status: "draft",
            trigger_key: triggerKey,
            current_version: 1,
            created_by_email: context.email,
          })
          .select("id")
          .single(),
      ),
      "Workflow was not created.",
    );
    const graph: WorkflowGraph = {
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          label: "Workflow trigger",
          x: 100,
          y: 180,
          config: { eventKey: triggerKey },
        },
        {
          id: "task-1",
          type: "create_task",
          label: "Create follow-up task",
          x: 390,
          y: 180,
          config: {
            title: "Follow up with {{contact_first_name}}",
            priority: "MEDIUM",
          },
        },
      ],
      edges: [
        {
          id: "edge-1",
          source: "trigger-1",
          target: "task-1",
          branch: "always",
        },
      ],
    };
    await assertOk(
      supabase()
        .from("workflow_versions")
        .insert({
          organization_id: context.organizationId,
          client_id: clientId,
          workflow_id: workflow.id,
          version: 1,
          graph,
          validation_errors: [],
          created_by_email: context.email,
        }),
    );
    await audit(
      context,
      "workflow.created",
      "workflow",
      workflow.id,
      { triggerKey },
      clientId,
    );
    return { id: workflow.id };
  }

  if (action === "save_workflow") {
    requirePermission(context, "automations.manage");
    const workflowId = requireText(input.workflowId, "Workflow", 100);
    const workflow = await assertOk(
      supabase()
        .from("workflows")
        .select("*")
        .eq("id", workflowId)
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
    );
    if (!workflow) throw new Error("Workflow not found.");
    await requireClient(context, String(workflow.client_id));
    await requireActiveTwilioConnection(context, String(workflow.client_id));
    const validation = validateWorkflowGraph(input.graph);
    if (validation.errors.length) throw new Error(validation.errors.join(" "));
    const nextVersion = Number(workflow.current_version) + 1;
    const trigger = validation.graph.nodes.find(
      (node) => node.type === "trigger",
    );
    const triggerKey = String(trigger?.config.eventKey ?? workflow.trigger_key);
    await assertOk(
      supabase()
        .from("workflow_versions")
        .insert({
          organization_id: context.organizationId,
          client_id: workflow.client_id,
          workflow_id: workflowId,
          version: nextVersion,
          graph: validation.graph,
          validation_errors: [],
          created_by_email: context.email,
        }),
    );
    await assertOk(
      supabase()
        .from("workflows")
        .update({
          name: requireText(input.name ?? workflow.name, "Workflow name", 160),
          description: optionalText(input.description, 500) ?? "",
          trigger_key: triggerKey,
          current_version: nextVersion,
          status:
            workflow.status === "active" ? "draft_changes" : workflow.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", workflowId),
    );
    await audit(
      context,
      "workflow.saved",
      "workflow",
      workflowId,
      { version: nextVersion },
      String(workflow.client_id),
    );
    return { id: workflowId, version: nextVersion };
  }

  if (action === "publish_workflow") {
    requirePermission(context, "automations.manage");
    const workflowId = requireText(input.workflowId, "Workflow", 100);
    const workflow = await assertOk(
      supabase()
        .from("workflows")
        .select("*")
        .eq("id", workflowId)
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
    );
    if (!workflow) throw new Error("Workflow not found.");
    await requireClient(context, String(workflow.client_id));
    await requireActiveTwilioConnection(context, String(workflow.client_id));
    const version = await assertOk(
      supabase()
        .from("workflow_versions")
        .select("graph")
        .eq("organization_id", context.organizationId)
        .eq("workflow_id", workflowId)
        .eq("version", workflow.current_version)
        .single(),
    );
    const validation = validateWorkflowGraph(version?.graph);
    if (validation.errors.length) throw new Error(validation.errors.join(" "));
    await assertOk(
      supabase()
        .from("workflows")
        .update({
          status: "active",
          published_version: workflow.current_version,
          updated_at: new Date().toISOString(),
        })
        .eq("id", workflowId),
    );
    await audit(
      context,
      "workflow.published",
      "workflow",
      workflowId,
      { version: workflow.current_version },
      String(workflow.client_id),
    );
    return { id: workflowId, status: "active" };
  }

  if (action === "pause_workflow") {
    requirePermission(context, "automations.manage");
    const workflowId = requireText(input.workflowId, "Workflow", 100);
    const workflow = await assertOk(
      supabase()
        .from("workflows")
        .select("client_id")
        .eq("id", workflowId)
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
    );
    if (!workflow) throw new Error("Workflow not found.");
    await requireClient(context, String(workflow.client_id));
    await assertOk(
      supabase()
        .from("workflows")
        .update({ status: "paused", updated_at: new Date().toISOString() })
        .eq("id", workflowId),
    );
    return { id: workflowId, status: "paused" };
  }

  if (action === "test_workflow") {
    requirePermission(context, "automations.manage");
    const workflowId = requireText(input.workflowId, "Workflow", 100);
    const workflow = await assertOk(
      supabase()
        .from("workflows")
        .select("*")
        .eq("id", workflowId)
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
    );
    if (!workflow) throw new Error("Workflow not found.");
    await requireClient(context, String(workflow.client_id));
    await requireActiveTwilioConnection(context, String(workflow.client_id));
    const version = await assertOk(
      supabase()
        .from("workflow_versions")
        .select("graph")
        .eq("organization_id", context.organizationId)
        .eq("workflow_id", workflowId)
        .eq("version", workflow.current_version)
        .single(),
    );
    return executeWorkflow({
      workflowId,
      graph: validateWorkflowGraph(version?.graph).graph,
      version: Number(workflow.current_version),
      triggerKey: String(workflow.trigger_key),
      payload: {
        organizationId: context.organizationId,
        clientId: String(workflow.client_id),
        eventId: `test:${crypto.randomUUID()}`,
        businessName: context.organizationName,
        serviceRequested: "Test workflow",
      },
      isTest: true,
    });
  }

  if (action === "save_phone_settings") {
    requirePermission(context, "phone_system.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    const client = requireRow(
      await assertOk(
        supabase()
          .from("clients")
          .select("business_name")
          .eq("id", clientId)
          .eq("organization_id", context.organizationId)
          .single(),
      ),
      "Client not found.",
    );
    const [twilio, connection, existingConfig] = await Promise.all([
      Promise.resolve(getTwilioRuntimeStatus()),
      requireActiveTwilioConnection(context, clientId),
      assertOk(
        supabase()
          .from("phone_system_configs")
          .select(
            "provider_account_sid,phone_number_sid,messaging_service_sid,phone_number",
          )
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .maybeSingle(),
      ),
    ]);
    const isSameProviderAccount =
      String(existingConfig?.provider_account_sid ?? "") ===
      String(connection.external_account_id);
    const assignedNumberSid = isSameProviderAccount
      ? nullable(existingConfig?.phone_number_sid)
      : null;
    const assignedNumber = assignedNumberSid
      ? nullable(existingConfig?.phone_number)
      : null;
    const messagingServiceSid = isSameProviderAccount
      ? nullable(existingConfig?.messaging_service_sid)
      : null;
    const forwardingNumber = phoneNumber(
      input.forwardingNumber,
      "Forwarding phone number",
    );
    const a2pStatus = [
      "not_started",
      "in_progress",
      "approved",
      "rejected",
    ].includes(String(input.a2pStatus))
      ? String(input.a2pStatus)
      : "not_started";
    const wantsMissedCallText = Boolean(input.missedCallTextEnabled);
    if (
      wantsMissedCallText &&
      (!twilio.configured || !assignedNumberSid || !assignedNumber)
    )
      throw new Error(
        "Connect the customer's Twilio account and choose a phone number before turning on missed-call text back.",
      );
    if (wantsMissedCallText && a2pStatus !== "approved")
      throw new Error(
        "A2P registration must be approved before missed-call texting can be turned on.",
      );
    const message = requireText(
      input.missedCallMessage,
      "Missed-call message",
      1000,
    );
    const ringTimeout = Math.max(
      10,
      Math.min(60, Number(input.ringTimeoutSeconds ?? 20)),
    );
    const cooldown = Math.max(
      1,
      Math.min(1440, Number(input.cooldownMinutes ?? 20)),
    );
    const providerStatus = "connected";
    const config = requireRow(
      await assertOk(
        supabase()
          .from("phone_system_configs")
          .upsert(
            {
              organization_id: context.organizationId,
              client_id: clientId,
              provider: "twilio",
              provider_account_sid: connection.external_account_id,
              phone_number_sid: assignedNumberSid,
              messaging_service_sid: messagingServiceSid,
              phone_number: assignedNumber,
              forwarding_number: forwardingNumber,
              ring_timeout_seconds: ringTimeout,
              voicemail_enabled: input.voicemailEnabled !== false,
              missed_call_text_enabled: wantsMissedCallText,
              missed_call_message: message,
              cooldown_minutes: cooldown,
              provider_status: providerStatus,
              a2p_status: a2pStatus,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "organization_id,client_id" },
          )
          .select("id")
          .single(),
      ),
      "Phone settings were not saved.",
    );
    await assertOk(
      supabase()
        .from("automation_rules")
        .upsert(
          {
            organization_id: context.organizationId,
            client_id: clientId,
            name: "Missed call text back",
            trigger_key: "call.missed",
            enabled: wantsMissedCallText,
            config: {
              message,
              cooldownMinutes: cooldown,
              businessName: String(client.business_name),
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "client_id,trigger_key" },
        ),
    );
    await audit(
      context,
      "phone.settings_updated",
      "phone_system_config",
      config.id,
      { providerStatus, a2pStatus, missedCallTextEnabled: wantsMissedCallText },
      clientId,
    );
    return { id: config.id, providerStatus };
  }

  if (action === "send_sms") {
    requirePermission(context, "messages.write");
    const clientId = requireText(input.clientId, "Client", 100);
    const contactId = requireText(input.contactId, "Contact", 100);
    await requireClient(context, clientId);
    const [contactResult, config] = await Promise.all([
      assertOk(
        supabase()
          .from("contacts")
          .select("id,phone,marketing_consent")
          .eq("id", contactId)
          .eq("client_id", clientId)
          .eq("organization_id", context.organizationId)
          .single(),
      ),
      assertOk(
        supabase()
          .from("phone_system_configs")
          .select("*")
          .eq("client_id", clientId)
          .eq("organization_id", context.organizationId)
          .maybeSingle(),
      ),
    ]);
    const contact = requireRow(contactResult, "Contact not found.");
    if (!contact.phone)
      throw new Error("This contact does not have a phone number.");
    if (String(contact.marketing_consent).toLowerCase() === "opt_out")
      throw new Error("This contact opted out of text messages.");
    if (!config || config.provider_status !== "connected")
      throw new Error(
        "Connect this client's Twilio phone system before sending messages.",
      );
    if (config.a2p_status !== "approved")
      throw new Error(
        "A2P registration must be approved before sending messages.",
      );
    const body = requireText(input.body, "Message", 1600);
    const conversation = requireRow(
      await assertOk(
        supabase()
          .from("conversations")
          .upsert(
            {
              organization_id: context.organizationId,
              client_id: clientId,
              contact_id: contactId,
              channel: "sms",
              status: "open",
              last_message_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "client_id,contact_id,channel" },
          )
          .select("id")
          .single(),
      ),
      "Conversation was not created.",
    );
    const sent = await sendTwilioMessage({
      accountSid: nullable(config.provider_account_sid),
      fromNumber: nullable(config.phone_number),
      messagingServiceSid: nullable(config.messaging_service_sid),
      to: String(contact.phone),
      body,
    });
    const message = requireRow(
      await assertOk(
        supabase()
          .from("messages")
          .insert({
            organization_id: context.organizationId,
            client_id: clientId,
            conversation_id: conversation.id,
            contact_id: contactId,
            provider_message_sid: sent.sid,
            direction: "outbound",
            channel: "sms",
            from_number: String(config.phone_number ?? ""),
            to_number: String(contact.phone),
            body,
            status: sent.status,
            sent_at: new Date().toISOString(),
          })
          .select("id")
          .single(),
      ),
      "Message was not saved.",
    );
    await audit(
      context,
      "message.sent",
      "message",
      message.id,
      { providerMessageSid: sent.sid },
      clientId,
    );
    return { id: message.id, status: sent.status };
  }

  if (action === "create_client") {
    requirePermission(context, "clients.manage");
    const businessName = requireText(input.businessName, "Business name", 160);
    const slugBase =
      businessName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 70) || crypto.randomUUID();
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
          assigned_account_manager:
            optionalText(input.assignedAccountManager, 120) ?? context.name,
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
      const existing = await assertOk(
        supabase()
          .from("websites")
          .select("id,analytics")
          .eq("id", websiteId)
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .maybeSingle(),
      );
      if (!existing) throw new Error("Website connection not found.");
      const currentAnalytics =
        existing.analytics && typeof existing.analytics === "object"
          ? (existing.analytics as Record<string, unknown>)
          : {};
      await assertOk(
        supabase()
          .from("websites")
          .update({
            name,
            domain,
            status: "connected",
            analytics: { ...currentAnalytics, ...analytics },
            updated_at: new Date().toISOString(),
          })
          .eq("id", websiteId)
          .eq("organization_id", context.organizationId),
      );
      await audit(
        context,
        "website.updated",
        "website",
        websiteId,
        { domain, platform },
        clientId,
      );
      return { id: websiteId };
    }
    const website = await assertOk(
      supabase()
        .from("websites")
        .insert({
          organization_id: context.organizationId,
          client_id: clientId,
          name,
          domain,
          status: "connected",
          analytics,
        })
        .select("id")
        .single(),
    );
    const createdWebsite = requireRow(
      website,
      "Website connection was not created.",
    );
    await audit(
      context,
      "website.connected",
      "website",
      createdWebsite.id,
      { domain, platform },
      clientId,
    );
    return { id: createdWebsite.id };
  }

  if (action === "disconnect_website") {
    requirePermission(context, "websites.manage");
    const websiteId = requireText(input.websiteId, "Website", 100);
    const website = await assertOk(
      supabase()
        .from("websites")
        .select("client_id,analytics")
        .eq("id", websiteId)
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
    );
    if (!website) throw new Error("Website connection not found.");
    await requireClient(context, String(website.client_id));
    const currentAnalytics =
      website.analytics && typeof website.analytics === "object"
        ? (website.analytics as Record<string, unknown>)
        : {};
    await assertOk(
      supabase()
        .from("websites")
        .update({
          status: "disconnected",
          analytics: { ...currentAnalytics, leadCaptureEnabled: false },
          updated_at: new Date().toISOString(),
        })
        .eq("id", websiteId)
        .eq("organization_id", context.organizationId),
    );
    await audit(
      context,
      "website.disconnected",
      "website",
      websiteId,
      {},
      String(website.client_id),
    );
    return { id: websiteId };
  }

  if (action === "archive_client") {
    requirePermission(context, "clients.manage");
    const clientId = requireText(input.clientId, "Client", 100);
    await requireClient(context, clientId);
    await assertOk(
      supabase()
        .from("clients")
        .update({ status: "archived", archived_at: new Date().toISOString() })
        .eq("id", clientId)
        .eq("organization_id", context.organizationId),
    );
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
          marketing_consent:
            input.marketingConsent === "granted" ? "granted" : "unknown",
          last_interaction_at: new Date().toISOString(),
        })
        .select("id")
        .single(),
    );
    const createdContact = requireRow(contact, "Contact was not created.");
    await audit(
      context,
      "contact.created",
      "contact",
      createdContact.id,
      {},
      clientId,
    );
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
    if (!phone && !email)
      throw new Error("A phone number or email is required.");

    let existingContact: AnyRecord | null = null;
    if (email) {
      existingContact = await assertOk(
        supabase()
          .from("contacts")
          .select("id")
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .eq("email", email)
          .is("archived_at", null)
          .limit(1)
          .maybeSingle(),
      );
    }
    if (!existingContact && phone) {
      existingContact = await assertOk(
        supabase()
          .from("contacts")
          .select("id")
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .eq("phone", phone)
          .is("archived_at", null)
          .limit(1)
          .maybeSingle(),
      );
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
            marketing_consent:
              input.consentStatus === "granted" ? "granted" : "unknown",
            last_interaction_at: new Date().toISOString(),
          })
          .select("id")
          .single(),
      );
    }

    const contactId = String(
      requireRow(existingContact, "Contact was not created.").id,
    );
    const lead = await assertOk(
      supabase()
        .from("leads")
        .insert({
          organization_id: context.organizationId,
          client_id: clientId,
          contact_id: contactId,
          pipeline_id: PIPELINE_ID,
          stage_id: STAGES[0].id,
          service_requested: requireText(
            input.serviceRequested,
            "Service",
            160,
          ),
          message: optionalText(input.message, 1200) ?? "",
          source: optionalText(input.source, 100) ?? "Manual",
          campaign: optionalText(input.campaign, 160),
          status: "NEW",
          assigned_user: context.name,
          estimated_value_cents: cents(input.estimatedValueCents),
          lead_score: Math.max(0, Math.min(100, Number(input.leadScore ?? 50))),
          tags: tags(input.tags),
          consent_status:
            input.consentStatus === "granted" ? "granted" : "unknown",
        })
        .select("id")
        .single(),
    );
    const createdLead = requireRow(lead, "Lead was not created.");
    await audit(context, "lead.created", "lead", createdLead.id, {}, clientId);
    await runPublishedWorkflowsForEvent("lead.created", {
      organizationId: context.organizationId,
      clientId,
      eventId: `lead:${createdLead.id}:created`,
      leadId: createdLead.id,
      contactId,
      businessName: context.organizationName,
      serviceRequested: requireText(input.serviceRequested, "Service", 160),
    });
    return { id: createdLead.id };
  }

  if (action === "update_lead") {
    requirePermission(context, "opportunities.write");
    const leadId = requireText(input.leadId, "Lead", 100);
    const lead = await assertOk(
      supabase()
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .eq("organization_id", context.organizationId)
        .is("archived_at", null)
        .maybeSingle(),
    );
    if (!lead) throw new Error("Lead not found.");
    await requireClient(context, lead.client_id);
    const allowedStatuses = new Set([
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
    const status =
      typeof input.status === "string" && allowedStatuses.has(input.status)
        ? input.status
        : String(lead.status);
    await assertOk(
      supabase()
        .from("leads")
        .update({
          status,
          assigned_user:
            optionalText(input.assignedUser, 120) ?? lead.assigned_user,
          estimated_value_cents:
            input.estimatedValueCents === undefined
              ? lead.estimated_value_cents
              : cents(input.estimatedValueCents),
          final_revenue_cents:
            input.finalRevenueCents === undefined
              ? lead.final_revenue_cents
              : cents(input.finalRevenueCents),
          lost_reason: optionalText(input.lostReason, 240) ?? lead.lost_reason,
          next_follow_up_at:
            optionalText(input.nextFollowUpAt, 40) ?? lead.next_follow_up_at,
          last_contacted_at: [
            "CONTACTED",
            "QUALIFIED",
            "APPOINTMENT_BOOKED",
            "ESTIMATE_SENT",
            "WON",
            "LOST",
          ].includes(status)
            ? new Date().toISOString()
            : lead.last_contacted_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .eq("organization_id", context.organizationId),
    );
    await audit(
      context,
      "lead.updated",
      "lead",
      leadId,
      { status },
      lead.client_id,
    );
    return { id: leadId };
  }

  if (action === "move_lead") {
    requirePermission(context, "opportunities.write");
    const leadId = requireText(input.leadId, "Lead", 100);
    const stageId = requireText(input.stageId, "Stage", 100);
    const lead = await assertOk(
      supabase()
        .from("leads")
        .select("client_id")
        .eq("id", leadId)
        .eq("organization_id", context.organizationId)
        .is("archived_at", null)
        .maybeSingle(),
    );
    if (!lead) throw new Error("Lead not found.");
    await requireClient(context, lead.client_id);
    const stage = await assertOk(
      supabase()
        .from("pipeline_stages")
        .select("id,name,slug")
        .eq("id", stageId)
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
    );
    if (!stage) throw new Error("Pipeline stage not found.");
    const statusByStage: Record<string, string> = {
      new: "NEW",
      "attempting-contact": "NEW",
      contacted: "CONTACTED",
      qualified: "QUALIFIED",
      "appointment-booked": "APPOINTMENT_BOOKED",
      "estimate-sent": "ESTIMATE_SENT",
      won: "WON",
      lost: "LOST",
    };
    await assertOk(
      supabase()
        .from("leads")
        .update({
          stage_id: stageId,
          status: statusByStage[stage.slug] ?? "NEW",
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .eq("organization_id", context.organizationId),
    );
    await audit(
      context,
      "lead.stage_changed",
      "lead",
      leadId,
      { stageId },
      lead.client_id,
    );
    return { id: leadId };
  }

  if (action === "archive_lead") {
    requirePermission(context, "opportunities.write");
    const leadId = requireText(input.leadId, "Lead", 100);
    const lead = await assertOk(
      supabase()
        .from("leads")
        .select("client_id")
        .eq("id", leadId)
        .eq("organization_id", context.organizationId)
        .is("archived_at", null)
        .maybeSingle(),
    );
    if (!lead) throw new Error("Lead not found.");
    await requireClient(context, lead.client_id);
    await assertOk(
      supabase()
        .from("leads")
        .update({
          archived_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .eq("organization_id", context.organizationId),
    );
    await audit(context, "lead.archived", "lead", leadId, {}, lead.client_id);
    return { id: leadId };
  }

  if (action === "add_note") {
    requirePermission(context, "opportunities.write");
    const leadId = requireText(input.leadId, "Lead", 100);
    const lead = await assertOk(
      supabase()
        .from("leads")
        .select("client_id,contact_id")
        .eq("id", leadId)
        .eq("organization_id", context.organizationId)
        .is("archived_at", null)
        .maybeSingle(),
    );
    if (!lead) throw new Error("Lead not found.");
    await requireClient(context, lead.client_id);
    const note = await assertOk(
      supabase()
        .from("notes")
        .insert({
          organization_id: context.organizationId,
          client_id: lead.client_id,
          lead_id: leadId,
          contact_id: lead.contact_id,
          body: requireText(input.body, "Note", 2000),
        })
        .select("id")
        .single(),
    );
    const createdNote = requireRow(note, "Note was not created.");
    await audit(context, "note.created", "lead", leadId, {}, lead.client_id);
    return { id: createdNote.id };
  }

  if (action === "create_task") {
    requirePermission(context, "tasks.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const leadId = optionalText(input.leadId, 100);
    const contactId = optionalText(input.contactId, 100);
    if (leadId) {
      const lead = await assertOk(
        supabase()
          .from("leads")
          .select("id")
          .eq("id", leadId)
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .is("archived_at", null)
          .maybeSingle(),
      );
      if (!lead) throw new Error("The selected lead does not belong to this business.");
    }
    if (contactId) {
      const contact = await assertOk(
        supabase()
          .from("contacts")
          .select("id")
          .eq("id", contactId)
          .eq("organization_id", context.organizationId)
          .eq("client_id", clientId)
          .is("archived_at", null)
          .maybeSingle(),
      );
      if (!contact)
        throw new Error("The selected contact does not belong to this business.");
    }
    const priority = ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(
      String(input.priority),
    )
      ? String(input.priority)
      : "MEDIUM";
    const task = await assertOk(
      supabase()
        .from("tasks")
        .insert({
          organization_id: context.organizationId,
          client_id: clientId,
          lead_id: leadId,
          contact_id: contactId,
          title: requireText(input.title, "Task title", 180),
          description: optionalText(input.description, 1000) ?? "",
          assignee: optionalText(input.assignee, 120) ?? context.name,
          due_at: optionalText(input.dueAt, 40),
          priority,
          status: "TO_DO",
        })
        .select("id")
        .single(),
    );
    const createdTask = requireRow(task, "Task was not created.");
    await audit(context, "task.created", "task", createdTask.id, {}, clientId);
    return { id: createdTask.id };
  }

  if (action === "toggle_task") {
    requirePermission(context, "tasks.write");
    const taskId = requireText(input.taskId, "Task", 100);
    const task = await assertOk(
      supabase()
        .from("tasks")
        .select("client_id,status")
        .eq("id", taskId)
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
    );
    if (!task) throw new Error("Task not found.");
    await requireClient(context, task.client_id);
    const nextStatus = task.status === "COMPLETED" ? "TO_DO" : "COMPLETED";
    await assertOk(
      supabase()
        .from("tasks")
        .update({
          status: nextStatus,
          completed_at:
            nextStatus === "COMPLETED" ? new Date().toISOString() : null,
        })
        .eq("id", taskId)
        .eq("organization_id", context.organizationId),
    );
    await audit(
      context,
      "task.status_changed",
      "task",
      taskId,
      { status: nextStatus },
      task.client_id,
    );
    return { id: taskId, status: nextStatus };
  }

  if (action === "create_appointment") {
    requirePermission(context, "appointments.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const contactId = requireText(input.contactId, "Contact", 100);
    const contact = await assertOk(
      supabase()
        .from("contacts")
        .select("id")
        .eq("id", contactId)
        .eq("client_id", clientId)
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
    );
    if (!contact) throw new Error("Contact not found.");
    const startsAt = requireText(input.startsAt, "Start time", 40);
    const endsAt = requireText(input.endsAt, "End time", 40);
    if (Date.parse(endsAt) <= Date.parse(startsAt))
      throw new Error("End time must be after the start time.");
    const appointment = await assertOk(
      supabase()
        .from("appointments")
        .insert({
          organization_id: context.organizationId,
          client_id: clientId,
          lead_id: optionalText(input.leadId, 100),
          contact_id: contactId,
          assigned_employee: optionalText(input.assignedEmployee, 120),
          service_type: requireText(input.serviceType, "Service", 160),
          starts_at: startsAt,
          ends_at: endsAt,
          notes: optionalText(input.notes, 1000) ?? "",
          status: "SCHEDULED",
        })
        .select("id")
        .single(),
    );
    const createdAppointment = requireRow(
      appointment,
      "Appointment was not created.",
    );
    await audit(
      context,
      "appointment.created",
      "appointment",
      createdAppointment.id,
      {},
      clientId,
    );
    return { id: createdAppointment.id };
  }

  if (action === "update_appointment_status") {
    requirePermission(context, "appointments.write");
    const appointmentId = requireText(input.appointmentId, "Appointment", 100);
    const status = requireText(input.status, "Status", 30);
    if (
      !["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"].includes(
        status,
      )
    )
      throw new Error("Invalid appointment status.");
    const appointment = await assertOk(
      supabase()
        .from("appointments")
        .select("client_id")
        .eq("id", appointmentId)
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
    );
    if (!appointment) throw new Error("Appointment not found.");
    await requireClient(context, appointment.client_id);
    await assertOk(
      supabase()
        .from("appointments")
        .update({ status })
        .eq("id", appointmentId)
        .eq("organization_id", context.organizationId),
    );
    await audit(
      context,
      "appointment.status_changed",
      "appointment",
      appointmentId,
      { status },
      appointment.client_id,
    );
    return { id: appointmentId, status };
  }

  if (action === "create_company") {
    requirePermission(context, "companies.write");
    const clientId = requireText(input.clientId, "Client", 80);
    await requireClient(context, clientId);
    const company = await assertOk(
      supabase()
        .from("companies")
        .insert({
          organization_id: context.organizationId,
          client_id: clientId,
          name: requireText(input.name, "Company name", 160),
          industry: optionalText(input.industry, 100),
          website: optionalText(input.website, 240),
          phone: optionalText(input.phone, 40),
          email: optionalText(input.email, 160)?.toLowerCase() ?? null,
          address: optionalText(input.address, 240),
          city: optionalText(input.city, 80),
          state: optionalText(input.state, 30),
          zip: optionalText(input.zip, 20),
          tags: tags(input.tags),
          notes: optionalText(input.notes, 1500) ?? "",
        })
        .select("id")
        .single(),
    );
    const createdCompany = requireRow(company, "Company was not created.");
    await audit(
      context,
      "company.created",
      "company",
      createdCompany.id,
      {},
      clientId,
    );
    return { id: createdCompany.id };
  }

  if (action === "archive_company") {
    requirePermission(context, "companies.write");
    const companyId = requireText(input.companyId, "Company", 100);
    const company = await assertOk(
      supabase()
        .from("companies")
        .select("client_id")
        .eq("id", companyId)
        .eq("organization_id", context.organizationId)
        .is("archived_at", null)
        .maybeSingle(),
    );
    if (!company) throw new Error("Company not found.");
    await requireClient(context, company.client_id);
    await assertOk(
      supabase()
        .from("companies")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", companyId)
        .eq("organization_id", context.organizationId),
    );
    await audit(
      context,
      "company.archived",
      "company",
      companyId,
      {},
      company.client_id,
    );
    return { id: companyId };
  }

  if (action === "import_contacts") {
    throw new Error(
      "CSV contact import is not connected to Supabase yet. Use single contact creation for now.",
    );
  }

  if (
    action.includes("custom_") ||
    action === "link_contact_company" ||
    action === "invite_member"
  ) {
    throw new Error("This advanced Supabase feature is not connected yet.");
  }

  throw new Error("Unsupported action.");
}
