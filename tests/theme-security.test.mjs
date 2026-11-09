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
const componentStyles = read("app/crm/design-system.css");
const migration = read("supabase/migrations/20260726053015_user_preferences.sql");
// The newest migration that rewrites the theme check is the one in force.
const themeCheckMigration = read("supabase/migrations/20261108000000_glass_theme.sql");
const glassStyles = read("app/crm/theme-glass.css");
const backdropMigration = read("supabase/migrations/20261108010000_glass_backdrop.sql");
const settingsSource = read("app/crm/OperationsViews.tsx");
const layoutSource = read("app/layout.tsx");

function themesFromTs() {
  const match = themeSource.match(/CRM_THEMES[^=]*=\s*\[([^\]]+)\]/);
  assert.ok(match, "CRM_THEMES literal exists in db/theme.ts");
  return match[1].match(/"([a-z]+)"/g).map((item) => item.replaceAll('"', ""));
}

function themesFromSql() {
  const match = themeCheckMigration.match(/check \(theme in \(([^)]+)\)\)/i);
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

test("the CRM theme comes only from the saved preference, never the browser", () => {
  assert.doesNotMatch(dashboardSource, /localStorage|THEME_STORAGE_KEY|cyberpunk/);
  assert.doesNotMatch(crmAppSource, /localStorage/);
  assert.match(crmAppSource, /data-ui="light"/);
  assert.match(crmAppSource, /crm-shell-view-\$\{view\}/);
  assert.doesNotMatch(crmAppSource, /themeOverride|switchTheme|crm-theme-picker/);
});

test("the redesigned CRM uses branded components and a charcoal sidebar", () => {
  assert.match(crmAppSource, /tone="light"/);
  assert.match(crmAppSource, /crm-design-system/);
  assert.match(componentStyles, /--crm-purple: var\(--crm-accent/);
  assert.match(componentStyles, /--crm-navy: #18181b/);
});

test("the bootstrap preference read is fault-isolated from the D1 fallback", () => {
  const block = supabaseSource.match(
    /let viewerTheme[\s\S]*?catch \(error\) \{[\s\S]*?\n {2}\}/,
  )?.[0];
  assert.ok(block, "prefs read wrapped in its own try/catch");
  assert.match(block, /from\("user_preferences"\)/);
  assert.match(block, /console\.error/);
});

test("Glass is an opt-in theme that leaves classic untouched", () => {
  assert.match(themeSource, /\{ id: "glass", label: "Glass" \}/);
  assert.match(crmAppSource, /useState<CrmTheme>\(initialData\.viewer\.theme\)/, "starts from the saved preference");
  assert.match(crmAppSource, /data-theme=\{theme === "glass" \? "glass" : undefined\}/, "classic keeps no data-theme");
  assert.match(crmAppSource, /action: "set_theme", theme: next/, "saves through the validated action");
  assert.match(layoutSource, /import "\.\/crm\/controls\.css";\r?\nimport "\.\/crm\/theme-glass\.css";/, "loads after the shared controls");
  for (const line of glassStyles.split(/\r?\n/).filter((l) => /^[.#][^{]*\{/.test(l) && !l.includes("crm-theme-switch") && !l.includes("crm-sidebar-foot") && !l.includes("crm-appearance") && !l.includes("crm-backdrop-image"))) {
    assert.match(line, /\[data-theme="glass"\]/, `glass rule is scoped to the glass theme: ${line.trim()}`);
  }
});

test("set_backdrop is validated, context-scoped, and mirrors set_theme", () => {
  const block = extractBlock(supabaseSource, 'if (action === "set_backdrop") {');
  assert.ok(block, "set_backdrop handler exists in db/supabase-crm.ts");
  assert.ok(block.indexOf("isCrmBackdrop(backdrop)") < block.indexOf('.from("user_preferences")'), "validated before writing");
  assert.match(block, /email: context\.email/);
  assert.deepEqual([...new Set(block.match(/input\.\w+/g) ?? [])], ["input.backdrop"]);
  const d1 = extractBlock(d1Source, 'if (action === "set_backdrop") {');
  assert.ok(d1, "D1 set_backdrop branch exists");
  assert.match(d1, /persisted: false/);
});

test("backdrop SQL check and CRM_BACKDROPS cannot drift apart", () => {
  const sql = backdropMigration.match(/check \(backdrop in \(([^)]+)\)\)/i)[1].match(/'([a-z-]+)'/g).map((v) => v.replaceAll("'", ""));
  const ts = [...themeSource.matchAll(/\{ id: "([a-z-]+)", label: "[^"]+", description:/g)].map((m) => m[1]);
  assert.deepEqual(sql.sort(), ts.sort());
  assert.match(backdropMigration, /default 'red'/);
  assert.match(themeSource, /DEFAULT_CRM_BACKDROP: CrmBackdrop = "red"/);
});

test("the backdrop read cannot break the theme read before the migration runs", () => {
  const block = supabaseSource.match(/let viewerTheme[\s\S]*?catch \(error\) \{/)?.[0];
  assert.ok(block);
  assert.match(block, /\.select\("\*"\)/, "selects * so a missing backdrop column is not an error");
  assert.match(block, /isCrmBackdrop\(preference\.backdrop\)/);
});

test("Settings offers the backdrop picker and Glass draws the chosen backdrop", () => {
  assert.match(settingsSource, /id: "appearance" as const, label: "Appearance"/);
  assert.match(settingsSource, /role="radiogroup" aria-label="Glass background"/);
  assert.match(crmAppSource, /<GlassBackdrop variant=\{backdrop\} \/>/);
  assert.match(crmAppSource, /action: "set_backdrop", backdrop: next/);
});

test("set_backdrop_blur is validated and context-scoped, and its SQL check matches", () => {
  const block = extractBlock(supabaseSource, 'if (action === "set_backdrop_blur") {');
  assert.ok(block, "set_backdrop_blur handler exists");
  assert.ok(block.indexOf("isCrmBackdropBlur(blur)") < block.indexOf('.from("user_preferences")'));
  assert.match(block, /email: context\.email/);
  assert.deepEqual([...new Set(block.match(/input\.\w+/g) ?? [])], ["input.blur"]);
  assert.match(extractBlock(d1Source, 'if (action === "set_backdrop_blur") {') ?? "", /persisted: false/);
  const sql = backdropMigration.match(/check \(backdrop_blur in \(([^)]+)\)\)/i)[1].match(/'([a-z]+)'/g).map((v) => v.replaceAll("'", ""));
  assert.deepEqual(sql.sort(), ["none", "soft", "strong"]);
});

test("Glass panels take their tint from the chosen backdrop", () => {
  assert.match(crmAppSource, /"--glass-tint": backdropTint\(backdrop\)/);
  assert.match(glassStyles, /rgb\(var\(--glass-tint, 14 11 12\) \/ 62%\)/);
  for (const match of themeSource.matchAll(/tint: "(\d+) (\d+) (\d+)"/g)) {
    const lightest = Math.max(+match[1], +match[2], +match[3]);
    assert.ok(lightest <= 40, `tint ${match[0]} stays dark enough for white text`);
  }
});
