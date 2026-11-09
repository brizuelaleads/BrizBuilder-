import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandLogo } from "../components/BrandLogo";
import styles from "../landing.module.css";
import { AuraBackground } from "./AuraBackground";

export function WorkspaceShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.pageShell}>
      <AuraBackground />
      <a className={styles.skipLink} href="#main">Skip to content</a>
      <header className={styles.header}>
        <Link href="/" aria-label="BrizBuilder home"><BrandLogo tone="light" size={164} priority /></Link>
        <span className={styles.headerNote}>An LB Marketing workspace</span>
        {actions ?? <a href="mailto:brizuelaleads@gmail.com" className={styles.helpLink}>Need a hand? <ArrowUpRight aria-hidden="true" /></a>}
      </header>

      {children}
      <footer className={styles.footer}>
        <span>LB Marketing <span className={styles.footerDivider}>/</span> BrizBuilder</span>
        <nav aria-label="Legal"><a href="mailto:brizuelaleads@gmail.com">Support</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
      </footer>
    </div>
  );
}
