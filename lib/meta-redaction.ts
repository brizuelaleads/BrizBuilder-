// Sanitizing Meta's error responses into something an admin can act on.
//
// Deliberately dependency-free so it can be unit tested directly, and so the
// redaction rules can be exercised against hostile input rather than merely
// inspected. Nothing here reads configuration, touches the network, or writes
// to storage.
//
// The contract: only six scalar diagnostic fields ever leave this module. The
// request URL, headers, submitted token, request payload and raw response body
// are never carried out of it, and the result is never persisted.

export type MetaErrorDetail = {
  status: number;
  code: number | null;
  subcode: number | null;
  type: string | null;
  message: string;
  traceId: string | null;
};

const MAX_INPUT = 2000;
const MAX_MESSAGE = 300;

/**
 * Strips anything that could be a credential or a person from free text.
 *
 * Ordered deliberately: structured shapes (URLs, key=value pairs, emails) are
 * matched while still intact, because the broad credential-run rule that
 * follows would otherwise chew them into unrecognizable fragments first.
 *
 * Biased hard toward over-redaction. Losing a detail from a diagnostic message
 * costs a support round trip; leaking a token costs a customer's ad account.
 */
export function redactDiagnosticText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "(no message provided)";
  let text = value.trim().slice(0, MAX_INPUT);

  // URLs first: query strings routinely carry access_token and appsecret_proof.
  text = text.replace(/\bhttps?:\/\/\S+/gi, "[redacted-url]");

  // Explicitly credential-bearing keys, before the generic rules.
  text = text.replace(
    /\b(access_token|client_secret|app_secret|appsecret_proof|refresh_token|password|secret|signature|token)\b\s*[:=]\s*\S+/gi,
    "$1=[redacted]",
  );
  text = text.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]");

  // Contact details belonging to a real person.
  text = text.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    "[redacted-email]",
  );

  // Long unbroken alphanumeric runs: Meta tokens, base64, JWT segments and
  // hex digests all live here. English words effectively never do.
  text = text.replace(/[A-Za-z0-9_-]{20,}/g, "[redacted]");

  // Long digit runs: phone numbers, account and dataset ids.
  text = text.replace(/\d{7,}/g, "[redacted]");

  return text.slice(0, MAX_MESSAGE);
}

/** Meta trace ids are short opaque handles; anything else is discarded. */
export function safeTraceId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value.trim())
    ? value.trim()
    : null;
}

/** Error types are bare identifiers such as OAuthException. */
export function safeErrorType(value: unknown): string | null {
  return typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value.trim())
    ? value.trim()
    : null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Lifts exactly six fields out of a parsed Meta error body. The body itself is
 * not retained, and no other key is read.
 */
export function buildMetaErrorDetail(
  status: number,
  body: unknown,
): MetaErrorDetail {
  const envelope =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const error =
    envelope.error && typeof envelope.error === "object" && !Array.isArray(envelope.error)
      ? (envelope.error as Record<string, unknown>)
      : {};
  return {
    status: Number.isFinite(status) ? status : 0,
    code: safeNumber(error.code),
    subcode: safeNumber(error.error_subcode),
    type: safeErrorType(error.type),
    message: redactDiagnosticText(error.message),
    traceId: safeTraceId(error.fbtrace_id),
  };
}

/**
 * Renders the detail onto an action-oriented summary, for display to the
 * authenticated admin who triggered the connection attempt.
 */
export function formatMetaErrorDetail(
  summary: string,
  detail: MetaErrorDetail,
): string {
  const parts = [`HTTP ${detail.status}`];
  if (detail.code !== null) parts.push(`code ${detail.code}`);
  if (detail.subcode !== null) parts.push(`subcode ${detail.subcode}`);
  if (detail.type) parts.push(`type ${detail.type}`);
  if (detail.traceId) parts.push(`trace ${detail.traceId}`);
  return `${summary} Meta reported ${parts.join(", ")} — ${detail.message}`;
}
