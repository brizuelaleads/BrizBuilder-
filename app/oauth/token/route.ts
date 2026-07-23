import {
  aiOAuthErrorResponse,
  processAiOAuthTokenRequest,
} from "../../../lib/ai-connector/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const result = await processAiOAuthTokenRequest(request);
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    return aiOAuthErrorResponse(error, "Token exchange failed.");
  }
}
