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
      "Bring leads, conversations, appointments, follow-ups, and reporting into one private workspace.",
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

const features = [
  {
    label: "01 / Leads",
    title: "One lead command center",
    description:
      "Capture, organize, and move opportunities through your process without losing track of the next step.",
    icon: CircleDot,
  },
  {
    label: "02 / Conversations",
    title: "Communication in context",
    description:
      "Keep conversations, connections, phone, and texting activity tied to the right customer and workflow.",
    icon: MessageSquareText,
  },
  {
    label: "03 / Reporting",
    title: "Know what drives results",
    description:
      "See what is happening across your workspace with source visibility, appointments, and operational reporting.",
    icon: TrendingUp,
  },
  {
    label: "04 / Scheduling",
    title: "Appointments without chaos",
    description:
      "Keep today's schedule, upcoming appointments, and follow-up activity visible from one central dashboard.",
    icon: CalendarDays,
  },
  {
    label: "05 / Follow-up",
    title: "Stay ahead of what needs action",
    description:
      "Highlight leads awaiting response, overdue tasks, and the items your team needs to handle right now.",
    icon: ListChecks,
  },
  {
    label: "06 / Control",
    title: "Private access by design",
    description:
      "BrizBuilder is built for approved clients and team members, with a cleaner and more controlled business experience.",
    icon: ShieldCheck,
  },
] as const;

export default function MarketingHome() {
  return (
    <main className={styles.pageShell}>
      <div className={styles.gridBackground} aria-hidden="true" />
      <div className={styles.ambientLight} aria-hidden="true" />

      <div className={styles.container}>
        <header className={styles.navigation}>
          <Link className={styles.brand} href="/" aria-label="BrizBuilder home">
            <BrandLogo className={styles.brandLogo} tone="light" size={112} priority />
          </Link>

          <nav className={styles.navLinks} aria-label="Landing page navigation">
            <a href="#platform">Platform</a>
            <a href="#why">Why BrizBuilder</a>
            <a href="#access">Access</a>
          </nav>

          <div className={styles.navActions}>
            <a className={`${styles.button} ${styles.secondaryButton}`} href="#access">
              Learn more
            </a>
            <Link className={`${styles.button} ${styles.primaryButton}`} href="/login">
              Log in <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </header>

      </div>

      <section className={styles.hero} aria-labelledby="landing-title">
        <Image
          className={styles.heroBackdrop}
          src="/landing-dashboard-dark.webp"
          alt="BrizBuilder dark-mode dashboard showing leads, tasks, appointments, and reporting"
          width={1672}
          height={941}
          sizes="(max-width: 620px) 850px, (max-width: 1200px) 112vw, 1500px"
          priority
          unoptimized
        />
        <div className={styles.heroVeil} aria-hidden="true" />
        <div className={styles.heroPattern} aria-hidden="true" />

        <div className={`${styles.container} ${styles.heroInner}`}>
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>Private business platform &middot; Built by LB Marketing</p>
            <h1 id="landing-title">
              <span className={styles.heroLine}>Every lead, next step,</span>{" "}
              <span className={styles.heroLine}>and dollar in one view.</span>
            </h1>
            <p className={styles.heroCopy}>
              BrizBuilder brings your leads, conversations, appointments,
              follow-ups, reporting, and customer activity into one powerful
              workspace so your team always knows what needs attention next.
            </p>
            <div className={styles.heroActions}>
              <Link className={`${styles.button} ${styles.primaryButton}`} href="/login">
                Log in to BrizBuilder <ArrowRight aria-hidden="true" />
              </Link>
              <a className={`${styles.button} ${styles.secondaryButton}`} href="#platform">
                Explore the platform
              </a>
            </div>
            <p className={styles.privateNote}>
              BrizBuilder is currently available to approved LB Marketing clients and team members.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.platformSection} id="platform" aria-labelledby="platform-title">
        <div className={styles.container}>
          <div className={styles.platformIntro}>
            <div>
              <p className={styles.sectionKicker}>The platform</p>
              <h2 className={styles.sectionTitle} id="platform-title">
                Everything your team needs to keep work moving.
              </h2>
              <p className={styles.sectionCopy}>
                Less switching between apps. Less wondering who needs a follow-up.
                More visibility from first contact to closed opportunity.
              </p>
            </div>
            <div className={styles.platformPicture}>
              <Image
                className={styles.platformImage}
                src="/landing-dashboard-dark.webp"
                alt="BrizBuilder dashboard preview for the platform overview"
                width={1672}
                height={941}
                sizes="(max-width: 900px) calc(100vw - 32px), 520px"
                unoptimized
              />
            </div>
          </div>

          <div className={styles.featureGrid}>
            {features.map(({ label, title, description, icon: Icon }) => (
              <article className={styles.feature} key={label}>
                <p className={styles.featureNumber}>{label}</p>
                <span className={styles.featureIcon} aria-hidden="true">
                  <Icon />
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.statementSection} id="why" aria-labelledby="why-title">
        <div className={styles.container}>
          <p className={styles.sectionKicker}>Why BrizBuilder</p>
          <h2 className={styles.sectionTitle} id="why-title">
            Your CRM should help the work move forward, not create more of it.
          </h2>
          <p className={styles.sectionCopy}>
            BrizBuilder is designed to make the important things obvious: who
            reached out, what needs attention, what is scheduled next, and where
            growth is coming from.
          </p>
        </div>
      </section>

      <section className={styles.accessSection} id="access" aria-labelledby="access-title">
        <div className={styles.container}>
          <div className={styles.accessPanel}>
            <div>
              <p className={styles.sectionKicker}>Private access</p>
              <h2 id="access-title">Already part of BrizBuilder?</h2>
              <p>
                Sign in to access your workspace. New accounts are created by
                invitation for approved clients and team members.
              </p>
            </div>
            <Link className={`${styles.button} ${styles.primaryButton}`} href="/login">
              Continue to login <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerRow}`}>
          <p>© 2026 BrizBuilder. Built by LB Marketing.</p>
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
