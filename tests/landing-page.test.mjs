import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("new landing page connects every public destination", () => {
  const source = read("app/page.tsx");
  for (const destination of [
    'href="/login"',
    'href="/privacy"',
    'href="/terms"',
    'href="#platform"',
    'href="#why"',
    'href="#access"',
    'href="mailto:brizuelaleads@gmail.com"',
  ]) {
    assert.match(source, new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const section of ["platform", "why", "access"]) {
    assert.match(source, new RegExp(`id="${section}"`));
  }
});

test("landing dashboard is a real local asset with accessible copy", () => {
  const source = read("app/page.tsx");
  const dashboard = fs.statSync(path.join(root, "public/landing-dashboard-dark.webp"));
  assert.ok(dashboard.size > 50_000);
  assert.ok(dashboard.size < 250_000);
  assert.match(source, /src="\/landing-dashboard-dark\.webp"/);
  assert.match(source, /alt="BrizBuilder dark-mode dashboard/);
  assert.match(source, /width=\{1672\}/);
  assert.match(source, /height=\{941\}/);
});

test("landing page keeps the official shared BrizBuilder wordmark", () => {
  const source = read("app/page.tsx");
  assert.match(source, /<BrandLogo/);
  assert.doesNotMatch(source, /site-logo-mark|>BB<|logo-mark/);
});

test("landing typography uses licensed open-source display families", () => {
  const layout = read("app/layout.tsx");
  const styles = read("app/landing.module.css");
  const packageJson = read("package.json");

  assert.match(layout, /@fontsource-variable\/archivo\/wdth\.css/);
  assert.match(layout, /@fontsource-variable\/big-shoulders\/wght\.css/);
  assert.match(packageJson, /@fontsource-variable\/archivo/);
  assert.match(packageJson, /@fontsource-variable\/big-shoulders/);
  assert.match(styles, /--font-landing-display: "Archivo Variable"/);
  assert.match(styles, /--font-landing-condensed: "Big Shoulders Variable"/);
  assert.match(styles, /var\(--font-landing-display\)/);
  assert.match(styles, /var\(--font-landing-condensed\)/);
});

test("landing redesign stays product-led and avoids the old template treatments", () => {
  const source = read("app/page.tsx");
  const styles = read("app/landing.module.css");

  assert.match(source, /01 \/ Command center/);
  assert.match(source, /02 \/ Everything in one place/);
  assert.match(source, /03 \/ Operating principle/);
  assert.match(source, /04 \/ Private access/);
  assert.match(source, /Private access for LB Marketing clients and team members/);
  assert.doesNotMatch(source, /ambientLight|dashboardFrame|featureGrid|Learn more/);
  assert.doesNotMatch(styles, /filter:\s*blur|border-radius:\s*999px|font-weight:\s*900/);
});

test("landing page defines a restrained reusable token system", () => {
  const styles = read("app/landing.module.css");

  for (const token of [
    "--landing-bg",
    "--landing-surface",
    "--landing-text",
    "--landing-secondary",
    "--landing-border",
    "--landing-purple",
    "--space-4",
    "--space-8",
    "--space-16",
    "--space-24",
  ]) {
    assert.match(styles, new RegExp(token));
  }

  assert.match(styles, /width: min\(1220px, calc\(100% - 48px\)\)/);
  assert.match(styles, /overflow-x: clip/);
});
