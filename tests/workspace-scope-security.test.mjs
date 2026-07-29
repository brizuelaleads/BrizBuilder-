import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

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
  "audit.read",
  "feature_flags.manage",
];

// Tabs a client user must never see in the sidebar.
const AGENCY_ONLY_TABS = [
  "connections",
  "phone-system",
  "automations",
  "profiles",
  "forms",
  "funnels",
  "payments",
  "ai",
  "clients",
  "custom-data",
  "audit",
  "settings",
];

function rolePermissions(source, role) {
  const block = source.match(new RegExp(`${role}: \\[([\\s\\S]*?)\\]`));
  assert.ok(block, `${role} exists in the role map`);
  return (block[1].match(/"[a-z_.]+"/g) ?? []).map((item) => item.replaceAll('"', "")).sort();
}

const CLIENT_ROLES = ["CLIENT_OWNER", "CLIENT_MANAGER", "CLIENT_EMPLOYEE"];
const ALL_ROLES = [
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

test("every agency-only tab is flagged, and Team stays reachable for client owners", () => {
  for (const id of AGENCY_ONLY_TABS) {
    const entry = appSource.match(
      new RegExp(`\\{[^{}]*id: "${id}"[^{}]*\\}`, "s"),
    )?.[0];
    assert.ok(entry, `nav entry for ${id} exists`);
    assert.match(entry, /agencyOnly: true/, `${id} must be agency-only`);
  }
  const team = appSource.match(/\{[^{}]*id: "team"[^{}]*\}/s)?.[0];
  assert.ok(team, "team nav entry exists");
  assert.doesNotMatch(team, /agencyOnly/, "Team is permission-gated, not agency-only");
  assert.match(team, /permission: "team\.manage"/);
  assert.match(
    appSource,
    /view === "team" && data\.viewer\.permissions\.includes\("team\.manage"\)/,
    "Team must render for permitted client owners, not only agency users",
  );
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
  assert.ok(entries.length >= 20, "found the nav entries");
  for (const entry of entries) {
    assert.match(entry, /section: "/, `nav entry missing a section: ${entry.slice(0, 60)}`);
  }
});

test("a client owner cannot invite an agency role or reach another sub-account", () => {
  const block = supabaseSource.match(
    /if \(action === "invite_member"\) \{[\s\S]*?\n {2}\}\n/,
  )?.[0];
  assert.ok(block, "invite_member handler exists");
  // Their session decides the sub-account; a supplied clientId is ignored.
  assert.match(
    block,
    /if \(context\.clientId\) \{[\s\S]*?if \(!isClientRole\)[\s\S]*?clientId = context\.clientId;/,
  );
  const clientBranch = block.match(/if \(context\.clientId\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.ok(clientBranch, "client-scoped branch exists");
  assert.doesNotMatch(clientBranch, /input\.clientId/, "must not read a client-supplied sub-account");
});

test("a client owner can never revoke an agency membership", () => {
  const block = supabaseSource.match(
    /if \(action === "revoke_member"\) \{[\s\S]*?\n {2}\}\n/,
  )?.[0];
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
  assert.match(formsSource, /isAgency \? <optgroup label="Agency/);
  assert.match(formsSource, /const needsSubAccount = isAgency && isClientRole/);
});
