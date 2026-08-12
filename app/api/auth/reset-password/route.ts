import {
  resetPasswordWithToken,
  SystemAuthTokenError,
} from "../../../../lib/system-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");

  if (password !== confirmPassword) {
    return redirectTo(request, "/reset-password", { token, error: "mismatch" });
  }

  try {
    await resetPasswordWithToken(token, password);
    return redirectTo(request, "/reset-password", { success: "1" });
  } catch (error) {
    const code =
      error instanceof SystemAuthTokenError ? "invalid" : password.length < 12 ? "weak" : "invalid";
    return redirectTo(request, "/reset-password", { token, error: code });
  }
}

function redirectTo(request: Request, path: string, params: Record<string, string>) {
  const url = new URL(path, request.url);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return Response.redirect(url, 303);
}
