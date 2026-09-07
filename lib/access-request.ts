export type AccessRequestInput = {
  name: string;
  email: string;
  business: string;
  message: string;
};

export type AccessRequestReceipt = {
  status: "accepted" | "duplicate" | "rate_limited";
  requestId?: string;
};

const MAX_BODY_BYTES = 8192;
const RECEIVED =
  "Request received. The BrizBuilder team will review it and contact you by email. This does not create an account.";

function field(
  input: Record<string, unknown>,
  key: string,
  max: number,
  required = true,
) {
  const value = input[key];
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  ) {
    throw new Error(`Enter a valid ${key} (${max} characters or fewer).`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))
    throw new Error(`Enter a valid ${key}.`);
  return value.trim();
}

export function validateAccessRequest(value: unknown): AccessRequestInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Complete the request form.");
  const input = value as Record<string, unknown>;
  const email = field(input, "email", 254).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email))
    throw new Error("Enter a valid email address.");
  if (input.consent !== true)
    throw new Error("Confirm that we may contact you about this request.");
  return {
    name: field(input, "name", 100),
    business: field(input, "business", 160),
    email,
    message: field(input, "message", 2000, false),
  };
}

async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES)
    throw new RangeError("Request too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Complete the request form.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("Request too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Persist before notifying. A failed notification cannot erase a received request. */
export async function receiveAccessRequest(
  request: Request,
  dependencies: {
    save: (
      input: AccessRequestInput,
      networkHash: string,
    ) => Promise<AccessRequestReceipt>;
    notify: (input: AccessRequestInput, requestId: string) => Promise<void>;
  },
) {
  const json = (
    body: object,
    status: number,
    extra: Record<string, string> = {},
  ) =>
    Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store", ...extra },
    });
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin)
    return json({ error: "Refresh the page and try again." }, 403);
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    return json({ error: "Use the access request form." }, 415);
  }
  let input: AccessRequestInput;
  try {
    const body = await readBody(request);
    // A hidden field catches basic form bots without sending email or storing spam.
    if (body && typeof body === "object" && "website" in body && body.website)
      return json({ message: RECEIVED }, 202);
    input = validateAccessRequest(body);
  } catch (error) {
    return json(
      {
        error:
          error instanceof SyntaxError
            ? "Complete the request form."
            : error instanceof Error
              ? error.message
              : "Invalid request.",
      },
      error instanceof RangeError ? 413 : 400,
    );
  }
  try {
    // Cloudflare supplies this header. Do not trust client-controlled forwarded-IP headers.
    const ip = request.headers.get("cf-connecting-ip") || "unavailable";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`access-request:${ip}`),
    );
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const saved = await dependencies.save(input, hash);
    if (saved.status === "rate_limited")
      return json(
        { error: "Too many requests. Please try again in an hour." },
        429,
        { "Retry-After": "3600" },
      );
    if (saved.status === "accepted" && saved.requestId) {
      try {
        await dependencies.notify(input, saved.requestId);
      } catch {
        /* The owner can still read the persisted request. */
      }
    }
    return json({ message: RECEIVED }, 202);
  } catch {
    return json(
      {
        error:
          "We couldn’t save your request. Please try again or contact support below.",
      },
      503,
    );
  }
}
