import { getChatGPTUser } from "../../../chatgpt-auth";
import {
  AiOAuthError,
  aiOAuthErrorResponse,
  completeAiOAuthConsent,
} from "../../../../lib/ai-connector/oauth";

export const dynamic = "force-dynamic";

const MAX_CONSENT_BODY_BYTES = 16_384;

function isSameOriginApproval(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    if (new URL(origin).origin !== new URL(request.url).origin) return false;
  } catch {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

function oneValue(
  form: URLSearchParams,
  name: string,
  required = true,
): string | null {
  const values = form.getAll(name);
  if (values.length > 1) {
    throw new AiOAuthError("invalid_request", `${name} must appear only once.`);
  }
  const value = values[0];
  if (value === undefined || (!value && required)) {
    if (!required) return null;
    throw new AiOAuthError("invalid_request", `${name} is required.`);
  }
  return value;
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return aiOAuthErrorResponse(
      new AiOAuthError(
        "access_denied",
        "Your BrizBuilder login expired. Start the connection again.",
        401,
      ),
    );
  }
  if (!isSameOriginApproval(request)) {
    return aiOAuthErrorResponse(
      new AiOAuthError(
        "access_denied",
        "The consent form did not come from BrizBuilder.",
        403,
      ),
    );
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return aiOAuthErrorResponse(
      new AiOAuthError(
        "invalid_request",
        "Content-Type must be application/x-www-form-urlencoded.",
        415,
      ),
    );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_CONSENT_BODY_BYTES) {
    return aiOAuthErrorResponse(
      new AiOAuthError("invalid_request", "The consent request is too large.", 413),
    );
  }

  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_CONSENT_BODY_BYTES) {
      throw new AiOAuthError(
        "invalid_request",
        "The consent request is too large.",
        413,
      );
    }
    const form = new URLSearchParams(body);
    const consentToken = oneValue(form, "consent_token")!;
    const decisionValue = oneValue(form, "decision")!;
    if (decisionValue !== "approve" && decisionValue !== "deny") {
      throw new AiOAuthError("invalid_request", "The consent decision is invalid.");
    }

    const redirectUrl = await completeAiOAuthConsent(user, {
      consentToken,
      decision: decisionValue,
      clientId: oneValue(form, "client_id", false),
    });
    return new Response(null, {
      status: 303,
      headers: {
        Location: redirectUrl,
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    return aiOAuthErrorResponse(error, "Consent could not be completed.");
  }
}
