// Shared white-label branding constants and validation. Keep this module
// dependency-free: it is imported by server code (db/supabase-branding.ts,
// the manifest route) and by client components (CrmApp, the settings form),
// so it must never pull in cloudflare:workers, Supabase, or next/*.
//
// Every value a tenant can set passes through a normalizer here, so the
// manifest route, the CRM write path, and the UI preview can never disagree
// about what a stored branding row means.

export type TenantNotificationPreferences = {
  newLead: boolean;
  missedCall: boolean;
  transcriptReady: boolean;
  leadNotContacted: boolean;
  appointmentReminder: boolean;
  hotLead: boolean;
  reviewRequest: boolean;
  dailyDigest: boolean;
};

/**
 * The two alert types that need a number, not just an on/off.
 * Clamped rather than rejected: these come from a settings form, and a value
 * outside the useful range is a slip, not an attack.
 */
export type TenantNotificationThresholds = {
  /** Hours a lead may sit uncontacted before `leadNotContacted` fires. */
  staleLeadHours: number;
  /** Lead score at or above which `hotLead` fires. */
  hotLeadScore: number;
};

export type TenantBranding = {
  /** Null for the agency's own (unbranded) BrizBuilder workspace. */
  clientId: string | null;
  businessName: string;
  appName: string;
  logoUrl: string | null;
  iconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  subdomain: string | null;
  notifications: TenantNotificationPreferences;
  thresholds: TenantNotificationThresholds;
};

export const NOTIFICATION_KEYS = [
  "newLead",
  "missedCall",
  "transcriptReady",
  "leadNotContacted",
  "appointmentReminder",
  "hotLead",
  "reviewRequest",
  "dailyDigest",
] as const;

export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];

export const NOTIFICATION_LABELS: Record<NotificationKey, string> = {
  newLead: "New lead captured",
  missedCall: "Missed calls",
  transcriptReady: "Voicemail or call transcript ready",
  leadNotContacted: "Lead not contacted in time",
  appointmentReminder: "Appointment reminders",
  hotLead: "Hot lead (high score)",
  reviewRequest: "Review requests",
  dailyDigest: "Daily summary digest",
};

/** One line of plain description per alert, shown under its toggle. */
export const NOTIFICATION_DESCRIPTIONS: Record<NotificationKey, string> = {
  newLead: "Someone submits a form or a new call creates a lead.",
  missedCall: "A call rings out without being answered.",
  transcriptReady: "A recording has been transcribed and summarized.",
  leadNotContacted: "A new lead passes the follow-up window untouched.",
  appointmentReminder: "An upcoming appointment is about to start.",
  hotLead: "A lead's score crosses the hot-lead threshold.",
  reviewRequest: "A review request is sent or answered.",
  dailyDigest: "A once-daily summary of the day's activity.",
};

export const DEFAULT_NOTIFICATIONS: TenantNotificationPreferences = {
  newLead: true,
  missedCall: true,
  transcriptReady: true,
  leadNotContacted: true,
  appointmentReminder: true,
  hotLead: true,
  reviewRequest: false,
  dailyDigest: false,
};

export const DEFAULT_THRESHOLDS: TenantNotificationThresholds = {
  staleLeadHours: 4,
  hotLeadScore: 80,
};

export const STALE_LEAD_HOURS_MIN = 1;
export const STALE_LEAD_HOURS_MAX = 168;
export const HOT_LEAD_SCORE_MIN = 1;
export const HOT_LEAD_SCORE_MAX = 100;

/** BrizBuilder's own identity: the fallback whenever a tenant sets nothing. */
export const DEFAULT_BRANDING: TenantBranding = {
  clientId: null,
  businessName: "BrizBuilder",
  appName: "BrizBuilder",
  logoUrl: null,
  iconUrl: "/brand/brizbuilder-icon.png",
  primaryColor: "#6757e8",
  accentColor: "#c9ff53",
  subdomain: null,
  notifications: { ...DEFAULT_NOTIFICATIONS },
  thresholds: { ...DEFAULT_THRESHOLDS },
};

// Hosts that must keep resolving to the agency surface even if somebody types
// them into the subdomain field. `app` and `dashboard` are the shared entry
// points; the rest are infrastructure names a tenant must not claim.
export const RESERVED_SUBDOMAINS: readonly string[] = [
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "cdn",
  "dashboard",
  "dev",
  "docs",
  "internal",
  "login",
  "mail",
  "mcp",
  "oauth",
  "preview",
  "smtp",
  "staging",
  "static",
  "status",
  "support",
  "test",
  "www",
];

export const SUBDOMAIN_MIN_LENGTH = 3;
export const SUBDOMAIN_MAX_LENGTH = 63;
export const APP_NAME_MAX_LENGTH = 60;
/** Android and iOS truncate aggressively under a home-screen icon. */
export const SHORT_NAME_MAX_LENGTH = 12;

const HEX_COLOR = /^#[0-9a-f]{6}$/;

/**
 * Accepts `#abc` and `#aabbcc` in any case and returns lowercase `#aabbcc`.
 * Returns null for anything else so callers decide whether to fall back or
 * reject: the write path rejects, the read path falls back.
 */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const expanded = /^#[0-9a-f]{3}$/.test(withHash)
    ? `#${withHash[1]}${withHash[1]}${withHash[2]}${withHash[2]}${withHash[3]}${withHash[3]}`
    : withHash;
  return HEX_COLOR.test(expanded) ? expanded : null;
}

/**
 * Branding URLs end up in `src`/`href` attributes and in the manifest, so the
 * scheme allowlist is the whole point: `javascript:`, `data:`, and protocol
 * relative `//evil.example` are all rejected. Only absolute https and
 * same-origin root-relative paths survive.
 */
export function normalizeBrandingUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return null;
  if (trimmed.startsWith("//")) return null;
  if (trimmed.startsWith("/")) {
    // Root-relative asset already served by this origin.
    return /^\/[\w\-./%]*$/.test(trimmed) ? trimmed : null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  return parsed.toString();
}

/**
 * Subdomain labels follow the DNS label rules the router depends on, and
 * reserved names are refused so a tenant can never shadow `app`, `api`, or
 * the auth host.
 */
export function normalizeSubdomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (
    trimmed.length < SUBDOMAIN_MIN_LENGTH ||
    trimmed.length > SUBDOMAIN_MAX_LENGTH
  )
    return null;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(trimmed)) return null;
  if (trimmed.includes("--")) return null;
  if (RESERVED_SUBDOMAINS.includes(trimmed)) return null;
  return trimmed;
}

/** Clamps to the supported range; a missing or unparseable value takes the default. */
function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function normalizeThresholds(
  value: unknown,
): TenantNotificationThresholds {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    staleLeadHours: clampInteger(
      source.staleLeadHours,
      STALE_LEAD_HOURS_MIN,
      STALE_LEAD_HOURS_MAX,
      DEFAULT_THRESHOLDS.staleLeadHours,
    ),
    hotLeadScore: clampInteger(
      source.hotLeadScore,
      HOT_LEAD_SCORE_MIN,
      HOT_LEAD_SCORE_MAX,
      DEFAULT_THRESHOLDS.hotLeadScore,
    ),
  };
}

export function normalizeNotifications(
  value: unknown,
): TenantNotificationPreferences {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const result = { ...DEFAULT_NOTIFICATIONS };
  for (const key of NOTIFICATION_KEYS) {
    const raw = source[key];
    if (typeof raw === "boolean") result[key] = raw;
  }
  return result;
}

/**
 * Turns a stored row (or a partial one) into a complete branding object.
 * Unset or invalid fields fall back to the agency default rather than
 * throwing, so a half-configured tenant still renders a working app.
 */
export function resolveBranding(
  input: Partial<Record<keyof TenantBranding, unknown>> | null | undefined,
): TenantBranding {
  const businessName =
    typeof input?.businessName === "string" && input.businessName.trim()
      ? input.businessName.trim().slice(0, 160)
      : DEFAULT_BRANDING.businessName;
  const appName =
    typeof input?.appName === "string" && input.appName.trim()
      ? input.appName.trim().slice(0, APP_NAME_MAX_LENGTH)
      : businessName;
  return {
    clientId:
      typeof input?.clientId === "string" && input.clientId
        ? input.clientId
        : null,
    businessName,
    appName,
    logoUrl: normalizeBrandingUrl(input?.logoUrl),
    iconUrl: normalizeBrandingUrl(input?.iconUrl) ?? DEFAULT_BRANDING.iconUrl,
    primaryColor:
      normalizeHexColor(input?.primaryColor) ?? DEFAULT_BRANDING.primaryColor,
    accentColor:
      normalizeHexColor(input?.accentColor) ?? DEFAULT_BRANDING.accentColor,
    subdomain: normalizeSubdomain(input?.subdomain),
    notifications: normalizeNotifications(input?.notifications),
    thresholds: normalizeThresholds(input?.thresholds),
  };
}

/** Home-screen labels get clipped, so derive a genuinely short short_name. */
export function shortAppName(appName: string): string {
  const trimmed = appName.trim();
  if (trimmed.length <= SHORT_NAME_MAX_LENGTH) return trimmed;
  const firstWord = trimmed.split(/\s+/)[0];
  return firstWord.length <= SHORT_NAME_MAX_LENGTH
    ? firstWord
    : firstWord.slice(0, SHORT_NAME_MAX_LENGTH);
}

/** Relative luminance per WCAG, used to keep label text legible on a brand fill. */
function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Ink that stays readable on top of an arbitrary tenant fill colour. */
export function readableInkOn(hex: string): string {
  const normalized = normalizeHexColor(hex) ?? DEFAULT_BRANDING.primaryColor;
  return relativeLuminance(normalized) > 0.55 ? "#191a1f" : "#ffffff";
}

function withAlpha(hex: string, alphaPercent: number): string {
  const normalized = normalizeHexColor(hex) ?? DEFAULT_BRANDING.primaryColor;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return `rgb(${r} ${g} ${b} / ${alphaPercent}%)`;
}

/**
 * The bridge between stored branding and the existing `--crm-*` design tokens.
 * Only the identity colours are overridden; every surface, line, and radius
 * token still comes from the selected CrmTheme, so a tenant can recolour the
 * app without being able to break its contrast or layout.
 */
export function brandingCssVariables(
  branding: TenantBranding,
): Record<string, string> {
  return {
    "--crm-purple": branding.primaryColor,
    "--crm-accent": branding.primaryColor,
    "--crm-accent-2": branding.accentColor,
    "--crm-accent-soft": withAlpha(branding.primaryColor, 10),
    "--crm-on-accent": readableInkOn(branding.primaryColor),
    "--crm-brand-primary": branding.primaryColor,
    "--crm-brand-accent": branding.accentColor,
  };
}

export type ManifestOptions = {
  /** Where the installed app opens. Defaults to the dashboard. */
  startUrl?: string;
};

export type TenantManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  display_override: string[];
  orientation: string;
  theme_color: string;
  background_color: string;
  categories: string[];
  icons: Array<{ src: string; sizes: string; type?: string; purpose: string }>;
  shortcuts: Array<{ name: string; short_name: string; url: string }>;
};

function iconType(src: string): string | undefined {
  const path = src.split("?")[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return undefined;
}

/**
 * Builds the per-tenant manifest. `id` is pinned to the tenant identity so a
 * later colour or name change updates the installed app in place instead of
 * the browser treating it as a second, unrelated install.
 */
export function buildTenantManifest(
  branding: TenantBranding,
  options: ManifestOptions = {},
): TenantManifest {
  const startUrl = options.startUrl ?? "/dashboard";
  const icon = branding.iconUrl ?? "/brand/brizbuilder-icon.png";
  const type = iconType(icon);
  const identity = branding.subdomain ?? branding.clientId ?? "brizbuilder";

  return {
    id: `/?tenant=${identity}`,
    name: branding.appName,
    short_name: shortAppName(branding.appName),
    description: `${branding.businessName} customer and lead workspace.`,
    start_url: startUrl,
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    orientation: "any",
    theme_color: branding.primaryColor,
    background_color: branding.primaryColor,
    categories: ["business", "productivity"],
    // The same source is declared at both sizes because tenants upload a
    // single square icon; `maskable` lets Android crop it to the device shape
    // instead of letterboxing it inside a white rounded square.
    icons: [
      { src: icon, sizes: "192x192", ...(type ? { type } : {}), purpose: "any" },
      { src: icon, sizes: "512x512", ...(type ? { type } : {}), purpose: "any" },
      {
        src: icon,
        sizes: "512x512",
        ...(type ? { type } : {}),
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Leads", short_name: "Leads", url: "/dashboard?view=leads" },
      {
        name: "Calendar",
        short_name: "Calendar",
        url: "/dashboard?view=calendar",
      },
      { name: "Tasks", short_name: "Tasks", url: "/dashboard?view=tasks" },
    ],
  };
}
