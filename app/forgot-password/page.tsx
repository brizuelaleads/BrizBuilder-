import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import { WorkspaceShell } from "../auth/WorkspaceShell";
import styles from "../landing.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset password", description: "Request a BrizBuilder password reset link." };
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  return (
    <WorkspaceShell>
      <main className={styles.main} id="main">
        <section className={styles.glassPanel} aria-label="Password recovery">
          <div className={styles.loginSide}>
            <h1>Forgot password?</h1>
            <p className={styles.loginCopy}>Enter the email you use for BrizBuilder.</p>
            {sent ? <p className={styles.formMessage} role="status">If that email belongs to a BrizBuilder account, we will send a password reset link. Check your inbox and spam folder.</p> : null}
            <form className={styles.loginForm} action="/api/auth/forgot-password" method="post">
              <label className={styles.field}>
                <span className={styles.srOnly}>Email address</span>
                <span className={styles.inputRow}><Mail aria-hidden="true" /><input name="email" type="email" autoComplete="username" placeholder="Email" required /></span>
              </label>
              <button className={styles.signIn} type="submit"><span>{sent ? "Send another link" : "Send reset link"}</span><ArrowRight aria-hidden="true" /></button>
            </form>
            <p className={styles.recovery}><Link href="/login">Back to sign in</Link></p>
          </div>
          <div className={styles.welcomeSide}>
            <p className={styles.kicker}>Account recovery</p>
            <h2>Let&apos;s get <br />you back in.</h2>
            <p className={styles.welcomeCopy}>Use the link in your email to choose a new password, then sign in to your workspace.</p>
            <div className={styles.invitation}><p>Need help accessing your account?</p><a href="mailto:brizuelaleads@gmail.com">Contact LB Marketing <ArrowRight aria-hidden="true" /></a></div>
          </div>
        </section>
      </main>
    </WorkspaceShell>
  );
}
