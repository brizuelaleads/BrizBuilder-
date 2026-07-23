import {
  AI_CONNECTOR_ISSUER,
  AI_CONNECTOR_SCOPES,
} from "../../../lib/ai-connector/config";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      issuer: AI_CONNECTOR_ISSUER,
      authorization_endpoint: `${AI_CONNECTOR_ISSUER}/oauth/authorize`,
      token_endpoint: `${AI_CONNECTOR_ISSUER}/oauth/token`,
      registration_endpoint: `${AI_CONNECTOR_ISSUER}/oauth/register`,
      scopes_supported: AI_CONNECTOR_SCOPES,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    },
    {
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}
