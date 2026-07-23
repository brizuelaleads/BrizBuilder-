"use client";

import {
  loadConnectAndInitialize,
  type StripeConnectInstance,
} from "@stripe/connect-js";
import {
  ConnectAccountManagement,
  ConnectAccountOnboarding,
  ConnectBalances,
  ConnectComponentsProvider,
  ConnectDisputesList,
  ConnectDocuments,
  ConnectNotificationBanner,
  ConnectPayments,
  ConnectPayouts,
} from "@stripe/react-connect-js";
import { useEffect, useMemo, useState } from "react";

type StripeCapabilities = {
  accountManagement: boolean;
  onboarding: boolean;
  refunds: boolean;
  disputes: boolean;
  payouts: boolean;
  instantPayouts: boolean;
  paymentsRead: boolean;
  payoutsRead: boolean;
};

type SessionPayload = {
  clientSecret?: string;
  publishableKey?: string;
  capabilities?: StripeCapabilities;
  error?: string;
};

type WorkspaceTab =
  | "setup"
  | "overview"
  | "payments"
  | "disputes"
  | "payouts"
  | "account";

const collectionOptions = {
  fields: "eventually_due" as const,
  futureRequirements: "include" as const,
};

async function requestAccountSession(
  clientId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    "/api/integrations/stripe/account-session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
      cache: "no-store",
      signal,
    },
  );
  const body = (await response.json()) as SessionPayload;
  if (
    !response.ok ||
    !body.clientSecret ||
    !body.publishableKey ||
    !body.capabilities
  )
    throw new Error(
      body.error ?? "Stripe's secure tools could not be opened right now.",
    );
  if (
    !/^pk_(?:test|live)_[A-Za-z0-9_]+$/.test(body.publishableKey) ||
    body.clientSecret.length < 20
  )
    throw new Error("Stripe returned an invalid secure session.");
  return {
    clientSecret: body.clientSecret,
    publishableKey: body.publishableKey,
    capabilities: body.capabilities,
  };
}

export function StripeEmbeddedWorkspace({
  clientId,
  setupStatus,
  onRefresh,
}: {
  clientId: string;
  setupStatus: string | null;
  onRefresh: () => Promise<void>;
}) {
  const [connectInstance, setConnectInstance] =
    useState<StripeConnectInstance | null>(null);
  const [capabilities, setCapabilities] =
    useState<StripeCapabilities | null>(null);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const needsSetup = !["ready", "payments_ready"].includes(
    setupStatus ?? "",
  );
  const [tab, setTab] = useState<WorkspaceTab>(
    needsSetup ? "setup" : "overview",
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let instance: StripeConnectInstance | null = null;

    void requestAccountSession(clientId, controller.signal)
      .then((initial) => {
        if (!active) return;
        let firstSecret: string | null = initial.clientSecret;
        instance = loadConnectAndInitialize({
          publishableKey: initial.publishableKey,
          fetchClientSecret: async () => {
            if (firstSecret) {
              const secret = firstSecret;
              firstSecret = null;
              return secret;
            }
            return (await requestAccountSession(clientId)).clientSecret;
          },
          appearance: {
            overlays: "dialog",
            variables: {
              colorPrimary: "#635bff",
              colorBackground: "#ffffff",
              colorText: "#171827",
              colorDanger: "#c52b45",
              colorBorder: "#dedee8",
              borderRadius: "12px",
              buttonBorderRadius: "9px",
              formBorderRadius: "10px",
              fontFamily:
                "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
              fontSizeBase: "14px",
              spacingUnit: "12px",
            },
          },
          displayOptions: { showObjectIds: false },
        });
        setError("");
        setCapabilities(initial.capabilities);
        setConnectInstance(instance);
        if (!initial.capabilities.onboarding)
          setTab((current) =>
            current === "setup" ? "overview" : current,
          );
      })
      .catch((caught) => {
        if (
          active &&
          !(caught instanceof DOMException && caught.name === "AbortError")
        )
          setError(
            caught instanceof Error
              ? caught.message
              : "Stripe's secure tools could not be opened right now.",
          );
      });

    return () => {
      active = false;
      controller.abort();
      if (instance) void instance.logout().catch(() => undefined);
    };
  }, [clientId, retryKey]);

  const tabs = useMemo(() => {
    if (!capabilities) return [];
    const items: Array<{ id: WorkspaceTab; label: string }> = [];
    if (capabilities.onboarding && needsSetup)
      items.push({ id: "setup", label: "Finish setup" });
    items.push({ id: "overview", label: "Overview" });
    if (capabilities.paymentsRead)
      items.push({ id: "payments", label: "Payments" });
    if (capabilities.disputes)
      items.push({ id: "disputes", label: "Disputes" });
    if (capabilities.payoutsRead)
      items.push({ id: "payouts", label: "Payouts" });
    if (capabilities.accountManagement)
      items.push({ id: "account", label: "Account" });
    return items;
  }, [capabilities, needsSetup]);

  function componentError() {
    setError(
      "Stripe could not load this section. Refresh the secure workspace and try again.",
    );
  }

  async function finishSetup() {
    try {
      await onRefresh();
      setTab("overview");
    } catch {
      setError("Stripe setup was saved, but the status could not be refreshed.");
    }
  }

  if (error)
    return (
      <section className="crm-stripe-embedded-error" role="alert">
        <div>
          <strong>Stripe tools did not open</strong>
          <p>{error}</p>
        </div>
        <button onClick={() => setRetryKey((value) => value + 1)}>
          Try again
        </button>
      </section>
    );

  if (!connectInstance || !capabilities)
    return (
      <section
        className="crm-stripe-embedded-loading"
        aria-live="polite"
        aria-busy="true"
      >
        <span />
        <div>
          <strong>Opening the secure Stripe workspace</strong>
          <p>Stripe may ask the account owner to confirm their identity.</p>
        </div>
      </section>
    );

  return (
    <ConnectComponentsProvider connectInstance={connectInstance}>
      <section className="crm-stripe-workspace">
        <div className="crm-stripe-notifications">
          <ConnectNotificationBanner
            collectionOptions={collectionOptions}
            onNotificationsChange={({ total, actionRequired }) =>
              setNotificationCount(actionRequired || total)
            }
            onLoadError={componentError}
          />
        </div>
        <header className="crm-stripe-workspace-header">
          <nav aria-label="Stripe workspace">
            {tabs.map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? "page" : undefined}
              >
                {item.label}
                {item.id === "setup" && notificationCount > 0 ? (
                  <span>{notificationCount}</span>
                ) : null}
              </button>
            ))}
          </nav>
          <a
            href="https://dashboard.stripe.com/"
            target="_blank"
            rel="noreferrer"
          >
            Open full Stripe Dashboard
          </a>
        </header>
        <div className="crm-stripe-component">
          {tab === "setup" && capabilities.onboarding ? (
            <>
              <div className="crm-stripe-component-intro">
                <p>SECURE ACCOUNT SETUP</p>
                <h3>Finish the items Stripe needs</h3>
                <span>
                  Stripe—not BrizBuilder—checks identity and banking details.
                  Required legal questions cannot be skipped.
                </span>
              </div>
              <ConnectAccountOnboarding
                onExit={() => void finishSetup()}
                collectionOptions={collectionOptions}
                onLoadError={componentError}
              />
            </>
          ) : null}
          {tab === "overview" ? (
            capabilities.payoutsRead ? (
              <ConnectBalances onLoadError={componentError} />
            ) : (
              <div className="crm-stripe-component-empty">
                Payment history is available in the Payments tab.
              </div>
            )
          ) : null}
          {tab === "payments" && capabilities.paymentsRead ? (
            <ConnectPayments onLoadError={componentError} />
          ) : null}
          {tab === "disputes" && capabilities.disputes ? (
            <ConnectDisputesList onLoadError={componentError} />
          ) : null}
          {tab === "payouts" && capabilities.payoutsRead ? (
            <ConnectPayouts onLoadError={componentError} />
          ) : null}
          {tab === "account" && capabilities.accountManagement ? (
            <div className="crm-stripe-account-stack">
              <ConnectAccountManagement
                collectionOptions={collectionOptions}
                onLoadError={componentError}
              />
              <ConnectDocuments onLoadError={componentError} />
            </div>
          ) : null}
        </div>
      </section>
    </ConnectComponentsProvider>
  );
}
