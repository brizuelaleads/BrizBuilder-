// Web Push over WebCrypto.
//
// The usual `web-push` npm package is Node-only (it reaches for `crypto`
// primitives Workers does not expose), so the two things it does for you are
// implemented here directly against the WebCrypto available in the runtime:
//
//   1. VAPID (RFC 8292): an ES256 JWT proving to the push service which
//      application server is sending, signed with our P-256 key.
//   2. Payload encryption (RFC 8291, aes128gcm): the push service is
//      untrusted infrastructure and must never see notification contents, so
//      the body is sealed to the subscriber's own key before it is handed over.
//
// Dependency-free apart from WebCrypto, so the encoding rules can be exercised
// directly in tests rather than merely inspected.

export type PushSubscriptionKeys = {
  endpoint: string;
  /** Subscriber public key, base64url, raw uncompressed P-256 point. */
  p256dh: string;
  /** Subscriber auth secret, base64url, 16 bytes. */
  auth: string;
};

export type VapidKeys = {
  /** base64url, raw uncompressed P-256 point (65 bytes). */
  publicKey: string;
  /** base64url, the P-256 private scalar `d` (32 bytes). */
  privateKey: string;
  /** `mailto:` or `https:` contact, per RFC 8292. */
  subject: string;
};

export type PushSendResult = {
  endpoint: string;
  status: number;
  /** True when the push service says this subscription is permanently gone. */
  expired: boolean;
  error?: string;
};

const encoder = new TextEncoder();

/* ---------------------------------------------------------------- base64url */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// Uint8Array<ArrayBuffer> rather than a bare Uint8Array: WebCrypto's
// BufferSource will not accept the ArrayBufferLike form, which may be backed
// by a SharedArrayBuffer.
export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function concat(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/* -------------------------------------------------------------------- VAPID */

/**
 * WebCrypto will not import a bare private scalar, so the JWK is reassembled
 * from the public point: `d` is the secret, `x`/`y` are the two halves of the
 * uncompressed public key after its 0x04 prefix.
 */
async function importVapidPrivateKey(keys: VapidKeys): Promise<CryptoKey> {
  const publicBytes = base64UrlDecode(keys.publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 0x04)
    throw new Error("VAPID public key must be a 65-byte uncompressed P-256 point.");
  const privateBytes = base64UrlDecode(keys.privateKey);
  if (privateBytes.length !== 32)
    throw new Error("VAPID private key must be a 32-byte P-256 scalar.");

  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: base64UrlEncode(privateBytes),
      x: base64UrlEncode(publicBytes.slice(1, 33)),
      y: base64UrlEncode(publicBytes.slice(33, 65)),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** The `aud` claim is the push service origin, not the full endpoint URL. */
export function audienceFor(endpoint: string): string {
  return new URL(endpoint).origin;
}

/**
 * Builds the signed VAPID token for one push service origin.
 *
 * Expiry is capped at 12 hours: RFC 8292 allows up to 24, but a shorter
 * window limits how long a token scraped from logs stays useful.
 */
export async function createVapidAuthorization(
  keys: VapidKeys,
  audience: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: audience,
    exp: nowSeconds + 12 * 60 * 60,
    sub: keys.subject,
  };
  const signingInput = `${base64UrlEncode(
    encoder.encode(JSON.stringify(header)),
  )}.${base64UrlEncode(encoder.encode(JSON.stringify(claims)))}`;

  const privateKey = await importVapidPrivateKey(keys);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    encoder.encode(signingInput),
  );
  // ECDSA over WebCrypto already returns the raw r||s form JWS wants.
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  return `vapid t=${jwt}, k=${keys.publicKey}`;
}

/* ------------------------------------------------------- payload encryption */

async function hkdf(
  ikm: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits as ArrayBuffer);
}

/**
 * Seals a payload for one subscriber using aes128gcm (RFC 8188 + RFC 8291).
 *
 * The wire format is:
 *   salt(16) | record_size(4) | key_id_len(1) | server_public_key(65) | ciphertext
 */
export async function encryptPushPayload(
  subscription: PushSubscriptionKeys,
  payload: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublicBytes = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);
  if (uaPublicBytes.length !== 65)
    throw new Error("Subscription p256dh must be a 65-byte uncompressed point.");
  if (authSecret.length !== 16)
    throw new Error("Subscription auth secret must be 16 bytes.");

  // A fresh server keypair per message: reusing one across sends would let a
  // push service correlate every notification to the same subscriber.
  const serverKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const serverPublicBytes = new Uint8Array(
    (await crypto.subtle.exportKey("raw", serverKeys.publicKey)) as ArrayBuffer,
  );

  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublicBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    (await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaPublicKey },
      serverKeys.privateKey,
      256,
    )) as ArrayBuffer,
  );

  // Step 1: mix the shared secret with the subscriber's auth secret.
  const keyInfo = concat(
    encoder.encode("WebPush: info"),
    new Uint8Array([0]),
    uaPublicBytes,
    serverPublicBytes,
  );
  const ikm = await hkdf(sharedSecret, authSecret, keyInfo, 32);

  // Step 2: derive the content key and nonce from a per-message salt.
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
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

  const contentKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "encrypt",
  ]);
  // 0x02 is the final-record delimiter; no padding is added beyond it.
  const plaintext = concat(encoder.encode(payload), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    (await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      contentKey,
      plaintext,
    )) as ArrayBuffer,
  );

  const recordSize = new Uint8Array(new ArrayBuffer(4));
  new DataView(recordSize.buffer).setUint32(0, 4096, false);

  return concat(
    salt,
    recordSize,
    new Uint8Array([serverPublicBytes.length]),
    serverPublicBytes,
    ciphertext,
  );
}

/* ---------------------------------------------------------------- delivering */

/** Push services reject anything much larger; keep well inside the limit. */
export const MAX_PUSH_PAYLOAD_BYTES = 3800;

/**
 * Sends one notification.
 *
 * Never throws for a delivery failure: the caller is fanning out to many
 * devices and one dead endpoint must not abort the rest. A 404 or 410 means
 * the subscription is permanently gone and should be deleted by the caller.
 */
export async function sendWebPush(
  subscription: PushSubscriptionKeys,
  payload: string,
  keys: VapidKeys,
  options: { ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high" } = {},
): Promise<PushSendResult> {
  try {
    if (encoder.encode(payload).length > MAX_PUSH_PAYLOAD_BYTES)
      throw new Error("Push payload is too large.");

    const body = await encryptPushPayload(subscription, payload);
    const authorization = await createVapidAuthorization(
      keys,
      audienceFor(subscription.endpoint),
    );

    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(options.ttlSeconds ?? 3600),
        Urgency: options.urgency ?? "normal",
      },
      body: body as unknown as BodyInit,
    });

    return {
      endpoint: subscription.endpoint,
      status: response.status,
      expired: response.status === 404 || response.status === 410,
    };
  } catch (error) {
    return {
      endpoint: subscription.endpoint,
      status: 0,
      expired: false,
      error: error instanceof Error ? error.message : "Push delivery failed.",
    };
  }
}
