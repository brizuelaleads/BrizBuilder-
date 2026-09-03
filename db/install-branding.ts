import {
  buildTenantManifest,
  normalizeSubdomain,
  type TenantBranding,
  type TenantManifest,
} from "./branding.ts";

/**
 * The complete and intentionally small payload a signed-out install page may
 * render. Keep this allowlist explicit: notification settings, tenant ids,
 * organization ids, and every CRM record must remain server-only.
 */
export type PublicInstallBranding = {
  slug: string;
  appName: string;
  businessName: string;
  logoUrl: string | null;
  iconUrl: string | null;
  primaryColor: string;
};

export function installPathForSlug(slug: string): string | null {
  const normalized = normalizeSubdomain(slug);
  return normalized ? `/install/${encodeURIComponent(normalized)}` : null;
}

export function toPublicInstallBranding(
  branding: TenantBranding,
): PublicInstallBranding | null {
  const slug = normalizeSubdomain(branding.subdomain);
  if (!slug) return null;
  return {
    slug,
    appName: branding.appName,
    businessName: branding.businessName,
    logoUrl: branding.logoUrl,
    iconUrl: branding.iconUrl,
    primaryColor: branding.primaryColor,
  };
}

/** The public slug, never the private client id, is the manifest identity. */
export function buildInstallManifest(
  branding: TenantBranding,
): TenantManifest | null {
  const path = installPathForSlug(branding.subdomain ?? "");
  if (!path) return null;
  return buildTenantManifest(branding, { startUrl: "/dashboard" });
}
