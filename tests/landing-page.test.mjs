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
