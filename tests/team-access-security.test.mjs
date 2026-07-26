import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const crmSource = read("db/supabase-crm.ts");
const formsSource = read("app/crm/ActionForms.tsx");
const opsSource = read("app/crm/OperationsViews.tsx");

const inviteBlock = crmSource.match(
  /if \(action === "invite_member"\) \{[\s\S]*?\n {2}\}\n/,
)?.[0];
const revokeBlock = crmSource.match(
  /if \(action === "revoke_member"\) \{[\s\S]*?\n {2}\}\n/,
)?.[0];

test("granting access requires team.manage before anything is written", () => {
  assert.ok(inviteBlock, "invite_member handler exists");
  const permissionIndex = inviteBlock.indexOf('requirePermission(context, "team.manage")');
  const authUserIndex = inviteBlock.indexOf("auth.admin.createUser");
  const membershipIndex = inviteBlock.search(/\.from\("(?:client|organization)_members"\)/);
  assert.ok(permissionIndex >= 0, "permission gate present");
  assert.ok(authUserIndex > permissionIndex, "auth user created only after the gate");
  assert.ok(membershipIndex > permissionIndex, "membership written only after the gate");
});

test("invites cannot escalate past the inviter", () => {
  const allowlist = crmSource.match(/INVITABLE_ROLES[^=]*=\s*\[([^\]]+)\]/)?.[1];
  assert.ok(allowlist, "INVITABLE_ROLES allowlist exists");
  const roles = allowlist.match(/"([A-Z_]+)"/g).map((item) => item.replaceAll('"', ""));
  assert.deepEqual(
    roles.sort(),
    ["AGENCY_ADMIN", "AGENCY_MEMBER", "CLIENT_EMPLOYEE", "CLIENT_MANAGER", "CLIENT_OWNER"],
    "SUPER_ADMIN and AGENCY_OWNER must never be grantable through an invite",
  );
  assert.ok(inviteBlock.includes("INVITABLE_ROLES.includes(role as CrmRole)"));
  assert.doesNotMatch(inviteBlock, /"SUPER_ADMIN"/);
});

test("a client-scoped invite is pinned to a sub-account the inviter owns", () => {
  const clientIdIndex = inviteBlock.indexOf('requireText(input.clientId, "Sub-account"');
  const requireClientIndex = inviteBlock.indexOf("requireClient(context, clientId)");
  const writeIndex = inviteBlock.indexOf('.from("client_members")');
  assert.ok(clientIdIndex >= 0, "client role requires a sub-account");
  assert.ok(requireClientIndex > clientIdIndex, "sub-account ownership verified");
  assert.ok(writeIndex > requireClientIndex, "membership written only after verification");
  // Tenant columns always come from the authenticated context, not the request.
  assert.match(inviteBlock, /organization_id: context\.organizationId/);
  assert.doesNotMatch(inviteBlock, /input\.organizationId/);
});

test("revoking access is scoped to the caller's organization", () => {
  assert.ok(revokeBlock, "revoke_member handler exists");
  assert.match(revokeBlock, /requirePermission\(context, "team\.manage"\)/);
  const orgScopes = revokeBlock.match(/\.eq\("organization_id", context\.organizationId\)/g) ?? [];
  assert.ok(orgScopes.length >= 2, "both the lookup and the update are org-scoped");
  assert.match(revokeBlock, /status: "inactive"/, "revoke soft-disables rather than deleting history");
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

test("the invite UI requires a sub-account for client roles and explains the Access step", () => {
  assert.match(formsSource, /clientId: needsSubAccount \? getFormValue\(form, "clientId"\) : ""/);
  assert.match(formsSource, /Cloudflare Access policy/);
  assert.match(opsSource, /action: "revoke_member"/);
  // No fabricated sign-in data: profiles carry no last-login timestamp.
  assert.doesNotMatch(opsSource, /Invite pending/);
});
