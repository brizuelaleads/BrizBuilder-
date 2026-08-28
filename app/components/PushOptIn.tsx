"use client";

import { useEffect, useState } from "react";
import { base64UrlToUint8Array } from "../../lib/push-client";

type PushOptInProps = {
  vapidPublicKey: string | null;
  configured: boolean;
  /** Devices already registered for this user, from the bootstrap. */
  initialDeviceCount: number;
};

type Status =
  | "checking"
  | "unsupported"
  | "blocked"
  | "off"
  | "on"
  | "working";

/**
 * The client-facing control for turning phone alerts on.
 *
 * Browsers only grant notification permission from a real user gesture, so
 * this is deliberately a button rather than something that runs on mount --
 * an automatic prompt is both refused by the browser and, on iOS, spends the
 * single chance the site gets before the user is permanently blocked.
 */
export function PushOptIn({
  vapidPublicKey,
  configured,
  initialDeviceCount,
}: PushOptInProps) {
  const [status, setStatus] = useState<Status>("checking");
  const [devices, setDevices] = useState(initialDeviceCount);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [installPrompt, setInstallPrompt] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      // iOS only exposes push to a PWA that has actually been installed to the
      // home screen, so the standalone check decides whether we can even ask.
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as { standalone?: boolean }).standalone === true;
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIos && !standalone) {
        if (!cancelled) {
          setInstallPrompt(true);
          setStatus("unsupported");
        }
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("blocked");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (!cancelled) setStatus(existing ? "on" : "off");
      } catch {
        if (!cancelled) setStatus("off");
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!vapidPublicKey) return;
    setStatus("working");
    setError("");
    setNotice("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "off");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // Required by every current browser: a push that shows no notification
        // is not allowed, and this promises we always will.
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not register this device.");

      setDevices((count) => count + 1);
      setStatus("on");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not turn on alerts.");
      setStatus("off");
    }
  }

  /**
   * Proves delivery end to end without needing a real lead or call.
   * The notification is rendered by the service worker, so seeing it confirms
   * the whole chain: subscription, VAPID, encryption, and the worker itself.
   */
  async function sendTest() {
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/push/test", { method: "POST" });
      const body = (await response.json()) as { error?: string; sent?: number };
      if (!response.ok)
        throw new Error(body.error ?? "The test alert could not be sent.");
      setNotice(
        `Test alert sent to ${body.sent} ${body.sent === 1 ? "device" : "devices"}.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The test alert failed.");
    }
  }

  async function disable() {
    setStatus("working");
    setError("");
    setNotice("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setDevices((count) => Math.max(0, count - 1));
      setStatus("off");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not turn off alerts.");
      setStatus("on");
    }
  }

  if (!configured) return null;

  return (
    <article className="crm-settings-section crm-push-optin">
      <h4>Phone alerts</h4>
      {status === "unsupported" ? (
        <p>
          {installPrompt
            ? "Add this app to your home screen first, then open it from there to turn on alerts. iPhone only allows notifications for installed apps."
            : "This browser cannot receive push notifications. Open the workspace from your phone home screen to enable them."}
        </p>
      ) : status === "blocked" ? (
        <p>
          Notifications are blocked for this site. Turn them back on in your
          browser or phone settings, then reload this page.
        </p>
      ) : (
        <>
          <p>
            {status === "on"
              ? `Alerts are on for this device${devices > 1 ? ` and ${devices - 1} other` : ""}.`
              : "Get a notification on this device when something needs attention."}
          </p>
          <div className="crm-push-actions">
            {status === "on" ? (
              <>
                <button
                  type="button"
                  className="crm-button-primary"
                  onClick={() => void sendTest()}
                >
                  Send a test alert
                </button>
                <button type="button" onClick={() => void disable()}>
                  Turn off on this device
                </button>
              </>
            ) : (
              <button
                type="button"
                className="crm-button-primary"
                disabled={status === "working" || status === "checking"}
                onClick={() => void enable()}
              >
                {status === "working" ? "Working…" : "Turn on alerts"}
              </button>
            )}
          </div>
        </>
      )}
      {notice ? (
        <p className="crm-push-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="crm-form-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
