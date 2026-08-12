import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import {
  getChatGPTUser,
  signInPathForCurrentRequest,
  signOutPathForCurrentRequest,
} from "../chatgpt-auth";
import { CrmApp } from "../CrmApp";
import { ClientPortal } from "../ClientPortal";
import { getAccountAccess, getClientPortalData } from "../../db/runtime-access";
import { getCrmBootstrap } from "../../db/runtime-crm";
import { AuthNote, AuthShell } from "../auth/AuthShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Protected BrizBuilder agency and client dashboard.",
};

function SignInScreen({ signInPath }: { signInPath: string }) {
  return (
    <AuthShell
      eyebrow="Secure agency workspace"
      title="Every lead. Every client. Every website."
      description="Admins manage the agency while each client sees only their own leads, contacts, appointments, and performance."
      trustItems={["Identity verified", "Role protected", "Client data isolated"]}
    >
      <p>WELCOME TO BRIZBUILDER</p>
      <h2>Sign in to continue</h2>
      <span className="auth-card-copy">
        Continue with your authorized account to open the dashboard.
      </span>
      <a className="auth-signin" href={signInPath}>
        <span>Continue to dashboard</span>
        <ArrowRight aria-hidden="true" />
      </a>
      <AuthNote title="Private by default">
        Access and permissions are checked on the server every time.
      </AuthNote>
    </AuthShell>
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

function DatabaseSetupRequired({ signOutPath }: { signOutPath: string }) {
  return (
    <main className="auth-page auth-pending-page">
      <section className="access-pending-card">
        <span>DB</span>
        <p>DASHBOARD LOGIN WORKS</p>
        <h1>Connect Cloudflare D1 to finish the dashboard.</h1>
        <div>
          You are signed in, but the protected CRM needs a real Cloudflare D1
          database before it can load client data, leads, tasks, and accounts.
          The public website can stay live while this is connected.
        </div>
        <a href={signOutPath}>Sign out</a>
      </section>
    </main>
  );
}

function isMissingDatabase(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("database is unavailable") ||
      error.message.includes("D1") ||
      error.message.includes("DB"))
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
    if (isMissingDatabase(error)) {
      return <DatabaseSetupRequired signOutPath={signOutPath} />;
    }
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
