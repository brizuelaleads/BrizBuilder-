import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  ListChecks,
  MessageSquareText,
  TrendingUp,
} from "lucide-react";
import { BrandLogo } from "./components/BrandLogo";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "Private Client Operating System",
  description:
    "BrizBuilder organizes leads, conversations, appointments, follow-ups, and revenue around the next action.",
  openGraph: {
    title: "BrizBuilder | Private Client Operating System",
    description:
      "One private workspace for leads, conversations, appointments, follow-ups, and revenue.",
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

const capabilities = [
  {
    index: "01",
    label: "Pipeline",
    title: "Every opportunity has a next step.",
    description:
      "Capture new leads, move active opportunities forward, and keep ownership clear from first response to won work.",
    icon: ListChecks,
  },
  {
    index: "02",
    label: "Conversations",
    title: "Customer context stays attached.",
    description:
      "Keep calls, texts, and account history connected to the customer and the work your team is already doing.",
    icon: MessageSquareText,
  },
  {
    index: "03",
    label: "Scheduling",
    title: "The day is visible before it starts.",
    description:
      "See today's schedule, upcoming appointments, and follow-ups without assembling the picture across separate tools.",
    icon: CalendarDays,
  },
  {
    index: "04",
    label: "Attribution",
    title: "Revenue keeps its source and context.",
    description:
      "Connect source visibility, client budgets, and won value so the team can see what is actually driving growth.",
    icon: TrendingUp,
  },
] as const;

const principles = [
  {
    index: "01",
    title: "Signal over noise",
    description:
      "Overdue tasks, unanswered leads, and upcoming appointments surface before they become problems.",
  },
  {
    index: "02",
    title: "Context stays with the work",
    description:
      "People, messages, schedules, and reporting remain connected instead of disappearing into separate apps.",
  },
  {
    index: "03",
    title: "Built around action",
    description:
      "The workspace is organized around what the team needs to do next, not around another pile of dashboards.",
  },
] as const;

export default function MarketingHome() {
  return (
    <main className={styles.pageShell}>
      <header className={styles.siteHeader}>
        <div className={`${styles.container} ${styles.navigation}`}>
          <Link className={styles.brand} href="/" aria-label="BrizBuilder home">
            <BrandLogo className={styles.brandLogo} tone="light" size={108} priority />
          </Link>

          <nav className={styles.navLinks} aria-label="Landing page navigation">
            <a href="#platform">Platform</a>
            <a href="#why">Why BrizBuilder</a>
            <a href="#access">Access</a>
          </nav>

          <Link className={styles.loginLink} href="/login">
            Log in <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className={styles.container}>
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={styles.heroMeta}>
            <p className={styles.technicalLabel}>
              BrizBuilder / Private client operating system
            </p>
            <p className={styles.liveStatus}>
              <span aria-hidden="true" /> Live workspace
            </p>
          </div>

          <div className={styles.heroGrid}>
            <h1 id="landing-title">
              Every lead, next step,{" "}
              <span>and dollar in one view.</span>
            </h1>

            <div className={styles.heroSupport}>
              <p className={styles.heroCopy}>
                Leads, conversations, appointments, follow-ups, and revenue,
                organized around what your team needs to do next.
              </p>
              <div className={styles.heroActions}>
                <Link className={`${styles.button} ${styles.primaryButton}`} href="/login">
                  Open BrizBuilder <ArrowRight aria-hidden="true" />
                </Link>
                <a className={styles.textAction} href="#platform">
                  Explore platform <ArrowRight aria-hidden="true" />
                </a>
              </div>
              <p className={styles.privateNote}>
                Private access for LB Marketing clients and team members.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.productStage} aria-labelledby="product-stage-title">
          <div className={styles.stageHeader}>
            <p className={styles.technicalLabel} id="product-stage-title">
              01 / Command center
            </p>
            <p className={styles.stageMeta}>Product view / Live workspace</p>
          </div>

          <div
            className={styles.productViewport}
            role="region"
            aria-label="BrizBuilder product preview"
            tabIndex={0}
          >
            <Image
              className={styles.dashboardImage}
              src="/landing-dashboard-dark.webp"
              alt="BrizBuilder dark-mode dashboard showing leads, tasks, appointments, and reporting"
              width={1672}
              height={941}
              sizes="(max-width: 620px) 720px, (max-width: 1280px) calc(100vw - 48px), 1220px"
              priority
              unoptimized
            />
          </div>

          <div className={styles.stageCaption}>
            <p>One operating view for the full client relationship.</p>
            <p>LB Marketing / 2026</p>
          </div>
        </section>
      </div>

      <section className={styles.platformSection} id="platform" aria-labelledby="platform-title">
        <div className={styles.container}>
          <div className={styles.sectionIntro}>
            <p className={styles.technicalLabel}>02 / Everything in one place</p>
            <h2 id="platform-title">The operation stays connected from first contact to won work.</h2>
            <p>
              Fewer handoffs between tools. More clarity about the customer,
              the next action, and the result.
            </p>
          </div>

          <div className={styles.capabilityList}>
            {capabilities.map(({ index, label, title, description, icon: Icon }) => (
              <article className={styles.capability} key={label}>
                <p className={styles.capabilityIndex}>{index}</p>
                <div className={styles.capabilityTitle}>
                  <Icon aria-hidden="true" />
                  <div>
                    <p>{label}</p>
                    <h3>{title}</h3>
                  </div>
                </div>
                <p className={styles.capabilityCopy}>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.principlesSection} id="why" aria-labelledby="why-title">
        <div className={`${styles.container} ${styles.principlesGrid}`}>
          <div className={styles.principlesHeading}>
            <p className={styles.technicalLabel}>03 / Operating principle</p>
            <h2 id="why-title">The important work should be impossible to miss.</h2>
          </div>

          <div className={styles.principleList}>
            {principles.map(({ index, title, description }) => (
              <article className={styles.principle} key={title}>
                <p>{index}</p>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.accessSection} id="access" aria-labelledby="access-title">
        <div className={`${styles.container} ${styles.accessGrid}`}>
          <p className={styles.technicalLabel}>04 / Private access</p>
          <h2 id="access-title">Serious software, deliberately private.</h2>
          <div className={styles.accessCopy}>
            <p>
              BrizBuilder is available to approved LB Marketing clients and
              team members. Accounts are provisioned by invitation.
            </p>
            <Link className={`${styles.button} ${styles.primaryButton}`} href="/login">
              Open BrizBuilder <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerRow}`}>
          <div className={styles.footerBuild}>
            <BrandLogo className={styles.footerLogo} tone="light" size={92} />
            <p>Private build / LB Marketing / 2026</p>
          </div>
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
