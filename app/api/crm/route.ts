import { getChatGPTUser } from "../../chatgpt-auth";
import { executeCrmAction, getCrmBootstrap, type CrmAction } from "../../../db/runtime-crm";

export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400;
  return Response.json({ error: message }, { status });
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const data = await getCrmBootstrap(user);
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 512_000) return Response.json({ error: "Request is too large." }, { status: 413 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }

  try {
    const input = (await request.json()) as CrmAction;
    const result = await executeCrmAction(user, input);
    return Response.json({ result });
  } catch (error) {
    return errorResponse(error);
  }
}
