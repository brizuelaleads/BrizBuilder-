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
  assert.match(layout, /@fontsource\/archivo-black/);
  assert.match(packageJson, /@fontsource-variable\/archivo/);
  assert.match(packageJson, /@fontsource-variable\/big-shoulders/);
  assert.match(packageJson, /@fontsource\/archivo-black/);
  assert.match(styles, /--font-landing-display: "Archivo Variable"/);
  assert.match(styles, /--font-landing-condensed: "Big Shoulders Variable"/);
  assert.match(styles, /--font-landing-hero: "Archivo Black"/);
  assert.match(styles, /var\(--font-landing-display\)/);
  assert.match(styles, /var\(--font-landing-condensed\)/);
  assert.match(styles, /\.hero h1\s*{[^}]*font-family: var\(--font-landing-hero\)/s);
});

test("landing page uses a black noir palette without purple lighting", () => {
  const styles = read("app/landing.module.css");

  assert.match(styles, /--landing-bg: #030303/);
  assert.match(styles, /--landing-panel: #0a0a0a/);
  assert.match(styles, /\.ambientLight\s*{\s*display: none/);
  assert.match(styles, /\.pageShell \.primaryButton\s*{[^}]*color: #090909[^}]*background: #f2f2ee/s);
  assert.doesNotMatch(styles, /#b995ff|#c8aaff|#a47bff|#9a84d8|153 113 255|185 149 255/);
});
