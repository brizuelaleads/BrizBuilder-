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

test("landing page uses the real dashboard as its product visual", () => {
  const source = read("app/page.tsx");
  const dashboard = fs.statSync(path.join(root, "public/landing-dashboard-dark.webp"));
  assert.ok(dashboard.size > 50_000);
  assert.ok(dashboard.size < 250_000);
  assert.ok(source.match(/src="\/landing-dashboard-dark\.webp"/g)?.length >= 2);
  assert.match(source, /alt="BrizBuilder dark-mode dashboard/);
  assert.match(source, /width=\{1672\}/);
  assert.match(source, /height=\{941\}/);
});

test("landing page keeps the official shared BrizBuilder wordmark", () => {
  const source = read("app/page.tsx");
  assert.ok(source.match(/<BrandLogo/g)?.length >= 2);
  assert.doesNotMatch(source, /site-logo-mark|>BB<|logo-mark/);
});

test("editorial landing direction stays split, restrained, and responsive", () => {
  const source = read("app/page.tsx");
  const styles = read("app/landing.module.css");

  assert.match(source, /Run the business/);
  assert.match(source, /from one place\./);
  assert.match(styles, /grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
  assert.match(styles, /font-family: "Instrument Serif", Georgia, serif/);
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /\.productGrid[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(styles, /-webkit-mask-image:/);
  assert.doesNotMatch(styles, /font-weight: (?:7|8|9)00/);
  assert.doesNotMatch(styles, /border-radius: 999/);
  assert.doesNotMatch(source, /ambientLight|gridBackground|featureNumber/);
  assert.match(styles, /\.heroCopyBlock[\s\S]*grid-row: 1/);
  assert.match(styles, /\.heroVisual[\s\S]*grid-row: 1/);
  assert.match(styles, /\.button\.primaryButton[\s\S]*color: #111/);
});

test("landing typography reuses the app serif and sans without extra font packages", () => {
  const layout = read("app/layout.tsx");
  const styles = read("app/landing.module.css");
  const packageJson = read("package.json");

  assert.match(layout, /Instrument_Serif/);
  assert.match(layout, /Geist/);
  assert.match(styles, /"Instrument Serif", Georgia, serif/);
  assert.match(styles, /var\(--font-sans\)/);
  assert.doesNotMatch(layout, /@fontsource-variable/);
  assert.doesNotMatch(packageJson, /@fontsource-variable/);
});
