import { readRuntimeValue } from "./supabase/env";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  loadKeyBytes,
  type EncryptedValue,
} from "./crypto";

// Sendblue is customer-owned: each client pastes their own API Key ID + Secret,
// which are stored encrypted (never in env, never returned to the browser).
// Sendblue blocks browser/frontend requests, so all calls run server-side here.

const SENDBLUE_BASE_URL = "https://api.sendblue.com";
const ENCRYPTION_KEY_ENV = "SENDBLUE_TOKEN_ENCRYPTION_KEY";
const E164 = /^\+[1-9]\d{6,14}$/;

export type SendblueRuntimeStatus = { configured: boolean };
export type SendblueCredentials = { apiKeyId: string; apiSecret: string };
export type SendblueEncryptedCredentials = {
  apiKeyId: EncryptedValue;
  apiSecret: EncryptedValue;
};

// Platform readiness = the encryption key is configured. Per-client API keys
// live encrypted in the database, not in the environment.
export function getSendblueRuntimeStatus(): SendblueRuntimeStatus {
  return { configured: Boolean(readRuntimeValue(ENCRYPTION_KEY_ENV)) };
}

function aad(organizationId: string, clientId: string) {
  return `brizbuilder:sendblue:${organizationId}:${clientId}:v1`;
}

export async function encryptSendblueCredentials(
  credentials: SendblueCredentials,
  organizationId: string,
  clientId: string,
): Promise<SendblueEncryptedCredentials> {
  const keyBytes = loadKeyBytes(ENCRYPTION_KEY_ENV);
  const scope = aad(organizationId, clientId);
  return {
    apiKeyId: await aesGcmEncrypt(keyBytes, credentials.apiKeyId, scope),
    apiSecret: await aesGcmEncrypt(keyBytes, credentials.apiSecret, scope),
  };
}

export async function decryptSendblueCredentials(
  encrypted: SendblueEncryptedCredentials,
  organizationId: string,
  clientId: string,
): Promise<SendblueCredentials> {
  try {
    const keyBytes = loadKeyBytes(ENCRYPTION_KEY_ENV);
    const scope = aad(organizationId, clientId);
    return {
      apiKeyId: await aesGcmDecrypt(keyBytes, encrypted.apiKeyId, scope),
      apiSecret: await aesGcmDecrypt(keyBytes, encrypted.apiSecret, scope),
    };
  } catch {
    throw new Error(
      "The saved Sendblue keys could not be read. Reconnect Sendblue.",
    );
  }
}

async function sendblueApi<T>(
  credentials: SendblueCredentials,
  path: string,
  init?: { method?: "GET" | "POST"; body?: Record<string, unknown> },
): Promise<T> {
  const response = await fetch(`${SENDBLUE_BASE_URL}${path}`, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: {
      "sb-api-key-id": credentials.apiKeyId,
      "sb-api-secret-key": credentials.apiSecret,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Error(
        "Sendblue rejected these API keys. Double-check the Key ID and Secret in the Sendblue dashboard.",
      );
    // Never surface the raw body (may echo request context); keep it generic.
    throw new Error(`Sendblue request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

function extractNumbers(payload: unknown): string[] {
  const container =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(container.lines)
      ? container.lines
      : Array.isArray(container.numbers)
        ? container.numbers
        : Array.isArray(container.data)
          ? container.data
          : [];
  const numbers: string[] = [];
  for (const item of list) {
    let candidate: unknown = item;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      candidate =
        record.number ??
        record.e164 ??
        record.phone_number ??
        record.phoneNumber;
    }
    if (typeof candidate === "string" && E164.test(candidate.trim()))
      numbers.push(candidate.trim());
  }
  return numbers;
}

// Validates the keys with a lightweight authenticated call and returns the
// account's provisioned Sendblue numbers. A 200 confirms the keys are good.
export async function checkSendblueAccount(credentials: SendblueCredentials) {
  const lines = await sendblueApi<unknown>(credentials, "/api/lines");
  const numbers = extractNumbers(lines);
  return {
    valid: true,
    numbers,
    primaryNumber: numbers[0] ?? null,
    hasNumber: numbers.length > 0,
  };
}
