import { SignJWT, jwtVerify } from "jose";
import { removeMetaSocialUser } from "../../../../../db/supabase-meta-social";
import { metaSocialId } from "../../../../../lib/meta-social";
import { SocialRequestError } from "../../../../../lib/social-core";
import { readRuntimeValue } from "../../../../../lib/supabase/env";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (value) => value.charCodeAt(0));
}

function appSecret() {
  const secret = readRuntimeValue("META_SOCIAL_APP_SECRET");
  if (!secret) throw new SocialRequestError("Meta account access is awaiting setup.", 503);
  return new TextEncoder().encode(secret);
}

async function verifiedRequest(value: string | null) {
  try {
    const parts = value?.split(".") ?? [];
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const [signature, payload] = parts;
    const key = await crypto.subtle.importKey("raw", appSecret(), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
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

export async function POST(request: Request) {
  try {
    appSecret();
    const decoded = await verifiedRequest(await readCallback(request));
    if (!decoded) return Response.json({ error: "Invalid Meta callback." }, { status: 403, headers });
    await removeMetaSocialUser(decoded.userId, decoded.issuedAt);
    const confirmationCode = crypto.randomUUID();
    const receipt = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" }).setAudience("brizbuilder-meta-social-deletion")
      .setSubject(confirmationCode).setExpirationTime("30d").sign(appSecret());
    const url = new URL("/api/integrations/meta-social/data-deletion", request.url);
    url.searchParams.set("receipt", receipt);
    return Response.json({ url: url.toString(), confirmation_code: confirmationCode }, { headers });
  } catch {
    return Response.json({ error: "Meta could not confirm removal. Retry the request." }, { status: 503, headers });
  }
}

export async function GET(request: Request) {
  const receipt = new URL(request.url).searchParams.get("receipt") ?? "";
  if (receipt.length < 1500) {
    try {
      const { payload } = await jwtVerify(receipt, appSecret(), {
        algorithms: ["HS256"], audience: "brizbuilder-meta-social-deletion",
      });
      return new Response(`BrizBuilder removed the Meta Social authorization. Confirmation code: ${payload.sub}`, { headers });
    } catch {
      // Fall through to a generic response for expired or invalid receipts.
    }
  }
  return new Response("This confirmation is unavailable.", { status: 404, headers });
}
