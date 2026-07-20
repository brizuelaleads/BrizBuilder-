import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms governing access to BrizBuilder and its CRM, communications, automation, and third-party integration features.",
};

const EFFECTIVE_DATE = "July 19, 2026";

const sections = [
  ["agreement", "Agreement"],
  ["service", "The service"],
  ["accounts", "Accounts and clients"],
  ["communications", "Twilio and communications"],
  ["compliance", "Consent and compliance"],
  ["acceptable-use", "Acceptable use"],
  ["data", "Customer data"],
  ["third-parties", "Third-party services"],
  ["automation", "Automations"],
  ["fees", "Fees"],
  ["availability", "Availability and changes"],
  ["termination", "Suspension and termination"],
  ["disclaimers", "Disclaimers and liability"],
  ["general", "General terms"],
] as const;

export default function TermsPage() {
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
          <Link className="site-link" href="/">
            Home
          </Link>
          <Link className="site-button" href="/dashboard">
            Log in
          </Link>
        </div>
      </header>

      <section className="terms-hero">
        <p>LEGAL</p>
        <h1>Terms of Service</h1>
        <span>Effective and last updated {EFFECTIVE_DATE}</span>
        <p>
          These Terms explain the rules for using BrizBuilder, including its
          CRM, communications, automation, and connected-provider features.
        </p>
      </section>

      <div className="terms-layout">
        <aside className="terms-summary" aria-label="Terms contents">
          <strong>On this page</strong>
          <nav>
            {sections.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
          <p>
            Questions can be sent through the support channel shown in your
            BrizBuilder account or on the BrizBuilder website.
          </p>
        </aside>

        <article className="terms-document">
          <section id="agreement">
            <h2>1. Agreement to these Terms</h2>
            <p>
              These Terms of Service (&quot;Terms&quot;) govern your access to and use
              of BrizBuilder (the &quot;Service&quot;). By creating an account,
              connecting an integration, or using the Service, you agree to
              these Terms. If you use BrizBuilder for a company, agency, or
              client, you represent that you have authority to accept these
              Terms for that organization.
            </p>
            <p>
              A signed order form or separate written agreement may add to
              these Terms. If it directly conflicts with these Terms, the
              signed agreement controls for that conflict.
            </p>
          </section>

          <section id="service">
            <h2>2. The Service</h2>
            <p>
              BrizBuilder provides software for managing business and client
              records, leads, websites, forms, communications, phone-system
              settings, and automated workflows. Some capabilities depend on
              third-party providers or may be released as previews. Features
              may be added, changed, limited, or removed as the Service
              develops.
            </p>
            <p>
              BrizBuilder is a software platform. It does not provide legal,
              tax, accounting, telecommunications, or regulatory advice, and
              it does not guarantee leads, sales, message delivery, search
              rankings, or other business results.
            </p>
          </section>

          <section id="accounts">
            <h2>3. Accounts, agencies, and client access</h2>
            <p>
              You must provide accurate account information, keep login and
              integration credentials secure, and promptly remove access for
              people who are no longer authorized. You are responsible for
              activity performed through your account and for assigning users
              the correct roles and client access.
            </p>
            <p>
              If you manage BrizBuilder for a client, you must have permission
              to handle that client&apos;s information, websites, phone numbers,
              communications, and connected accounts. You may not access or
              expose another client&apos;s data without authorization.
            </p>
          </section>

          <section id="communications">
            <h2>4. Twilio and communications features</h2>
            <p>
              When you connect a Twilio account, you authorize BrizBuilder to
              use the permissions you approve to read account and phone-number
              information, check connection health, configure selected phone
              numbers and webhooks, and send or receive communications that you
              or your automations initiate. Actions such as purchasing a phone
              number require your confirmation in the Service.
            </p>
            <p>
              The connected Twilio account remains owned and billed by its
              owner. The account owner is responsible for Twilio charges,
              carrier fees, taxes, account funding, number rental, usage, and
              any plan or registration required by Twilio. Connecting Twilio
              to BrizBuilder does not transfer those obligations to
              BrizBuilder, and Twilio&apos;s own terms and policies also apply.
            </p>
            <p>
              Disconnecting Twilio stops BrizBuilder from using that
              connection for new activity. It does not cancel the Twilio
              account, release phone numbers, reverse charges, or remove
              records that must be retained for operations, security, or legal
              compliance.
            </p>
          </section>

          <section id="compliance">
            <h2>5. Consent and communications compliance</h2>
            <p>
              You are the sender of communications made through your account.
              You must obtain and retain every consent required for calls and
              messages, identify the sender when required, honor opt-outs and
              do-not-contact requests, follow quiet-hour restrictions, and
              comply with applicable laws, carrier rules, and industry
              requirements, including any required A2P registration.
            </p>
            <p>
              You may not use BrizBuilder for spam, unlawful telemarketing,
              purchased contact lists without valid consent, deceptive caller
              identification, harassment, phishing, or content that is illegal
              or abusive. Call recording may be used only when all required
              notices and consents have been provided.
            </p>
            <div className="terms-callout">
              <strong>Not an emergency service</strong>
              <p>
                BrizBuilder is not a replacement for emergency calling or a
                guaranteed real-time communications service. Do not rely on it
                to contact 911, emergency responders, or for other
                safety-critical communications.
              </p>
            </div>
          </section>

          <section id="acceptable-use">
            <h2>6. Acceptable use</h2>
            <p>You may not use the Service to:</p>
            <ul>
              <li>break the law or violate another person&apos;s rights;</li>
              <li>send malware, fraud, threats, or misleading content;</li>
              <li>
                probe, bypass, or disrupt security, access controls, tenant
                separation, rate limits, or provider safeguards;
              </li>
              <li>
                scrape, resell, reverse engineer, or copy the Service except
                where applicable law expressly permits it; or
              </li>
              <li>
                place unreasonable loads on BrizBuilder or connected services.
              </li>
            </ul>
          </section>

          <section id="data">
            <h2>7. Customer data and privacy</h2>
            <p>
              You retain your rights in information and content you submit to
              BrizBuilder. You grant BrizBuilder permission to host, process,
              transmit, and display that data only as reasonably needed to
              provide, protect, support, and improve the Service and to meet
              legal obligations.
            </p>
            <p>
              You are responsible for having a lawful basis to collect and use
              customer and client data. Do not submit highly sensitive data
              unless the relevant BrizBuilder feature is expressly designed
              for it and any required written agreement is in place. No online
              system can guarantee absolute security, so you should maintain
              appropriate backups and internal safeguards.
            </p>
          </section>

          <section id="third-parties">
            <h2>8. Third-party services</h2>
            <p>
              BrizBuilder may connect with services such as Twilio, Cloudflare,
              and Supabase. Those providers operate under their own terms,
              privacy practices, pricing, limits, and availability. You are
              responsible for reviewing and maintaining the third-party
              accounts you choose to connect. BrizBuilder is not responsible
              for a third party&apos;s suspension, outage, pricing change, or
              decision to discontinue a feature.
            </p>
          </section>

          <section id="automation">
            <h2>9. Automations and generated output</h2>
            <p>
              You are responsible for reviewing workflows, templates,
              generated content, recipients, timing, and settings before
              activation. Test automations with non-production data whenever
              practical. Automated results may be incomplete or incorrect,
              and a workflow can create repeated communications or third-party
              charges if configured incorrectly.
            </p>
          </section>

          <section id="fees">
            <h2>10. Fees and billing</h2>
            <p>
              Any BrizBuilder subscription fees are described in the plan,
              order form, or checkout you accept. Unless that document says
              otherwise, third-party provider charges are separate and are
              billed directly by the provider. You authorize charges you
              explicitly approve through the Service, including phone-number
              purchases made in a connected Twilio account.
            </p>
          </section>

          <section id="availability">
            <h2>11. Availability, maintenance, and changes</h2>
            <p>
              BrizBuilder may perform maintenance, apply security controls,
              introduce usage limits, or change integrations when reasonably
              necessary. The Service may sometimes be interrupted or
              unavailable. We will use commercially reasonable efforts to keep
              it reliable, but continuous or error-free operation is not
              guaranteed.
            </p>
          </section>

          <section id="termination">
            <h2>12. Suspension and termination</h2>
            <p>
              You may stop using the Service and disconnect integrations at any
              time. BrizBuilder may limit or suspend access when reasonably
              necessary to address security risk, nonpayment, unlawful or
              abusive activity, provider requirements, or a material breach of
              these Terms. Where practical, notice and an opportunity to fix
              the issue will be provided.
            </p>
            <p>
              Ending BrizBuilder access does not automatically cancel a
              third-party account. You remain responsible for separately
              managing Twilio numbers, subscriptions, billing, and other
              connected services.
            </p>
          </section>

          <section id="disclaimers">
            <h2>13. Disclaimers and limitation of liability</h2>
            <p>
              To the fullest extent permitted by applicable law, the Service
              is provided &quot;as is&quot; and &quot;as available.&quot; BrizBuilder disclaims
              implied warranties of merchantability, fitness for a particular
              purpose, and non-infringement where those disclaimers are legally
              allowed.
            </p>
            <p>
              To the fullest extent permitted by law, BrizBuilder will not be
              liable for indirect, incidental, special, consequential,
              exemplary, or punitive damages, or for lost profits, revenue,
              data, goodwill, or business opportunity arising from the
              Service. Any direct liability will be limited to the amount paid
              for BrizBuilder during the twelve months before the event giving
              rise to the claim. These limits do not apply where applicable law
              does not permit them.
            </p>
          </section>

          <section id="general">
            <h2>14. General terms</h2>
            <p>
              You may not transfer these Terms without permission, except as
              part of a lawful business reorganization or sale. BrizBuilder
              may transfer these Terms as part of a merger, financing,
              reorganization, or sale of the Service. If any provision is
              unenforceable, the remaining provisions stay in effect. A delay
              in enforcing a provision is not a waiver.
            </p>
            <p>
              These Terms may be updated as the Service, providers, or legal
              requirements change. The effective date above will be revised
              when changes are posted. If a material change requires notice or
              consent under applicable law, it will be provided through the
              Service or another reasonable channel.
            </p>
          </section>

          <footer className="terms-footer">
            <strong>Questions about these Terms?</strong>
            <p>
              Contact BrizBuilder through the support channel displayed in
              your account or on the public BrizBuilder website.
            </p>
            <Link href="/">Return to BrizBuilder</Link>
          </footer>
        </article>
      </div>
    </main>
  );
}
