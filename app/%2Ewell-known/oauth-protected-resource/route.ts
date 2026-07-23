import {
  AI_CONNECTOR_ISSUER,
  AI_CONNECTOR_RESOURCE,
  AI_CONNECTOR_SCOPES,
} from "../../../lib/ai-connector/config";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      resource: AI_CONNECTOR_RESOURCE,
      authorization_servers: [AI_CONNECTOR_ISSUER],
      scopes_supported: AI_CONNECTOR_SCOPES,
      bearer_methods_supported: ["header"],
      resource_documentation: `${AI_CONNECTOR_ISSUER}/?view=ai`,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}
