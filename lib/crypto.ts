import { readRuntimeValue } from "./supabase/env";

// Generic AES-GCM helpers for encrypting provider credentials at rest.
// Mirrors the approach already used for Google Business tokens, but provider-
// agnostic so new integrations can reuse it without touching working code.

export type EncryptedValue = { ciphertext: string; iv: string };

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

// Accepts a 64-char hex string or base64url; must decode to exactly 32 bytes.
export function loadKeyBytes(envName: string): Uint8Array {
  const configured = readRuntimeValue(envName);
  if (!configured)
    throw new Error(`Encryption is not configured. Add ${envName} in Cloudflare.`);
  let bytes: Uint8Array;
  if (/^[0-9a-f]{64}$/i.test(configured)) {
    bytes = Uint8Array.from(
      configured.match(/.{2}/g) ?? [],
      (pair) => Number.parseInt(pair, 16),
    );
  } else {
    try {
      bytes = base64UrlToBytes(configured);
    } catch {
      throw new Error(`${envName} must be a 32-byte key.`);
    }
  }
  if (bytes.byteLength !== 32) throw new Error(`${envName} must be a 32-byte key.`);
  return bytes;
}

async function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function aesGcmEncrypt(
  keyBytes: Uint8Array,
  plaintext: string,
  aad: string,
): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: new TextEncoder().encode(aad) as BufferSource,
    },
    await importAesKey(keyBytes),
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

export async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  encrypted: EncryptedValue,
  aad: string,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(encrypted.iv) as BufferSource,
      additionalData: new TextEncoder().encode(aad) as BufferSource,
    },
    await importAesKey(keyBytes),
    base64UrlToBytes(encrypted.ciphertext) as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}
