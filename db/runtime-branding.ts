// Backend-aware branding resolution, mirroring db/runtime-access.ts.
//
// Branding lives only in Supabase. On the D1 fallback backend every caller
// gets the default BrizBuilder identity, which is the honest answer: the app
// still works, it just is not white-labelled.

import type { ChatGPTUser } from "../app/chatgpt-auth";
import { shouldUseSupabaseBackend } from "./backend";
import { DEFAULT_BRANDING, type TenantBranding } from "./branding";
import {
  getBrandingByClientId,
  getBrandingBySubdomain,
} from "./supabase-branding";
import { getAccountAccess } from "./runtime-access";
import { subdomainFromHeaders } from "../lib/tenant-host";

export type { TenantBranding } from "./branding";

export type BrandingResolution = {
  branding: TenantBranding;
  /** How the tenant was identified, for cache-header and debugging decisions. */
  source: "subdomain" | "session" | "default";
};

/**
 * Resolves the tenant for a request.
 *
 * Host wins over session on purpose: someone opening `acme.brizbuilder.com`
 * should see the Acme-branded shell while the sign-in page is still loading,
 * before any session exists. The session path then covers the shared app host,
 * where the URL says nothing about which tenant is being served.
 *
 * Never throws. A branding lookup failing must not take down a page render or
 * the manifest, so every failure degrades to the default identity.
 */
export async function resolveRequestBranding(
  headers: Headers,
  user: ChatGPTUser | null,
): Promise<BrandingResolution> {
  if (!shouldUseSupabaseBackend())
    return { branding: DEFAULT_BRANDING, source: "default" };

  const subdomain = subdomainFromHeaders(headers);
  if (subdomain) {
    try {
      const branding = await getBrandingBySubdomain(subdomain);
      if (branding) return { branding, source: "subdomain" };
    } catch (error) {
      console.error("Tenant branding could not be loaded by subdomain.", error);
    }
  }

  if (user) {
    try {
      const access = await getAccountAccess(user);
      if (access?.client?.id) {
        const branding = await getBrandingByClientId(access.client.id);
        if (branding) return { branding, source: "session" };
      }
    } catch (error) {
      console.error("Tenant branding could not be loaded for the session.", error);
    }
  }

  return { branding: DEFAULT_BRANDING, source: "default" };
}

/** Branding for one tenant id, defaulted and fault-isolated. */
export async function brandingForClient(
  clientId: string | null,
): Promise<TenantBranding> {
  if (!clientId || !shouldUseSupabaseBackend()) return DEFAULT_BRANDING;
  try {
    return (await getBrandingByClientId(clientId)) ?? DEFAULT_BRANDING;
  } catch (error) {
    console.error("Tenant branding could not be loaded.", error);
    return DEFAULT_BRANDING;
  }
}
