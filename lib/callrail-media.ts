/**
 * The rules a recording fetch follows, kept apart from the fetching.
 *
 * CallRail's recording endpoint answers with JSON naming where the audio
 * currently lives, and that location is on Amazon S3 rather than a CallRail
 * host. So a recording request crosses hosts, follows redirects, and must not
 * carry our credential past CallRail's own door — three decisions that are
 * worth being able to test directly rather than inferring from a fetch loop.
 *
 * Dependency-free on purpose.
 */

/**
 * CallRail's own API and application hosts.
 *
 * Used to decide which URLs may be fetched at all. Deliberately not used
 * to decide where a credential goes: nothing in a media fetch carries
 * one, whatever the host.
 */
export function isCallRailApiHost(hostname: unknown): boolean {
  return (
    typeof hostname === "string" &&
    (hostname === "callrail.com" || hostname.endsWith(".callrail.com"))
  );
}

/**
 * Where CallRail actually keeps recording audio.
 *
 * The bucket prefix is pinned. A bare `*.amazonaws.com` allowlist would
 * accept any bucket on earth, which is the whole attack: persuade the server
 * to fetch, and stream back, something of the asker's choosing.
 */
export function isCallRailMediaHost(hostname: unknown): boolean {
  return (
    typeof hostname === "string" &&
    /^calltrk[a-z0-9-]*\.s3(\.[a-z0-9-]+)*\.amazonaws\.com$/u.test(hostname)
  );
}

/**
 * A URL this server is willing to fetch a recording from, or null.
 *
 * HTTPS only, and only the two host families above. `base` resolves a
 * relative Location header, which is legal in a redirect and must be judged
 * against the same rules as an absolute one.
 */
export function allowedCallRailMediaUrl(
  candidate: unknown,
  base?: string,
): string | null {
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  let url: URL;
  try {
    url = base ? new URL(candidate, base) : new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!isCallRailApiHost(url.hostname) && !isCallRailMediaHost(url.hostname)) {
    return null;
  }
  return url.toString();
}

/**
 * Where the recording is, from CallRail's JSON.
 *
 * Exactly one field is read. The body is a provider response and the rest of
 * it is none of this system's business — it is not stored, not logged, and
 * not returned.
 */
export function readCallRailRecordingLocation(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const url = (body as Record<string, unknown>).url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

/** Whether a response claims to be audio, whatever else it carries. */
export function isAudioContentType(value: unknown): boolean {
  return (
    typeof value === "string" && /^audio\/[-\w.+]+\s*(;.*)?$/iu.test(value.trim())
  );
}

export const CALLRAIL_MEDIA_REDIRECT_STATUSES = [301, 302, 303, 307, 308];
export const MAX_CALLRAIL_MEDIA_REDIRECTS = 5;

export type CallRailMediaDecision =
  | { action: "follow"; url: string }
  | { action: "stream" }
  | { action: "absent" }
  | {
      action: "refuse";
      reason:
        | "hostile_redirect"
        | "too_many_redirects"
        | "not_audio"
        | "provider_error";
    };

/**
 * What to do with one response in a recording fetch.
 *
 * Separated from the fetching so every branch can be exercised: a redirect
 * somewhere reasonable, a redirect somewhere hostile, a 404, an error, real
 * audio, a partial, and the JSON body that started all this by being streamed
 * to a browser as though it were a recording.
 */
export function decideCallRailMediaResponse(input: {
  status: number;
  contentType?: string | null;
  location?: string | null;
  currentUrl: string;
  hop: number;
}): CallRailMediaDecision {
  const { status, contentType, location, currentUrl, hop } = input;

  if (CALLRAIL_MEDIA_REDIRECT_STATUSES.includes(status)) {
    if (hop >= MAX_CALLRAIL_MEDIA_REDIRECTS) {
      return { action: "refuse", reason: "too_many_redirects" };
    }
    const next = allowedCallRailMediaUrl(location, currentUrl);
    return next
      ? { action: "follow", url: next }
      : { action: "refuse", reason: "hostile_redirect" };
  }

  // A call with no recording. Ordinary, and not an error.
  if (status === 404) return { action: "absent" };

  if (status !== 200 && status !== 206) {
    return { action: "refuse", reason: "provider_error" };
  }

  // The check this exists for. A 200 carrying JSON is not a recording, and
  // forwarding it as one hands a player an error document to try to play.
  return isAudioContentType(contentType)
    ? { action: "stream" }
    : { action: "refuse", reason: "not_audio" };
}

/**
 * The headers one hop of a recording fetch may carry.
 *
 * No credential, ever, to any host. The API key belongs to exactly one
 * request — the authenticated call to api.callrail.com that asks where the
 * recording is — and a media URL is expected to carry its own signed access
 * instead. That holds even when the media URL is on a callrail.com host: a
 * location handed back by a provider is not a reason to attach a key to it,
 * and a redirect chain is somebody else deciding where our credential goes.
 *
 * This takes no key, so it cannot leak one. A conditional would only be as
 * good as the condition.
 */
export function callRailMediaRequestHeaders(input: {
  range?: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  // Seeking is the browser's business and travels to whichever host serves
  // the audio.
  if (typeof input.range === "string" && input.range.trim()) {
    headers.Range = input.range;
  }
  return headers;
}
