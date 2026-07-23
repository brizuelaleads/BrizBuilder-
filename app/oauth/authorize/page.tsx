import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getChatGPTUser,
  signInPathForCurrentRequest,
} from "../../chatgpt-auth";
import { AI_CONNECTOR_SCOPE_LABELS } from "../../../lib/ai-connector/config";
import {
  prepareAiOAuthConsent,
  publicAiOAuthError,
} from "../../../lib/ai-connector/oauth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Approve AI connection",
  description: "Review and approve secure AI access to BrizBuilder.",
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

const AUTHORIZATION_PARAMETER_NAMES = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource",
] as const;

function safeAuthorizationReturnPath(searchParams: SearchParams): string {
  const query = new URLSearchParams();
  for (const name of AUTHORIZATION_PARAMETER_NAMES) {
    const raw = searchParams[name];
    const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    for (const value of values) {
      if (value.length > 4_096 || /[\u0000-\u001F\u007F]/u.test(value)) {
        return "/oauth/authorize";
      }
      query.append(name, value);
    }
  }
  const encoded = query.toString();
  if (encoded.length > 16_384) return "/oauth/authorize";
  return encoded ? `/oauth/authorize?${encoded}` : "/oauth/authorize";
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: "32px 18px",
    background:
      "radial-gradient(circle at 15% 15%, rgba(109,93,251,.18), transparent 32%), linear-gradient(145deg, #101326 0%, #171b33 54%, #222641 100%)",
    color: "#191c2d",
  },
  card: {
    width: "min(100%, 660px)",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,.22)",
    borderRadius: 24,
    background: "#fff",
    boxShadow: "0 30px 90px rgba(5,8,24,.34)",
  },
  header: {
    padding: "25px 28px 22px",
    color: "#fff",
    background: "linear-gradient(135deg, #5e50e8, #7c68ff)",
  },
  brand: { display: "flex", alignItems: "center", gap: 11 },
  brandMark: {
    width: 38,
    height: 38,
    display: "grid",
    placeItems: "center",
    borderRadius: 11,
    color: "#171b33",
    background: "#c8ff4d",
    fontSize: 12,
    fontWeight: 900,
  },
  eyebrow: {
    margin: "18px 0 5px",
    color: "rgba(255,255,255,.72)",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: ".11em",
  },
  title: { margin: 0, fontSize: 28, lineHeight: 1.2, letterSpacing: "-.03em" },
  body: { padding: "25px 28px 29px" },
  intro: { margin: 0, color: "#606477", fontSize: 14, lineHeight: 1.65 },
  identity: {
    marginTop: 18,
    padding: "13px 15px",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    border: "1px solid #e7e5ee",
    borderRadius: 12,
    background: "#faf9ff",
    fontSize: 12,
  },
  section: { marginTop: 23 },
  sectionTitle: { margin: "0 0 10px", fontSize: 13, fontWeight: 850 },
  permissions: { margin: 0, padding: 0, display: "grid", gap: 8, listStyle: "none" },
  permission: {
    padding: "11px 12px",
    display: "grid",
    gridTemplateColumns: "28px minmax(0,1fr)",
    alignItems: "center",
    gap: 10,
    border: "1px solid #ebe9f1",
    borderRadius: 10,
    color: "#3f4354",
    background: "#fff",
    fontSize: 12,
  },
  check: {
    width: 27,
    height: 27,
    display: "grid",
    placeItems: "center",
    borderRadius: 8,
    color: "#4d3ed0",
    background: "#efedff",
    fontWeight: 900,
  },
  select: {
    width: "100%",
    minHeight: 46,
    padding: "10px 12px",
    border: "1px solid #dcd9e7",
    borderRadius: 10,
    color: "#242738",
    background: "#fff",
    font: "inherit",
    fontSize: 13,
  },
  help: { margin: "7px 0 0", color: "#7d8190", fontSize: 11, lineHeight: 1.5 },
  safety: {
    marginTop: 20,
    padding: "13px 14px",
    border: "1px solid #d9ecd8",
    borderRadius: 11,
    color: "#346446",
    background: "#f2fbf3",
    fontSize: 11,
    lineHeight: 1.55,
  },
  warning: {
    marginTop: 18,
    padding: "13px 14px",
    border: "1px solid #f0d7a8",
    borderRadius: 11,
    color: "#6f5015",
    background: "#fff9ec",
    fontSize: 11,
    lineHeight: 1.55,
  },
  actions: { marginTop: 23, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  deny: {
    minHeight: 46,
    border: "1px solid #dedce6",
    borderRadius: 10,
    color: "#555969",
    background: "#fff",
    font: "inherit",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  },
  approve: {
    minHeight: 46,
    border: 0,
    borderRadius: 10,
    color: "#fff",
    background: "#6454e8",
    boxShadow: "0 9px 24px rgba(100,84,232,.25)",
    font: "inherit",
    fontSize: 12,
    fontWeight: 850,
    cursor: "pointer",
  },
  errorCode: {
    display: "inline-block",
    padding: "5px 8px",
    borderRadius: 7,
    color: "#8d3044",
    background: "#fff0f3",
    fontFamily: "monospace",
    fontSize: 11,
  },
  dashboardLink: {
    marginTop: 20,
    minHeight: 44,
    display: "grid",
    placeItems: "center",
    borderRadius: 10,
    color: "#fff",
    background: "#6454e8",
    fontSize: 12,
    fontWeight: 800,
    textDecoration: "none",
  },
};

function ConsentError({ error }: { error: unknown }) {
  const safeError = publicAiOAuthError(error);
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <header style={styles.header}>
          <div style={styles.brand}>
            <span style={styles.brandMark}>BB</span>
            <strong>BrizBuilder</strong>
          </div>
          <p style={styles.eyebrow}>SECURE AI CONNECTION</p>
          <h1 style={styles.title}>This connection cannot be approved.</h1>
        </header>
        <div style={styles.body}>
          <p style={styles.intro}>{safeError.message}</p>
          <p style={styles.errorCode}>{safeError.code}</p>
          <p style={styles.help}>
            Return to the AI service and start the BrizBuilder connection again.
            No CRM access was granted.
          </p>
          <Link href="/?view=ai" style={styles.dashboardLink}>
            Return to BrizBuilder
          </Link>
        </div>
      </section>
    </main>
  );
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const parameters = await searchParams;
  const user = await getChatGPTUser();
  if (!user) {
    const returnTo = safeAuthorizationReturnPath(parameters);
    redirect(await signInPathForCurrentRequest(returnTo));
  }

  let consent;
  try {
    consent = await prepareAiOAuthConsent(user, parameters);
  } catch (error) {
    return <ConsentError error={error} />;
  }

  return (
    <main style={styles.page}>
      <style>{`@media(max-width:560px){.oauth-consent-actions{grid-template-columns:1fr!important}.oauth-consent-card{border-radius:18px!important}}`}</style>
      <section className="oauth-consent-card" style={styles.card}>
        <header style={styles.header}>
          <div style={styles.brand}>
            <span style={styles.brandMark}>BB</span>
            <strong>BrizBuilder</strong>
          </div>
          <p style={styles.eyebrow}>SECURE AI CONNECTION</p>
          <h1 style={styles.title}>Allow an external AI app to use your CRM?</h1>
        </header>

        <form style={styles.body} action="/api/oauth/authorize" method="post">
          <input type="hidden" name="consent_token" value={consent.consentToken} />
          <p style={styles.intro}>
            You are connecting an AI assistant to {consent.organizationName}.
            BrizBuilder will limit it to the business and permissions shown below.
          </p>

          <div style={styles.warning}>
            <strong>External app — identity not verified by BrizBuilder</strong>
            <br />
            App name: {consent.oauthClientName}
            <br />
            Returns to: {consent.oauthRedirectHost}
            <br />
            Continue only if you started this connection from an AI service you
            trust.
          </div>

          <div style={styles.identity}>
            <span>Signed in as</span>
            <strong>{consent.actorEmail}</strong>
          </div>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Choose one business</h2>
            <select
              name="client_id"
              required
              defaultValue={consent.clients.length === 1 ? consent.clients[0].id : ""}
              style={styles.select}
            >
              {consent.clients.length > 1 ? (
                <option value="" disabled>
                  Select the business this AI can access
                </option>
              ) : null}
              {consent.clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <p style={styles.help}>
              The AI cannot see other client dashboards. Connect another business
              separately if needed.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Permissions requested</h2>
            <ul style={styles.permissions}>
              {consent.requestedScopes.map((scope) => (
                <li key={scope} style={styles.permission}>
                  <span style={styles.check}>✓</span>
                  <strong>{AI_CONNECTOR_SCOPE_LABELS[scope]}</strong>
                </li>
              ))}
            </ul>
          </section>

          <div style={styles.safety}>
            BrizBuilder never shares your browser session, password, Supabase key,
            or customer-wide access. You can revoke this connection from the AI
            Connector screen.
          </div>

          <div className="oauth-consent-actions" style={styles.actions}>
            <button
              style={styles.deny}
              type="submit"
              name="decision"
              value="deny"
              formNoValidate
            >
              Cancel
            </button>
            <button
              style={styles.approve}
              type="submit"
              name="decision"
              value="approve"
            >
              Approve connection
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
