import { getChatGPTUser } from "../../chatgpt-auth";
import { authorizeSocial, listSocialPosts, mutateSocialPost } from "../../../db/supabase-social";
import { SocialRequestError } from "../../../lib/social-core";
import {
  beginMetaSocialConnect, disconnectMetaSocial, getMetaSocialWorkspace, metaAccess, publishSocialPost, selectMetaSocialPage,
} from "../../../db/supabase-meta-social";
import { loadSocialInbox, loadSocialThread, replySocialThread } from "../../../lib/meta-social-inbox";
import { beginInstagramConnect, disconnectInstagram } from "../../../db/supabase-instagram-social";

export const dynamic = "force-dynamic";

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function errorResponse(error: unknown) {
  if (error instanceof SocialRequestError) return json({ error: error.message }, error.status);
  if (error instanceof Error && ["Forbidden", "Client not found."].includes(error.message)) {
    return json({ error: "Forbidden" }, 403);
  }
  return json({ error: "Social is temporarily unavailable. Try again." }, 503);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new SocialRequestError("Send a JSON request.", 415);
  }
  if (!request.body) throw new SocialRequestError("Enter post details.");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_768) {
        await reader.cancel();
        throw new SocialRequestError("This request is too large.", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    const input: unknown = JSON.parse(body + decoder.decode());
    if (input && typeof input === "object" && !Array.isArray(input)) {
      return input as Record<string, unknown>;
    }
  } catch (error) {
    if (error instanceof SocialRequestError) throw error;
  } finally {
    reader.releaseLock();
  }
  throw new SocialRequestError("Enter valid post details.");
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { searchParams } = new URL(request.url);
  try {
    const clientId = searchParams.get("clientId");
    const view = searchParams.get("view");
    if (view === "accounts") return json({ data: await getMetaSocialWorkspace(await authorizeSocial(user, clientId)) });
    if (view === "inbox" || view === "thread") {
      const access = await metaAccess(await authorizeSocial(user, clientId));
      const data = view === "inbox"
        ? await loadSocialInbox(access, searchParams.get("kind"), searchParams.get("after"))
        : await loadSocialThread(access, searchParams.get("ref"));
      return json({ data });
    }
    return json({
      data: await listSocialPosts(user, clientId, searchParams.get("status"), searchParams.get("page")),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const origin = request.headers.get("origin");
  const sameOrigin = origin === null
    ? request.headers.get("sec-fetch-site") === "same-origin"
    : origin === new URL(request.url).origin;
  if (!sameOrigin) return json({ error: "Invalid request origin." }, 403);

  try {
    const input = await readBody(request);
    switch (input.action) {
      case "meta_connect":
        return json({ data: { url: await beginMetaSocialConnect(await authorizeSocial(user, input.clientId)) } });
      case "meta_select":
        return json({ data: await selectMetaSocialPage(await authorizeSocial(user, input.clientId), input.pageId) });
      case "meta_disconnect":
        return json({ data: await disconnectMetaSocial(await authorizeSocial(user, input.clientId)) });
      case "instagram_connect":
        return json({ data: { url: await beginInstagramConnect(await authorizeSocial(user, input.clientId)) } });
      case "instagram_disconnect": {
        const scope = await authorizeSocial(user, input.clientId);
        await disconnectInstagram(scope);
        return json({ data: await getMetaSocialWorkspace(scope) });
      }
      case "publish_now":
        return json({ data: await publishSocialPost(await authorizeSocial(user, input.clientId), input) });
      case "social_reply": {
        const access = await metaAccess(await authorizeSocial(user, input.clientId));
        await replySocialThread(access, input.ref, input.text);
        return json({ data: { sent: true } });
      }
      default:
        return json({ data: await mutateSocialPost(user, input) });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
