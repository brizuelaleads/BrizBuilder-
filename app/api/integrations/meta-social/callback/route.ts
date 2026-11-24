import { getChatGPTUser } from "../../../../chatgpt-auth";
import { finishMetaSocialConnect } from "../../../../../db/supabase-meta-social";
import { SocialRequestError } from "../../../../../lib/social-core";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = new URL("/dashboard", url);
  back.searchParams.set("view", "social");
  back.searchParams.set("social_section", "accounts");
  try {
    const user = await getChatGPTUser();
    if (!user) throw new SocialRequestError("Sign in to BrizBuilder and start the Meta connection again.");
    await finishMetaSocialConnect(
      user, url.searchParams.get("state") ?? "",
      url.searchParams.has("error") ? null : url.searchParams.get("code"), back,
    );
  } catch (error) {
    back.searchParams.set("social_connection_error", error instanceof SocialRequestError
      ? error.message : "Could not connect Meta. Start the connection again.");
  }
  return new Response(null, {
    status: 302,
    headers: { Location: back.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
