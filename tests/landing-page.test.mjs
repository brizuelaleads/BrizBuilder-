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

test("landing hero uses the requested wide display face while body copy stays in Geist", () => {
  const layout = read("app/layout.tsx");
  const styles = read("app/landing.module.css");
  const packageJson = read("package.json");

  assert.match(layout, /Geist/);
  assert.match(layout, /@fontsource-variable\/anybody\/wdth\.css/);
  assert.match(packageJson, /@fontsource-variable\/anybody/);
  assert.match(styles, /\.hero h1\s*{[^}]*font-family: "Anybody Variable"/s);
  assert.match(styles, /\.hero h1\s*{[^}]*max-width: 980px/s);
  assert.match(styles, /\.hero h1\s*{[^}]*font-weight: 720/s);
  assert.match(styles, /\.hero h1\s*{[^}]*font-variation-settings: "wdth" 112, "wght" 720/s);
  assert.match(styles, /\.hero h1\s*{[^}]*letter-spacing: 0/s);
  assert.doesNotMatch(styles, /\.hero h1\s*{[^}]*text-transform: uppercase/s);
  assert.match(styles, /\.heroCopy\s*{[^}]*font-size: 16px/s);
});

test("landing hero layers the product artwork with the existing line pattern", () => {
  const source = read("app/page.tsx");
  const styles = read("app/landing.module.css");

  assert.match(source, /className=\{styles\.heroBackdrop\}/);
  assert.match(source, /className=\{styles\.heroVeil\}/);
  assert.match(source, /className=\{styles\.heroPattern\}/);
  assert.match(styles, /\.heroBackdrop\s*{[^}]*position: absolute/s);
  assert.match(styles, /\.heroPattern\s*{[^}]*background-image:/s);
  assert.match(styles, /\.heroPattern\s*{[^}]*background-size: 60px 60px/s);
  assert.doesNotMatch(source, /className=\{styles\.dashboardFrame\}/);
});

test("landing page uses a black noir palette without purple lighting", () => {
  const styles = read("app/landing.module.css");

  assert.match(styles, /--landing-bg: #030303/);
  assert.match(styles, /--landing-panel: #0a0a0a/);
  assert.match(styles, /\.ambientLight\s*{\s*display: none/);
  assert.match(styles, /\.pageShell \.primaryButton\s*{[^}]*background: #7862ad/s);
  assert.doesNotMatch(styles, /#b995ff|#c8aaff|#a47bff|#9a84d8|153 113 255|185 149 255/);
});
