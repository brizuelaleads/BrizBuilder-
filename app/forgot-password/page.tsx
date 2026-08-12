import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset password | BrizBuilder",
  description: "Request a BrizBuilder password reset link.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand">
          <span>BB</span>
          <strong>BrizBuilder</strong>
        </div>
        <div className="auth-story-copy">
          <p>ACCOUNT SECURITY</p>
          <h1>Reset your password.</h1>
          <span>
            BrizBuilder sends account/security email only from this flow.
          </span>
        </div>
        <div className="auth-trust-row">
          <span>Single-use links</span>
          <span>Server checked</span>
          <span>No account lookup leak</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-card-icon">BB</span>
          <p>BRIZBUILDER</p>
          <h2>Forgot password</h2>
          <span className="auth-card-copy">
            Enter your email. If it belongs to a BrizBuilder account, we will
            send a secure reset link.
          </span>
          {sent ? (
            <div className="local-login-success" role="status">
              Check your email for the next step.
            </div>
          ) : null}
          <form className="local-login-form" action="/api/auth/forgot-password" method="post">
            <label>
              <span>Email</span>
              <input name="email" type="email" autoComplete="username" required autoFocus />
            </label>
            <button className="auth-signin" type="submit">
              Send reset link <span>-&gt;</span>
            </button>
          </form>
          <p className="auth-secondary-link">
            <Link href="/login">Back to sign in</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
