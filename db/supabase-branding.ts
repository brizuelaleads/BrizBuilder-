// Reads and writes for public.client_branding.
//
// Kept out of db/supabase-crm.ts so the manifest route -- which runs for
// signed-out visitors and must stay cheap -- can load a tenant's branding
// without dragging in the whole CRM bootstrap module.

import { getSupabaseAdminClient } from "../lib/supabase/server";
import {
  DEFAULT_BRANDING,
  normalizeBrandingUrl,
  normalizeHexColor,
  normalizeNotifications,
  normalizeSubdomain,
  normalizeThresholds,
  resolveBranding,
  APP_NAME_MAX_LENGTH,
  type TenantBranding,
} from "./branding";

type AnyRecord = Record<string, unknown>;

const BRANDING_COLUMNS =
  "client_id,organization_id,app_name,logo_url,icon_url,primary_color,accent_color,subdomain,notification_preferences,stale_lead_hours,hot_lead_score";

function supabase() {
  return getSupabaseAdminClient();
}

async function assertOk<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

/** Merges a branding row with its client record into a complete branding object. */
function fromRow(
  row: AnyRecord | null | undefined,
  businessName: string,
  clientId: string,
): TenantBranding {
  return resolveBranding({
    clientId,
    businessName,
    appName: row?.app_name ? String(row.app_name) : businessName,
    logoUrl: row?.logo_url ?? null,
    iconUrl: row?.icon_url ?? null,
    primaryColor: row?.primary_color ?? null,
    accentColor: row?.accent_color ?? null,
    subdomain: row?.subdomain ?? null,
    notifications: row?.notification_preferences ?? null,
    thresholds: {
      staleLeadHours: row?.stale_lead_hours ?? null,
      hotLeadScore: row?.hot_lead_score ?? null,
    },
  });
}

/**
 * Branding for one tenant. Returns a fully defaulted object even when the
 * tenant has no branding row yet, so callers never special-case "unbranded".
 */
export async function getBrandingByClientId(
  clientId: string,
): Promise<TenantBranding | null> {
  const client = await assertOk(
    supabase()
      .from("clients")
      .select("id,business_name,status")
      .eq("id", clientId)
      .neq("status", "archived")
      .maybeSingle(),
  );
  if (!client?.id) return null;

  const row = await assertOk(
    supabase()
      .from("client_branding")
      .select(BRANDING_COLUMNS)
      .eq("client_id", clientId)
      .maybeSingle(),
  );

  return fromRow(row as AnyRecord | null, String(client.business_name), String(client.id));
}

/**
 * Branding for the tenant that owns a host label. Used by the manifest route
 * before there is any session, so it deliberately reads nothing user-scoped.
 */
export async function getBrandingBySubdomain(
  subdomain: string,
): Promise<TenantBranding | null> {
  const normalized = normalizeSubdomain(subdomain);
  if (!normalized) return null;

  const row = (await assertOk(
    supabase()
      .from("client_branding")
      .select(`${BRANDING_COLUMNS},clients(id,business_name,status)`)
      .eq("subdomain", normalized)
      .maybeSingle(),
  )) as AnyRecord | null;
  if (!row) return null;

  const client = (Array.isArray(row.clients) ? row.clients[0] : row.clients) as
    | AnyRecord
    | undefined;
  if (!client?.id || client.status === "archived") return null;

  return fromRow(row, String(client.business_name), String(client.id));
}

export type BrandingInput = {
  appName?: unknown;
  logoUrl?: unknown;
  iconUrl?: unknown;
  primaryColor?: unknown;
  accentColor?: unknown;
  subdomain?: unknown;
  notifications?: unknown;
  thresholds?: unknown;
};

/**
 * Validates and upserts a tenant's branding.
 *
 * Every field is optional: an absent key leaves the stored value alone, while
 * an explicitly empty string clears it. Invalid values throw rather than
 * silently falling back, because a person is watching a form -- unlike the
 * read path, where a bad stored value must still render a usable app.
 */
export async function saveClientBranding(
  clientId: string,
  organizationId: string,
  input: BrandingInput,
): Promise<TenantBranding> {
  const patch: AnyRecord = {
    client_id: clientId,
    organization_id: organizationId,
    updated_at: new Date().toISOString(),
  };

  if (input.appName !== undefined) {
    const appName =
      typeof input.appName === "string"
        ? input.appName.trim().slice(0, APP_NAME_MAX_LENGTH)
        : "";
    patch.app_name = appName;
  }

  for (const [key, column] of [
    ["logoUrl", "logo_url"],
    ["iconUrl", "icon_url"],
  ] as const) {
    const raw = input[key];
    if (raw === undefined) continue;
    if (typeof raw === "string" && !raw.trim()) {
      patch[column] = null;
      continue;
    }
    const url = normalizeBrandingUrl(raw);
    if (!url)
      throw new Error(
        `${key === "logoUrl" ? "Logo" : "Icon"} URL must be an https address or a path on this site.`,
      );
    patch[column] = url;
  }

  for (const [key, column, label] of [
    ["primaryColor", "primary_color", "Primary color"],
    ["accentColor", "accent_color", "Accent color"],
  ] as const) {
    const raw = input[key];
    if (raw === undefined) continue;
    if (typeof raw === "string" && !raw.trim()) {
      patch[column] =
        key === "primaryColor"
          ? DEFAULT_BRANDING.primaryColor
          : DEFAULT_BRANDING.accentColor;
      continue;
    }
    const color = normalizeHexColor(raw);
    if (!color) throw new Error(`${label} must be a hex value such as #3366ff.`);
    patch[column] = color;
  }

  if (input.subdomain !== undefined) {
    if (typeof input.subdomain === "string" && !input.subdomain.trim()) {
      patch.subdomain = null;
    } else {
      const subdomain = normalizeSubdomain(input.subdomain);
      if (!subdomain)
        throw new Error(
          "Subdomain must be 3-63 characters, letters, numbers and single hyphens only, and cannot be a reserved name.",
        );
      // Checked up front for a clear message; the unique index below is what
      // actually makes this safe against two concurrent writes.
      const taken = await assertOk(
        supabase()
          .from("client_branding")
          .select("client_id")
          .eq("subdomain", subdomain)
          .neq("client_id", clientId)
          .maybeSingle(),
      );
      if (taken) throw new Error("That subdomain is already in use.");
      patch.subdomain = subdomain;
    }
  }

  if (input.notifications !== undefined) {
    patch.notification_preferences = normalizeNotifications(input.notifications);
  }

  if (input.thresholds !== undefined) {
    // Clamped, not rejected: these arrive from a number input where an
    // out-of-range value is a slip rather than an attack, and the SQL check
    // constraint would otherwise turn it into an opaque database error.
    const thresholds = normalizeThresholds(input.thresholds);
    patch.stale_lead_hours = thresholds.staleLeadHours;
    patch.hot_lead_score = thresholds.hotLeadScore;
  }

  const { error } = await supabase()
    .from("client_branding")
    .upsert(patch, { onConflict: "client_id" });
  if (error) {
    if (/client_branding_subdomain_key|duplicate key/i.test(error.message))
      throw new Error("That subdomain is already in use.");
    throw new Error(error.message);
  }

  const saved = await getBrandingByClientId(clientId);
  if (!saved) throw new Error("Branding could not be reloaded after saving.");
  return saved;
}
