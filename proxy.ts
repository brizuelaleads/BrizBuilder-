import type { NextRequest } from "next/server";
import { applyAiConsentSecurityHeaders } from "./lib/ai-connector/http-security";
import { updateSession } from "./utils/supabase/middleware";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  if (request.nextUrl.pathname === "/oauth/authorize") {
    return applyAiConsentSecurityHeaders(response);
  }
  return response;
}

// Machine-to-machine traffic is excluded: MCP, webhooks, OAuth token/register
// and public lead capture authenticate with bearer tokens or signatures and
// carry no browser session, so refreshing one there is pure added latency.
export const config = {
  matcher: [
    // sw.js and offline.html are static, brand-neutral PWA assets with no
    // session to refresh. The manifest route is deliberately NOT excluded:
    // it needs the session cookie to answer with the right tenant.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|offline.html|mcp|oauth/token|oauth/register|api/twilio|api/website-leads|api/integrations/stripe/webhook|api/integrations/twilio/deauthorize|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
