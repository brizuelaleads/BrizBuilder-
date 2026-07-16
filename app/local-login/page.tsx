import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MAIN_ADMIN_EMAIL } from "../auth-config";
import { isLocalDevelopmentHost } from "../chatgpt-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Local sign in · Brizuela Leads",
  description: "Local Brizuela Leads CRM preview sign in.",
};

export default async function LocalLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const requestHeaders = await headers();
  if (!isLocalDevelopmentHost(requestHeaders)) redirect("/");

  const { error } = await searchParams;

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand">
          <span>✦</span>
          <strong>Brizuela Leads</strong>
        </div>
        <div className="auth-story-copy">
          <p>LOCAL TEST ENVIRONMENT</p>
          <h1>Test the protected workspace safely.</h1>
          <span>
            This local-only login lets you verify the administrator experience.
            It is disabled automatically on the published website.
          </span>
        </div>
        <div className="auth-trust-row">
          <span>✓ Local preview only</span>
          <span>✓ Administrator access</span>
          <span>✓ Production auth unchanged</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-card-icon">✦</span>
          <p>BRIZUELA LEADS PREVIEW</p>
          <h2>Admin sign in</h2>
          <span className="auth-card-copy">
            Enter the local testing credentials to open the agency dashboard.
          </span>
          <form className="local-login-form" action="/api/local-auth/login" method="post">
            <label>
              <span>Email</span>
              <input name="email" type="email" defaultValue={MAIN_ADMIN_EMAIL} autoComplete="username" required />
            </label>
            <label>
              <span>Password</span>
              <input name="password" type="password" autoComplete="current-password" required autoFocus />
            </label>
            {error === "config" ? <div className="local-login-error" role="alert">Local credentials are not configured. Add the required values to .env.local and restart the server.</div> : error ? <div className="local-login-error" role="alert">The email or password is incorrect.</div> : null}
            <button className="auth-signin" type="submit">
              Open admin dashboard <span>→</span>
            </button>
          </form>
          <div className="auth-role-note">
            <span>◎</span>
            <p>
              <strong>Testing mode</strong>
              <small>The published app uses secure ChatGPT authentication.</small>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
