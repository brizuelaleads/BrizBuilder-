import {
  SystemAuthTokenError,
  verifyEmailWithToken,
} from "../../../../lib/system-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  try {
    await verifyEmailWithToken(token);
    return redirectTo(request, "/verify-email?status=success");
  } catch (error) {
    const code = error instanceof SystemAuthTokenError ? "invalid" : "invalid";
    return redirectTo(request, `/verify-email?error=${code}`);
  }
}

export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  try {
    await verifyEmailWithToken(token);
    return redirectTo(request, "/verify-email?status=success");
  } catch {
    return redirectTo(request, "/verify-email?error=invalid");
  }
}

function redirectTo(request: Request, path: string) {
  return Response.redirect(new URL(path, request.url), 303);
}
