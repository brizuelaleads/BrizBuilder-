import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CircleDot,
  ListChecks,
  MessageSquareText,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { BrandLogo } from "./components/BrandLogo";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "Agency Command Center",
  description:
    "BrizBuilder is a private command center for leads, conversations, appointments, and growth.",
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

const productViews = [
  {
    title: "A clear path from lead to close.",
    description:
      "Keep new inquiries, next steps, and opportunity value visible without digging through separate tools.",
    icon: CircleDot,
    cropClass: styles.pipelineCrop,
  },
  {
    title: "Know what needs attention.",
    description:
      "Surface unanswered leads, overdue tasks, and follow-ups before the work slips through the cracks.",
    icon: ListChecks,
    cropClass: styles.attentionCrop,
  },
  {
    title: "Appointments stay connected.",
    description:
      "See today's schedule and upcoming meetings in the same place as the customer record and conversation.",
    icon: CalendarDays,
    cropClass: styles.scheduleCrop,
  },
  {
    title: "Reporting tied to real work.",
    description:
      "Understand lead sources, won value, and budget performance from the activity your team already manages.",
    icon: TrendingUp,
    cropClass: styles.reportingCrop,
  },
] as const;

const operatingPrinciples = [
  {
    title: "One shared customer history",
    description: "Leads, conversations, tasks, and appointments stay connected.",
    icon: MessageSquareText,
  },
  {
    title: "The next action stays visible",
    description: "Your team can see what matters now without rebuilding context.",
    icon: ListChecks,
  },
  {
    title: "Private access by design",
    description: "Workspaces are available only to approved clients and team members.",
    icon: ShieldCheck,
  },
] as const;

export default function MarketingHome() {
  return (
    <main className={styles.pageShell}>
      <header className={styles.siteHeader}>
        <div className={`${styles.container} ${styles.navigation}`}>
          <Link className={styles.brand} href="/" aria-label="BrizBuilder home">
            <BrandLogo className={styles.brandLogo} tone="light" size={104} priority />
          </Link>

          <nav className={styles.navLinks} aria-label="Landing page navigation">
            <a href="#platform">Platform</a>
            <a href="#why">Why BrizBuilder</a>
            <a href="#access">Access</a>
          </nav>

          <div className={styles.navActions}>
            <Link className={styles.loginLink} href="/login">
              Log in
            </Link>
            <Link className={`${styles.button} ${styles.navButton}`} href="/login">
              Open BrizBuilder <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={`${styles.container} ${styles.heroGrid}`}>
          <div className={styles.heroCopyBlock}>
            <p className={styles.eyebrow}>
              <span aria-hidden="true" /> Private workspace for LB Marketing clients
            </p>
            <h1 id="landing-title">
              <span className={styles.heroLead}>Run the business</span>{" "}
              <span>from one place.</span>
            </h1>
            <p className={styles.heroCopy}>
              BrizBuilder gives your team one calm, connected workspace for
              leads, conversations, appointments, follow-ups, and reporting.
            </p>
            <div className={styles.heroActions}>
              <Link className={`${styles.button} ${styles.primaryButton}`} href="/login">
                Open BrizBuilder <ArrowRight aria-hidden="true" />
              </Link>
              <a className={styles.textLink} href="#platform">
                Explore the platform <ArrowRight aria-hidden="true" />
              </a>
            </div>
            <p className={styles.privateNote}>
              Access is reserved for approved clients and team members.
            </p>
          </div>

          <div className={styles.heroVisual}>
            <div className={styles.heroScreen}>
              <Image
                className={styles.heroDashboard}
                src="/landing-dashboard-dark.webp"
                alt="BrizBuilder dark-mode dashboard showing leads, tasks, appointments, and reporting"
                width={1672}
                height={941}
                sizes="(max-width: 767px) 760px, (max-width: 1199px) 62vw, 820px"
                priority
                unoptimized
              />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.platformSection} id="platform" aria-labelledby="platform-title">
        <div className={styles.container}>
          <div className={styles.sectionIntro}>
            <div>
              <p className={styles.sectionKicker}>The platform</p>
              <h2 id="platform-title">Everything your team needs to move work forward.</h2>
            </div>
            <p>
              The dashboard is built around the moments that move a customer
              relationship forward, from first response to booked work and clear reporting.
            </p>
          </div>

          <div className={styles.productGrid}>
            {productViews.map(({ title, description, icon: Icon, cropClass }) => (
              <article className={styles.productItem} key={title}>
                <div className={`${styles.productVisual} ${cropClass}`}>
                  <Image
                    src="/landing-dashboard-dark.webp"
                    alt=""
                    width={1672}
                    height={941}
                    sizes="(max-width: 767px) calc(100vw - 40px), 560px"
                    unoptimized
                  />
                </div>
                <div className={styles.productMeta}>
                  <Icon aria-hidden="true" />
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                    <Link className={styles.textLink} href="/login">
                      View the workspace <ArrowRight aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.whySection} id="why" aria-labelledby="why-title">
        <div className={`${styles.container} ${styles.whyGrid}`}>
          <div>
            <p className={styles.sectionKicker}>Why BrizBuilder</p>
            <h2 id="why-title">
              The work is already complicated. The software should not be.
            </h2>
          </div>
          <div className={styles.principles}>
            <p className={styles.whyCopy}>
              BrizBuilder keeps the signal close and the busywork out of the
              way, so everyone can act from the same customer context.
            </p>
            {operatingPrinciples.map(({ title, description, icon: Icon }) => (
              <div className={styles.principle} key={title}>
                <Icon aria-hidden="true" />
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.accessSection} id="access" aria-labelledby="access-title">
        <div className={`${styles.container} ${styles.accessGrid}`}>
          <div>
            <p className={styles.sectionKicker}>Private access</p>
            <h2 id="access-title">Built for the team doing the work.</h2>
          </div>
          <div className={styles.accessCopy}>
            <p>
              Sign in to your existing workspace. New BrizBuilder accounts are
              created by invitation for approved clients and team members.
            </p>
            <Link className={`${styles.button} ${styles.primaryButton}`} href="/login">
              Continue to login <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerRow}`}>
          <Link href="/" aria-label="BrizBuilder home">
            <BrandLogo className={styles.footerLogo} tone="light" size={92} />
          </Link>
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
