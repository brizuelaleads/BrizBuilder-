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
    'href="#features"',
    'href="#access"',
    'href="#about"',
    'href="mailto:brizuelaleads@gmail.com"',
  ]) {
    assert.match(source, new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const section of ["platform", "features", "access", "about"]) {
    assert.match(source, new RegExp(`id="${section}"`));
  }
});

test("landing page keeps the supplied structure with real BrizBuilder UI media", () => {
  const source = read("app/page.tsx");
  const styles = read("app/landing.module.css");
  const dashboard = fs.statSync(path.join(root, "public/landing-dashboard-dark.webp"));

  assert.ok(dashboard.size > 50_000);
  assert.ok(dashboard.size < 250_000);
  assert.match(source, /className=\{styles\.productStage\}/);
  assert.match(source, /className=\{styles\.heroProductImage\}/);
  assert.match(source, /src="\/landing-dashboard-dark\.webp"/);
  assert.match(source, /alt="BrizBuilder dark-mode CRM dashboard/);
  assert.match(source, /width=\{1672\}/);
  assert.match(source, /height=\{941\}/);
  assert.match(source, /productShowcases\.map/);
  assert.match(styles, /\.showcaseImageDashboard/);
  assert.match(styles, /\.showcaseImageSchedule/);
  assert.match(styles, /\.showcaseImageReporting/);
});

test("landing page keeps the official shared BrizBuilder wordmark", () => {
  const source = read("app/page.tsx");
  assert.match(source, /<BrandLogo/);
  assert.doesNotMatch(source, /site-logo-mark|>BB<|logo-mark/);
});

test("landing hero follows the supplied bold uppercase concept", () => {
  const styles = read("app/landing.module.css");

  assert.match(styles, /\.hero h1\s*{[^}]*font-family: Impact/s);
  assert.match(styles, /\.hero h1\s*{[^}]*font-size: clamp\(64px, 8\.4vw, 118px\)/s);
  assert.match(styles, /\.hero h1\s*{[^}]*line-height: 0\.88/s);
  assert.match(styles, /\.hero h1\s*{[^}]*text-transform: uppercase/s);
  assert.match(styles, /\.heroCopy\s*{[^}]*font-size: 16px/s);
});

test("landing page uses the supplied dark grid and purple access styling", () => {
  const styles = read("app/landing.module.css");

  assert.match(styles, /--bg: #070709/);
  assert.match(styles, /--panel: #0d0d12/);
  assert.match(styles, /--purple: #8b5cf6/);
  assert.match(styles, /\.pageShell\s*{[^}]*background:[\s\S]*48px 48px/s);
  assert.match(styles, /\.heroRingLeft/);
  assert.match(styles, /\.heroRingRight/);
  assert.match(styles, /\.primaryButton\s*{[^}]*linear-gradient\(180deg, #9566ff, #7743e8\)/s);
});
