import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AuthShell } from "../auth/AuthShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accept invite",
  description: "Accept a BrizBuilder workspace invitation.",
};

const ERROR_COPY: Record<string, string> = {
  invalid: "That invite link is invalid or expired.",
  mismatch: "Enter the same password twice.",
  weak: "Use at least 12 characters for the password.",
};

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; error?: string; success?: string }>;
}) {
  const { token: rawToken, error, success } = await searchParams;
  const token = typeof rawToken === "string" ? rawToken : "";

  return (
    <AuthShell
      eyebrow="Team invitation"
      title="Set up your account."
      description="Your private invitation lets you choose a password without sharing credentials."
      trustItems={["No shared passwords", "Single-use invite", "Email verified"]}
    >
      <p>WORKSPACE ACCESS</p>
      <h2>Accept invite</h2>
      {success ? (
        <>
          <div className="local-login-success" role="status">
            Your account is ready. Check your inbox for the verification email.
          </div>
          <p className="auth-secondary-link auth-secondary-link-primary">
            <Link href="/login">Go to sign in <ArrowRight aria-hidden="true" /></Link>
          </p>
        </>
      ) : (
        <>
          <span className="auth-card-copy">
            Choose a password with at least 12 characters.
          </span>
          {error ? (
            <div className="local-login-error" role="alert">
              {ERROR_COPY[error] ?? ERROR_COPY.invalid}
            </div>
          ) : null}
          <form className="local-login-form" action="/api/auth/accept-invite" method="post">
            <input type="hidden" name="token" value={token} />
            <label>
              <span>Password</span>
              <input name="password" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <label>
              <span>Confirm password</span>
              <input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            <button className="auth-signin" type="submit">
              <span>Accept invite</span>
              <ArrowRight aria-hidden="true" />
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
