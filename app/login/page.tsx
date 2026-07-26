import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in | BrizBuilder",
  description: "Sign in to your BrizBuilder workspace.",
};

const ERROR_COPY: Record<string, string> = {
  invalid: "That email or password is not correct.",
  missing: "Enter your email and password.",
  rate: "Too many sign-in attempts. Wait a minute and try again.",
  config: "Sign-in is not configured yet. Add the Supabase keys in Cloudflare.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; return_to?: string | string[] }>;
}) {
  const { error, return_to: rawReturnTo } = await searchParams;
  const returnTo = safeLoginReturnTo(rawReturnTo);

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand">
          <span>BB</span>
          <strong>BrizBuilder</strong>
        </div>
        <div className="auth-story-copy">
          <p>SECURE WORKSPACE</p>
          <h1>Sign in to BrizBuilder.</h1>
          <span>
            Accounts are created by your agency. If you do not have one yet, ask
            them to send you an invite.
          </span>
        </div>
        <div className="auth-trust-row">
          <span>Invite only</span>
          <span>Server checked</span>
          <span>Your own workspace</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-card-icon">BB</span>
          <p>BRIZBUILDER</p>
          <h2>Sign in</h2>
          <span className="auth-card-copy">
            Enter the email and password your agency gave you.
          </span>
          <form className="local-login-form" action="/api/auth/login" method="post">
            <input type="hidden" name="return_to" value={returnTo} />
            <label>
              <span>Email</span>
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
              />
            </label>
            <label>
              <span>Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            {error ? (
              <div className="local-login-error" role="alert">
                {ERROR_COPY[error] ?? ERROR_COPY.invalid}
              </div>
            ) : null}
            <button className="auth-signin" type="submit">
              Sign in <span>-&gt;</span>
            </button>
          </form>
          <div className="auth-role-note">
            <span>O</span>
            <p>
              <strong>Change your password</strong>
              <small>
                After signing in you can set your own password from the sidebar.
              </small>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function safeLoginReturnTo(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length > 16_384) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";

  try {
    const url = new URL(value, "https://brizbuilder.local");
    if (url.origin !== "https://brizbuilder.local") return "/dashboard";
    if (url.pathname === "/login" || url.pathname.startsWith("/api/auth/")) {
      return "/dashboard";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}
