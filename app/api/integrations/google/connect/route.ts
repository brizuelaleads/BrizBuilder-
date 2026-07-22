import { getChatGPTUser } from "../../../../chatgpt-auth";
import { readRuntimeValue } from "../../../../../lib/supabase/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.redirect(new URL("/", request.url));

  const url = new URL("/dashboard", request.url);
  url.searchParams.set("view", "profiles");
  const clientId = new URL(request.url).searchParams.get("clientId") ?? "";
  if (clientId) url.searchParams.set("client", clientId);

  const clientIdConfigured = readRuntimeValue("GOOGLE_CLIENT_ID");
  const clientSecretConfigured = readRuntimeValue("GOOGLE_CLIENT_SECRET");
  const redirectUri = readRuntimeValue("GOOGLE_REDIRECT_URI");
  if (!clientIdConfigured || !clientSecretConfigured || !redirectUri) {
    url.searchParams.set(
      "connection_error",
      "Google OAuth is not configured yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in Cloudflare.",
    );
    return Response.redirect(url);
  }

  // The profile/location authorization flow is intentionally not started until
  // the platform OAuth callback and protected token store are configured.
  url.searchParams.set(
    "connection_error",
    "Google OAuth credentials are present, but the secure Business Profile authorization flow still needs to be enabled.",
  );
  return Response.redirect(url);
}
