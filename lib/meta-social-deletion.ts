import { SignJWT, jwtVerify } from "jose";
import { metaSocialId } from "./meta-social";
import { readRuntimeValue } from "./supabase/env";

const headers = { "Cache-Control": "private, no-store" };

function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (value) => value.charCodeAt(0));
}

async function verifiedRequest(value: string | null, secret: Uint8Array<ArrayBuffer>) {
  try {
    const parts = value?.split(".") ?? [];
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const [signature, payload] = parts;
    const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, decode(signature), new TextEncoder().encode(payload))) return null;
    const data = JSON.parse(new TextDecoder().decode(decode(payload))) as {
      algorithm: string; user_id: unknown; issued_at: number;
    };
    const age = Date.now() / 1000 - data.issued_at;
    if (data.algorithm.toUpperCase() !== "HMAC-SHA256" || !metaSocialId(data.user_id) ||
        !Number.isSafeInteger(data.issued_at) || age < -60 || age > 60 * 60) return null;
    return { userId: data.user_id, issuedAt: data.issued_at };
  } catch {
    return null;
  }
}

async function readCallback(request: Request) {
  if (!request.body || !request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    return new URLSearchParams(body + decoder.decode()).get("signed_request");
  } finally {
    reader.releaseLock();
  }
}

async function deletionRequest(
  request: Request,
  secret: Uint8Array<ArrayBuffer>,
  removeUser: (userId: string, issuedAt: number) => Promise<void>,
  audience: string,
) {
  try {
    const decoded = await verifiedRequest(await readCallback(request), secret);
    if (!decoded) return Response.json({ error: "Invalid Meta callback." }, { status: 403, headers });
    await removeUser(decoded.userId, decoded.issuedAt);
    const confirmationCode = crypto.randomUUID();
    const receipt = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" }).setAudience(audience)
      .setSubject(confirmationCode).setExpirationTime("30d").sign(secret);
    const url = new URL(request.url);
    url.search = "";
    url.searchParams.set("receipt", receipt);
    return Response.json({ url: url.toString(), confirmation_code: confirmationCode }, { headers });
  } catch {
    return Response.json({ error: "Meta could not confirm removal. Retry the request." }, { status: 503, headers });
  }
}

async function deletionReceipt(request: Request, secret: Uint8Array<ArrayBuffer>, audience: string) {
  const receipt = new URL(request.url).searchParams.get("receipt") ?? "";
  if (receipt.length < 1500) {
    try {
      const { payload } = await jwtVerify(receipt, secret, {
        algorithms: ["HS256"], audience,
      });
      return new Response(`BrizBuilder removed the Meta Social authorization. Confirmation code: ${payload.sub}`, { headers });
    } catch {
      // Fall through to a generic response for expired or invalid receipts.
    }
  }
  return new Response("This confirmation is unavailable.", { status: 404, headers });
}

export function socialDeletionHandlers(
  integration: "meta-social" | "instagram-social",
  removeUser: (userId: string, issuedAt: number) => Promise<void>,
) {
  const audience = `brizbuilder-${integration}-deletion`;
  const secretName = integration === "meta-social" ? "META_SOCIAL_APP_SECRET" : "META_SOCIAL_INSTAGRAM_APP_SECRET";
  return {
    async POST(request: Request) {
      const secret = readRuntimeValue(secretName);
      return secret ? deletionRequest(request, new TextEncoder().encode(secret), removeUser, audience)
        : Response.json({ error: "Meta could not confirm removal. Retry the request." }, { status: 503, headers });
    },
    async GET(request: Request) {
      const secret = readRuntimeValue(secretName);
      return secret ? deletionReceipt(request, new TextEncoder().encode(secret), audience)
        : new Response("This confirmation is unavailable.", { status: 404, headers });
    },
  };
}
