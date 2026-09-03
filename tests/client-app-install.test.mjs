import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildInstallManifest,
  installPathForSlug,
  toPublicInstallBranding,
} from "../db/install-branding.ts";
import {
  detectInstallEnvironment,
  manualInstallGuideFor,
} from "../lib/install-environment.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const installPage = read("app/install/[clientSlug]/page.tsx");
const installClient = read("app/install/[clientSlug]/InstallExperience.tsx");
const installEnvironment = read("lib/install-environment.ts");
const installManifestRoute = read(
  "app/install/[clientSlug]/manifest.webmanifest/route.ts",
);
const installRuntime = read("db/runtime-install-branding.ts");
const clientAppSettings = read("app/crm/BrandingSettings.tsx");
const robotsRoute = read("app/robots.txt/route.ts");

const iosSafariUa =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1";
const iosChromeUa =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1";
const iosEdgeUa =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 EdgiOS/140.0 Mobile/15E148 Safari/605.1.15";
const iosFirefoxUa =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 FxiOS/142.0 Mobile/15E148 Safari/605.1.15";
const androidChromeUa =
  "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36";
const androidEdgeUa =
  "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36 EdgA/140.0";

function tenant(overrides = {}) {
  return {
    clientId: "private-client-id-123",
    businessName: "Segovia Pest Management",
    appName: "Segovia Pest",
    logoUrl: "https://cdn.example.com/segovia-logo.png",
    iconUrl: "https://cdn.example.com/segovia-icon.png",
    primaryColor: "#24543a",
    accentColor: "#f1d64b",
    subdomain: "segovia-pest",
    notifications: {
      newLead: true,
      missedCall: true,
      transcriptReady: true,
      leadNotContacted: true,
      appointmentReminder: true,
      hotLead: true,
      reviewRequest: false,
      dailyDigest: false,
    },
    thresholds: { staleLeadHours: 4, hotLeadScore: 80 },
    ...overrides,
  };
}

test("the public install payload is an explicit branding-only allowlist", () => {
  const result = toPublicInstallBranding(tenant());
  assert.deepEqual(Object.keys(result).sort(), [
    "appName",
    "businessName",
    "iconUrl",
    "logoUrl",
    "primaryColor",
    "slug",
  ]);
  const serialized = JSON.stringify(result);
  for (const secret of [
    "private-client-id-123",
    "notifications",
    "thresholds",
    "organizationId",
    "leads",
    "calls",
    "credentials",
  ]) {
    assert.ok(!serialized.includes(secret), `${secret} is not public`);
  }
});

test("install paths use only a validated public branding slug", () => {
  assert.equal(installPathForSlug("segovia-pest"), "/install/segovia-pest");
  for (const invalid of [
    "private client id",
    "../other-tenant",
    "api",
    "x",
    "segovia--pest",
  ]) {
    assert.equal(installPathForSlug(invalid), null);
  }
  assert.equal(toPublicInstallBranding(tenant({ subdomain: null })), null);
});

test("two tenants resolve to distinct public payloads and manifest identities", () => {
  const first = tenant();
  const second = tenant({
    clientId: "private-client-id-456",
    businessName: "Acme Plumbing",
    appName: "Acme Service",
    subdomain: "acme-plumbing",
    primaryColor: "#183e8f",
  });
  assert.equal(toPublicInstallBranding(first)?.slug, "segovia-pest");
  assert.equal(toPublicInstallBranding(second)?.slug, "acme-plumbing");
  assert.equal(buildInstallManifest(first)?.id, "/?tenant=segovia-pest");
  assert.equal(buildInstallManifest(second)?.id, "/?tenant=acme-plumbing");
  assert.ok(!JSON.stringify(buildInstallManifest(first)).includes(first.clientId));
});

test("unknown or malformed slugs return a neutral 404", () => {
  assert.match(installPage, /if \(!branding \|\| !installPath\) notFound\(\)/);
  assert.match(installManifestRoute, /status: 404/);
  assert.match(installRuntime, /normalizeSubdomain\(candidate\)/);
  assert.match(installRuntime, /branding\?\.subdomain === slug/);
});

test("the install page uses the exact slug manifest and keeps the dashboard authenticated", () => {
  assert.match(
    installPage,
    /href=\{`\$\{installPath\}\/manifest\.webmanifest`\}/,
  );
  assert.match(installPage, /<PwaRegistrar \/>/);
  assert.match(installClient, /href="\/dashboard"/);
  assert.doesNotMatch(installPage, /CrmApp|ClientPortal|getCrmBootstrap/);
  assert.doesNotMatch(
    installClient,
    /\b(?:leads?|calls?|credentials?|clientId|organizationId)\b/i,
  );
  assert.match(installPage, /robots: \{ index: false, follow: false \}/);
  assert.match(robotsRoute, /"\/install\/"/);
});

test("Android uses the native prompt only after the user clicks Install App", () => {
  assert.match(installClient, /beforeinstallprompt/);
  assert.match(installClient, /event\.preventDefault\(\)/);
  assert.match(installClient, /setInstallPrompt\(event as BeforeInstallPromptEvent\)/);
  assert.match(installClient, /async function install\(\)/);
  assert.match(installClient, /await prompt\.prompt\(\)/);
  assert.match(installClient, /await prompt\.userChoice/);
  assert.match(installClient, /choice\.outcome === "accepted"/);
  assert.match(installClient, /Installation cancelled/);
});

test("iOS Safari gets a minimal Safari-specific three-step guide", () => {
  const environment = detectInstallEnvironment({ userAgent: iosSafariUa });
  const guide = manualInstallGuideFor(environment);
  assert.equal(environment.platform, "ios");
  assert.equal(environment.browser, "safari");
  assert.equal(guide.safariFallback, undefined);
  assert.equal(guide.steps.length, 3);
  assert.match(guide.steps[0].detail, /Safari/);
  assert.equal(guide.steps[1].title, "Add to Home Screen");
  assert.equal(guide.steps[2].title, "Tap Add");
  assert.doesNotMatch(installClient, /webkit.*install|apple.*prompt/i);
});

test("iOS Chrome installs from Chrome's own Share menu without a Safari warning", () => {
  const environment = detectInstallEnvironment({ userAgent: iosChromeUa });
  const guide = manualInstallGuideFor(environment);
  assert.equal(environment.browser, "chrome");
  assert.equal(guide.safariFallback, undefined);
  assert.match(guide.steps[0].detail, /Chrome's address bar/);
  assert.doesNotMatch(JSON.stringify(guide), /open in safari/i);
});

test("Firefox uses its supported iOS share flow while Edge gets a safe Safari fallback", () => {
  const firefox = detectInstallEnvironment({ userAgent: iosFirefoxUa });
  const firefoxGuide = manualInstallGuideFor(firefox);
  assert.equal(firefox.browser, "firefox");
  assert.equal(firefoxGuide.safariFallback, undefined);
  assert.match(firefoxGuide.steps[0].detail, /Firefox/);

  const edge = detectInstallEnvironment({ userAgent: iosEdgeUa });
  const edgeGuide = manualInstallGuideFor(edge);
  assert.equal(edge.browser, "edge");
  assert.equal(edgeGuide.safariFallback, true);
  assert.match(edgeGuide.title, /Open in Safari/);
  assert.match(installClient, /Copy Link for Safari/);
  assert.doesNotMatch(installClient, /x-web-search|googlechrome|microsoft-edge/i);
});

test("iPad desktop-mode detection still receives the correct iOS guide", () => {
  const environment = detectInstallEnvironment({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15",
    platform: "MacIntel",
    maxTouchPoints: 5,
  });
  assert.equal(environment.platform, "ios");
  assert.equal(environment.deviceLabel, "iPad");
  assert.equal(environment.browser, "safari");
  assert.equal(manualInstallGuideFor(environment).title, "Install on iPad");
});

test("Android without beforeinstallprompt gets the shortest browser-specific fallback", () => {
  const chrome = detectInstallEnvironment({ userAgent: androidChromeUa });
  const edge = detectInstallEnvironment({ userAgent: androidEdgeUa });
  assert.equal(chrome.platform, "android");
  assert.equal(chrome.browser, "chrome");
  assert.match(manualInstallGuideFor(chrome).steps[0].title, /Chrome menu/);
  assert.equal(edge.browser, "edge");
  assert.match(manualInstallGuideFor(edge).steps[0].title, /Edge menu/);
  assert.match(manualInstallGuideFor(edge).steps[1].title, /Add to phone/);
});

test("standalone capability replaces install guidance with Open Dashboard", () => {
  const displayMode = detectInstallEnvironment({
    userAgent: androidChromeUa,
    displayModeStandalone: true,
  });
  const iosStandalone = detectInstallEnvironment({
    userAgent: iosSafariUa,
    navigatorStandalone: true,
  });
  assert.equal(displayMode.standalone, true);
  assert.equal(iosStandalone.standalone, true);
  assert.match(installEnvironment, /display-mode: standalone/);
  assert.match(installEnvironment, /navigator as Navigator.*standalone/s);
  assert.match(installClient, /App Installed/);
  assert.match(installClient, /appinstalled/);
  assert.match(installClient, /standalone: true/);
  assert.match(installClient, /Open Dashboard/);
});

test("desktop fallback reuses a locally generated QR for the exact install URL", () => {
  const desktop = detectInstallEnvironment({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
  });
  const guide = manualInstallGuideFor(desktop);
  assert.equal(desktop.platform, "desktop");
  assert.equal(guide.desktopQr, true);
  assert.match(guide.title, /Scan to install/);
  assert.match(installClient, /QRCodeCanvas/);
  assert.match(installClient, /window\.location\.origin/);
  assert.match(installClient, /window\.location\.pathname/);
  assert.match(installClient, /value=\{installUrl\}/);
  assert.doesNotMatch(installClient, /api\.qrserver|chart\.googleapis|quickchart/i);
});

test("the initial install page has one primary action and hides fallback instructions", () => {
  assert.match(installClient, />\s*Install App\s*<\/button>/s);
  assert.match(installClient, /showGuide && guide/);
  assert.match(installClient, /setShowGuide\(true\)/);
  assert.doesNotMatch(installClient, /For the simplest install/);
});

test("Settings QR, sharing, and copy flows all use the exact install URL", () => {
  assert.match(clientAppSettings, /installPathForSlug\(savedSubdomain\)/);
  assert.match(clientAppSettings, /setQrUrl\(url\)/);
  assert.match(clientAppSettings, /value=\{qrUrl\}/);
  assert.match(clientAppSettings, /navigator\.share\(shareData\)/);
  assert.match(clientAppSettings, /clientInstallMessage\(url\)/);
  assert.match(clientAppSettings, /Copy Message/);
  assert.match(clientAppSettings, /Download QR/);
  assert.doesNotMatch(clientAppSettings, /api\.qrserver|chart\.googleapis|quickchart/i);
});

test("the public manifest carries branding and no private settings", () => {
  const manifest = buildInstallManifest(tenant());
  assert.equal(manifest?.name, "Segovia Pest");
  assert.equal(manifest?.theme_color, "#24543a");
  assert.equal(manifest?.start_url, "/dashboard");
  assert.equal(manifest?.icons[0].src, "https://cdn.example.com/segovia-icon.png");
  assert.doesNotMatch(JSON.stringify(manifest), /notification|threshold|client-id/i);
});
