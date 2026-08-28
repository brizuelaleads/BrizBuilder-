// Pure host-parsing helpers for tenant subdomain routing.
//
// Split out of lib/tenant-host.ts so this logic can be imported and tested
// without cloudflare:workers coming along for the ride: the sibling module
// reads runtime env, this one only ever takes arguments.

import { normalizeSubdomain } from "../db/branding.ts";

/** Host headers carry the port, and IPv6 literals carry brackets. */
export function stripPort(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) return trimmed.slice(0, trimmed.indexOf("]") + 1);
  const colon = trimmed.lastIndexOf(":");
  return colon > -1 ? trimmed.slice(0, colon) : trimmed;
}

/** Normalizes a configured root-domain list into bare, lowercase hostnames. */
export function parseRootDomains(configured: string): string[] {
  return configured
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .map((entry) => entry.replace(/^https?:\/\//, "").split("/")[0])
    .map((entry) => entry.replace(/^\.+|\.+$/g, ""))
    .map((entry) => stripPort(entry))
    .filter(Boolean);
}

/**
 * Extracts the tenant label from a host, or null when the host is a bare root
 * domain, an unconfigured domain, or a reserved label such as `www` or `app`
 * (normalizeSubdomain rejects those, which is exactly the behaviour we want:
 * the shared entry points must never resolve to a tenant).
 */
export function subdomainFromHostWithRoots(
  host: string | null | undefined,
  roots: string[],
): string | null {
  if (!host) return null;
  const hostname = stripPort(host.split(",")[0]);
  if (!hostname || hostname.startsWith("[")) return null;
  // A bare IP has no tenant label.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;

  for (const root of roots) {
    if (hostname === root) return null;
    if (!hostname.endsWith(`.${root}`)) continue;
    const label = hostname.slice(0, -(root.length + 1));
    // Only a single label is a tenant: `a.b.example.com` is not `a`.
    if (!label || label.includes(".")) return null;
    return normalizeSubdomain(label);
  }
  return null;
}
