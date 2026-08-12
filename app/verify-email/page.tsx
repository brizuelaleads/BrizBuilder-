import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AuthShell } from "../auth/AuthShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify email",
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
    <AuthShell
      eyebrow="Email verification"
      title={verified ? "Email verified." : "Verify your email."}
      description="BrizBuilder uses this address only for account access and security messages."
      trustItems={["Account email only", "Single-use link", "Server checked"]}
    >
      <p>ACCOUNT SECURITY</p>
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
      <p className="auth-secondary-link auth-secondary-link-primary">
        <Link href="/login">Go to sign in <ArrowRight aria-hidden="true" /></Link>
      </p>
    </AuthShell>
  );
}
