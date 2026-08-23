import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CircleDot,
  ListChecks,
  MessageSquareText,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { BrandLogo } from "./components/BrandLogo";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "BrizBuilder | Private CRM Platform",
  description:
    "BrizBuilder brings leads, conversations, appointments, follow-ups, reporting, and customer activity into one private workspace.",
  openGraph: {
    title: "BrizBuilder | Private CRM Platform",
    description:
      "Every lead, next step, and dollar in one private BrizBuilder workspace.",
    images: [
      {
        url: "/landing-dashboard-dark.webp",
        width: 1672,
        height: 941,
        alt: "BrizBuilder dark-mode CRM dashboard preview",
      },
    ],
  },
};

const platformFeatures = [
  {
    title: "Leads",
    description: "Capture, organize, and prioritize every lead in one central place.",
    icon: CircleDot,
  },
  {
    title: "Conversations",
    description: "Manage every customer conversation without losing context.",
    icon: MessageSquareText,
  },
  {
    title: "Calendar",
    description: "Schedule, track, and stay ahead of every appointment.",
    icon: CalendarDays,
  },
  {
    title: "Reporting",
    description: "See what matters with clear, actionable performance views.",
    icon: TrendingUp,
  },
  {
    title: "Automation",
    description: "Automate follow-ups and workflows so nothing falls through the cracks.",
    icon: ListChecks,
  },
] as const;

const accessRoles = [
  {
    title: "Agency Admin",
    description:
      "Full platform access to manage workspaces, users, automations, and client oversight.",
    icon: ShieldCheck,
    points: ["Manage clients and teams", "View all data and reports", "Configure automations"],
  },
  {
    title: "Client Owner",
    description:
      "Business-level access to manage leads, team members, and customer communication.",
    icon: Building2,
    points: ["Manage leads and pipelines", "Invite and manage team", "View reports and activity"],
  },
  {
    title: "Team Member",
    description:
      "Focused access to assigned responsibilities, conversations, appointments, and tasks.",
    icon: Users,
    points: ["Assigned leads and tasks", "Conversations and calendar", "Limited reporting access"],
  },
] as const;

const workflowSteps = [
  ["01", "Capture", "Capture leads from every source and bring them into one organized pipeline."],
  ["02", "Follow Up", "Engage leads across channels and keep every conversation tied to the right customer."],
  ["03", "Schedule", "Book appointments and manage time without the back and forth."],
  ["04", "Report", "Track what matters and make decisions based on real activity."],
] as const;

const productShowcases = [
  {
    title: "Pipeline and command center",
    description: "A live CRM dashboard for leads, appointments, follow-ups, and value.",
    className: styles.showcaseImageDashboard,
  },
  {
    title: "Daily workload",
    description: "Schedule, needs-attention, and upcoming appointment panels stay visible.",
    className: styles.showcaseImageSchedule,
  },
  {
    title: "Reporting context",
    description: "Performance and source snapshots make next actions easier to see.",
    className: styles.showcaseImageReporting,
  },
] as const;

export default function MarketingHome() {
  return (
    <main className={styles.pageShell}>
      <header className={styles.nav}>
        <div className={`${styles.container} ${styles.navInner}`}>
          <Link className={styles.logo} href="/" aria-label="BrizBuilder home">
            <BrandLogo tone="light" size={142} priority />
          </Link>

          <nav className={styles.navLinks} aria-label="Landing page navigation">
            <a href="#platform">Platform</a>
            <a href="#features">Features</a>
            <a href="#access">Access</a>
            <a href="#about">About</a>
          </nav>

          <div className={styles.navActions}>
            <Link href="/login">Log in</Link>
            <a className={styles.button} href="#access">
              Request Access
            </a>
          </div>
        </div>
      </header>

      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.container}>
          <p className={styles.eyebrow}>Private business platform - Built for LB Marketing</p>
          <h1 id="landing-title">
            Every Lead,
            <br />
            Next Step,
            <br />
            And Dollar
            <br />
            In One View.
          </h1>
          <p className={styles.heroCopy}>
            BrizBuilder brings your leads, conversations, appointments, follow-ups,
            reporting, and customer activity into one powerful workspace so your team
            always knows what needs attention next.
          </p>
          <div className={styles.heroActions}>
            <a className={`${styles.button} ${styles.primaryButton}`} href="#access">
              Request Access
            </a>
            <Link className={styles.button} href="/login">
              Log In
            </Link>
          </div>

          <div className={styles.productStage}>
            <Image
              className={styles.heroProductImage}
              src="/landing-dashboard-dark.webp"
              alt="BrizBuilder dark-mode CRM dashboard showing leads, tasks, appointments, and reporting"
              width={1672}
              height={941}
              sizes="(max-width: 900px) calc(100vw - 32px), 1020px"
              priority
              unoptimized
            />
          </div>
        </div>
      </section>

      <section className={styles.featuresSection} id="features" aria-labelledby="features-title">
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>The Platform</p>
            <h2 id="features-title">Everything Your Team Needs To Move Forward.</h2>
          </div>

          <div className={styles.cardsFive}>
            {platformFeatures.map(({ title, description, icon: Icon }) => (
              <article className={styles.featureCard} key={title}>
                <span className={styles.iconBox} aria-hidden="true">
                  <Icon />
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.privateSection} id="access" aria-labelledby="access-title">
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>Built For Private Access</p>
            <h2 id="access-title">Built Exclusively For LB Marketing And Invited Client Businesses.</h2>
          </div>

          <div className={styles.roles}>
            {accessRoles.map(({ title, description, icon: Icon, points }) => (
              <article className={styles.roleCard} key={title}>
                <span className={styles.iconBox} aria-hidden="true">
                  <Icon />
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
                <ul>
                  {points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.stepsSection} id="platform" aria-labelledby="platform-title">
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>How It Works</p>
            <h2 id="platform-title">One Workspace. Clear Next Steps.</h2>
          </div>

          <div className={styles.steps}>
            {workflowSteps.map(([number, title, description]) => (
              <article className={styles.stepCard} key={number}>
                <span className={styles.stepNumber}>{number}</span>
                <h3>
                  {number}. {title}
                </h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.showcaseSection} aria-labelledby="showcase-title">
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>Designed For Clarity. Built For Action.</p>
            <h2 id="showcase-title">See BrizBuilder In Action.</h2>
          </div>

          <div className={styles.showcaseGrid}>
            {productShowcases.map(({ title, description, className }) => (
              <article className={styles.showcase} key={title}>
                <div className={styles.showcaseTitle}>{title}</div>
                <div className={styles.showcaseMedia}>
                  <Image
                    className={`${styles.showcaseImage} ${className}`}
                    src="/landing-dashboard-dark.webp"
                    alt={`BrizBuilder CRM UI preview: ${title}`}
                    width={1672}
                    height={941}
                    sizes="(max-width: 900px) calc(100vw - 32px), 370px"
                    unoptimized
                  />
                </div>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.finalCta} id="about" aria-labelledby="about-title">
        <div className={styles.container}>
          <p className={styles.eyebrow}>Designed For Clarity. Built For Action.</p>
          <h2 id="about-title">Request Access To BrizBuilder.</h2>
          <p>
            BrizBuilder is a private platform for LB Marketing and invited client
            businesses. Request access and we will get you set up.
          </p>
          <a className={`${styles.button} ${styles.primaryButton}`} href="#access">
            Request Access <ArrowRight aria-hidden="true" />
          </a>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerGrid}`}>
          <div>
            <BrandLogo tone="light" size={148} />
            <p>A private business platform for LB Marketing and invited client businesses.</p>
          </div>
          <div>
            <h4>Platform</h4>
            <a href="#features">Features</a>
            <a href="#platform">How It Works</a>
            <a href="#access">Access</a>
          </div>
          <div>
            <h4>Company</h4>
            <a href="#about">About LB Marketing</a>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
          <div>
            <h4>Account</h4>
            <Link href="/login">Log In</Link>
            <a href="mailto:brizuelaleads@gmail.com">Support</a>
            <a className={styles.footerButton} href="#access">
              Request Access
            </a>
          </div>
        </div>
        <p className={styles.copy}>Copyright 2026 LB Marketing. All rights reserved.</p>
      </footer>
    </main>
  );
}
