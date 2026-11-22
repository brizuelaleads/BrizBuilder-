import { getChatGPTUser } from "../../../../chatgpt-auth";
import { deleteSupabaseGoogleMedia, uploadSupabaseGoogleMedia } from "../../../../../db/supabase-crm";
import { GOOGLE_VIDEO_MAX_BYTES } from "../../../../../lib/google-business";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

// Browsers send Origin on every POST/DELETE; require proof the request came from this site.
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === new URL(request.url).host;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "same-origin" || fetchSite === "none";
}

function failure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
  return Response.json({ error: message || fallback }, { status, headers });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > GOOGLE_VIDEO_MAX_BYTES + 64 * 1024) {
    return Response.json({ error: "Files must be 30 MB or smaller." }, { status: 413, headers });
  }
  try {
    const form = await request.formData();
    const clientId = String(form.get("clientId") ?? "").trim();
    const category = String(form.get("category") ?? "ADDITIONAL");
    const file = form.get("file");
    if (!clientId || clientId.length > 100) throw new Error("Choose a business.");
    if (!(file instanceof File)) throw new Error("Choose a photo or video to upload.");
    const data = await uploadSupabaseGoogleMedia(user, clientId, { bytes: await file.arrayBuffer(), type: file.type }, category);
    return Response.json({ data }, { headers });
  } catch (error) {
    return failure(error, "Google could not upload this file.");
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const clientId = params.get("clientId")?.trim() ?? "";
  const name = params.get("name")?.trim() ?? "";
  if (!clientId || clientId.length > 100 || !name || name.length > 500) {
    return Response.json({ error: "Choose a photo to remove." }, { status: 400, headers });
  }
  try {
    return Response.json({ data: await deleteSupabaseGoogleMedia(user, clientId, name) }, { headers });
  } catch (error) {
    return failure(error, "Google could not remove this file.");
  }
}
