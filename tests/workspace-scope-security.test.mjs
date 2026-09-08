import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
// Line endings are normalized so the block-matching patterns below behave the
// same on a CRLF checkout as they do on LF.
const read = (rel) =>
  fs.readFileSync(path.join(root, rel), "utf8").replaceAll("\r\n", "\n");

const d1Source = read("db/crm.ts");
const supabaseSource = read("db/supabase-crm.ts");
const appSource = read("app/CrmApp.tsx");
const formsSource = read("app/crm/ActionForms.tsx");

// Capabilities a client user must never hold: they drive the agency-only tabs
// (provider setup, automations, AI, custom data, shared billing).
const AGENCY_ONLY_PERMISSIONS = [
  "phone_system.manage",
  "payments.manage",
  "automations.manage",
  "ai_connector.manage",
  "custom_data.manage",
  "profiles.manage",
  "profiles.connect",
  "billing.read_shared",
  "clients.manage",
  "clients.delete",
  "audit.read",
  "feature_flags.manage",
  "reports.read",
];

const CLIENT_TABS = [
  ["dashboard", "Dashboard", "LayoutDashboard", "MAIN"],
  ["leads", "Leads", "UserRoundSearch", "MAIN"],
  ["pipeline", "Pipeline", "Funnel", "MAIN"],
  ["calls", "Calls", "PhoneCall", "MAIN"],
  ["calendar", "Calendar", "CalendarDays", "MAIN"],
  ["ads", "Ads", "Megaphone", "MAIN"],
  ["connections", "Connections", "Plug", "MAIN"],
];

const AGENCY_TABS = [
  ["dashboard", "Dashboard", "LayoutDashboard", "MAIN"],
  ["leads", "Leads", "UserRoundSearch", "MAIN"],
  ["pipeline", "Pipeline", "Funnel", "MAIN"],
  ["calls", "Calls", "PhoneCall", "MAIN"],
  ["contacts", "Contacts", "ContactRound", "MAIN"],
  ["companies", "Companies", "Building2", "MAIN"],
  ["calendar", "Calendar", "CalendarDays", "MAIN"],
  ["tasks", "Tasks", "ListChecks", "MAIN"],
  ["ads", "Ads", "Megaphone", "MAIN"],
  ["conversations", "Conversations", "MessageSquareText", "COMMUNICATIONS"],
  ["connections", "Connections", "Plug", "COMMUNICATIONS"],
  ["phone-system", "Phone & Texting", "PhoneCall", "COMMUNICATIONS"],
  ["automations", "Automations", "Workflow", "COMMUNICATIONS"],
  ["websites", "Websites", "Globe2", "GROWTH"],
  ["reviews", "Reviews", "Star", "GROWTH"],
  ["profiles", "Google Profiles", "MapPin", "GROWTH"],
  ["forms", "Forms", "FileText", "GROWTH"],
  ["funnels", "Funnels", "Funnel", "GROWTH"],
  ["reports", "Reports", "ChartNoAxesCombined", "BUSINESS"],
  ["payments", "Payments", "CreditCard", "BUSINESS"],
  ["clients", "Sub-accounts", "BriefcaseBusiness", "BUSINESS"],
  ["team", "Team", "UsersRound", "BUSINESS"],
  ["ai", "AI Connector", "Sparkles", "TOOLS"],
  ["custom-data", "Custom data", "Database", "TOOLS"],
  ["audit", "Audit log", "History", "TOOLS"],
  ["settings", "Settings", "SettingsIcon", "TOOLS"],
];

const AGENCY_ONLY_TABS = new Set([
  "connections",
  "phone-system",
  "automations",
  "profiles",
  "forms",
  "funnels",
  "payments",
  "clients",
  "ai",
  "custom-data",
  "audit",
]);

const NAV_PERMISSIONS = new Map([
  ["companies", "companies.write"],
  ["ads", "reports.read"],
  ["conversations", "messages.write"],
  ["connections", "phone_system.manage"],
  ["phone-system", "phone_system.manage"],
  ["automations", "automations.manage"],
  ["reviews", "reviews.read"],
  ["profiles", "profiles.manage"],
  ["reports", "reports.read"],
  ["payments", "payments.manage"],
  ["clients", "clients.manage"],
  ["team", "team.manage"],
  ["ai", "ai_connector.manage"],
  ["custom-data", "custom_data.manage"],
  ["audit", "audit.read"],
  ["settings", "clients.manage"],
]);

function permissionArray(source, name) {
  const block = source.match(new RegExp(`const ${name}: CrmPermission\\[] = \\[([\\s\\S]*?)\\]`));
  assert.ok(block, `${name} permission array exists`);
  return (block[1].match(/"[a-z_.]+"/g) ?? []).map((item) => item.replaceAll('"', ""));
}

function rolePermissions(source, role) {
  const direct = source.match(new RegExp(`${role}: \\[([\\s\\S]*?)\\]`));
  if (direct) return (direct[1].match(/"[a-z_.]+"/g) ?? []).map((item) => item.replaceAll('"', "")).sort();
  const mapped = source.match(new RegExp(`${role}:\\s*([a-zA-Z]+Permissions)`));
  assert.ok(mapped, `${role} exists in the role map`);
  return permissionArray(source, mapped[1]).sort();
}

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

function navigationEntries(name) {
  const start = appSource.indexOf(`const ${name}: NavItem[] = [`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = appSource.indexOf("\n];", start);
  assert.notEqual(end, -1, `${name} closes`);
  const block = appSource.slice(start, end + 3);
  return [...block.matchAll(/\{\s*id: "[a-z-]+"[\s\S]*?\}/g)].map(
    ([entry]) => ({
      id: entry.match(/id: "([a-z-]+)"/)?.[1],
      label: entry.match(/label: "([^"]+)"/)?.[1],
      icon: entry.match(/icon: <([A-Za-z0-9]+)/)?.[1],
      section: entry.match(/section: "([A-Z]+)"/)?.[1],
      agencyOnly: /agencyOnly: true/.test(entry),
      permission: entry.match(/permission: "([a-z_.]+)"/)?.[1],
    }),
  );
}

const CLIENT_ROLES = ["CLIENT_OWNER", "CLIENT_MANAGER", "CLIENT_EMPLOYEE"];
const ALL_ROLES = [
  "LB_OWNER",
  "LB_ADMIN",
  "LB_TEAM_MEMBER",
  "SUPER_ADMIN",
  "AGENCY_OWNER",
  "AGENCY_ADMIN",
  "AGENCY_MEMBER",
  ...CLIENT_ROLES,
];

test("the two role maps cannot drift apart", () => {
  for (const role of ALL_ROLES) {
    assert.deepEqual(
      rolePermissions(d1Source, role),
      rolePermissions(supabaseSource, role),
      `${role} must be identical in db/crm.ts and db/supabase-crm.ts`,
    );
  }
});

test("LB Marketing agency roles follow owner/admin/team boundaries", () => {
  const owner = rolePermissions(supabaseSource, "LB_OWNER");
  assert.ok(owner.includes("clients.delete"));
  assert.ok(owner.includes("payments.manage"));
  assert.ok(owner.includes("audit.read"));
  const admin = rolePermissions(supabaseSource, "LB_ADMIN");
  assert.ok(admin.includes("clients.manage"));
  assert.ok(admin.includes("reports.read"));
  assert.ok(!admin.includes("clients.delete"));
  assert.ok(!admin.includes("payments.manage"));
  assert.ok(!admin.includes("audit.read"));
  const team = rolePermissions(supabaseSource, "LB_TEAM_MEMBER");
  for (const permission of ["contacts.write", "opportunities.write", "tasks.write", "appointments.write", "messages.write"]) {
    assert.ok(team.includes(permission), `LB_TEAM_MEMBER needs ${permission}`);
  }
  for (const permission of AGENCY_ONLY_PERMISSIONS) {
    assert.ok(!team.includes(permission), `LB_TEAM_MEMBER must not hold ${permission}`);
  }
});

test("client roles hold none of the agency-only capabilities", () => {
  for (const role of CLIENT_ROLES) {
    const granted = rolePermissions(supabaseSource, role);
    for (const permission of AGENCY_ONLY_PERMISSIONS) {
      assert.ok(
        !granted.includes(permission),
        `${role} must not hold ${permission}`,
      );
    }
  }
});

test("client roles keep exactly the capabilities their own tabs need", () => {
  const owner = rolePermissions(supabaseSource, "CLIENT_OWNER");
  for (const permission of [
    "contacts.write",
    "companies.write",
    "opportunities.write",
    "tasks.write",
    "appointments.write",
    "calendar.connect",
    "websites.manage",
    "messages.write",
    "reviews.read",
  ]) {
    assert.ok(owner.includes(permission), `CLIENT_OWNER needs ${permission}`);
  }
  // Only the owner may manage their own staff.
  assert.ok(owner.includes("team.manage"));
  assert.ok(!rolePermissions(supabaseSource, "CLIENT_MANAGER").includes("team.manage"));
  assert.ok(!rolePermissions(supabaseSource, "CLIENT_EMPLOYEE").includes("team.manage"));
  assert.ok(rolePermissions(supabaseSource, "CLIENT_MANAGER").includes("calendar.connect"));
  assert.ok(!rolePermissions(supabaseSource, "CLIENT_EMPLOYEE").includes("calendar.connect"));
});

test("client navigation is exactly the requested seven shared tabs", () => {
  const entries = navigationEntries("clientNavigation");
  assert.deepEqual(
    entries.map(({ id, label, icon, section }) => [id, label, icon, section]),
    CLIENT_TABS,
  );
  for (const entry of entries) {
    assert.equal(entry.agencyOnly, false, `${entry.id} must not be agency-only`);
    assert.equal(entry.permission, undefined, `${entry.id} must not be permission-hidden`);
  }
  assert.match(
    appSource,
    /view === "team" && data\.viewer\.permissions\.includes\("team\.manage"\)/,
    "Team must render for permitted client owners, not only agency users",
  );
  assert.match(
    appSource,
    /view === "settings" && data\.viewer\.permissions\.includes\("clients\.manage"\)/,
  );
});

test("agency navigation restores the historical menu and retains Pipeline and Calls", () => {
  const entries = navigationEntries("agencyNavigation");
  assert.deepEqual(
    entries.map(({ id, label, icon, section }) => [id, label, icon, section]),
    AGENCY_TABS,
  );
  for (const entry of entries) {
    assert.equal(
      entry.agencyOnly,
      AGENCY_ONLY_TABS.has(entry.id),
      `${entry.id} agency-only behavior drifted`,
    );
    assert.equal(
      entry.permission,
      NAV_PERMISSIONS.get(entry.id),
      `${entry.id} permission drifted`,
    );
  }
});

test("authenticated account type selects navigation independently of client selection", () => {
  assert.match(
    appSource,
    /const navigation = data\.viewer\.isAgency\s*\? agencyNavigation\s*: clientNavigation;/,
  );
  assert.doesNotMatch(
    appSource.match(/const navigation = [\s\S]*?;/)?.[0] ?? "",
    /selectedClient|effectiveSelectedClientId/,
  );
});

test("client deep links cannot bypass agency-only and permission route gates", () => {
  assert.match(
    appSource,
    /\(!item\.agencyOnly \|\| isAgency\)[\s\S]*?permissions\.includes\(item\.permission\)/,
  );
  assert.match(
    appSource,
    /accessibleSecondaryViews = agencyNavigation\.filter\(\(item\) =>[\s\S]*?canAccessNavigationItem/,
  );
  assert.match(
    appSource,
    /visibleNav\.some\(\(item\) => item\.id === requested\) \|\|[\s\S]*?accessibleSecondaryViews\.some\(\(item\) => item\.id === requested\)/,
  );
  assert.doesNotMatch(appSource, /nestedViews\.includes\(requested\)/);
  const clientIds = new Set(CLIENT_TABS.map(([id]) => id));
  for (const id of AGENCY_ONLY_TABS) {
    if (id !== "connections") assert.ok(!clientIds.has(id), `${id} leaked into client navigation`);
  }
});

test("every restored agency tab resolves to an implemented view", () => {
  assert.match(
    appSource,
    /return requested && knownViews\.has\(requested\) \? requested : "dashboard";/,
    "refresh and direct-link parsing must recognize every configured navigation route",
  );
  const renderedViews = appSource.slice(appSource.indexOf('{view === "dashboard" && !data.viewer.isAgency'));
  for (const [id] of AGENCY_TABS) {
    if (["forms", "funnels"].includes(id)) continue;
    assert.match(renderedViews, new RegExp(`view === "${id}"`), `${id} needs an implemented view`);
  }
  assert.match(appSource, /const futureModules: FutureModule\[] = \[[\s\S]*?"forms",[\s\S]*?"funnels",/);
  assert.match(renderedViews, /futureModules\.includes\(view as FutureModule\)/);
  assert.match(renderedViews, /<FutureModuleView module=\{view as FutureModule\} \/>/);
});

test("client sessions are pinned to their own selected client in the UI", () => {
  assert.match(
    appSource,
    /const effectiveSelectedClientId = data\.viewer\.isAgency[\s\S]*?: data\.viewer\.clientId;/,
    "client sessions must derive the selected workspace from the authenticated viewer",
  );
  assert.match(
    appSource,
    /if \(!data\.viewer\.isAgency\) \{[\s\S]*setSelectedClientId\(data\.viewer\.clientId \?\? ""\);[\s\S]*return;/,
    "client sessions must not keep ?client=all or another selected client",
  );
  assert.match(
    appSource,
    /initialData\.viewer\.isAgency &&[\s\S]*requestedClient/,
    "URL client switching must only run for agency users",
  );
  assert.match(
    appSource,
    /setSelectedClientId\(data\.viewer\.isAgency \? "all" : data\.viewer\.clientId \?\? ""\)/,
    "client lead creation must not reset the workspace to all clients",
  );
});

test("every role-specific nav item declares a section", () => {
  for (const name of ["clientNavigation", "agencyNavigation"]) {
    for (const entry of navigationEntries(name)) {
      assert.ok(entry.section, `${name} entry ${entry.id} is missing a section`);
    }
  }
});

test("a client owner cannot invite an agency role or reach another sub-account", () => {
  const block = extractBlock(supabaseSource, 'if (action === "invite_member") {');
  assert.ok(block, "invite_member handler exists");
  // Their session decides the sub-account; a supplied clientId is ignored.
  assert.match(
    block,
    /if \(context\.clientId\) \{[\s\S]*?if \(!targetIsClientUser\)[\s\S]*?clientId = context\.clientId;/,
  );
  const clientBranch = block.match(/if \(context\.clientId\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.ok(clientBranch, "client-scoped branch exists");
  assert.doesNotMatch(clientBranch, /input\.clientId/, "must not read a client-supplied sub-account");
});

test("a client owner can never revoke an agency membership", () => {
  const block = extractBlock(supabaseSource, 'if (action === "revoke_member") {');
  assert.ok(block, "revoke_member handler exists");
  // Client users are pinned to the client branch regardless of requested scope.
  assert.match(block, /const scope = context\.clientId\s*\?\s*"client"/);
  // And their own client id constrains both the lookup and the update.
  const clientIdGuards = block.match(/\.eq\("client_id", context\.clientId\)/g) ?? [];
  assert.ok(clientIdGuards.length >= 2, "lookup and update are both client-scoped");
});

test("the team roster is scoped to the viewer's own sub-account", () => {
  const block = supabaseSource.match(
    /let teamMembers: CrmTeamMember\[\][\s\S]*?\n {2}\}\n/,
  )?.[0];
  assert.ok(block, "roster block exists");
  assert.match(block, /supabaseRoleHasPermission\(context, "team\.manage"\)/);
  // Client users get no agency memberships and only their own client's rows.
  assert.match(block, /context\.clientId\s*\?\s*Promise\.resolve\(\[\]/);
  assert.match(block, /clientMemberQuery\.eq\("client_id", context\.clientId\)/);
});

test("the invite form hides agency roles from client owners", () => {
  assert.match(formsSource, /canInviteLbRoles \? <optgroup label="LB Marketing"/);
  assert.match(formsSource, /const needsSubAccount = isAgency && \(isClientRole \|\| isLbTeamMember\)/);
});
