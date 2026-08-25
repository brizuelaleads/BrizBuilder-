import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getSupabaseCallRailRecording } from "../../../../../db/supabase-crm";

export const dynamic = "force-dynamic";

/**
 * Audio for one tracked call.
 *
 * The browser is never given a CallRail URL. It asks this route, which
 * establishes who is asking, which client they may see, and whether the call
 * they named belongs to that client — and only then fetches the audio with the
 * customer's API key and streams it straight back. The key never leaves the
 * server, and a URL that would work without one is never minted.
 *
 * Range requests are passed through so a browser can seek. Without that, a
 * fifteen-minute call has to be downloaded in full before it can be scrubbed.
 */

const NO_STORE = {
  // Audio belongs to one tenant and one viewer. A shared cache holding it
  // would be a way for the next request to be answered with it.
  "Cache-Control": "private, no-store, max-age=0",
} as const;

function refuse(status: number, error: string) {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ callId: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return refuse(401, "Unauthorized");

  const { callId } = await context.params;
  const clientId = new URL(request.url).searchParams.get("clientId") ?? "";

  try {
    const recording = await getSupabaseCallRailRecording(user, {
      clientId,
      callId,
      range: request.headers.get("Range"),
    });

    // No audio is an ordinary answer, not a failure: plenty of calls have
    // none. The interface says so rather than showing a broken player.
    if (!recording) return refuse(404, "Recording unavailable");

    const headers = new Headers(NO_STORE);
    headers.set(
      "Content-Type",
      recording.headers.get("Content-Type") ?? "audio/mpeg",
    );
    // Passed through so the browser can seek. Accept-Ranges is asserted even
    // on a full response, because that is what tells it seeking is possible.
    headers.set("Accept-Ranges", "bytes");
    for (const header of ["Content-Length", "Content-Range"]) {
      const value = recording.headers.get(header);
      if (value) headers.set(header, value);
    }
    // Nothing here should be treated as a document, and nothing about the
    // request should travel onward with it.
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Content-Disposition", "inline");

    return new Response(recording.body, {
      status: recording.status === 206 ? 206 : 200,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Unauthorized") return refuse(401, message);
    if (message === "Forbidden") return refuse(403, message);
    // A call that is not this client's is not described as somebody else's.
    // Saying "not found" is the same answer they would get for an id that
    // never existed, which is the point.
    if (message === "Not found") return refuse(404, "Recording unavailable");
    console.error("CallRail recording request failed.", {
      reason: message ? "handled" : "unknown",
    });
    return refuse(502, "The recording could not be played right now.");
  }
}
