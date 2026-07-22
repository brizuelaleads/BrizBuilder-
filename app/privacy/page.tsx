import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How BrizBuilder collects, uses, protects, and deletes account, CRM, communications, and connected Google Business Profile data.",
};

const EFFECTIVE_DATE = "July 21, 2026";

const sections = [
  ["scope", "Scope"],
  ["collect", "Information we collect"],
  ["use", "How we use information"],
  ["google", "Google user data"],
  ["communications", "Communications data"],
  ["sharing", "How information is shared"],
  ["retention", "Retention and deletion"],
  ["security", "Security"],
  ["choices", "Your choices"],
  ["children", "Children"],
  ["changes", "Changes"],
  ["contact", "Contact"],
] as const;

export default function PrivacyPage() {
  return (
    <main className="site-home terms-page">
      <header className="site-nav terms-nav">
        <Link className="site-logo" href="/" aria-label="BrizBuilder home">
          <span className="site-logo-mark" aria-hidden="true">
            BB
          </span>
          <strong>BrizBuilder</strong>
        </Link>
        <div className="site-actions">
          <Link className="site-link" href="/terms">
            Terms
          </Link>
          <Link className="site-button" href="/dashboard">
            Log in
          </Link>
        </div>
      </header>

      <section className="terms-hero">
        <p>LEGAL</p>
        <h1>Privacy Policy</h1>
        <span>Effective and last updated {EFFECTIVE_DATE}</span>
        <p>
          This Policy explains what BrizBuilder collects, why it is used, and
          the choices available to businesses, agencies, clients, and users.
        </p>
      </section>

      <div className="terms-layout">
        <aside className="terms-summary" aria-label="Privacy policy contents">
          <strong>On this page</strong>
          <nav>
            {sections.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
          <p>
            Privacy questions and deletion requests can be sent to
            brizuelaleads@gmail.com.
          </p>
        </aside>

        <article className="terms-document">
          <section id="scope">
            <h2>1. Scope</h2>
            <p>
              This Privacy Policy applies to BrizBuilder&apos;s website, CRM,
              dashboards, communications features, automations, support, and
              connected third-party services. A business or agency that uses
              BrizBuilder may also have its own privacy notice for information
              it collects from customers. That business or agency controls its
              customer relationships and is responsible for providing any
              notice or consent required by law.
            </p>
          </section>

          <section id="collect">
            <h2>2. Information we collect</h2>
            <p>Depending on how BrizBuilder is used, we may collect:</p>
            <ul>
              <li>
                account information such as name, email address, role, login
                events, organization, and assigned client workspace;
              </li>
              <li>
                business and CRM information such as contacts, leads, service
                requests, tasks, notes, appointments, websites, and workflow
                settings;
              </li>
              <li>
                communications information such as phone numbers, message
                content, call status, delivery status, consent, and opt-out
                records;
              </li>
              <li>
                connected-account information returned by providers you
                authorize, including account identifiers, profile details,
                locations, connection health, and granted permissions; and
              </li>
              <li>
                technical and security information such as timestamps,
                request metadata, audit events, device or browser details, and
                error logs.
              </li>
            </ul>
            <p>
              BrizBuilder does not ask for or store the password to a connected
              Google or Twilio account. Authorization is performed on the
              provider&apos;s own sign-in page.
            </p>
          </section>

          <section id="use">
            <h2>3. How we use information</h2>
            <p>
              We use information to provide and secure the Service, isolate
              client workspaces, operate requested integrations, send or
              receive communications authorized by the account owner,
              troubleshoot errors, maintain audit trails, prevent misuse, and
              comply with legal obligations. We may also use aggregated or
              de-identified information to understand reliability and improve
              the Service when it cannot reasonably identify a person or
              client.
            </p>
          </section>

          <section id="google">
            <h2>4. Google user data</h2>
            <p>
              When a user chooses Connect Google, BrizBuilder requests the
              Google Business Profile permission needed to manage business
              listings the user already owns or manages. Depending on the
              feature used, BrizBuilder may access authorized account and
              location identifiers, business names, categories, addresses,
              phone numbers, websites, service areas, profile status, reviews,
              and business replies.
            </p>
            <p>
              Google information is used only to show and manage the
              authorized business profile inside the correct BrizBuilder
              client workspace, synchronize requested profile information,
              display reviews, and perform a profile change or review reply
              that an authorized user explicitly approves. BrizBuilder does
              not use Google user data for advertising, sell it, or transfer it
              to data brokers.
            </p>
            <div className="terms-callout">
              <strong>Google API Services User Data Policy</strong>
              <p>
                BrizBuilder&apos;s use and transfer to any other app of information
                received from Google APIs will adhere to the Google API
                Services User Data Policy, including the Limited Use
                requirements.
              </p>
            </div>
            <p>
              Google authorization tokens are encrypted before storage. A user
              can disconnect Google in BrizBuilder or remove BrizBuilder from
              Google Account permissions at any time.
            </p>
          </section>

          <section id="communications">
            <h2>5. Communications and Twilio data</h2>
            <p>
              When Twilio is connected, BrizBuilder uses the connected
              customer-owned account to provide phone, messaging, status, and
              automation features requested by that account. The business or
              agency is responsible for recipient consent, lawful use,
              sender identification, opt-outs, registration, and retention
              duties that apply to its communications.
            </p>
          </section>

          <section id="sharing">
            <h2>6. How information is shared</h2>
            <p>
              Information may be processed by service providers that help
              operate BrizBuilder, such as Cloudflare for hosting and security,
              Supabase for database services, Google for connected Business
              Profile features, and Twilio for connected communications. Each
              provider processes information under its own terms and privacy
              practices. We may also disclose information when required by
              law, to protect rights or safety, to investigate abuse, or as
              part of a business transaction with appropriate safeguards.
            </p>
            <p>
              BrizBuilder does not sell personal information. Client data is
              not shared with another client workspace, and users receive
              access according to their assigned organization, client, and
              role.
            </p>
          </section>

          <section id="retention">
            <h2>7. Retention and deletion</h2>
            <p>
              We retain account and customer data while it is needed to provide
              the Service, meet the account owner&apos;s instructions, maintain
              security and audit records, resolve disputes, and satisfy legal
              obligations. Retention periods vary by record type and contract.
            </p>
            <p>
              Google API content is refreshed when needed and is not cached
              longer than permitted by Google&apos;s policies. Google refresh
              tokens are retained only while the connection remains active.
              Disconnecting removes the local token and selected Google profile
              association; any remaining provider disassociation is completed
              within seven business days. Backups and legally required records
              may take longer to expire but are not used for ordinary product
              activity.
            </p>
          </section>

          <section id="security">
            <h2>8. Security</h2>
            <p>
              BrizBuilder uses access controls, tenant checks, encrypted
              transport, protected deployment secrets, encrypted provider
              tokens, audit logging, and least-privilege integration scopes.
              No system is completely secure, and users must protect their
              accounts, connected providers, and authorized team access.
            </p>
          </section>

          <section id="choices">
            <h2>9. Your choices and rights</h2>
            <p>
              Authorized users can review or update many records in the
              dashboard, disconnect integrations, and manage team access. To
              request access, correction, export, restriction, or deletion of
              information, contact the business that collected the data or
              email BrizBuilder at brizuelaleads@gmail.com. We may verify the
              requester&apos;s identity and authority before acting.
            </p>
          </section>

          <section id="children">
            <h2>10. Children</h2>
            <p>
              BrizBuilder is a business service and is not directed to children
              under 13. We do not knowingly collect personal information from
              children through account registration.
            </p>
          </section>

          <section id="changes">
            <h2>11. Changes to this Policy</h2>
            <p>
              We may update this Policy as BrizBuilder, connected providers, or
              legal requirements change. The date above will be revised when an
              update is posted. Material changes will be communicated through
              the Service or another reasonable channel when required.
            </p>
          </section>

          <section id="contact">
            <h2>12. Contact</h2>
            <p>
              For privacy questions, Google data questions, or deletion
              requests, email brizuelaleads@gmail.com and identify the relevant
              BrizBuilder organization or client workspace.
            </p>
          </section>

          <footer className="terms-footer">
            <strong>Questions about privacy?</strong>
            <p>Email brizuelaleads@gmail.com.</p>
            <Link href="/">Return to BrizBuilder</Link>
          </footer>
        </article>
      </div>
    </main>
  );
}
