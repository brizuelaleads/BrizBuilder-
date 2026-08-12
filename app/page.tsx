import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  LayoutDashboard,
  PanelsTopLeft,
  UsersRound,
} from "lucide-react";

export const metadata: Metadata = {
  description:
    "Launch service-business websites, landing pages, forms, and client portals from one agency workspace.",
};

const stats = [
  ["10 min", "site draft from intake"],
  ["24/7", "lead capture and routing"],
  ["1 place", "clients, forms, tasks, reports"],
];

const features = [
  {
    icon: PanelsTopLeft,
    title: "Website launch system",
    copy: "Turn a business profile into a polished service website with pages, metadata, service areas, offers, and conversion sections.",
  },
  {
    icon: LayoutDashboard,
    title: "Agency CRM",
    copy: "Track clients, leads, appointments, tasks, reports, and future marketing modules without exposing one client to another.",
  },
  {
    icon: UsersRound,
    title: "Client-ready portals",
    copy: "Give each client a clean dashboard for their own leads and performance while your team keeps the full agency view.",
  },
];

const websiteParts = [
  "Homepage",
  "Service pages",
  "Contact forms",
  "FAQ",
  "SEO metadata",
  "Schema markup",
  "Privacy and terms",
  "Mobile layout",
];

export default function MarketingHome() {
  return (
    <main className="site-home">
      <header className="site-nav">
        <Link className="site-logo" href="/">
          <span className="site-logo-mark">BB</span>
          <strong>BrizBuilder</strong>
        </Link>
        <nav aria-label="Public website navigation">
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#contact">Contact</a>
        </nav>
        <div className="site-actions">
          <Link className="site-link" href="/login">Sign in</Link>
          <Link className="site-button primary" href="/dashboard">
            Open dashboard <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section className="site-hero-public">
        <div className="site-hero-copy">
          <div className="site-kicker"><span />The workspace for service-business agencies</div>
          <h1>Build client websites. Manage every lead.</h1>
          <p>
            BrizBuilder helps an agency collect business details, generate a
            service-business website, publish it, and manage the client after
            the site goes live.
          </p>
          <div className="site-hero-actions">
            <Link className="site-button primary" href="/dashboard">
              Open dashboard <ArrowRight aria-hidden="true" />
            </Link>
            <a className="site-button" href="#workflow">See workflow</a>
          </div>
        </div>
        <figure className="site-product-shot">
          <Image
            src="/og-calm.png"
            alt="BrizBuilder dashboard with websites, leads, tasks, and appointments"
            fill
            priority
            unoptimized
            sizes="(max-width: 980px) calc(100vw - 32px), 52vw"
          />
          <figcaption>
            <span>Live workspace</span>
            Websites, leads, and client work together
          </figcaption>
        </figure>
      </section>

      <section className="site-proof-band">
        <p>One private workspace for the websites, leads, and client work that move your agency forward.</p>
        <div className="site-stats" aria-label="BrizBuilder highlights">
          {stats.map(([value, label]) => (
            <article key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="site-section" id="features">
        <div className="site-section-heading">
          <span>What it does</span>
          <h2>Built like a website platform, managed like an agency CRM.</h2>
        </div>
        <div className="site-feature-grid">
          {features.map(({ icon: Icon, title, copy }) => (
            <article key={title}>
              <span><Icon aria-hidden="true" /></span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="site-workflow-band" id="workflow">
        <div className="site-section site-split">
          <div>
            <span className="site-section-label">Client website output</span>
            <h2>Everything a home-service website needs before launch.</h2>
            <p>
              Enter the business, services, offers, photos, contact details, and
              service areas. BrizBuilder turns them into a publish-ready draft.
            </p>
          </div>
          <ul>
            {websiteParts.map((part) => (
              <li key={part}>{part}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="site-cta" id="contact">
        <div className="site-cta-inner">
          <span className="site-section-label">Ready to build</span>
          <h2>Launch the website. Keep the client work organized.</h2>
          <p>Open your private workspace to start managing clients and leads.</p>
          <Link className="site-button" href="/dashboard">
            Go to dashboard <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>

      <footer className="site-public-footer">
        <span>© 2026 BrizBuilder</span>
        <nav aria-label="Legal links">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </nav>
      </footer>
    </main>
  );
}
