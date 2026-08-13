import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("landing page connects every public destination", () => {
  const source = read("app/page.tsx");
  for (const destination of [
    'href="/login"',
    'href="/privacy"',
    'href="/terms"',
    'href="#features"',
    'href="mailto:brizuelaleads@gmail.com"',
  ]) {
    assert.match(source, new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const destination of ["#platform", "#why", "#access"]) {
    assert.match(source, new RegExp(`href: "${destination}"`));
  }
  for (const section of ["platform", "features", "why", "access"]) {
    assert.match(source, new RegExp(`id="${section}"`));
  }
});

test("supplied UI direction and product content are implemented", () => {
  const source = read("app/page.tsx");
  const styles = read("app/landing.module.css");

  assert.match(source, /Run the business/);
  assert.match(source, /from one place\./);
  assert.match(source, /Everything your team needs to win\./);
  assert.match(source, /Pipeline that keeps deals moving/);
  assert.match(source, /Appointments that fill your calendar/);
  assert.match(styles, /grid-template-columns: 0\.9fr 1\.25fr/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 720px\)/);
});

test("landing page uses the real local dashboard asset", () => {
  const source = read("app/page.tsx");
  const dashboard = fs.statSync(path.join(root, "public/landing-dashboard-dark.webp"));
  assert.ok(dashboard.size > 50_000);
  assert.ok(dashboard.size < 250_000);
  assert.match(source, /src="\/landing-dashboard-dark\.webp"/);
  assert.match(source, /alt="BrizBuilder CRM dashboard/);
  assert.match(source, /width=\{1672\}/);
  assert.match(source, /height=\{941\}/);
  assert.doesNotMatch(source, /brizbuilder-dashboard\.png/);
});

test("landing page keeps the official shared BrizBuilder wordmark", () => {
  const source = read("app/page.tsx");
  assert.ok(source.match(/<BrandLogo/g)?.length >= 2);
  assert.doesNotMatch(source, />BRIZBUILDER<|site-logo-mark|>BB<|logo-mark/);
});

test("landing typography uses the existing licensed display families", () => {
  const layout = read("app/layout.tsx");
  const styles = read("app/landing.module.css");
  const packageJson = read("package.json");

  assert.match(layout, /@fontsource-variable\/archivo/);
  assert.match(layout, /@fontsource-variable\/big-shoulders/);
  assert.match(packageJson, /@fontsource-variable\/archivo/);
  assert.match(packageJson, /@fontsource-variable\/big-shoulders/);
  assert.match(styles, /var\(--font-landing-display\)/);
  assert.match(styles, /var\(--font-landing-condensed\)/);
  assert.match(styles, /--font-landing-display: "Archivo Variable"/);
  assert.match(styles, /--font-landing-condensed: "Big Shoulders Variable"/);
  assert.doesNotMatch(styles, /letter-spacing: -/);
});
