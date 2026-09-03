import { shouldUseSupabaseBackend } from "./backend";
import { normalizeSubdomain, type TenantBranding } from "./branding";
import {
  toPublicInstallBranding,
  type PublicInstallBranding,
} from "./install-branding";
import { getBrandingBySubdomain } from "./supabase-branding";

/**
 * Resolves only a configured public branding slug. Unknown, malformed, and
 * archived tenants all collapse to null so the route can return the same 404.
 */
export async function installBrandingBySlug(
  candidate: string,
): Promise<TenantBranding | null> {
  const slug = normalizeSubdomain(candidate);
  if (!slug || !shouldUseSupabaseBackend()) return null;
  try {
    const branding = await getBrandingBySubdomain(slug);
    return branding?.subdomain === slug ? branding : null;
  } catch (error) {
    console.error("Public install branding could not be loaded.", error);
    return null;
  }
}

export async function publicInstallBrandingBySlug(
  candidate: string,
): Promise<PublicInstallBranding | null> {
  const branding = await installBrandingBySlug(candidate);
  return branding ? toPublicInstallBranding(branding) : null;
}
