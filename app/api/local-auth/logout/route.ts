import { cookies } from "next/headers";
import { LOCAL_AUTH_COOKIE } from "../../../auth-config";
import { isLocalDevelopmentHost } from "../../../chatgpt-auth";

export async function GET(request: Request) {
  if (!isLocalDevelopmentHost(request.headers)) {
    return new Response("Not found", { status: 404 });
  }

  const cookieStore = await cookies();
  cookieStore.delete(LOCAL_AUTH_COOKIE);
  return Response.redirect(new URL("/", request.url), 303);
}
