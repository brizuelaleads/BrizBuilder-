import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { WorkspaceShell } from "../auth/WorkspaceShell";
import styles from "../landing.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose password",
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
    <WorkspaceShell>
      <main className={styles.main} id="main">
        <section className={styles.glassPanel} aria-labelledby="reset-title">
          <div className={styles.loginSide}>
            <h1 id="reset-title">{success ? "Password changed" : "Choose a new password"}</h1>
            {success ? (
              <>
                <p className={styles.loginCopy} role="status">You can now sign in with your new password.</p>
                <Link className={styles.signIn} href="/login">
                  Go to sign in <ArrowRight aria-hidden="true" />
                </Link>
              </>
            ) : (
              <>
                <p className={styles.loginCopy} id="password-requirements">Use at least 12 characters.</p>
                <form className={styles.loginForm} action="/api/auth/reset-password" method="post">
                  <input type="hidden" name="token" value={token} />
                  <label className={styles.field}>
                    <span>New password</span>
                    <span className={styles.inputRow}>
                      <LockKeyhole aria-hidden="true" />
                      <input name="password" type="password" autoComplete="new-password" minLength={12} aria-describedby="password-requirements" required />
                    </span>
                  </label>
                  <label className={styles.field}>
                    <span>Confirm password</span>
                    <span className={styles.inputRow}>
                      <LockKeyhole aria-hidden="true" />
                      <input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required />
                    </span>
                  </label>
                  {error ? (
                    <p className={styles.formMessage} role="alert">{ERROR_COPY[error] ?? ERROR_COPY.invalid}</p>
                  ) : null}
                  <button className={styles.signIn} type="submit">
                    <span>Change password</span><ArrowRight aria-hidden="true" />
                  </button>
                </form>
                <p className={styles.recovery}><Link href="/forgot-password">Request a new reset link</Link></p>
              </>
            )}
          </div>
          <div className={styles.welcomeSide}>
            <h2>Account<br /> security.</h2>
            <p className={styles.welcomeCopy}>Reset links expire automatically and can only be used once.</p>
          </div>
        </section>
      </main>
    </WorkspaceShell>
  );
}
