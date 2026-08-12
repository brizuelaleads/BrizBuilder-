import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("official BrizBuilder logo assets are available for every surface", () => {
  for (const rel of [
    "public/brand/brizbuilder-wordmark-white.png",
    "public/brand/brizbuilder-wordmark-dark.png",
    "public/brand/brizbuilder-mark-white.png",
    "public/brand/brizbuilder-mark-dark.png",
    "public/brand/brizbuilder-icon.png",
    "app/icon.png",
    "app/apple-icon.png",
  ]) {
    const stat = fs.statSync(path.join(root, rel));
    assert.ok(stat.size > 1_000, `${rel} contains a real image asset`);
  }
});

test("shared brand component replaces legacy BB placeholders", () => {
  const component = read("app/components/BrandLogo.tsx");
  assert.match(component, /brizbuilder-\$\{variant\}-\$\{color\}\.png/);
  assert.match(component, /tone === "light" \? "white" : "dark"/);

  for (const rel of [
    "app/page.tsx",
    "app/auth/AuthShell.tsx",
    "app/CrmApp.tsx",
    "app/ClientPortal.tsx",
    "app/privacy/page.tsx",
    "app/terms/page.tsx",
    "app/oauth/authorize/page.tsx",
  ]) {
    assert.match(read(rel), /BrandLogo/, `${rel} uses the official logo component`);
  }

  assert.doesNotMatch(read("app/page.tsx"), /site-logo-mark|>BB</);
  assert.doesNotMatch(read("app/auth/AuthShell.tsx"), />BB</);
  assert.doesNotMatch(read("app/oauth/authorize/page.tsx"), /brandMark|>BB</);
});

test("transactional email templates include the hosted official wordmark", () => {
  const emailSource = read("lib/system-email.ts");
  assert.match(emailSource, /APP_BASE_URL/);
  assert.match(emailSource, /brizbuilder-wordmark-white\.png/);
  assert.match(emailSource, /alt=\"BrizBuilder\"/);
});
