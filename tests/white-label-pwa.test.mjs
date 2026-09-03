import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BRANDING,
  RESERVED_SUBDOMAINS,
  brandingCssVariables,
  buildTenantManifest,
  normalizeBrandingUrl,
  normalizeHexColor,
  normalizeNotifications,
  normalizeSubdomain,
  readableInkOn,
  resolveBranding,
  shortAppName,
} from "../db/branding.ts";
import {
  parseRootDomains,
  subdomainFromHostWithRoots,
} from "../lib/tenant-host-parse.ts";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
// Line endings are normalized so the block-matching patterns behave the same
// on a CRLF checkout as they do on LF.
const read = (rel) =>
  fs.readFileSync(path.join(root, rel), "utf8").replaceAll("\r\n", "\n");

const migration = read("supabase/migrations/20260827120000_client_branding.sql");
const supabaseSource = read("db/supabase-crm.ts");
const d1Source = read("db/crm.ts");
const brandingStore = read("db/supabase-branding.ts");
const manifestRoute = read("app/manifest.webmanifest/route.ts");
const brandHead = read("app/components/BrandHead.tsx");
const crmAppSource = read("app/CrmApp.tsx");
const clientAppSettings = read("app/crm/BrandingSettings.tsx");
const operationsViews = read("app/crm/OperationsViews.tsx");
const serviceWorker = read("public/sw.js");

function extractBlock(source, needle) {
  const start = source.indexOf(needle);
  if (start < 0) return undefined;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------
 * Value validation
 * ---------------------------------------------------------------------- */

test("branding URLs reject every scheme that could execute or exfiltrate", () => {
  for (const hostile of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "//evil.example/logo.png",
    "http://insecure.example/logo.png",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ]) {
    assert.equal(
      normalizeBrandingUrl(hostile),
      null,
      `${hostile} must not survive normalization`,
    );
  }
});

test("branding URLs accept https and same-origin paths", () => {
  assert.equal(
    normalizeBrandingUrl("https://cdn.example.com/logo.png"),
    "https://cdn.example.com/logo.png",
  );
  assert.equal(normalizeBrandingUrl("/brand/acme.png"), "/brand/acme.png");
  assert.equal(normalizeBrandingUrl("  "), null);
  assert.equal(normalizeBrandingUrl(`https://x.example/${"a".repeat(600)}`), null);
});

test("hex colors are normalized and anything else is refused", () => {
  assert.equal(normalizeHexColor("#ABCDEF"), "#abcdef");
  assert.equal(normalizeHexColor("abcdef"), "#abcdef");
  assert.equal(normalizeHexColor("#abc"), "#aabbcc");
  for (const bad of ["red", "#12345", "#gggggg", "", null, undefined, 42]) {
    assert.equal(normalizeHexColor(bad), null, `${String(bad)} is not a hex color`);
  }
});

test("subdomains follow DNS label rules and cannot claim a reserved name", () => {
  assert.equal(normalizeSubdomain("Acme"), "acme");
  assert.equal(normalizeSubdomain("acme-plumbing"), "acme-plumbing");
  for (const bad of [
    "ab",
    "-acme",
    "acme-",
    "acme--plumbing",
    "acme.plumbing",
    "acme_plumbing",
    "a".repeat(64),
    "",
  ]) {
    assert.equal(normalizeSubdomain(bad), null, `${bad} must be refused`);
  }
  for (const reserved of RESERVED_SUBDOMAINS) {
    assert.equal(
      normalizeSubdomain(reserved),
      null,
      `${reserved} must stay with the platform`,
    );
  }
});

test("notification preferences accept only known keys and boolean values", () => {
  const result = normalizeNotifications({
    newLead: false,
    dailyDigest: true,
    // Neither of these may reach the stored object.
    isAdmin: true,
    missedCall: "yes",
  });
  assert.equal(result.newLead, false);
  assert.equal(result.dailyDigest, true);
  assert.equal(
    result.missedCall,
    DEFAULT_BRANDING.notifications.missedCall,
    "a non-boolean falls back to the default rather than becoming truthy",
  );
  assert.ok(!("isAdmin" in result), "unknown keys are dropped");
  assert.deepEqual(
    Object.keys(normalizeNotifications(null)).sort(),
    Object.keys(DEFAULT_BRANDING.notifications).sort(),
  );
});

test("a half-configured tenant still resolves to a usable brand", () => {
  const branding = resolveBranding({
    clientId: "client-1",
    businessName: "Acme Plumbing",
    primaryColor: "not-a-color",
    logoUrl: "javascript:alert(1)",
    subdomain: "www",
  });
  assert.equal(branding.appName, "Acme Plumbing", "app name falls back to the business");
  assert.equal(branding.primaryColor, DEFAULT_BRANDING.primaryColor);
  assert.equal(branding.logoUrl, null, "a hostile logo URL is dropped, not rendered");
  assert.equal(branding.subdomain, null, "a reserved subdomain is dropped");
  assert.equal(branding.iconUrl, DEFAULT_BRANDING.iconUrl);
});

/* -------------------------------------------------------------------------
 * Manifest
 * ---------------------------------------------------------------------- */

test("the manifest carries the tenant identity, never BrizBuilder's", () => {
  const branding = resolveBranding({
    clientId: "client-1",
    businessName: "Acme Plumbing & Drain",
    appName: "Acme Field",
    iconUrl: "https://cdn.example.com/acme.png",
    primaryColor: "#0a7d55",
    subdomain: "acme",
  });
  const manifest = buildTenantManifest(branding);

  assert.equal(manifest.name, "Acme Field");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#0a7d55");
  assert.equal(manifest.background_color, "#0a7d55");
  assert.equal(manifest.start_url, "/dashboard");
  assert.equal(manifest.id, "/?tenant=acme");
  assert.ok(
    !JSON.stringify(manifest).includes("BrizBuilder"),
    "a white-label manifest must not leak the platform name",
  );
  for (const icon of manifest.icons) {
    assert.equal(icon.src, "https://cdn.example.com/acme.png");
    assert.equal(icon.type, "image/png");
  }
  assert.ok(
    manifest.icons.some((icon) => icon.purpose === "maskable"),
    "a maskable icon keeps Android from letterboxing the logo",
  );
  assert.ok(
    manifest.icons.some((icon) => icon.sizes === "512x512"),
    "512x512 is required for the install prompt",
  );
});

test("short_name stays inside the home-screen label budget", () => {
  assert.equal(shortAppName("Acme Field"), "Acme Field");
  assert.equal(shortAppName("Acme Plumbing And Drain Co"), "Acme");
  assert.ok(shortAppName("Supercalifragilistic").length <= 12);
  const manifest = buildTenantManifest(
    resolveBranding({ businessName: "Northwest Foundation Repair Group" }),
  );
  assert.ok(manifest.short_name.length <= 12);
});

test("two tenants never share a manifest id", () => {
  const first = buildTenantManifest(
    resolveBranding({ clientId: "a", businessName: "A", subdomain: "acme" }),
  );
  const second = buildTenantManifest(
    resolveBranding({ clientId: "b", businessName: "B", subdomain: "brava" }),
  );
  assert.notEqual(first.id, second.id);
});

/* -------------------------------------------------------------------------
 * Theming
 * ---------------------------------------------------------------------- */

test("brand colors override only identity tokens, never layout or surfaces", () => {
  const variables = brandingCssVariables(
    resolveBranding({ businessName: "Acme", primaryColor: "#0a7d55" }),
  );
  assert.equal(variables["--crm-accent"], "#0a7d55");
  for (const structural of [
    "--crm-canvas",
    "--crm-card",
    "--crm-line",
    "--crm-ink",
    "--crm-muted",
    "--crm-radius-sm",
  ]) {
    assert.ok(
      !(structural in variables),
      `${structural} belongs to the theme, not to tenant branding`,
    );
  }
});

test("label ink stays readable on both light and dark brand fills", () => {
  assert.equal(readableInkOn("#ffffff"), "#191a1f");
  assert.equal(readableInkOn("#f2f7a1"), "#191a1f");
  assert.equal(readableInkOn("#0a7d55"), "#ffffff");
  assert.equal(readableInkOn("#000000"), "#ffffff");
  assert.equal(readableInkOn("garbage"), readableInkOn(DEFAULT_BRANDING.primaryColor));
});

test("brand tokens are applied inline, where they beat the theme's own rules", () => {
  assert.match(crmAppSource, /style=\{brandingCssVariables\(branding\)/);
  assert.match(crmAppSource, /data-theme=\{theme === "classic" \? undefined : theme\}/);
});

/* -------------------------------------------------------------------------
 * Host routing
 * ---------------------------------------------------------------------- */

test("a tenant subdomain resolves only under a configured root domain", () => {
  const roots = parseRootDomains("brizbuilder.com");
  assert.equal(subdomainFromHostWithRoots("acme.brizbuilder.com", roots), "acme");
  assert.equal(subdomainFromHostWithRoots("acme.brizbuilder.com:8443", roots), "acme");
  assert.equal(subdomainFromHostWithRoots("brizbuilder.com", roots), null);
  assert.equal(subdomainFromHostWithRoots("acme.someone-else.com", roots), null);
});

test("the worker host can never be mistaken for a tenant", () => {
  // The deployment runs at brizbuilder.<account>.workers.dev. With only the
  // real root configured, that first label must not resolve to a tenant.
  const roots = parseRootDomains("brizbuilder.com");
  assert.equal(
    subdomainFromHostWithRoots("brizbuilder.brizuelaleads.workers.dev", roots),
    null,
  );
});

test("reserved and nested labels do not resolve to a tenant", () => {
  const roots = parseRootDomains("brizbuilder.com");
  for (const host of [
    "www.brizbuilder.com",
    "app.brizbuilder.com",
    "api.brizbuilder.com",
    "a.b.brizbuilder.com",
    "192.168.1.10",
    "",
    null,
  ]) {
    assert.equal(
      subdomainFromHostWithRoots(host, roots),
      null,
      `${String(host)} must not resolve to a tenant`,
    );
  }
});

test("root domains are parsed tolerantly from configuration", () => {
  assert.deepEqual(
    parseRootDomains(" https://BrizBuilder.com/ , .example.org , "),
    ["brizbuilder.com", "example.org"],
  );
  assert.deepEqual(parseRootDomains(""), []);
});

/* -------------------------------------------------------------------------
 * Write path
 * ---------------------------------------------------------------------- */

test("save_client_branding is permission checked and tenant scoped", () => {
  const block = extractBlock(
    supabaseSource,
    'if (action === "save_client_branding") {',
  );
  assert.ok(block, "the handler exists in db/supabase-crm.ts");

  const permissionIndex = block.indexOf('requirePermission(context, "clients.manage")');
  const scopeIndex = block.indexOf("await requireClient(context, clientId)");
  const writeIndex = block.indexOf("saveClientBranding(");
  assert.ok(permissionIndex >= 0, "clients.manage is required");
  assert.ok(scopeIndex > permissionIndex, "tenant scope is checked after permission");
  assert.ok(writeIndex > scopeIndex, "the write happens only after both checks");

  assert.match(block, /organization_id|context\.organizationId/);
  assert.doesNotMatch(
    block,
    /input\.organizationId/,
    "the organization is never taken from the request body",
  );
  assert.match(
    block,
    /thresholds: input\.thresholds/,
    "notification thresholds reach the existing branding store",
  );
});

test("Client App settings are discoverable and gated by the existing permission", () => {
  assert.match(operationsViews, /label: "Client App"/);
  assert.match(operationsViews, /setSection\("branding"\)/);
  assert.match(
    crmAppSource,
    /id: "settings"[^\n]*permission: "clients\.manage"/,
  );
  assert.match(
    crmAppSource,
    /view === "settings" && data\.viewer\.permissions\.includes\("clients\.manage"\)/,
  );
  assert.doesNotMatch(
    crmAppSource,
    /id: "settings"[^\n]*agencyOnly: true/,
    "a client role with the explicit permission is not blocked by a second role-name check",
  );
});

test("Client App form reuses branding storage and never leaks unsaved state across tenants", () => {
  assert.match(clientAppSettings, /action: "save_client_branding"/);
  assert.match(clientAppSettings, /synced\.clientId !== clientId/);
  assert.match(clientAppSettings, /Discard unsaved Client App changes/);
  assert.match(clientAppSettings, /Unsaved changes/);
  assert.match(clientAppSettings, /Save Changes/);
  assert.doesNotMatch(
    clientAppSettings,
    /fetch\(|storage\.from|\.upload\(/,
    "the UI must not create a second branding or asset-storage path",
  );
});

test("Client App UI exposes live preview, notifications, and existing PWA install support", () => {
  for (const label of [
    "App Name",
    "Client Logo",
    "App Icon",
    "Brand Color",
    "Accent Color",
    "Hot Lead / High Lead Score",
    "Edit Branding",
    "Send App",
    "Install App",
    "Copy Link",
    "Send to Client",
    "QR Code",
    "Advanced",
    "Live preview",
  ]) {
    assert.ok(clientAppSettings.includes(label), `${label} is present`);
  }
  assert.match(clientAppSettings, /beforeinstallprompt/);
  assert.match(clientAppSettings, /appinstalled/);
  assert.match(clientAppSettings, /onClick=\{\(\) => void handleInstallAction\(\)\}/);
  assert.match(clientAppSettings, /installPrompt\.state === "available"/);
  assert.match(clientAppSettings, /installPrompt\.state === "ios"/);
  assert.doesNotMatch(
    clientAppSettings,
    /installPrompt\.state === "available" \? \(\s*<button/,
    "the install button stays visible even before a native prompt is available",
  );
  assert.match(clientAppSettings, /form\.appName\.trim\(\)/);
  assert.match(clientAppSettings, /normalizeBrandingUrl\(form\.logoUrl\)/);
  assert.match(clientAppSettings, /style=\{previewStyle\}/);
  assert.match(clientAppSettings, /role="dialog"/);
  assert.match(clientAppSettings, /<details className="crm-client-app-advanced">/);
  assert.match(clientAppSettings, /<QRCodeCanvas/);
  assert.match(clientAppSettings, /value=\{qrUrl\}/);
  assert.match(clientAppSettings, /Show QR Code/);
  assert.doesNotMatch(clientAppSettings, /Coming soon/);
  assert.match(clientAppSettings, /navigator\.share/);
  assert.doesNotMatch(
    clientAppSettings,
    /<ol>|<h[234]>iPhone<\/h[234]>|<h[234]>Android<\/h[234]>/,
    "platform instructions stay contextual instead of becoming permanent cards",
  );
});

test("the D1 fallback enforces the same checks and admits it cannot persist", () => {
  const block = extractBlock(d1Source, 'if (action === "save_client_branding") {');
  assert.ok(block, "the D1 branch exists");
  assert.match(block, /requirePermission\(context, "clients\.manage"\)/);
  assert.match(block, /await requireClient\(context, clientId\)/);
  assert.match(block, /persisted: false/, "an honest validated no-op");
});

test("branding writes reject a subdomain already taken by another tenant", () => {
  assert.match(brandingStore, /\.neq\("client_id", clientId\)/);
  assert.match(brandingStore, /already in use/);
  assert.match(
    brandingStore,
    /client_branding_subdomain_key\|duplicate key/,
    "the unique index is the real guard against a concurrent claim",
  );
});

test("the bootstrap branding read cannot trip the whole-bootstrap D1 fallback", () => {
  const block = supabaseSource.match(
    /let brandingList[\s\S]*?catch \(error\) \{[\s\S]*?\n {2}\}/,
  )?.[0];
  assert.ok(block, "the branding read is wrapped in its own try/catch");
  assert.match(block, /from\("client_branding"\)/);
  assert.match(block, /console\.error/);
  assert.match(block, /\.in\("client_id", clientIds\)/, "scoped to reachable clients");
});

/* -------------------------------------------------------------------------
 * Schema
 * ---------------------------------------------------------------------- */

test("client_branding is service-role only with RLS enabled", () => {
  assert.match(migration, /alter table public\.client_branding enable row level security/i);
  assert.match(migration, /revoke all on table public\.client_branding from anon, authenticated/i);
});

test("the subdomain uniqueness the router depends on is enforced in SQL", () => {
  assert.match(
    migration,
    /create unique index if not exists client_branding_subdomain_key[\s\S]*?on public\.client_branding \(subdomain\)/i,
  );
});

test("colour columns cannot hold anything but a hex value", () => {
  const checks = migration.match(/check \(\s*\w*_?color ~ '\^#\[0-9a-f\]\{6\}\$'\s*\)/gi) ?? [];
  assert.equal(checks.length, 2, "both primary and accent are constrained");
});

test("this migration's notification default names only real alert types", () => {
  // The effective default is set by the later push migration, which the push
  // suite pins to NOTIFICATION_KEYS exactly. All this one has to guarantee is
  // that the original baseline never named a key the app does not understand.
  const sqlKeys = (
    migration.match(/jsonb_build_object\(([\s\S]*?)\n  \)/)?.[1].match(/'(\w+)'/g) ?? []
  ).map((item) => item.replaceAll("'", ""));
  assert.ok(sqlKeys.length > 0, "the default names some keys");
  for (const key of sqlKeys) {
    assert.ok(
      key in DEFAULT_BRANDING.notifications,
      `${key} is a known notification key`,
    );
  }
});

test("deleting a tenant takes its branding with it", () => {
  assert.match(
    migration,
    /client_id uuid primary key references public\.clients\(id\) on delete cascade/i,
  );
});

/* -------------------------------------------------------------------------
 * Delivery
 * ---------------------------------------------------------------------- */

test("the manifest is never cached across tenants or users", () => {
  assert.match(manifestRoute, /export const dynamic = "force-dynamic"/);
  assert.match(manifestRoute, /"Cache-Control": "private, no-cache, must-revalidate"/);
  assert.match(manifestRoute, /Vary: "Host, X-Forwarded-Host, Cookie"/);
  assert.match(manifestRoute, /application\/manifest\+json/);
});

test("the manifest link is credentialed so session tenants resolve", () => {
  assert.match(brandHead, /rel="manifest"/);
  assert.match(brandHead, /crossOrigin="use-credentials"/);
  // Next's own `manifest` metadata key emits an uncredentialed link, which
  // would silently serve every user on the shared host the same brand.
  assert.doesNotMatch(
    read("app/dashboard/page.tsx"),
    /^\s*manifest: "/m,
    "the metadata manifest key must stay unused",
  );
});

test("the dashboard announces the tenant, not the platform", () => {
  const dashboard = read("app/dashboard/page.tsx");
  assert.match(dashboard, /title: \{ absolute: branding\.appName \}/);
  assert.match(dashboard, /themeColor: branding\.primaryColor/);
  assert.match(dashboard, /appleWebApp/, "iOS ignores the manifest when installing");
  assert.match(dashboard, /shortAppName\(branding\.appName\)/);
});

test("the service worker caches nothing tenant-specific", () => {
  assert.match(
    serviceWorker,
    /url\.pathname === "\/manifest\.webmanifest"\) return/,
    "the per-tenant manifest always goes to the network",
  );
  assert.match(
    serviceWorker,
    /url\.pathname\.startsWith\("\/_next\/static\/"\)/,
    "only content-hashed build output is cache-first",
  );
  assert.doesNotMatch(
    serviceWorker,
    /\/api\/crm/,
    "tenant CRM data must never be cached in a shared worker",
  );
});

test("the offline fallback is precached and brand-neutral", () => {
  assert.match(serviceWorker, /const OFFLINE_URL = "\/offline\.html"/);
  const offline = read("public/offline.html");
  assert.ok(!offline.includes("BrizBuilder"), "a shared offline page names no brand");
});

test("the service worker is excluded from session-refresh middleware", () => {
  const proxySource = read("proxy.ts");
  assert.match(proxySource, /sw\.js/);
  assert.doesNotMatch(
    proxySource,
    /manifest\.webmanifest/,
    "the manifest must keep passing through so it can read the session",
  );
});

test("a tenant logo replaces the BrizBuilder mark rather than sitting beside it", () => {
  const logo = read("app/components/BrandLogo.tsx");
  assert.match(logo, /if \(logoUrl\) \{/);
  const tenantBranch = logo.slice(logo.indexOf("if (logoUrl) {"));
  assert.ok(
    !tenantBranch.slice(0, tenantBranch.indexOf("return (\n    <Image")).includes(
      "brizbuilder-",
    ),
    "the tenant branch never renders a BrizBuilder asset",
  );
});
