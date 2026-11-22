import { getChatGPTUser } from "../../chatgpt-auth";
import { listSocialPosts, mutateSocialPost } from "../../../db/supabase-social";
import { SocialRequestError } from "../../../lib/social-core";

export const dynamic = "force-dynamic";

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function errorResponse(error: unknown) {
  if (error instanceof SocialRequestError) return json({ error: error.message }, error.status);
  if (error instanceof Error && ["Forbidden", "Client not found."].includes(error.message)) {
    return json({ error: "Forbidden" }, 403);
  }
  return json({ error: "The social planner is temporarily unavailable." }, 503);
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
    return json({
      data: await listSocialPosts(user, searchParams.get("clientId"), searchParams.get("status"), searchParams.get("page")),
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
    return json({ data: await mutateSocialPost(user, await readBody(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}
