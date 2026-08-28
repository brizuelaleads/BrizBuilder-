import type { Metadata, Viewport } from "next";
import { cache } from "react";
import { headers } from "next/headers";
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
import { resolveRequestBranding } from "../../db/runtime-branding";
import { shortAppName } from "../../db/branding";
import { subscriptionCountForEmail } from "../../db/supabase-push";
import { pushConfigured, vapidPublicKey } from "../../lib/push-notifications";
import { BrandHead } from "../components/BrandHead";
import { PwaRegistrar } from "../components/PwaRegistrar";
import { AuthNote, AuthShell } from "../auth/AuthShell";

export const dynamic = "force-dynamic";

/**
 * generateMetadata, generateViewport, and the page body all need the same
 * branding. React's cache() collapses them into one lookup per request rather
 * than three round-trips for an answer that cannot change mid-render.
 */
const brandingForRequest = cache(async () => {
  const requestHeaders = await headers();
  const user = await getChatGPTUser().catch(() => null);
  return resolveRequestBranding(requestHeaders, user);
});

/**
 * The workspace announces itself as the tenant's own app, not as BrizBuilder.
 *
 * iOS ignores the manifest when adding to the home screen, so the Apple
 * specific title and touch icon are set here too -- without them an iPhone
 * install falls back to the page title and a screenshot.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { branding } = await brandingForRequest();
  const icon = branding.iconUrl ?? "/brand/brizbuilder-icon.png";

  return {
    // Overrides the root layout's "%s | BrizBuilder" template: a white-label
    // install must not carry the platform's name.
    title: { absolute: branding.appName },
    description: `${branding.businessName} customer and lead workspace.`,
    // No `manifest` key here on purpose: Next renders that link without a
    // crossorigin attribute, and an anonymous manifest fetch cannot see the
    // session cookie. BrandHead below emits the link with
    // crossorigin="use-credentials" instead.
    appleWebApp: {
      capable: true,
      title: shortAppName(branding.appName),
      statusBarStyle: "default",
    },
    icons: {
      icon: [{ url: icon }],
      apple: [{ url: icon, sizes: "180x180" }],
    },
    other: { "application-name": branding.appName },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const { branding } = await brandingForRequest();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    // Colours the mobile status bar and the standalone window chrome.
    themeColor: branding.primaryColor,
  };
}

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

  // Resolved once per render and shared by the head, the shell, and the
  // settings form, so the installed app and the running app can never show
  // two different brands.
  const { branding } = await brandingForRequest();

  let crmData = null;
  try {
    crmData = await getCrmBootstrap(user);
  } catch (error) {
    if (isMissingDatabase(error)) {
      return <DatabaseSetupRequired signOutPath={signOutPath} />;
    }
    if (access.role !== "client" || !access.client) throw error;
  }
  if (crmData)
    return (
      <>
        <BrandHead branding={branding} />
        <PwaRegistrar />
        <CrmApp
          initialData={crmData}
          signOutPath={signOutPath}
          branding={branding}
        />
      </>
    );

  if (access.role === "client" && access.client) {
    const portalData = await getClientPortalData(access.client.id);
    // This branch runs because the CRM bootstrap failed, so the device count
    // is best-effort: a missing count still leaves a working opt-in button,
    // which is the whole point of putting it on this screen.
    let subscribedDevices = 0;
    try {
      subscribedDevices = await subscriptionCountForEmail(
        access.client.id,
        access.email,
      );
    } catch {
      subscribedDevices = 0;
    }
    return (
      <>
        <BrandHead branding={branding} />
        <PwaRegistrar />
        <ClientPortal
          session={{
            name: access.displayName,
            email: access.email,
            role: access.role,
          }}
          signOutPath={signOutPath}
          client={access.client}
          data={portalData}
          branding={branding}
          push={{
            configured: pushConfigured(),
            vapidPublicKey: vapidPublicKey(),
            subscribedDevices,
          }}
        />
      </>
    );
  }

  return <AccessPending name={access.displayName} signOutPath={signOutPath} />;
}
