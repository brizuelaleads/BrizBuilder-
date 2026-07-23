import type { Metadata } from "next";
import { MAIN_ADMIN_EMAIL } from "../auth-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in | BrizBuilder",
  description: "Sign in to the protected BrizBuilder dashboard.",
};

export default async function LocalLogin({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    return_to?: string | string[];
  }>;
}) {
  const { error, return_to: rawReturnTo } = await searchParams;
  const returnTo = safeLocalReturnTo(rawReturnTo);

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand">
          <span>BB</span>
          <strong>BrizBuilder</strong>
        </div>
        <div className="auth-story-copy">
          <p>SECURE DASHBOARD</p>
          <h1>Sign in to manage BrizBuilder.</h1>
          <span>
            Use the administrator credentials configured in Cloudflare. Client
            users can be added later from the dashboard.
          </span>
        </div>
        <div className="auth-trust-row">
          <span>Private dashboard</span>
          <span>Administrator access</span>
          <span>Server checked</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-card-icon">BB</span>
          <p>BRIZBUILDER</p>
          <h2>Admin sign in</h2>
          <span className="auth-card-copy">
            Enter your admin credentials to open the agency dashboard.
          </span>
          <form className="local-login-form" action="/api/local-auth/login" method="post">
            <input type="hidden" name="return_to" value={returnTo} />
            <label>
              <span>Email</span>
              <input name="email" type="email" defaultValue={MAIN_ADMIN_EMAIL} autoComplete="username" required />
            </label>
            <label>
              <span>Password</span>
              <input name="password" type="password" autoComplete="current-password" required autoFocus />
            </label>
            {error === "config" ? (
              <div className="local-login-error" role="alert">
                Login is not configured yet. Add MAIN_ADMIN_EMAIL,
                LOCAL_DEV_ADMIN_PASSWORD, and LOCAL_DEV_SESSION_TOKEN in
                Cloudflare environment variables.
              </div>
            ) : error ? (
              <div className="local-login-error" role="alert">
                The email or password is incorrect.
              </div>
            ) : null}
            <button className="auth-signin" type="submit">
              Open admin dashboard <span>-&gt;</span>
            </button>
          </form>
          <div className="auth-role-note">
            <span>O</span>
            <p>
              <strong>Protected access</strong>
              <small>
                Your password is read from Cloudflare environment variables, not
                stored in GitHub.
              </small>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function safeLocalReturnTo(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length > 16_384) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";

  try {
    const url = new URL(value, "https://brizbuilder.local");
    if (url.origin !== "https://brizbuilder.local") return "/dashboard";
    if (
      url.pathname === "/local-login" ||
      url.pathname === "/api/local-auth/login" ||
      url.pathname === "/signout-with-chatgpt"
    ) {
      return "/dashboard";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}
