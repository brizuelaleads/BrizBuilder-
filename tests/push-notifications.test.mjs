import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  audienceFor,
  base64UrlDecode,
  base64UrlEncode,
  createVapidAuthorization,
  encryptPushPayload,
  MAX_PUSH_PAYLOAD_BYTES,
} from "../lib/web-push.ts";
import { base64UrlToUint8Array } from "../lib/push-client.ts";
import {
  DEFAULT_BRANDING,
  NOTIFICATION_KEYS,
  NOTIFICATION_LABELS,
  NOTIFICATION_DESCRIPTIONS,
  normalizeNotifications,
  normalizeThresholds,
  HOT_LEAD_SCORE_MAX,
  STALE_LEAD_HOURS_MAX,
} from "../db/branding.ts";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (rel) =>
  fs.readFileSync(path.join(root, rel), "utf8").replaceAll("\r\n", "\n");

const migration = read("supabase/migrations/20260827140000_push_notifications.sql");
const concurrencyMigration = read(
  "supabase/migrations/20260829120000_production_readiness_concurrency.sql",
);
const pushStore = read("db/supabase-push.ts");
const dispatcher = read("lib/push-notifications.ts");
const sweeps = read("lib/notification-sweeps.ts");
const subscribeRoute = read("app/api/push/subscribe/route.ts");
const serviceWorker = read("public/sw.js");
const optIn = read("app/components/PushOptIn.tsx");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* -------------------------------------------------------------------------
 * RFC 8291 payload encryption, verified by decrypting as the subscriber
 * ---------------------------------------------------------------------- */

/** Stands in for a browser creating a push subscription. */
async function makeSubscriber() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const publicRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return {
    keyPair,
    publicRaw,
    authSecret,
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      p256dh: base64UrlEncode(publicRaw),
      auth: base64UrlEncode(authSecret),
    },
  };
}

async function hkdf(ikm, salt, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info },
      key,
      length * 8,
    ),
  );
}

function concat(...chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** The subscriber half of RFC 8291, written independently of the sender. */
async function decryptAsSubscriber(subscriber, body) {
  const salt = body.slice(0, 16);
  const keyIdLength = body[20];
  const serverPublic = body.slice(21, 21 + keyIdLength);
  const ciphertext = body.slice(21 + keyIdLength);

  const serverKey = await crypto.subtle.importKey(
    "raw",
    serverPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: serverKey },
      subscriber.keyPair.privateKey,
      256,
    ),
  );

  const keyInfo = concat(
    encoder.encode("WebPush: info"),
    new Uint8Array([0]),
    subscriber.publicRaw,
    serverPublic,
  );
  const ikm = await hkdf(shared, subscriber.authSecret, keyInfo, 32);
  const cek = await hkdf(
    ikm,
    salt,
    concat(encoder.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])),
    16,
  );
  const nonce = await hkdf(
    ikm,
    salt,
    concat(encoder.encode("Content-Encoding: nonce"), new Uint8Array([0])),
    12,
  );

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "decrypt",
  ]);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      key,
      ciphertext,
    ),
  );
  // Strip the 0x02 final-record delimiter.
  assert.equal(plaintext[plaintext.length - 1], 2, "record delimiter is present");
  return decoder.decode(plaintext.slice(0, -1));
}

test("an encrypted payload can be decrypted by the subscriber it was sealed to", async () => {
  const subscriber = await makeSubscriber();
  const message = JSON.stringify({ title: "New lead", body: "Acme — Drain clearing" });

  const body = await encryptPushPayload(subscriber.subscription, message);
  assert.equal(await decryptAsSubscriber(subscriber, body), message);
});

test("the encrypted body follows the aes128gcm header layout", async () => {
  const subscriber = await makeSubscriber();
  const body = await encryptPushPayload(subscriber.subscription, "hello");

  const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16, false);
  assert.equal(recordSize, 4096, "record size is declared");
  assert.equal(body[20], 65, "key id length is the uncompressed point length");
  assert.equal(body[21], 0x04, "server key is an uncompressed P-256 point");
  // 16 salt + 4 record size + 1 length + 65 key + ciphertext(5 + 1 delimiter + 16 tag)
  assert.equal(body.length, 16 + 4 + 1 + 65 + 22);
});

test("a different subscriber cannot read another's payload", async () => {
  const intended = await makeSubscriber();
  const other = await makeSubscriber();
  const body = await encryptPushPayload(intended.subscription, "secret");

  await assert.rejects(() => decryptAsSubscriber(other, body));
});

test("every send uses a fresh server key and salt", async () => {
  const subscriber = await makeSubscriber();
  const first = await encryptPushPayload(subscriber.subscription, "same message");
  const second = await encryptPushPayload(subscriber.subscription, "same message");

  assert.notDeepEqual(first.slice(0, 16), second.slice(0, 16), "salt differs");
  assert.notDeepEqual(first.slice(21, 86), second.slice(21, 86), "server key differs");
});

test("malformed subscription keys are refused before any crypto runs", async () => {
  const subscriber = await makeSubscriber();
  await assert.rejects(
    () =>
      encryptPushPayload(
        { ...subscriber.subscription, p256dh: base64UrlEncode(new Uint8Array(10)) },
        "x",
      ),
    /65-byte uncompressed point/,
  );
  await assert.rejects(
    () =>
      encryptPushPayload(
        { ...subscriber.subscription, auth: base64UrlEncode(new Uint8Array(4)) },
        "x",
      ),
    /auth secret must be 16 bytes/,
  );
});

/* -------------------------------------------------------------------------
 * VAPID
 * ---------------------------------------------------------------------- */

async function makeVapidKeys() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );
  return {
    verifyKey: keyPair.publicKey,
    keys: {
      publicKey: base64UrlEncode(publicRaw),
      privateKey: jwk.d,
      subject: "mailto:alerts@example.com",
    },
  };
}

test("the VAPID header carries a JWT that verifies against the public key", async () => {
  const { keys, verifyKey } = await makeVapidKeys();
  const header = await createVapidAuthorization(
    keys,
    "https://fcm.googleapis.com",
    1_800_000_000,
  );

  const match = header.match(/^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/);
  assert.ok(match, "header is the RFC 8292 vapid form");
  assert.equal(match[2], keys.publicKey, "the sending key is advertised");

  const [encodedHeader, encodedClaims, encodedSignature] = match[1].split(".");
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    verifyKey,
    base64UrlDecode(encodedSignature),
    encoder.encode(`${encodedHeader}.${encodedClaims}`),
  );
  assert.ok(verified, "signature verifies with the advertised key");

  assert.deepEqual(JSON.parse(decoder.decode(base64UrlDecode(encodedHeader))), {
    typ: "JWT",
    alg: "ES256",
  });
  const claims = JSON.parse(decoder.decode(base64UrlDecode(encodedClaims)));
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "mailto:alerts@example.com");
  assert.ok(
    claims.exp > 1_800_000_000 && claims.exp <= 1_800_000_000 + 24 * 3600,
    "expiry is inside the RFC's 24-hour ceiling",
  );
});

test("the audience is the push service origin, never the full endpoint", () => {
  assert.equal(
    audienceFor("https://fcm.googleapis.com/fcm/send/abc?x=1"),
    "https://fcm.googleapis.com",
  );
  assert.equal(
    audienceFor("https://updates.push.services.mozilla.com/wpush/v2/xyz"),
    "https://updates.push.services.mozilla.com",
  );
});

test("base64url survives a round trip in both the server and client helpers", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(65));
  const encoded = base64UrlEncode(bytes);
  assert.ok(!/[+/=]/.test(encoded), "no standard-base64 characters remain");
  assert.deepEqual(base64UrlDecode(encoded), bytes);
  assert.deepEqual(base64UrlToUint8Array(encoded), bytes);
});

/* -------------------------------------------------------------------------
 * Preferences
 * ---------------------------------------------------------------------- */

test("every requested alert type has a key, a label, and a description", () => {
  for (const event of [
    "newLead",
    "missedCall",
    "transcriptReady",
    "leadNotContacted",
    "appointmentReminder",
    "hotLead",
  ]) {
    assert.ok(NOTIFICATION_KEYS.includes(event), `${event} is a known alert type`);
    assert.ok(NOTIFICATION_LABELS[event], `${event} has a label`);
    assert.ok(NOTIFICATION_DESCRIPTIONS[event], `${event} has a description`);
  }
});

test("an unknown preference key cannot be smuggled into stored preferences", () => {
  const result = normalizeNotifications({
    newLead: false,
    __proto__: { polluted: true },
    isAdmin: true,
  });
  assert.equal(result.newLead, false);
  assert.ok(!("isAdmin" in result));
  assert.deepEqual(Object.keys(result).sort(), [...NOTIFICATION_KEYS].sort());
  assert.equal({}.polluted, undefined, "prototype is untouched");
});

test("thresholds are clamped into range rather than rejected", () => {
  assert.deepEqual(normalizeThresholds({ staleLeadHours: 6, hotLeadScore: 90 }), {
    staleLeadHours: 6,
    hotLeadScore: 90,
  });
  assert.equal(normalizeThresholds({ staleLeadHours: 0 }).staleLeadHours, 1);
  assert.equal(
    normalizeThresholds({ staleLeadHours: 99999 }).staleLeadHours,
    STALE_LEAD_HOURS_MAX,
  );
  assert.equal(normalizeThresholds({ hotLeadScore: 500 }).hotLeadScore, HOT_LEAD_SCORE_MAX);
  // Strings arrive from a number input; nonsense falls back to the default.
  assert.equal(normalizeThresholds({ staleLeadHours: "12" }).staleLeadHours, 12);
  assert.deepEqual(normalizeThresholds("nonsense"), DEFAULT_BRANDING.thresholds);
});

test("SQL and TypeScript agree on the notification keys", () => {
  const sqlKeys = (
    migration.match(/jsonb_build_object\(([\s\S]*?)\n  \)/)?.[1].match(/'(\w+)'/g) ?? []
  ).map((item) => item.replaceAll("'", ""));
  assert.deepEqual(
    sqlKeys.sort(),
    [...NOTIFICATION_KEYS].sort(),
    "the migration default and NOTIFICATION_KEYS cannot drift apart",
  );
});

test("threshold bounds match between SQL and TypeScript", () => {
  assert.match(migration, /stale_lead_hours between 1 and 168/);
  assert.match(migration, /hot_lead_score between 1 and 100/);
  assert.equal(STALE_LEAD_HOURS_MAX, 168);
  assert.equal(HOT_LEAD_SCORE_MAX, 100);
});

/* -------------------------------------------------------------------------
 * Isolation and safety
 * ---------------------------------------------------------------------- */

test("subscriptions and the delivery ledger are service-role only", () => {
  for (const table of ["push_subscriptions", "push_deliveries"]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    );
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"),
    );
  }
});

test("one device cannot accumulate duplicate subscriptions", () => {
  assert.match(migration, /endpoint text not null unique/);
  assert.match(pushStore, /onConflict: "endpoint"/);
});

test("the delivery ledger makes a retried event idempotent", () => {
  assert.match(migration, /unique \(client_id, event_key\)/);
  assert.match(pushStore, /rpc\("claim_push_delivery"/);
  assert.match(concurrencyMigration, /pg_advisory_xact_lock/);
  assert.match(
    concurrencyMigration,
    /v_row\.status in \('delivered', 'permanently_failed'\)/,
  );
  // The leased claim must come before the fan-out, or two workers can send.
  const claimIndex = dispatcher.indexOf("claimDelivery({");
  const sendIndex = dispatcher.indexOf("subscriptionsForClient(");
  assert.ok(claimIndex > 0 && sendIndex > claimIndex, "claim precedes delivery");
});

test("failed and abandoned delivery claims are retryable", () => {
  assert.match(concurrencyMigration, /lease_expires_at/);
  assert.match(concurrencyMigration, /next_attempt_at/);
  assert.match(concurrencyMigration, /status in \('pending', 'processing', 'delivered', 'failed', 'permanently_failed'\)/);
  assert.match(pushStore, /recoverablePushDeliveries/);
  assert.match(sweeps, /recoverPushDeliveries/);
});

test("a disabled alert type leaves no ledger row", () => {
  // Checking the preference after claiming would burn the event key, so
  // re-enabling the alert later would silently never fire for that record.
  const prefIndex = dispatcher.indexOf("branding.notifications[event.type]");
  const claimIndex = dispatcher.indexOf("claimDelivery({");
  assert.ok(prefIndex > 0 && prefIndex < claimIndex, "preference is checked first");
});

test("a tenant only ever receives its own notifications", () => {
  assert.match(pushStore, /\.eq\("client_id", clientId\)/);
  assert.doesNotMatch(
    dispatcher,
    /subscriptionsForClient\(\)/,
    "the fan-out is always scoped to one client",
  );
  assert.match(dispatcher, /subscriptionsForClient\(event\.clientId\)/);
});

test("the subscribe endpoint takes the tenant from the session, not the body", () => {
  assert.match(subscribeRoute, /getAccountAccess\(user\)/);
  assert.doesNotMatch(
    subscribeRoute,
    /body\.clientId|input\.clientId|body\.organizationId/,
    "a client-supplied tenant id must never be honoured",
  );
  assert.match(subscribeRoute, /sameOrigin\(request\)/);
  assert.match(subscribeRoute, /Unauthorized/);
});

test("unsubscribing is scoped to the caller's own devices", () => {
  assert.match(subscribeRoute, /deleteSubscription\(endpoint, user\.email\)/);
  assert.match(pushStore, /\.eq\("email", email\.trim\(\)\.toLowerCase\(\)\)/);
});

test("a push endpoint must be https and carry no credentials", () => {
  assert.match(pushStore, /protocol !== "https:"/);
  assert.match(pushStore, /parsed\.username \|\| parsed\.password/);
});

test("delivery failures never propagate into the caller", () => {
  // Every trigger site sits inside lead ingestion or a provider webhook; an
  // exception there would fail work that has already been committed.
  assert.match(dispatcher, /export async function dispatchPushEvent[\s\S]*?try \{/);
  assert.match(dispatcher, /\} catch \(error\) \{[\s\S]*?console\.error/);
});

test("expired subscriptions are retired rather than retried forever", () => {
  assert.match(read("lib/web-push.ts"), /status === 404 \|\| response\.status === 410/);
  assert.match(dispatcher, /markSubscriptionsExpired\(expired\)/);
});

/* -------------------------------------------------------------------------
 * Triggers
 * ---------------------------------------------------------------------- */

test("all six alert types have a real trigger", () => {
  const supabaseCrm = read("db/supabase-crm.ts");
  const ingestion = read("lib/callrail-ingestion.ts");
  const twilio = read("lib/twilio-webhooks.ts");

  // new lead: manual creation and CallRail ingestion
  assert.match(supabaseCrm, /newLeadEvent\(\{/);
  assert.match(ingestion, /newLeadEvent\(\{/);
  // missed call: CallRail and Twilio
  assert.match(ingestion, /missedCallEvent\(\{/);
  assert.match(twilio, /missedCallEvent\(\{/);
  // transcript ready
  assert.match(ingestion, /transcriptReadyEvent\(\{/);
  // hot lead
  assert.match(supabaseCrm, /maybeNotifyHotLead\(\{/);
  assert.match(ingestion, /maybeNotifyHotLead\(\{/);
  // stale lead and appointment reminder are swept on the cron
  assert.match(sweeps, /leadNotContactedEvent\(\{/);
  assert.match(sweeps, /appointmentReminderEvent\(\{/);
  assert.match(read("worker/index.ts"), /runNotificationSweeps\(\)/);
});

test("the stale-lead sweep only considers genuinely untouched leads", () => {
  assert.match(sweeps, /\.is\("last_contacted_at", null\)/);
  assert.match(sweeps, /\.eq\("status", "NEW"\)/);
  assert.match(sweeps, /\.is\("archived_at", null\)/);
  // A lower bound stops every historic lead re-alerting when the window changes.
  assert.match(sweeps, /\.gt\("created_at", floor\)/);
});

test("the hot-lead threshold is the tenant's, not a constant", () => {
  assert.match(dispatcher, /input\.score < branding\.thresholds\.hotLeadScore/);
});

test("shortening the follow-up window re-alerts rather than staying silent", () => {
  // The window is part of the idempotency key.
  assert.match(dispatcher, /lead:\$\{input\.leadId\}:stale:\$\{input\.hours\}/);
});

test("sweeps only scan tenants that actually have a subscriber", () => {
  assert.match(sweeps, /tenantsWithSubscribers/);
  assert.match(sweeps, /from\("push_subscriptions"\)/);
  assert.match(sweeps, /SWEEP_ROW_LIMIT/, "a single run is bounded");
});

/* -------------------------------------------------------------------------
 * Client side
 * ---------------------------------------------------------------------- */

test("permission is only ever requested from a user gesture", () => {
  // Requesting on mount is refused by browsers and, on iOS, burns the one
  // chance the site gets.
  const effectBlock = optIn.slice(optIn.indexOf("useEffect("), optIn.indexOf("async function enable"));
  assert.doesNotMatch(effectBlock, /requestPermission/);
  assert.match(optIn, /async function enable\(\)[\s\S]*?Notification\.requestPermission\(\)/);
});

test("iOS is told to install the app before it can be offered alerts", () => {
  assert.match(optIn, /display-mode: standalone/);
  assert.match(optIn, /iPad\|iPhone\|iPod/);
  assert.match(optIn, /home screen/i);
});

test("a blocked permission is explained rather than retried", () => {
  assert.match(optIn, /Notification\.permission === "denied"/);
  assert.match(optIn, /blocked/);
});

test("subscriptions promise a visible notification, as browsers require", () => {
  assert.match(optIn, /userVisibleOnly: true/);
  assert.match(optIn, /applicationServerKey: base64UrlToUint8Array\(vapidPublicKey\)/);
});

test("the test alert reaches only the person who asked for it", () => {
  const testRoute = read("app/api/push/test/route.ts");
  // Scoped by email, not by tenant: an agency check must not buzz a client's
  // whole staff.
  assert.match(dispatcher, /subscriptionsForEmail\(input\.clientId, input\.email\)/);
  assert.match(testRoute, /email: user\.email/);
  assert.match(testRoute, /getAccountAccess\(user\)/);
  assert.match(testRoute, /sameOrigin\(request\)/);
  assert.doesNotMatch(
    testRoute,
    /body\.clientId|body\.email/,
    "the tenant and identity come from the session only",
  );
});

test("the test alert is repeatable and ignores preferences", () => {
  const block = dispatcher.slice(dispatcher.indexOf("export async function sendTestNotification"));
  const body = block.slice(0, block.indexOf("/* ------"));
  // No ledger claim, so it can be pressed twice; no preference check, so a
  // workspace with alerts switched off can still prove delivery.
  assert.doesNotMatch(body, /claimDelivery/);
  assert.doesNotMatch(body, /notifications\[/);
  assert.match(body, /subscriptionsForEmail/);
});

test("a test alert with no registered device explains itself", () => {
  assert.match(dispatcher, /No device is registered for alerts yet/);
  assert.match(dispatcher, /Push is not configured/);
});

test("the fallback client screen also offers the opt-in", () => {
  // ClientPortal renders when the CRM bootstrap fails; without this a client
  // could land there with no way to turn alerts on at all.
  const portal = read("app/ClientPortal.tsx");
  assert.match(portal, /import \{ PushOptIn \}/);
  assert.match(portal, /<PushOptIn/);
  assert.match(read("app/dashboard/page.tsx"), /push=\{\{/);
  // The portal defines the CRM tokens the card needs, since it is styled
  // independently of the CRM shell.
  assert.match(read("app/globals.css"), /\.client-portal-push \{[\s\S]*?--crm-line:/);
});

test("the device count never blocks the fallback screen from rendering", () => {
  const page = read("app/dashboard/page.tsx");
  const block = page.slice(page.indexOf("let subscribedDevices"));
  assert.match(block.slice(0, 400), /try \{[\s\S]*?\} catch \{[\s\S]*?subscribedDevices = 0;/);
});

test("the opt-in card lines up with the dashboard content below it", () => {
  // Rendered outside DashboardView, so it needs crm-view's width and padding
  // or it sits flush against the edges of crm-main.
  assert.match(read("app/CrmApp.tsx"), /className="crm-view crm-push-optin-shell"/);
  assert.match(read("app/globals.css"), /\.crm-push-optin-shell \{/);
});

test("the service worker renders a push and focuses an existing window", () => {
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /showNotification\(/);
  assert.match(serviceWorker, /addEventListener\("notificationclick"/);
  assert.match(serviceWorker, /clients\.openWindow\(/);
  // The payload carries its own branding: one worker serves every tenant on
  // the shared host.
  assert.match(serviceWorker, /payload\.icon/);
});

test("a payload that cannot fit is rejected before it reaches a push service", () => {
  assert.ok(MAX_PUSH_PAYLOAD_BYTES <= 4096);
  assert.match(read("lib/web-push.ts"), /Push payload is too large/);
});
