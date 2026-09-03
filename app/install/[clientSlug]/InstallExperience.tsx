"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  Menu,
  MonitorSmartphone,
  QrCode,
  Share2,
  SquarePlus,
  X,
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { readableInkOn } from "../../../db/branding";
import type { PublicInstallBranding } from "../../../db/install-branding";
import {
  currentInstallEnvironment,
  manualInstallGuideFor,
  type InstallEnvironment,
  type ManualInstallGuideStep,
} from "../../../lib/install-environment";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function StepIcon({ icon }: { icon: ManualInstallGuideStep["icon"] }) {
  if (icon === "share") return <Share2 aria-hidden="true" />;
  if (icon === "add") return <SquarePlus aria-hidden="true" />;
  if (icon === "menu") return <Menu aria-hidden="true" />;
  if (icon === "copy") return <Copy aria-hidden="true" />;
  return <Check aria-hidden="true" />;
}

export function InstallExperience({
  branding,
}: {
  branding: PublicInstallBranding;
}) {
  const [environment, setEnvironment] = useState<InstallEnvironment | null>(null);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [installUrl, setInstallUrl] = useState("");
  const [status, setStatus] = useState("");
  const image =
    branding.logoUrl ?? branding.iconUrl ?? "/brand/brizbuilder-icon.png";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setEnvironment(currentInstallEnvironment());
      setInstallUrl(`${window.location.origin}${window.location.pathname}`);
    });
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setStatus("");
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setShowGuide(false);
      setInstallPrompt(null);
      setStatus("Installation complete.");
      setEnvironment((current) => ({
        ...(current ?? currentInstallEnvironment()),
        standalone: true,
      }));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    setStatus("");
    if (!environment) return;

    if (installPrompt) {
      const prompt = installPrompt;
      setInstallPrompt(null);
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice.outcome === "accepted") {
          setStatus("Installation started. Follow the browser prompt to finish.");
        } else {
          setStatus("Installation cancelled. Tap Install App to see another option.");
        }
      } catch {
        setStatus("The browser prompt was unavailable. Follow the steps shown instead.");
        setShowGuide(true);
      }
      return;
    }

    setShowGuide(true);
  }

  async function copyForSafari() {
    if (!installUrl || !navigator.clipboard?.writeText) {
      setStatus("Copy the address from the browser, then paste it into Safari.");
      return;
    }
    try {
      await navigator.clipboard.writeText(installUrl);
      setStatus("Link copied. Open Safari and paste it into the address bar.");
    } catch {
      setStatus("Copy the address from the browser, then paste it into Safari.");
    }
  }

  const installed = environment?.standalone === true;
  const guide = environment ? manualInstallGuideFor(environment) : null;

  return (
    <main
      className="client-install-page"
      style={
        {
          "--install-brand": branding.primaryColor,
          "--install-ink": readableInkOn(branding.primaryColor),
        } as React.CSSProperties
      }
      data-device={installed ? "installed" : (environment?.platform ?? "checking")}
      data-browser={environment?.browser ?? "checking"}
    >
      <section className="client-install-card">
        <div className="client-install-logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- tenant assets use validated dynamic URLs. */}
          <img src={image} alt={`${branding.appName} logo`} />
        </div>
        <p>{installed ? "APP INSTALLED" : "YOUR CLIENT APP"}</p>
        <h1>{branding.appName}</h1>
        <span>
          {installed
            ? "Your app is ready to use."
            : "Your business dashboard is ready."}
        </span>

        {installed ? (
          <div className="client-install-complete" aria-live="polite">
            <Check aria-hidden="true" /> App Installed
          </div>
        ) : null}

        <div className="client-install-actions">
          {installed ? (
            <a href="/dashboard">
              Open Dashboard <ArrowRight aria-hidden="true" />
            </a>
          ) : (
            <button
              type="button"
              disabled={!environment}
              onClick={() => void install()}
            >
              <MonitorSmartphone aria-hidden="true" />
              Install App
            </button>
          )}
        </div>

        {!environment ? <small>Checking this device…</small> : null}
        {status ? (
          <small className="client-install-status" aria-live="polite">
            {status}
          </small>
        ) : null}

        <footer>Available on your phone through BrizBuilder.</footer>
      </section>

      {showGuide && guide ? (
        <div className="client-install-guide-backdrop" role="presentation">
          <section
            className="client-install-guide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-guide-title"
          >
            <header>
              <div>
                <p>{guide.eyebrow}</p>
                <h2 id="install-guide-title">{guide.title}</h2>
              </div>
              <button
                type="button"
                aria-label="Close installation guide"
                onClick={() => setShowGuide(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>

            {guide.desktopQr ? (
              <div className="client-install-qr">
                <div aria-hidden="true">
                  {installUrl ? (
                    <QRCodeCanvas
                      value={installUrl}
                      size={190}
                      level="M"
                      marginSize={2}
                    />
                  ) : (
                    <QrCode />
                  )}
                </div>
                <strong>Scan this QR code with your phone</strong>
                <span>The same branded install page will open automatically.</span>
              </div>
            ) : (
              <ol>
                {guide.steps.map((step) => (
                  <li key={step.title}>
                    <StepIcon icon={step.icon} />
                    <span>
                      <strong>{step.title}</strong>
                      {step.detail}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {guide.safariFallback ? (
              <>
                <button
                  className="client-install-copy-link"
                  type="button"
                  onClick={() => void copyForSafari()}
                >
                  <Copy aria-hidden="true" /> Copy Link for Safari
                </button>
                {status ? (
                  <small className="client-install-guide-status" aria-live="polite">
                    {status}
                  </small>
                ) : null}
              </>
            ) : (
              <button type="button" onClick={() => setShowGuide(false)}>
                Got it
              </button>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
