import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AuthShell } from "../auth/AuthShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose password",
  description: "Set a new BrizBuilder password.",
};

const ERROR_COPY: Record<string, string> = {
  invalid: "That reset link is invalid or expired.",
  mismatch: "Enter the same password twice.",
  weak: "Use at least 12 characters for the password.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; error?: string; success?: string }>;
}) {
  const { token: rawToken, error, success } = await searchParams;
  const token = typeof rawToken === "string" ? rawToken : "";

  return (
    <AuthShell
      eyebrow="Password reset"
      title="Choose a new password."
      description="Reset links expire automatically and can only be used once."
      trustItems={["Single use", "Expires soon", "Hashed token storage"]}
    >
      <p>ACCOUNT SECURITY</p>
      <h2>New password</h2>
      {success ? (
        <>
          <div className="local-login-success" role="status">
            Your password was changed successfully.
          </div>
          <p className="auth-secondary-link auth-secondary-link-primary">
            <Link href="/login">Go to sign in <ArrowRight aria-hidden="true" /></Link>
          </p>
        </>
      ) : (
        <>
          <span className="auth-card-copy">
            Enter a password with at least 12 characters.
          </span>
          {error ? (
            <div className="local-login-error" role="alert">
              {ERROR_COPY[error] ?? ERROR_COPY.invalid}
            </div>
          ) : null}
          <form className="local-login-form" action="/api/auth/reset-password" method="post">
            <input type="hidden" name="token" value={token} />
            <label>
              <span>New password</span>
              <input name="password" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <label>
              <span>Confirm password</span>
              <input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <button className="auth-signin" type="submit">
              <span>Change password</span>
              <ArrowRight aria-hidden="true" />
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
