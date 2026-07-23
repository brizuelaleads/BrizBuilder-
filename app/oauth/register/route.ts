import {
  AiOAuthError,
  aiOAuthErrorResponse,
  registerAiOAuthClient,
} from "../../../lib/ai-connector/oauth";

export const dynamic = "force-dynamic";

const MAX_REGISTRATION_BODY_BYTES = 32_768;

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return aiOAuthErrorResponse(
      new AiOAuthError(
        "invalid_client_metadata",
        "Content-Type must be application/json.",
        415,
      ),
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REGISTRATION_BODY_BYTES) {
    return aiOAuthErrorResponse(
      new AiOAuthError(
        "invalid_client_metadata",
        "The client registration is too large.",
        413,
      ),
    );
  }

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REGISTRATION_BODY_BYTES) {
      throw new AiOAuthError(
        "invalid_client_metadata",
        "The client registration is too large.",
        413,
      );
    }

    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new AiOAuthError(
        "invalid_client_metadata",
        "The client metadata is not valid JSON.",
      );
    }

    const metadata = await registerAiOAuthClient(request, input);
    return Response.json(metadata, {
      status: 201,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    return aiOAuthErrorResponse(error, "Client registration failed.");
  }
}
