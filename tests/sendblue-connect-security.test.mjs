import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const sendblueSource = read("lib/sendblue.ts");
const cryptoSource = read("lib/crypto.ts");
const crmSource = read("db/supabase-crm.ts");
const migration = read("supabase/migrations/20260725000000_sendblue_credentials.sql");
const workflowSource = read("app/crm/WorkflowViews.tsx");

test("Sendblue API client only ever targets api.sendblue.com with the documented key headers", () => {
  assert.match(sendblueSource, /const SENDBLUE_BASE_URL = "https:\/\/api\.sendblue\.co"/);
  assert.match(sendblueSource, /"sb-api-key-id": credentials\.apiKeyId/);
  assert.match(sendblueSource, /"sb-api-secret-key": credentials\.apiSecret/);
  // Keys are validated with a lightweight authenticated call.
  assert.match(sendblueSource, /checkSendblueAccount[\s\S]{0,200}sendblueApi<unknown>\(credentials, "\/api\/lines"\)/);
});

test("Sendblue errors never leak the raw response body (which can echo request context)", () => {
  const apiFn = sendblueSource.match(/async function sendblueApi<T>\([\s\S]*?\n}/)?.[0];
  assert.ok(apiFn, "sendblueApi exists");
  assert.match(apiFn, /Sendblue request failed \(\$\{response\.status\}\)/);
  assert.doesNotMatch(
    apiFn,
    /throw new Error\([^)]*await response\.(?:text|json)/,
    "must not put the raw response body into the thrown error",
  );
});

test("stored Sendblue secrets are AES-GCM encrypted and tenant-bound by organization + client", () => {
  // AAD binds ciphertext to one tenant so it cannot be replayed across clients.
  assert.match(
    sendblueSource,
    /`brizbuilder:sendblue:\$\{organizationId\}:\$\{clientId\}:v1`/,
  );
  assert.match(sendblueSource, /aesGcmEncrypt\(keyBytes, credentials\.apiKeyId, scope\)/);
  assert.match(sendblueSource, /aesGcmEncrypt\(keyBytes, credentials\.apiSecret, scope\)/);
  // The shared crypto helper uses AES-GCM with a 32-byte key and 12-byte IV.
  assert.match(cryptoSource, /name: "AES-GCM"/);
  assert.match(cryptoSource, /getRandomValues\(new Uint8Array\(12\)\)/);
  assert.match(cryptoSource, /bytes\.byteLength !== 32/);
});

test("the sendblue_credentials table is service-role only (no anon/authenticated access, no RLS policy)", () => {
  assert.match(migration, /create table if not exists public\.sendblue_credentials/i);
  assert.match(migration, /api_key_id_ciphertext text not null/i);
  assert.match(migration, /api_secret_ciphertext text not null/i);
  // No plaintext key columns.
  assert.doesNotMatch(
    migration,
    /^\s*(?:api_key_id|api_secret)\s+text/im,
    "keys must be stored only as *_ciphertext, never in plaintext columns",
  );
  assert.match(migration, /alter table public\.sendblue_credentials enable row level security/i);
  assert.match(migration, /revoke all on table public\.sendblue_credentials from anon, authenticated/i);
  // Tenant integrity: composite FK ties the row's client to its organization.
  assert.match(migration, /foreign key \(organization_id, client_id\)[\s\S]*references public\.clients\(organization_id, id\)/i);
});

test("connect_sendblue requires permission + client scope before storing, and only stores ciphertext", () => {
  const action = crmSource.match(
    /if \(action === "connect_sendblue"\) \{[\s\S]*?\n {2}\}\n/,
  )?.[0];
  assert.ok(action, "connect_sendblue handler exists");
  const permIndex = action.indexOf('requirePermission(context, "phone_system.manage")');
  const clientIndex = action.indexOf("requireClient(context, clientId)");
  const encryptIndex = action.indexOf("encryptSendblueCredentials");
  const storeIndex = action.indexOf('.from("sendblue_credentials")');
  assert.ok(permIndex >= 0, "permission checked");
  assert.ok(clientIndex > permIndex, "client access checked after permission");
  assert.ok(encryptIndex > clientIndex, "credentials encrypted after auth checks");
  assert.ok(storeIndex > encryptIndex, "only encrypted values are stored");
  assert.match(action, /api_secret_ciphertext: encrypted\.apiSecret\.ciphertext/);
  // The response never echoes the keys back to the browser.
  assert.match(action, /return \{\s*connected: true,\s*number:[\s\S]*hasNumber:[\s\S]*\};/);
  assert.doesNotMatch(action, /return[\s\S]{0,120}apiSecret/);
});

test("plaintext Sendblue keys are read only by the server-only loader that decrypts them", () => {
  // The ciphertext columns are selected in exactly one place: loadSendblueCredentials.
  const selects = crmSource.match(/api_key_id_ciphertext,api_key_id_iv/g) ?? [];
  assert.equal(selects.length, 1, "credentials are read in a single server-only helper");
  const loader = crmSource.match(/async function loadSendblueCredentials\([\s\S]*?\n}/)?.[0];
  assert.ok(loader, "loadSendblueCredentials exists");
  assert.match(loader, /decryptSendblueCredentials\(/);
  assert.match(loader, /\.eq\("organization_id", context\.organizationId\)/);
});

test("disconnecting Sendblue deletes the stored credentials", () => {
  const disconnect = crmSource.match(
    /if \(action === "disconnect_provider"\) \{[\s\S]*?return \{ disconnected: true \};/,
  )?.[0];
  assert.ok(disconnect, "disconnect_provider handler exists");
  assert.match(
    disconnect,
    /if \(provider === "sendblue"\) \{[\s\S]*\.from\("sendblue_credentials"\)\s*\.delete\(\)/,
  );
  assert.match(disconnect, /provider !== "sendblue"/, "sendblue is an allowed provider");
});

test("the Connections UI never renders stored keys and submits the secret as a password field", () => {
  assert.match(workflowSource, /action: "connect_sendblue", clientId, apiKeyId, apiSecret/);
  assert.match(workflowSource, /name="apiSecret"\s*\n\s*type="password"/);
  // The card reads only safe connection fields, never a credential.
  assert.doesNotMatch(workflowSource, /sendblueConnection\?\.(?:apiSecret|apiKeyId|ciphertext)/);
});
