import { cookies } from "next/headers";
import {
  LOCAL_ADMIN_PASSWORD,
  LOCAL_AUTH_COOKIE,
  LOCAL_AUTH_TOKEN,
  MAIN_ADMIN_EMAIL,
} from "../../../auth-config";

export async function POST(request: Request) {
  const form = await request.formData();
  const returnTo = safeLocalReturnTo(form.get("return_to"));

  if (!LOCAL_ADMIN_PASSWORD || !LOCAL_AUTH_TOKEN) {
    return loginErrorRedirect(request, "config", returnTo);
  }

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  if (email !== MAIN_ADMIN_EMAIL || password !== LOCAL_ADMIN_PASSWORD) {
    return loginErrorRedirect(request, "1", returnTo);
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCAL_AUTH_COOKIE, LOCAL_AUTH_TOKEN, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return Response.redirect(new URL(returnTo, request.url), 303);
}

function loginErrorRedirect(
  request: Request,
  error: string,
  returnTo: string,
) {
  const url = new URL("/local-login", request.url);
  url.searchParams.set("error", error);
  if (returnTo !== "/dashboard") url.searchParams.set("return_to", returnTo);
  return Response.redirect(url, 303);
}

function safeLocalReturnTo(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || value.length > 16_384) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";

  try {
    const url = new URL(value, "https://brizbuilder.local");
    if (url.origin !== "https://brizbuilder.local") return "/dashboard";
    if (
      url.pathname === "/local-login" ||
      url.pathname === "/api/local-auth/login" ||
      url.pathname === "/signout-with-chatgpt"
    ) {
      return "/dashboard";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}
