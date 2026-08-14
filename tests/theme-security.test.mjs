import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const supabaseSource = read("db/supabase-crm.ts");
const d1Source = read("db/crm.ts");
const themeSource = read("db/theme.ts");
const crmAppSource = read("app/CrmApp.tsx");
const dashboardSource = read("app/crm/DashboardView.tsx");
const styles = read("app/globals.css");
const migration = read("supabase/migrations/20260726000000_user_preferences.sql");

function themesFromTs() {
  const match = themeSource.match(/CRM_THEMES[^=]*=\s*\[([^\]]+)\]/);
  assert.ok(match, "CRM_THEMES literal exists in db/theme.ts");
  return match[1].match(/"([a-z]+)"/g).map((item) => item.replaceAll('"', ""));
}

function themesFromSql() {
  const match = migration.match(/check \(theme in \(([^)]+)\)\)/i);
  assert.ok(match, "theme check constraint exists in the migration");
  return match[1].match(/'([a-z]+)'/g).map((item) => item.replaceAll("'", ""));
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

test("set_theme validates against the shared allowlist before writing", () => {
  const block = extractBlock(supabaseSource, 'if (action === "set_theme") {');
  assert.ok(block, "set_theme handler exists in db/supabase-crm.ts");
  const validateIndex = block.indexOf("CRM_THEMES.includes(theme)");
  const writeIndex = block.indexOf('.from("user_preferences")');
  assert.ok(validateIndex >= 0, "allowlist validation present");
  assert.ok(writeIndex > validateIndex, "write happens only after validation");
});

test("set_theme identity comes only from the authenticated context", () => {
  const block = extractBlock(supabaseSource, 'if (action === "set_theme") {');
  assert.ok(block, "set_theme handler exists");
  assert.match(block, /email: context\.email/);
  assert.doesNotMatch(block, /input\.email/, "must never trust a client-supplied email");
  const inputReads = block.match(/input\.\w+/g) ?? [];
  assert.deepEqual(
    [...new Set(inputReads)].sort(),
    ["input.theme"],
    "the only client-controlled field read is the theme value",
  );
});

test("user_preferences is service-role only with RLS enabled", () => {
  assert.match(migration, /alter table public\.user_preferences enable row level security/i);
  assert.match(migration, /revoke all on table public\.user_preferences from anon, authenticated/i);
  assert.match(migration, /email text primary key check \(email = lower\(email\)\)/i);
});

test("SQL check constraint and CRM_THEMES cannot drift apart", () => {
  assert.deepEqual(themesFromSql().sort(), [...themesFromTs()].sort());
});

test("D1 fallback has viewer theme parity and a validated set_theme branch", () => {
  assert.match(d1Source, /theme: "classic"/, "D1 viewer supplies a default theme");
  const block = extractBlock(d1Source, 'if (action === "set_theme") {');
  assert.ok(block, "D1 set_theme branch exists");
  assert.match(block, /CRM_THEMES\.includes\(theme\)/);
  assert.match(block, /persisted: false/, "D1 branch is an honest validated no-op");
});

test("the localStorage pilot is fully removed and theme derives from the viewer", () => {
  assert.doesNotMatch(dashboardSource, /localStorage|THEME_STORAGE_KEY|cyberpunk/);
  assert.doesNotMatch(crmAppSource, /localStorage/);
  assert.match(crmAppSource, /data-theme=\{theme === "classic" \? undefined : theme\}/);
  assert.match(crmAppSource, /themeOverride \?\? data\.viewer\.theme \?\? "classic"/);
});

test("midnight is the selectable dark CRM theme with dark surfaces", () => {
  assert.match(crmAppSource, /tone=\{theme === "classic" \? "dark" : "light"\}/);
  assert.match(crmAppSource, /\? "Dark"/);
  assert.match(styles, /\.crm-shell\[data-theme="midnight"\]\s*\{[\s\S]*--crm-canvas: #090b0a/);
  assert.match(styles, /\.crm-shell\[data-theme="midnight"\]\s*:is\([\s\S]*\.crm-modal/);
  assert.match(styles, /\.crm-shell\[data-theme="midnight"\]\s*:is\([\s\S]*\.crm-table-panel/);
});

test("the bootstrap preference read is fault-isolated from the D1 fallback", () => {
  const block = supabaseSource.match(
    /let viewerTheme[\s\S]*?catch \(error\) \{[\s\S]*?\n {2}\}/,
  )?.[0];
  assert.ok(block, "prefs read wrapped in its own try/catch");
  assert.match(block, /from\("user_preferences"\)/);
  assert.match(block, /console\.error/);
});
