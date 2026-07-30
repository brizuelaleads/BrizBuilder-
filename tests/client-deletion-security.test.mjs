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
const operationsSource = read("app/crm/OperationsViews.tsx");
const routeSource = read("app/api/crm/route.ts");

function deletionBlock(source) {
  const block = source.match(/if \(action === "delete_client"\) \{[\s\S]*?\n {2}\}\n/)?.[0];
  assert.ok(block, "delete_client handler exists");
  return block;
}

test("only agency administrators can permanently delete a sub-account", () => {
  for (const source of [d1Source, supabaseSource]) {
    const helper = source.match(/function requireAgencyAdministrator\([\s\S]*?\n\}/)?.[0];
    assert.ok(helper, "agency administrator guard exists");
    assert.match(helper, /"SUPER_ADMIN"/);
    assert.match(helper, /"AGENCY_OWNER"/);
    assert.match(helper, /"AGENCY_ADMIN"/);
    assert.doesNotMatch(helper, /"AGENCY_MEMBER"|"CLIENT_OWNER"|"CLIENT_MANAGER"|"CLIENT_EMPLOYEE"/);
    const block = deletionBlock(source);
    const destructiveIndex = block.search(/DELETE|\.delete\(\)/);
    assert.ok(destructiveIndex >= 0, "destructive query exists");
    assert.ok(block.indexOf("requireAgencyAdministrator(context)") < destructiveIndex, "role check runs before deletion");
  }
});

test("sub-account deletion is tenant-scoped, cascading, and audited", () => {
  const d1Block = deletionBlock(d1Source);
  assert.match(d1Block, /organization_id = \?/);
  assert.ok(d1Block.indexOf("DELETE FROM appointments") < d1Block.indexOf("DELETE FROM crm_clients"));
  assert.ok(d1Block.indexOf("DELETE FROM crm_leads") < d1Block.indexOf("DELETE FROM crm_clients"));
  assert.match(d1Block, /client\.deleted/);
  assert.match(d1Block, /, null\);/);

  const supabaseBlock = deletionBlock(supabaseSource);
  const orgScopes = supabaseBlock.match(/\.eq\("organization_id", context\.organizationId\)/g) ?? [];
  assert.ok(orgScopes.length >= 2, "lookup and delete are organization-scoped");
  assert.match(supabaseBlock, /\.from\("clients"\)[\s\S]*?\.delete\(\)/);
  assert.match(supabaseBlock, /client\.deleted/);
  assert.match(supabaseBlock, /, null\);/);
});

test("the delete control is admin-only and requires the exact sub-account name and password", () => {
  assert.match(appSource, /canDelete=\{\["SUPER_ADMIN", "AGENCY_OWNER", "AGENCY_ADMIN"\]\.includes\(data\.viewer\.role\)\}/);
  assert.match(operationsSource, /canDelete \? <button className="danger"/);
  assert.match(operationsSource, /type="password"/);
  assert.match(operationsSource, /autoComplete="current-password"/);
  assert.match(operationsSource, /deleteName\.trim\(\) !== deleteTarget\.businessName/);
  assert.match(operationsSource, /password: deletePassword/);
  assert.match(operationsSource, /action: "delete_client"/);
});

test("the server verifies the current password and strips it before CRM execution", () => {
  assert.match(routeSource, /if \(input\.action === "delete_client"\)/);
  assert.match(routeSource, /verifyCurrentPassword\(user\.email, input\.password\)/);
  assert.match(routeSource, /signInWithPassword\(\{\s*email,\s*password,/);
  assert.match(routeSource, /persistSession: false/);
  assert.match(routeSource, /delete safeInput\.password/);
  assert.match(routeSource, /executeCrmAction\(user, safeInput\)/);
  assert.ok(
    routeSource.indexOf("verifyCurrentPassword(user.email, input.password)") <
      routeSource.indexOf("executeCrmAction(user, safeInput)"),
    "password verification runs before CRM execution",
  );
});