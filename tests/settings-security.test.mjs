import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
// Line endings are normalized so the block patterns behave the same on a CRLF
// checkout as on LF.
const read = (rel) =>
  fs.readFileSync(path.join(root, rel), "utf8").replaceAll("\r\n", "\n");
const d1Source = read("db/crm.ts");
const supabaseSource = read("db/supabase-crm.ts");
const settingsSource = read("app/crm/SettingsView.tsx");

function updateClientBlock(source) {
  const block = source.match(/if \(action === "update_client"\) \{[\s\S]*?\n {2}\}\n/)?.[0];
  assert.ok(block, "update_client handler exists");
  return block;
}

test("editing a business needs clients.manage and a business the caller can open", () => {
  for (const source of [d1Source, supabaseSource]) {
    const block = updateClientBlock(source);
    const write = block.search(/\.update\(|UPDATE crm_clients/);
    assert.ok(write >= 0, "the write exists");
    // Both checks run before anything is written.
    assert.ok(block.indexOf('requirePermission(context, "clients.manage")') >= 0);
    assert.ok(block.indexOf('requirePermission(context, "clients.manage")') < write);
    assert.ok(block.indexOf("await requireClient(context, clientId)") >= 0, "a browser-supplied id is checked");
    assert.ok(block.indexOf("await requireClient(context, clientId)") < write);
  }
});

test("the business write is pinned to the caller's organization and audited", () => {
  const supabaseBlock = updateClientBlock(supabaseSource);
  assert.match(supabaseBlock, /\.eq\("id", clientId\)\s*\.eq\("organization_id", context\.organizationId\)/);
  assert.match(supabaseBlock, /audit\(context, "client\.updated", "client", clientId\)/);
  // Only profile fields are writable: never status, slug or the organization.
  assert.doesNotMatch(supabaseBlock, /organization_id:|status:|slug:/);
  const d1Block = updateClientBlock(d1Source);
  assert.match(d1Block, /WHERE id = \? AND organization_id = \?/);
  assert.match(d1Block, /audit\(context, "client\.updated", "client", clientId\)/);
});

test("Settings saves only through permission-checked server actions", () => {
  // Every write in the Settings tab goes through mutate to /api/crm.
  const actions = [...settingsSource.matchAll(/action: "([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(actions)], ["change_own_password", "remove_client_logo", "update_client", "upload_client_logo"]);
  assert.doesNotMatch(settingsSource, /fetch\(/, "no direct requests from Settings");
  // The password is checked in the browser too: 12 characters and confirmed.
  assert.match(settingsSource, /const ready = password\.length >= 12 && confirm === password;/);
  // Business details are read-only without the permission.
  assert.match(settingsSource, /<fieldset disabled=\{!canEdit \|\| busy\}>/);
  assert.match(settingsSource, /canEdit=\{can\("clients\.manage"\)\}/);
});

test("logo uploads are gated, checked as real images, and stored per business", () => {
  const block = supabaseSource.match(/if \(action === "upload_client_logo"\) \{[\s\S]*?\n {2}\}\n/)?.[0];
  assert.ok(block, "upload_client_logo handler exists");
  const store = block.indexOf(".upload(path, bytes");
  assert.ok(store > 0, "the upload exists");
  // Permission and tenant checks come before anything is stored.
  assert.ok(block.indexOf('requirePermission(context, "clients.manage")') < store);
  assert.ok(block.indexOf("await requireClient(context, clientId)") < store);
  // Only PNG, JPEG or WebP, confirmed by their file signatures; never SVG.
  assert.ok(block.includes(String.raw`data:image\/(png|jpeg|webp);base64`));
  assert.doesNotMatch(block.match(/image\.match\([^\n]*/)?.[0] ?? "", /svg/i, "SVG is not an accepted type");
  for (const signature of ["isPng", "isJpeg", "isWebp"]) assert.ok(block.includes(signature), `${signature} is checked`);
  assert.ok(block.includes("bytes.length > 300_000"), "size is capped below the API body limit");
  // Stored under this organization and business, never overwriting a file.
  assert.ok(block.includes("logos/${context.organizationId}/${clientId}/${crypto.randomUUID()}"));
  assert.ok(block.includes("upsert: false"));
  assert.ok(block.includes('audit(context, "client_branding.logo_uploaded"'));
  const remove = supabaseSource.match(/if \(action === "remove_client_logo"\) \{[\s\S]*?\n {2}\}\n/)?.[0];
  assert.ok(remove && remove.indexOf("requireClient") < remove.indexOf("saveClientBranding"));
});
