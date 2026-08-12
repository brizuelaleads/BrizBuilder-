import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify email | BrizBuilder",
  description: "Confirm your BrizBuilder email address.",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { status, error } = await searchParams;
  const verified = status === "success";

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand">
          <span>BB</span>
          <strong>BrizBuilder</strong>
        </div>
        <div className="auth-story-copy">
          <p>EMAIL VERIFICATION</p>
          <h1>{verified ? "Email verified." : "Verify your email."}</h1>
          <span>
            BrizBuilder uses this address for account and security messages.
          </span>
        </div>
        <div className="auth-trust-row">
          <span>Account email only</span>
          <span>Single-use link</span>
          <span>Server checked</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-card-icon">BB</span>
          <p>BRIZBUILDER</p>
          <h2>{verified ? "You are verified" : "Link problem"}</h2>
          <span className="auth-card-copy">
            {verified
              ? "Your email is confirmed. You can continue to BrizBuilder."
              : "That verification link is invalid or expired."}
          </span>
          {error ? (
            <div className="local-login-error" role="alert">
              That verification link is invalid or expired.
            </div>
          ) : null}
          <p className="auth-secondary-link">
            <Link href="/login">Go to sign in</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
