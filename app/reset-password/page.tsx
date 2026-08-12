import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose password | BrizBuilder",
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
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand">
          <span>BB</span>
          <strong>BrizBuilder</strong>
        </div>
        <div className="auth-story-copy">
          <p>PASSWORD RESET</p>
          <h1>Choose a new password.</h1>
          <span>Reset links are single-use and expire automatically.</span>
        </div>
        <div className="auth-trust-row">
          <span>Single use</span>
          <span>Expires soon</span>
          <span>Hashed token storage</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-card-icon">BB</span>
          <p>BRIZBUILDER</p>
          <h2>New password</h2>
          {success ? (
            <>
              <span className="auth-card-copy">
                Your password was changed. You can sign in now.
              </span>
              <p className="auth-secondary-link">
                <Link href="/login">Go to sign in</Link>
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
                  Change password <span>-&gt;</span>
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
