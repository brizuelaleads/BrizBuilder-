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

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
