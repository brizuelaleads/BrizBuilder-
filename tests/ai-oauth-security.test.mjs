import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyRefreshTokenUse,
  createPkceS256Challenge,
  isExactOAuthResource,
  isOneTimeCredentialUsable,
  isPkceS256Challenge,
  isPkceVerifier,
  isSafeOAuthClientName,
  verifyPkceS256,
} from "../lib/ai-connector/oauth-policy.ts";
import { applyAiConsentSecurityHeaders } from "../lib/ai-connector/http-security.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oauthSource = fs.readFileSync(
  path.join(root, "lib/ai-connector/oauth.ts"),
  "utf8",
);
const proxySource = fs.readFileSync(path.join(root, "proxy.ts"), "utf8");

test("PKCE accepts only RFC 7636 S256 values and rejects a verifier mismatch", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  assert.equal(isPkceVerifier(verifier), true);
  assert.equal(isPkceS256Challenge(challenge), true);
  assert.equal(await createPkceS256Challenge(verifier), challenge);
  assert.equal(await verifyPkceS256(verifier, challenge), true);
  assert.equal(
    await verifyPkceS256(
      "0123456789012345678901234567890123456789012",
      challenge,
    ),
    false,
  );
  assert.equal(isPkceVerifier("too-short"), false);
  assert.equal(isPkceS256Challenge(`${challenge}=`), false);
  assert.match(oauthSource, /code_challenge_method[\s\S]{0,120}!== "S256"/);
  assert.match(oauthSource, /codeRow\.code_challenge_method !== "S256"/);
});

test("unverified OAuth app names reject control and Unicode format-control characters", () => {
  assert.equal(isSafeOAuthClientName("Asistente Ágil"), true);
  assert.equal(isSafeOAuthClientName("Trusted\nApp"), false);
  for (const deceptiveName of [
    "Trusted\u202EApp",
    "Safe\u200BName",
    "AI\u2066App",
  ]) {
    assert.equal(isSafeOAuthClientName(deceptiveName), false);
  }
  assert.equal(isSafeOAuthClientName("A".repeat(101)), false);
  assert.match(oauthSource, /isSafeOAuthClientName\(text\)/);
});

test("OAuth resource binding requires the exact MCP URL", () => {
  const resource = "https://brizbuilder.brizuelaleads.workers.dev/mcp";

  assert.equal(isExactOAuthResource(resource, resource), true);
  assert.equal(isExactOAuthResource(`${resource}/`, resource), false);
  assert.equal(
    isExactOAuthResource("https://brizbuilder-agency.rhkfgqqn2r.chatgpt.site/mcp", resource),
    false,
  );
  assert.equal(isExactOAuthResource("https://brizbuilder.brizuelaleads.workers.dev/", resource), false);
  assert.equal(isExactOAuthResource(undefined, resource), false);
  assert.match(oauthSource, /isExactOAuthResource\(value, AI_CONNECTOR_RESOURCE\)/);
  assert.match(oauthSource, /codeRow\.resource !== resource/);
  assert.match(oauthSource, /refreshRow\.resource !== resource/);
});

test("consent requests and authorization codes are usable only once and before expiry", () => {
  const now = Date.parse("2026-07-22T12:00:00.000Z");
  const future = "2026-07-22T12:05:00.000Z";
  const past = "2026-07-22T11:59:59.999Z";

  assert.equal(
    isOneTimeCredentialUsable({ consumedAt: null, expiresAt: future }, now),
    true,
  );
  assert.equal(
    isOneTimeCredentialUsable({ consumedAt: "2026-07-22T11:58:00.000Z", expiresAt: future }, now),
    false,
  );
  assert.equal(
    isOneTimeCredentialUsable({ consumedAt: null, expiresAt: past }, now),
    false,
  );
  assert.equal(
    isOneTimeCredentialUsable({ consumedAt: null, expiresAt: "not-a-date" }, now),
    false,
  );

  const atomicConsumeGuards = oauthSource.match(/\.is\("consumed_at", null\)/g) ?? [];
  assert.equal(atomicConsumeGuards.length, 2);
  assert.match(oauthSource, /if \(!consumed\)[\s\S]{0,180}already (?:been )?used/);
});

test("refresh tokens rotate once and reuse revokes the authorization family", () => {
  const now = Date.parse("2026-07-22T12:00:00.000Z");
  const future = "2026-08-22T12:00:00.000Z";

  assert.equal(
    classifyRefreshTokenUse({ rotatedAt: null, revokedAt: null, expiresAt: future }, now),
    "accept",
  );
  assert.equal(
    classifyRefreshTokenUse({
      rotatedAt: "2026-07-22T11:00:00.000Z",
      revokedAt: null,
      expiresAt: future,
    }, now),
    "reuse",
  );
  assert.equal(
    classifyRefreshTokenUse({
      rotatedAt: null,
      revokedAt: "2026-07-22T11:00:00.000Z",
      expiresAt: future,
    }, now),
    "invalid",
  );
  assert.equal(
    classifyRefreshTokenUse({
      rotatedAt: null,
      revokedAt: null,
      expiresAt: "2026-07-22T11:59:59.999Z",
    }, now),
    "invalid",
  );

  assert.match(
    oauthSource,
    /\.is\("rotated_at", null\)[\s\S]{0,100}\.is\("revoked_at", null\)/,
  );
  assert.match(
    oauthSource,
    /refreshDecision === "reuse"[\s\S]{0,180}revokeAuthorizationFamily/,
  );
  assert.match(
    oauthSource,
    /if \(!rotated\)[\s\S]{0,180}revokeAuthorizationFamily/,
  );

  const revokeStart = oauthSource.indexOf("async function revokeAuthorizationFamily");
  const parentRevoke = oauthSource.indexOf(".from(TOKEN_TABLES.authorizations)", revokeStart);
  const childCleanup = oauthSource.indexOf("await Promise.all", revokeStart);
  assert.ok(revokeStart >= 0 && parentRevoke > revokeStart && childCleanup > parentRevoke);
});

test("redirect, duplicate-parameter, and refresh-scope guards remain fail closed", () => {
  assert.match(oauthSource, /url\.protocol !== "https:"/);
  assert.match(oauthSource, /url\.username/);
  assert.match(oauthSource, /url\.password/);
  assert.match(oauthSource, /url\.hash/);
  assert.match(oauthSource, /client\.redirect_uris\.includes\(redirectUri\)/);
  assert.match(oauthSource, /codeRow\.redirect_uri !== redirectUri/);
  assert.match(oauthSource, /form\.getAll\(name\)/);
  assert.match(oauthSource, /must appear only once/);
  assert.match(
    oauthSource,
    /scopes\.some\(\(scope\) => !currentScopes\.includes\(scope\)\)/,
  );
  assert.match(oauthSource, /A refresh request cannot add permissions/);
});

test("the consent page is non-cacheable and cannot be framed", () => {
  const response = applyAiConsentSecurityHeaders(new Response());

  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(proxySource, /request\.nextUrl\.pathname === "\/oauth\/authorize"/);
  assert.match(proxySource, /applyAiConsentSecurityHeaders\(response\)/);
});
