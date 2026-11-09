"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import styles from "./landing.module.css";

export function WorkspaceLogin({ returnTo = "/dashboard", error }: { returnTo?: string; error?: string }) {
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <form className={styles.loginForm} action="/api/auth/login" method="post" onSubmit={() => setPending(true)}>
      <input type="hidden" name="return_to" value={returnTo} />
      <label className={styles.field}>
        <span className={styles.srOnly}>Email address</span>
        <span className={styles.inputRow}>
          <Mail aria-hidden="true" />
          <input name="email" type="email" autoComplete="username" placeholder="Email" required />
        </span>
      </label>
      <label className={styles.srOnly} htmlFor="workspace-password">Password</label>
      <div className={styles.inputRow}>
        <LockKeyhole aria-hidden="true" />
        <input id="workspace-password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" placeholder="Password" required />
        <button className={styles.visibility} type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      {error ? <p className={styles.formMessage} role="alert">{error}</p> : null}
      <button className={styles.signIn} type="submit" disabled={pending}>
        <span>{pending ? "Signing in..." : "Sign in"}</span><ArrowRight aria-hidden="true" />
      </button>
      <p className={styles.recovery}><Link href="/forgot-password">Forgot your password?</Link></p>
    </form>
  );
}
