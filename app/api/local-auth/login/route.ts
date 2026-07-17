import { cookies } from "next/headers";
import {
  LOCAL_ADMIN_PASSWORD,
  LOCAL_AUTH_COOKIE,
  LOCAL_AUTH_TOKEN,
  MAIN_ADMIN_EMAIL,
} from "../../../auth-config";
import { isLocalDevelopmentHost } from "../../../chatgpt-auth";

export async function POST(request: Request) {
  if (!isLocalDevelopmentHost(request.headers)) {
    return new Response("Not found", { status: 404 });
  }

  if (!LOCAL_ADMIN_PASSWORD || !LOCAL_AUTH_TOKEN) {
    return Response.redirect(new URL("/local-login?error=config", request.url), 303);
  }

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  if (email !== MAIN_ADMIN_EMAIL || password !== LOCAL_ADMIN_PASSWORD) {
    return Response.redirect(new URL("/local-login?error=1", request.url), 303);
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCAL_AUTH_COOKIE, LOCAL_AUTH_TOKEN, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return Response.redirect(new URL("/dashboard", request.url), 303);
}
