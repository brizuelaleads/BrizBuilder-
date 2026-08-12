import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AuthShell } from "../auth/AuthShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Request a BrizBuilder password reset link.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <AuthShell
      eyebrow="Account security"
      title="Reset your password."
      description="Request a secure email link without exposing whether an account exists."
      trustItems={["Single-use links", "Server checked", "Private by default"]}
    >
      <p>ACCOUNT RECOVERY</p>
      <h2>Forgot password</h2>
      <span className="auth-card-copy">
        Enter your email. If it belongs to a BrizBuilder account, we will send
        the next step.
      </span>
      {sent ? (
        <div className="local-login-success" role="status">
          Check your email for a secure reset link.
        </div>
      ) : null}
      <form className="local-login-form" action="/api/auth/forgot-password" method="post">
        <label>
          <span>Email</span>
          <input name="email" type="email" autoComplete="username" required autoFocus />
        </label>
        <button className="auth-signin" type="submit">
          <span>Send reset link</span>
          <ArrowRight aria-hidden="true" />
        </button>
      </form>
      <p className="auth-secondary-link">
        <Link href="/login"><ArrowLeft aria-hidden="true" /> Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
