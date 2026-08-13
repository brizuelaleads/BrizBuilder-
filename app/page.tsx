import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  LockKeyhole,
  TrendingUp,
} from "lucide-react";
import { BrandLogo } from "./components/BrandLogo";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "Agency Command Center",
  description:
    "Capture leads, manage conversations, book appointments, and see what drives revenue in BrizBuilder.",
  openGraph: {
    title: "BrizBuilder | Agency Command Center",
    description:
      "Run leads, conversations, appointments, follow-ups, and reporting from one private workspace.",
    images: [
      {
        url: "/landing-dashboard-dark.webp",
        width: 1672,
        height: 941,
        alt: "BrizBuilder agency command center",
      },
    ],
  },
};

const navItems = [
  { label: "Platform", href: "#platform" },
  { label: "Why BrizBuilder", href: "#why" },
  { label: "Access", href: "#access" },
] as const;

const pipelineRows = [
  { label: "New lead", width: "86%", value: "248" },
  { label: "Contacted", width: "59%", value: "96" },
  { label: "Qualified", width: "39%", value: "64" },
  { label: "Booked", width: "23%", value: "32" },
  { label: "Closed", width: "12%", value: "18" },
] as const;

const appointments = [
  { name: "Discovery call", date: "May 12, 10:00 AM" },
  { name: "Strategy call", date: "May 12, 11:30 AM" },
  { name: "Onboarding call", date: "May 13, 10:00 AM" },
] as const;

export default function MarketingHome() {
  return (
    <main className={styles.pageShell}>
      <header className={styles.navShell}>
        <nav className={`${styles.container} ${styles.navigation}`} aria-label="Primary navigation">
          <Link className={styles.brand} href="/" aria-label="BrizBuilder home">
            <BrandLogo className={styles.brandLogo} tone="light" size={104} priority />
          </Link>

          <div className={styles.navLinks}>
            {navItems.map(({ label, href }) => (
              <a href={href} key={href}>{label}</a>
            ))}
          </div>

          <div className={styles.navActions}>
            <Link className={styles.loginLink} href="/login">Log in</Link>
            <Link className={styles.navCta} href="/login">
              Open BrizBuilder <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </nav>
      </header>

      <section className={`${styles.container} ${styles.hero}`} id="platform" aria-labelledby="landing-title">
        <div className={styles.heroCopyBlock}>
          <p className={styles.eyebrow}>Private business platform. Built by LB Marketing.</p>
          <h1 id="landing-title">
            Run the business
            <span>from one place.</span>
          </h1>
          <p className={styles.heroDescription}>
            Capture leads. Manage conversations. Book appointments.
            <br /> Follow up automatically. See what drives revenue.
            <br /> All in one workspace your team actually uses.
          </p>

          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href="/login">
              Open BrizBuilder <ArrowRight aria-hidden="true" />
            </Link>
            <a className={styles.secondaryButton} href="#features">Explore the platform</a>
          </div>

          <p className={styles.accessNote}>
            <LockKeyhole aria-hidden="true" />
            Available to approved LB Marketing clients and team members.
          </p>
        </div>

        <div className={styles.productStage} aria-label="BrizBuilder dashboard preview">
          <div className={styles.stageLight} aria-hidden="true" />
          <div className={styles.productFrame}>
            <Image
              src="/landing-dashboard-dark.webp"
              alt="BrizBuilder CRM dashboard showing leads, appointments, tasks, and reporting"
              width={1672}
              height={941}
              sizes="(max-width: 640px) 116vw, (max-width: 1024px) 90vw, 700px"
              priority
              unoptimized
            />
          </div>
        </div>
      </section>

      <section className={styles.features} id="features" aria-labelledby="features-title">
        <div className={`${styles.container} ${styles.sectionHeading}`}>
          <div>
            <p className={styles.eyebrow}>Control your growth</p>
            <h2 id="features-title">Everything your team needs to win.</h2>
          </div>
          <p>
            BrizBuilder brings leads, conversations, appointments, and
            follow-ups together so nothing gets missed and more turns into revenue.
          </p>
        </div>

        <div className={`${styles.container} ${styles.featureGrid}`}>
          <article className={styles.featureCard}>
            <div className={styles.miniUi} aria-label="Pipeline preview">
              <h3 className={styles.miniTitle}>Pipeline</h3>
              {pipelineRows.map(({ label, width, value }) => (
                <div className={styles.pipelineRow} key={label}>
                  <span>{label}</span>
                  <span className={styles.barTrack} aria-hidden="true">
                    <span className={styles.barFill} style={{ width }} />
                  </span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className={styles.featureCopy}>
              <span className={styles.iconBox} aria-hidden="true"><TrendingUp /></span>
              <h3>Pipeline that keeps deals moving</h3>
              <p>
                See every lead, stage, and next step so your team always knows what to do.
              </p>
              <Link href="/login">View pipeline <ArrowRight aria-hidden="true" /></Link>
            </div>
          </article>

          <article className={styles.featureCard}>
            <div className={styles.miniUi} aria-label="Upcoming appointments preview">
              <h3 className={styles.miniTitle}>Upcoming appointments</h3>
              {appointments.map(({ name, date }) => (
                <div className={styles.appointment} key={name}>
                  <CalendarDays aria-hidden="true" />
                  <span>{name}</span>
                  <small>{date}</small>
                </div>
              ))}
              <Link className={styles.miniLink} href="/login">View calendar</Link>
            </div>
            <div className={styles.featureCopy}>
              <span className={styles.iconBox} aria-hidden="true"><CalendarDays /></span>
              <h3>Appointments that fill your calendar</h3>
              <p>Book more calls, reduce no-shows, and keep your calendar full.</p>
              <Link href="/login">View calendar <ArrowRight aria-hidden="true" /></Link>
            </div>
          </article>
        </div>
      </section>

      <section className={styles.whySection} id="why" aria-labelledby="why-title">
        <div className={`${styles.container} ${styles.whyGrid}`}>
          <p className={styles.eyebrow}>Why BrizBuilder</p>
          <h2 id="why-title">The next move should always be clear.</h2>
          <p>
            One workspace keeps customer context, follow-up, appointments, and
            reporting connected. Your team spends less time switching tools and
            more time moving opportunities forward.
          </p>
        </div>
      </section>

      <section className={styles.accessSection} id="access" aria-labelledby="access-title">
        <div className={`${styles.container} ${styles.accessPanel}`}>
          <div>
            <p className={styles.eyebrow}>Private access</p>
            <h2 id="access-title">Already part of BrizBuilder?</h2>
            <p>Sign in to your workspace. New accounts are created by invitation.</p>
          </div>
          <Link className={styles.primaryButton} href="/login">
            Continue to login <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerRow}`}>
          <BrandLogo className={styles.footerLogo} tone="light" size={88} />
          <p>(c) 2026 BrizBuilder. Built by LB Marketing.</p>
          <nav className={styles.footerLinks} aria-label="Legal and support links">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href="mailto:brizuelaleads@gmail.com">Support</a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
