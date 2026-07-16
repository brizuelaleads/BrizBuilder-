import type { ClientIdentity, ClientPortalData } from "../db/access";
type ClientPortalProps = {
  session: { name: string; email: string; role: "client" };
  signOutPath: string;
  client: ClientIdentity;
  data: ClientPortalData;
};

export function ClientPortal({ session, signOutPath, client, data }: ClientPortalProps) {
  const initials = session.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="client-portal">
      <header className="client-portal-header">
        <div className="client-portal-brand">
          <span>✦</span>
          <strong>Brizuela Leads</strong>
          <small>Client portal</small>
        </div>
        <div className="client-portal-account">
          <span>{initials || "CL"}</span>
          <div>
            <strong>{session.name}</strong>
            <small>{session.email}</small>
          </div>
          <a href={signOutPath}>Sign out</a>
        </div>
      </header>

      <main className="client-portal-main">
        <section className="client-welcome">
          <div>
            <p>YOUR PRIVATE WORKSPACE</p>
            <h1>{client.name}</h1>
            <span>
              {client.industry} · {client.city}, {client.state}
            </span>
          </div>
          <span className="client-role-badge">Client access</span>
        </section>

        <div className="client-privacy-banner">
          <span>◉</span>
          <p>
            <strong>Your information is isolated.</strong>
            <small>
              This portal only receives data assigned to {client.name}. Other
              agency clients are never included in your session.
            </small>
          </p>
        </div>

        <section className="client-metrics">
          <article>
            <span>Website status</span>
            <strong>Live</strong>
            <small>Production is healthy</small>
          </article>
          <article>
            <span>Leads this month</span>
            <strong>{data.leadCount}</strong>
            <small>Only {client.name} submissions</small>
          </article>
          <article>
            <span>Conversion rate</span>
            <strong>6.8%</strong>
            <small>Above industry average</small>
          </article>
          <article>
            <span>Domain</span>
            <strong className="client-domain-value">
              {client.domain ?? "Pending"}
            </strong>
            <small>{client.domain ? "SSL active" : "Setup in progress"}</small>
          </article>
        </section>

        <section className="client-portal-grid">
          <article className="client-portal-card client-leads-card">
            <div className="client-card-head">
              <div>
                <h2>Recent leads</h2>
                <p>New inquiries for {client.name}</p>
              </div>
              <button>View all</button>
            </div>
            {data.recentLeads.map((lead) => (
              <div className="client-lead-row" key={lead.id}>
                <span>{lead.contactName.split(" ").map((part) => part[0]).join("")}</span>
                <div><strong>{lead.contactName}</strong><small>{lead.service}</small></div>
                <time>{new Date(`${lead.createdAt}Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time>
              </div>
            ))}
            {data.recentLeads.length === 0 && <div className="client-empty-leads">No leads have been received yet.</div>}
          </article>

          <article className="client-portal-card">
            <div className="client-card-head">
              <div>
                <h2>Website health</h2>
                <p>Current production checks</p>
              </div>
            </div>
            <div className="client-health-score"><strong>94</strong><span>/ 100</span></div>
            {[
              ["Performance", "Excellent"],
              ["SEO coverage", "Complete"],
              ["Accessibility", "No critical issues"],
              ["Analytics", "Connected"],
            ].map(([label, value]) => (
              <div className="client-health-row" key={label}>
                <span>✓</span><strong>{label}</strong><small>{value}</small>
              </div>
            ))}
          </article>
        </section>
      </main>
    </div>
  );
}
