import {
  resetPasswordWithToken,
  SystemAuthTokenError,
} from "../../../../lib/system-auth";
import { passwordRecoveryUrl } from "../../../../lib/password-recovery-url";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");

  if (password !== confirmPassword) {
    return redirectTo(request, { token, error: "mismatch" });
  }

  try {
    await resetPasswordWithToken(token, password);
    return redirectTo(request, { success: "1" });
  } catch (error) {
    const code =
      error instanceof SystemAuthTokenError ? "invalid" : password.length < 12 ? "weak" : "invalid";
    return redirectTo(request, { token, error: code });
  }
}

function redirectTo(request: Request, params: Record<string, string>) {
  return Response.redirect(passwordRecoveryUrl("/reset-password", request, params), 303);
}
