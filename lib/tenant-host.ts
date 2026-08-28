// Resolves which tenant a request is for from its Host header.
//
// Host-based resolution is opt-in: it only activates for root domains listed
// in BRIZBUILDER_TENANT_ROOT_DOMAINS. That matters because the app also runs
// on `brizbuilder.<account>.workers.dev`, where the first label is the worker
// name and emphatically not a tenant. With no configured root domain the
// helpers below return null and every caller falls back to the signed-in
// user's own tenant, which is how the shared app host already behaves.
//
// The parsing itself lives in ./tenant-host-parse so it stays testable; this
// module is only the runtime-env wrapper around it.

import { readRuntimeValue } from "./supabase/env";
import {
  parseRootDomains,
  subdomainFromHostWithRoots,
} from "./tenant-host-parse";

const ROOT_DOMAIN_ENV = "BRIZBUILDER_TENANT_ROOT_DOMAINS";

/** Configured roots, lowercased and stripped of any scheme, port, or dot. */
export function tenantRootDomains(): string[] {
  return parseRootDomains(readRuntimeValue(ROOT_DOMAIN_ENV));
}

export function hostBasedRoutingEnabled(): boolean {
  return tenantRootDomains().length > 0;
}

export function subdomainFromHost(host: string | null | undefined): string | null {
  return subdomainFromHostWithRoots(host, tenantRootDomains());
}

/**
 * The Host header a Cloudflare Worker sees can be the internal one, so prefer
 * the forwarded host when a proxy set it.
 */
export function requestHost(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-host");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("host");
}

export function subdomainFromHeaders(headers: Headers): string | null {
  return subdomainFromHost(requestHost(headers));
}

/** Absolute origin for the current request, used to build manifest URLs. */
export function requestOrigin(headers: Headers, fallback = ""): string {
  const host = requestHost(headers);
  if (!host) return fallback;
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${proto}://${host}`;
}
