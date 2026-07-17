import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "BrizBuilder | Websites for service businesses",
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
    title: "Website launch system",
    copy: "Turn a business profile into a polished service website with pages, metadata, service areas, offers, and conversion sections.",
  },
  {
    title: "Agency CRM",
    copy: "Track clients, leads, appointments, tasks, reports, and future marketing modules without exposing one client to another.",
  },
  {
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
        <Link className="site-wordmark" href="/">
          <span>BB</span>
          <strong>BrizBuilder</strong>
        </Link>
        <nav aria-label="Public website navigation">
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#contact">Contact</a>
        </nav>
        <Link className="site-login" href="/dashboard">
          Login
        </Link>
      </header>

      <section className="site-hero-public">
        <div className="site-hero-copy">
          <p>FOR MARKETING AGENCIES AND SERVICE BUSINESSES</p>
          <h1>Launch client websites and manage leads from one workspace.</h1>
          <span>
            BrizBuilder helps an agency collect business details, generate a
            service-business website, publish it, and manage the client after
            the site goes live.
          </span>
          <div className="site-hero-actions">
            <Link href="/dashboard">Open dashboard</Link>
            <a href="#workflow">See workflow</a>
          </div>
        </div>
        <div className="site-product-shot" aria-label="BrizBuilder website and dashboard preview">
          <div className="site-browser-bar">
            <span />
            <span />
            <span />
            <small>brizbuilder.com</small>
          </div>
          <div className="site-preview-grid">
            <aside>
              <b>BrizBuilder</b>
              <span>Dashboard</span>
              <span>Clients</span>
              <span>Websites</span>
              <span>Leads</span>
            </aside>
            <section>
              <div>
                <p>Client website</p>
                <strong>Your client business</strong>
              </div>
              <div className="site-preview-page">
                <small>Hero section</small>
                <b>Local pest control built to convert</b>
                <i />
              </div>
              <div className="site-preview-cards">
                <span>SEO</span>
                <span>Forms</span>
                <span>Analytics</span>
              </div>
            </section>
          </div>
        </div>
      </section>

      <section className="site-stats" aria-label="BrizBuilder highlights">
        {stats.map(([value, label]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section className="site-section" id="features">
        <div className="site-section-head">
          <p>WHAT IT DOES</p>
          <h2>Built like a website platform, managed like an agency CRM.</h2>
        </div>
        <div className="site-feature-grid">
          {features.map((feature) => (
            <article key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="site-split" id="workflow">
        <div>
          <p>CLIENT WEBSITE OUTPUT</p>
          <h2>Everything a home-service website needs before launch.</h2>
          <span>
            Enter the business name, industry, city, services, offers, colors,
            photos, contact details, and service areas. BrizBuilder turns that
            into the first publish-ready draft.
          </span>
        </div>
        <ul>
          {websiteParts.map((part) => (
            <li key={part}>{part}</li>
          ))}
        </ul>
      </section>

      <section className="site-cta" id="contact">
        <p>READY TO BUILD</p>
        <h2>Use the public site for visitors. Keep the dashboard private.</h2>
        <Link href="/dashboard">Go to login</Link>
      </section>
    </main>
  );
}
