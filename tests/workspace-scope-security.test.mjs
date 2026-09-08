import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
// Line endings are normalized so the block-matching patterns below behave the
// same on a CRLF checkout as they do on LF.
const read = (rel) =>
  fs.readFileSync(path.join(root, rel), "utf8").replaceAll("\r\n", "\n");

const d1Source = read("db/crm.ts");
const supabaseSource = read("db/supabase-crm.ts");
const appSource = read("app/CrmApp.tsx");
const formsSource = read("app/crm/ActionForms.tsx");

// Execute the actual JSX navigation definitions and viewer filter in isolation,
// without loading the CRM's network/provider components.
const navigationDefinitions = appSource.slice(
  appSource.indexOf("const nav:"),
  appSource.indexOf("const viewChangeEvent"),
);
const navigationFilter = appSource.match(/const visibleNav = ([\s\S]*?);/)?.[1];
assert.ok(navigationFilter, "CRM computes a visible navigation list");
const iconsImport = appSource.match(/import \{[^}]+\} from "lucide-react";/)?.[0];
const navigationBuild = buildSync({
  stdin: {
    contents: `${iconsImport}\n${navigationDefinitions}\nexport function visibleNavigation(viewer) { const data = { viewer }; return ${navigationFilter}; }`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  external: ["react/jsx-runtime", "lucide-react"],
});
const navigationModule = { exports: {} };
new Function("require", "module", "exports", navigationBuild.outputFiles[0].text)(
  createRequire(import.meta.url), navigationModule, navigationModule.exports,
);
const { visibleNavigation } = navigationModule.exports;

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

const PRIMARY_TABS = [
  "dashboard",
  "leads",
  "pipeline",
  "calls",
  "calendar",
  "ads",
  "connections",
];

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

test("the compact client tabs remain available while sensitive pages follow capabilities", () => {
  for (const id of PRIMARY_TABS) {
    const entry = appSource.match(
      new RegExp(`\\{[^{}]*id: "${id}"[^{}]*\\}`, "s"),
    )?.[0];
    assert.ok(entry, `nav entry for ${id} exists`);
    assert.doesNotMatch(entry, /agencyOnly|permission:/, `${id} must be shared`);
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

test("agency owners regain the full grouped menu, including Pipeline and Calls", () => {
  const menu = visibleNavigation({ isAgency: true, permissions: rolePermissions(supabaseSource, "LB_OWNER") });
  assert.deepEqual(menu.map((item) => item.id), [
    "dashboard", "leads", "pipeline", "calls", "calendar", "ads",
    "contacts", "companies", "tasks", "conversations", "connections",
    "phone-system", "automations", "websites", "reviews", "profiles",
    "forms", "funnels", "reports", "payments", "clients", "team", "ai",
    "custom-data", "audit", "settings",
  ]);
  assert.deepEqual([...new Set(menu.map((item) => item.section))], [
    "MAIN", "COMMUNICATIONS", "GROWTH", "BUSINESS", "TOOLS",
  ]);
  assert.deepEqual(menu.filter((item) => item.preview).map((item) => item.id), ["forms", "funnels"]);
  assert.ok(menu.every((item) => item.icon && item.label && item.section));
});

test("all client roles keep exactly seven tabs even with an agency permission supplied", () => {
  for (const role of ["CLIENT_OWNER", "CLIENT_MANAGER", "CLIENT_EMPLOYEE"]) {
    for (const permissions of [rolePermissions(supabaseSource, role), rolePermissions(supabaseSource, "LB_OWNER")]) {
      const menu = visibleNavigation({ isAgency: false, role, permissions });
      assert.deepEqual(menu.map((item) => item.id), PRIMARY_TABS, role);
    }
  }
});

test("agency menu uses the authenticated viewer, not the selected sub-account", () => {
  const viewer = { isAgency: true, permissions: rolePermissions(supabaseSource, "LB_OWNER") };
  assert.deepEqual(visibleNavigation({ ...viewer, clientId: "client-one", canViewAllClients: false }), visibleNavigation(viewer));
});

test("restored agency management tabs retain their original capability gates", () => {
  const expectedGates = {
    ads: "reports.read", companies: "companies.write", conversations: "messages.write",
    connections: "phone_system.manage", "phone-system": "phone_system.manage",
    automations: "automations.manage", reviews: "reviews.read", profiles: "profiles.manage",
    reports: "reports.read", payments: "payments.manage", clients: "clients.manage",
    team: "team.manage", ai: "ai_connector.manage", "custom-data": "custom_data.manage",
    audit: "audit.read", settings: "clients.manage",
  };
  for (const source of [d1Source, supabaseSource]) {
    for (const role of ["LB_OWNER", "LB_ADMIN", "LB_TEAM_MEMBER", "SUPER_ADMIN", "AGENCY_OWNER", "AGENCY_ADMIN", "AGENCY_MEMBER"]) {
      const permissions = rolePermissions(source, role);
      const menu = visibleNavigation({ isAgency: true, role, permissions });
      for (const [id, permission] of Object.entries(expectedGates)) {
        assert.equal(menu.some((item) => item.id === id), permissions.includes(permission), `${role}: ${id} requires ${permission}`);
      }
      assert.equal(new Set(menu.map((item) => item.id)).size, menu.length, "no duplicate tabs");
      const sections = menu.map((item) => item.section).filter((section, index, all) => index === 0 || section !== all[index - 1]);
      assert.equal(new Set(sections).size, sections.length, "sections remain contiguous after permission filtering");
    }
  }
});

test("agency viewer without management permissions cannot see management tabs", () => {
  const ids = visibleNavigation({ isAgency: true, permissions: [] }).map((item) => item.id);
  assert.deepEqual(ids, ["dashboard", "leads", "pipeline", "calls", "calendar", "contacts", "tasks", "websites", "forms", "funnels"]);
});

test("restored entries still resolve through existing navigation and deep-link routes", () => {
  const secondaryRoutes = appSource.match(/const nestedViews: View\[\] = \[([\s\S]*?)\];/)?.[1];
  assert.ok(secondaryRoutes);
  const knownRoutes = new Set([...PRIMARY_TABS, "forms", "funnels", ...[...secondaryRoutes.matchAll(/"([a-z-]+)"/g)].map((match) => match[1])]);
  for (const item of visibleNavigation({ isAgency: true, permissions: rolePermissions(supabaseSource, "LB_OWNER") })) {
    assert.ok(knownRoutes.has(item.id), `${item.id} is a supported route`);
  }
  assert.match(appSource, /onClick=\{\(\) => navigate\(item\.id\)\}/);
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

test("every nav item declares a section so hiding tabs cannot orphan a label", () => {
  const navBlock = appSource.match(/const nav: Array<\{[\s\S]*?\n\];/)?.[0];
  assert.ok(navBlock, "nav array exists");
  const entries = navBlock.match(/\{[^{}]*id: "[a-z-]+"[^{}]*\}/gs) ?? [];
  assert.equal(entries.length, PRIMARY_TABS.length, "found exactly the seven primary nav entries");
  for (const entry of entries) {
    assert.match(entry, /section: "/, `nav entry missing a section: ${entry.slice(0, 60)}`);
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
