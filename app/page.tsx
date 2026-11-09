import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import styles from "./landing.module.css";
import { WorkspaceShell } from "./auth/WorkspaceShell";
import { CrmShowcase, HeroReveal } from "./components/CrmShowcase";

export const metadata: Metadata = {
  title: "BrizBuilder | The LB Marketing workspace",
  description: "The workspace for LB Marketing clients and team. Leads, calls, texts, and results in one place.",
  openGraph: {
    title: "BrizBuilder | The LB Marketing workspace",
    description: "Leads, calls, texts, and results in one place for LB Marketing clients and team.",
    images: [{ url: "/landing/crm-dashboard.webp", width: 1800, height: 1125, alt: "BrizBuilder dashboard with sample records" }],
  },
};

export default function LandingPage() {
  return (
    <WorkspaceShell actions={<Link className={styles.headerButton} href="/login">Sign in <ArrowRight aria-hidden="true" /></Link>}>
      <main className={styles.landing} id="main">
        <section className={styles.hero}>
          <p className={styles.kicker}>For LB Marketing clients &amp; team</p>
          <HeroReveal lines={["All your leads.", "One workspace."]} />
          <div className={styles.heroRow}>
            <p className={styles.heroCopy}>Track every lead, call, and text, and see what your marketing is bringing in.</p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryButton} href="/login">Sign in to your workspace <ArrowRight aria-hidden="true" /></Link>
              <a className={styles.textLink} href="mailto:brizuelaleads@gmail.com?subject=BrizBuilder%20access">Request access <ArrowUpRight aria-hidden="true" /></a>
            </div>
          </div>
        </section>

        <CrmShowcase />

        <p className={styles.inviteNote}>Invitation only. Accounts are set up by LB Marketing.</p>
      </main>
    </WorkspaceShell>
  );
}
