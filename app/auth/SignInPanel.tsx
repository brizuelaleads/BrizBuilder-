import { ArrowUpRight } from "lucide-react";
import { WorkspaceLogin } from "../WorkspaceLogin";
import styles from "../landing.module.css";

export function SignInPanel({ returnTo, error }: { returnTo?: string; error?: string }) {
  return (
    <main className={styles.main} id="main">
      <section className={styles.glassPanel} aria-label="Sign in to your workspace">
        <div className={styles.loginSide}>
          <h1>Sign in</h1>
          <WorkspaceLogin returnTo={returnTo} error={error} />
        </div>
        <div className={styles.welcomeSide}>
          <h2>Welcome <br />back.</h2>
          <p className={styles.welcomeCopy}>Your leads, conversations, and appointments, for LB Marketing clients and team.</p>
          <a className={styles.ghostButton} href="mailto:brizuelaleads@gmail.com">Request access <ArrowUpRight aria-hidden="true" /></a>
        </div>
      </section>
    </main>
  );
}
