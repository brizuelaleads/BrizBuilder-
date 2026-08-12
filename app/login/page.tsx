import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AuthNote, AuthShell } from "../auth/AuthShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
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
    <AuthShell
      eyebrow="Secure workspace"
      title="Sign in to BrizBuilder."
      description="Accounts are created by your agency. If you do not have one yet, ask them to send you an invite."
      trustItems={["Invite only", "Server checked", "Private workspace"]}
    >
      <p>BRIZBUILDER</p>
      <h2>Sign in</h2>
      <span className="auth-card-copy">
        Enter the email and password for your workspace.
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
        <p className="auth-form-link">
          <Link href="/forgot-password">Forgot password?</Link>
        </p>
        {error ? (
          <div className="local-login-error" role="alert">
            {ERROR_COPY[error] ?? ERROR_COPY.invalid}
          </div>
        ) : null}
        <button className="auth-signin" type="submit">
          <span>Sign in</span>
          <ArrowRight aria-hidden="true" />
        </button>
      </form>
      <AuthNote title="Secure password recovery">
        Password resets are sent by a single-use email link.
      </AuthNote>
    </AuthShell>
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
