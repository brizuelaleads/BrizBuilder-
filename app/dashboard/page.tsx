import type { Metadata } from "next";
import {
  getChatGPTUser,
  signInPathForCurrentRequest,
  signOutPathForCurrentRequest,
} from "../chatgpt-auth";
import { CrmApp } from "../CrmApp";
import { ClientPortal } from "../ClientPortal";
import { getAccountAccess, getClientPortalData } from "../../db/access";
import { getCrmBootstrap } from "../../db/crm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard | BrizBuilder",
  description: "Protected BrizBuilder agency and client dashboard.",
};

function SignInScreen({ signInPath }: { signInPath: string }) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand">
          <span>BB</span>
          <strong>BrizBuilder</strong>
        </div>
        <div className="auth-story-copy">
          <p>SECURE AGENCY WORKSPACE</p>
          <h1>Every lead. Every client. Every website.</h1>
          <span>
            Admins manage the agency. Clients see only their own leads,
            contacts, appointments, tasks, and performance.
          </span>
        </div>
        <div className="auth-trust-row">
          <span>Identity verified</span>
          <span>Role protected</span>
          <span>Client data isolated</span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-card-icon">BB</span>
          <p>WELCOME TO BRIZBUILDER</p>
          <h2>Sign in to continue</h2>
          <span className="auth-card-copy">
            Use your authorized account. BrizBuilder never receives or stores
            your password.
          </span>
          <a className="auth-signin" href={signInPath}>
            Continue to dashboard <span>-&gt;</span>
          </a>
          <div className="auth-role-note">
            <span>O</span>
            <p>
              <strong>Private by default</strong>
              <small>
                Access and permissions are checked on the server every time.
              </small>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function AccessPending({ name, signOutPath }: { name: string; signOutPath: string }) {
  return (
    <main className="auth-page auth-pending-page">
      <section className="access-pending-card">
        <span>O</span>
        <p>ACCOUNT VERIFIED</p>
        <h1>Access is awaiting assignment.</h1>
        <div>
          Hi {name}. Your identity is verified, but the main administrator has
          not assigned you to a client workspace yet. No client data is visible.
        </div>
        <a href={signOutPath}>Sign out</a>
      </section>
    </main>
  );
}

export default async function DashboardPage() {
  const user = await getChatGPTUser();
  if (!user) {
    const signInPath = await signInPathForCurrentRequest("/dashboard");
    return <SignInScreen signInPath={signInPath} />;
  }

  const access = await getAccountAccess(user);
  const signOutPath = await signOutPathForCurrentRequest("/");
  if (!access) return <AccessPending name={user.displayName} signOutPath={signOutPath} />;

  let crmData = null;
  try {
    crmData = await getCrmBootstrap(user);
  } catch (error) {
    if (access.role !== "client" || !access.client) throw error;
  }
  if (crmData) return <CrmApp initialData={crmData} signOutPath={signOutPath} />;

  if (access.role === "client" && access.client) {
    const portalData = await getClientPortalData(access.client.id);
    return (
      <ClientPortal
        session={{
          name: access.displayName,
          email: access.email,
          role: access.role,
        }}
        signOutPath={signOutPath}
        client={access.client}
        data={portalData}
      />
    );
  }

  return <AccessPending name={access.displayName} signOutPath={signOutPath} />;
}
