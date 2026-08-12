import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const crmSource = read("db/supabase-crm.ts");
const accessSource = read("db/supabase-access.ts");
const formsSource = read("app/crm/ActionForms.tsx");
const opsSource = read("app/crm/OperationsViews.tsx");

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

const inviteBlock = extractBlock(crmSource, 'if (action === "invite_member") {');
const revokeBlock = extractBlock(crmSource, 'if (action === "revoke_member") {');

test("granting access requires team.manage before anything is written", () => {
  assert.ok(inviteBlock, "invite_member handler exists");
  const permissionIndex = inviteBlock.indexOf('requirePermission(context, "team.manage")');
  const authUserIndex = inviteBlock.indexOf("ensureSupabaseInviteProfile");
  const membershipIndex = inviteBlock.search(/\.from\("(?:client|organization)_members"\)/);
  assert.ok(permissionIndex >= 0, "permission gate present");
  assert.ok(authUserIndex > permissionIndex, "auth profile prepared only after the gate");
  assert.ok(membershipIndex > permissionIndex, "membership written only after the gate");
});

test("invites cannot escalate past the inviter", () => {
  const allowlist = crmSource.match(/INVITABLE_ROLES[^=]*=\s*\[([^\]]+)\]/)?.[1];
  assert.ok(allowlist, "INVITABLE_ROLES allowlist exists");
  const roles = allowlist.match(/"([A-Z_]+)"/g).map((item) => item.replaceAll('"', ""));
  assert.deepEqual(
    roles.sort(),
    ["CLIENT_EMPLOYEE", "CLIENT_MANAGER", "CLIENT_OWNER", "LB_ADMIN", "LB_TEAM_MEMBER"],
    "LB_OWNER and legacy owner roles must never be grantable through an invite",
  );
  assert.ok(inviteBlock.includes("INVITABLE_ROLES.includes(role)"));
  assert.doesNotMatch(allowlist, /"SUPER_ADMIN"/);
  assert.doesNotMatch(allowlist, /"LB_OWNER"/);
  assert.doesNotMatch(allowlist, /"AGENCY_OWNER"/);
});

test("a client-scoped invite is pinned to a sub-account the inviter owns", () => {
  const clientIdIndex = inviteBlock.indexOf('requireText(input.clientId, "Sub-account"');
  const requireClientIndex = inviteBlock.indexOf("requireClient(context, clientId)", clientIdIndex);
  const writeIndex = inviteBlock.indexOf('.from("client_members")');
  assert.ok(clientIdIndex >= 0, "client role requires a sub-account");
  assert.ok(requireClientIndex > clientIdIndex, "sub-account ownership verified");
  assert.ok(writeIndex > requireClientIndex, "membership written only after verification");
  // Tenant columns always come from the authenticated context, not the request.
  assert.match(inviteBlock, /organization_id: context\.organizationId/);
  assert.match(inviteBlock, /Only the LB Owner can grant LB agency roles/);
  assert.match(inviteBlock, /targetIsLbTeamMember/);
  assert.doesNotMatch(inviteBlock, /input\.organizationId/);
});

test("revoking access is scoped to the caller's organization", () => {
  assert.ok(revokeBlock, "revoke_member handler exists");
  assert.match(revokeBlock, /requirePermission\(context, "team\.manage"\)/);
  const orgScopes = revokeBlock.match(/\.eq\("organization_id", context\.organizationId\)/g) ?? [];
  assert.ok(orgScopes.length >= 2, "both the lookup and the update are org-scoped");
  assert.match(revokeBlock, /status: "archived"/, "revoke soft-disables with a valid record_status enum value");
});

test("both access changes are audited", () => {
  assert.match(inviteBlock, /"team\.access_granted"/);
  assert.match(revokeBlock, /"team\.access_revoked"/);
});

test("the team roster never leaks beyond the viewer's own workspace", () => {
  const rosterBlock = crmSource.match(
    /let teamMembers: CrmTeamMember\[\][\s\S]*?\n {2}\}\n/,
  )?.[0];
  assert.ok(rosterBlock, "team roster block exists");
  // Only people who can manage a team receive a roster at all.
  assert.match(rosterBlock, /supabaseRoleHasPermission\(context, "team\.manage"\)/);
  // A client owner gets no agency memberships and only their own client's rows.
  assert.match(rosterBlock, /context\.clientId\s*\?\s*Promise\.resolve\(\[\]/);
  assert.match(rosterBlock, /clientMemberQuery\.eq\("client_id", context\.clientId\)/);
  assert.match(rosterBlock, /\.eq\("organization_id", context\.organizationId\)/);
});

test("an invited person of either kind actually resolves to access", () => {
  const block = accessSource.match(
    /export async function getSupabaseAccountAccess\([\s\S]*?\n\}/,
  )?.[0];
  assert.ok(block, "getSupabaseAccountAccess exists");
  // Both membership tables must be consulted, or one kind of invited user
  // lands on the "access pending" screen forever.
  const agencyIndex = block.indexOf('.from("organization_members")');
  const clientIndex = block.indexOf('.from("client_members")');
  assert.ok(agencyIndex >= 0, "agency memberships are recognized");
  assert.ok(clientIndex >= 0, "client memberships are recognized");
  assert.ok(agencyIndex < clientIndex, "agency is checked first, as in getTenantContext");
  assert.match(block, /\.eq\("status", "active"\)/);
});

test("the invite UI requires a sub-account for client roles and explains the Access step", () => {
  assert.match(formsSource, /clientId: needsSubAccount \? getFormValue\(form, "clientId"\) : ""/);
  assert.match(formsSource, /canInviteLbRoles \? <optgroup label="LB Marketing"/);
  assert.match(formsSource, /const needsSubAccount = isAgency && \(isClientRole \|\| isLbTeamMember\)/);
  assert.match(formsSource, /secure invite link/);
  assert.doesNotMatch(formsSource, /Starting password|cannot email it yet/);
  // The Cloudflare Access caveat lives on the Team view (it applies to every
  // grant, not just new invites) until Access is removed at launch.
  assert.match(opsSource, /Cloudflare Access policy/);
  assert.match(opsSource, /action: "revoke_member"/);
  // No fabricated sign-in data: profiles carry no last-login timestamp.
  assert.doesNotMatch(opsSource, /Invite pending/);
});
