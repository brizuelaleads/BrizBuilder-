"use client";

import {
  type CSSProperties,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Download,
  Home,
  Image as ImageIcon,
  QrCode,
  Send,
  Users,
  X,
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import type { CrmClient } from "../../db/crm";
import {
  DEFAULT_BRANDING,
  HOT_LEAD_SCORE_MAX,
  HOT_LEAD_SCORE_MIN,
  NOTIFICATION_DESCRIPTIONS,
  NOTIFICATION_KEYS,
  STALE_LEAD_HOURS_MAX,
  STALE_LEAD_HOURS_MIN,
  normalizeBrandingUrl,
  normalizeHexColor,
  readableInkOn,
  shortAppName,
  type NotificationKey,
  type TenantBranding,
} from "../../db/branding";
import { installPathForSlug } from "../../db/install-branding";

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;

type BrandingSettingsProps = {
  clients: CrmClient[];
  branding: TenantBranding[];
  mutate: Mutate;
  tenantRootDomain: string | null;
};

type FormState = {
  appName: string;
  logoUrl: string;
  iconUrl: string;
  primaryColor: string;
  accentColor: string;
  subdomain: string;
  notifications: Record<NotificationKey, boolean>;
  staleLeadHours: string;
  hotLeadScore: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallState =
  | { state: "available"; event: BeforeInstallPromptEvent }
  | { state: "installed" | "ios" | "manual" };

const notificationNames: Record<NotificationKey, string> = {
  newLead: "New Lead",
  missedCall: "Missed Call",
  transcriptReady: "Transcript Ready",
  leadNotContacted: "Lead Not Contacted",
  appointmentReminder: "Appointment Reminder",
  hotLead: "Hot Lead / High Lead Score",
  reviewRequest: "Review Requests",
  dailyDigest: "Daily Digest",
};

function toFormState(value: TenantBranding | undefined): FormState {
  return {
    appName: value?.appName ?? "",
    logoUrl: value?.logoUrl ?? "",
    iconUrl:
      value?.iconUrl && value.iconUrl !== DEFAULT_BRANDING.iconUrl
        ? value.iconUrl
        : "",
    primaryColor: value?.primaryColor ?? DEFAULT_BRANDING.primaryColor,
    accentColor: value?.accentColor ?? DEFAULT_BRANDING.accentColor,
    subdomain: value?.subdomain ?? "",
    notifications: {
      ...(value?.notifications ?? DEFAULT_BRANDING.notifications),
    },
    staleLeadHours: String(
      value?.thresholds.staleLeadHours ??
        DEFAULT_BRANDING.thresholds.staleLeadHours,
    ),
    hotLeadScore: String(
      value?.thresholds.hotLeadScore ??
        DEFAULT_BRANDING.thresholds.hotLeadScore,
    ),
  };
}

function sameForm(left: FormState, right: FormState) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function useInstallPrompt() {
  const [install, setInstall] = useState<InstallState>({ state: "manual" });

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const frame = window.requestAnimationFrame(() => {
      setInstall({ state: standalone ? "installed" : ios ? "ios" : "manual" });
    });
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstall({
        state: "available",
        event: event as BeforeInstallPromptEvent,
      });
    };
    const onInstalled = () => setInstall({ state: "installed" });
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return install;
}

function AssetControl({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const image = normalizeBrandingUrl(value);

  return (
    <div className="crm-client-asset-control">
      <div className="crm-client-asset-preview">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- tenant CDN URLs are dynamic.
          <img src={image} alt="" />
        ) : (
          <ImageIcon aria-hidden="true" />
        )}
      </div>
      <div className="crm-client-asset-copy">
        <strong>{label}</strong>
        <span>{hint}</span>
        <div className="crm-client-asset-actions">
          <button type="button" onClick={() => setEditing((open) => !open)}>
            {image ? "Change image" : "Add image"}
          </button>
          {value ? (
            <button type="button" onClick={() => onChange("")}>
              Remove
            </button>
          ) : null}
        </div>
        {editing ? (
          <div className="crm-client-asset-url">
            <label>
              <span>Hosted HTTPS image</span>
              <input
                type="url"
                value={value}
                placeholder="https://cdn.example.com/image.png"
                onChange={(event) => onChange(event.target.value)}
              />
            </label>
            <small>
              Direct uploads need a secure media bucket. Use an existing hosted
              image for now.
            </small>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function BrandingSettings({
  clients,
  branding,
  mutate,
  tenantRootDomain,
}: BrandingSettingsProps) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const selectedBranding = useMemo(
    () => branding.find((entry) => entry.clientId === clientId),
    [branding, clientId],
  );
  const initialForm = toFormState(selectedBranding);
  const [form, setForm] = useState<FormState>(initialForm);
  const [baseline, setBaseline] = useState<FormState>(initialForm);
  const [synced, setSynced] = useState({
    clientId,
    branding: selectedBranding,
  });
  const [brandingOpen, setBrandingOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [installNotice, setInstallNotice] = useState("");
  const [linkFeedback, setLinkFeedback] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const qrCanvasId = `client-app-qr-${useId().replaceAll(":", "")}`;
  const installSectionRef = useRef<HTMLElement>(null);
  const installPrompt = useInstallPrompt();

  // Rendering the new tenant only after its state has been reset prevents an
  // unsaved logo, color, or notification setting from crossing tenant scope.
  if (
    synced.clientId !== clientId ||
    synced.branding !== selectedBranding
  ) {
    const next = toFormState(selectedBranding);
    setSynced({ clientId, branding: selectedBranding });
    setForm(next);
    setBaseline(next);
    setBrandingOpen(false);
    setQrUrl("");
    setError("");
    setSuccess("");
  }

  const dirty = !sameForm(form, baseline);
  const client = clients.find((entry) => entry.id === clientId);
  const previewName = form.appName.trim() || client?.businessName || "Workspace";
  const previewPrimary =
    normalizeHexColor(form.primaryColor) ?? DEFAULT_BRANDING.primaryColor;
  const previewAccent =
    normalizeHexColor(form.accentColor) ?? DEFAULT_BRANDING.accentColor;
  const previewLogo = normalizeBrandingUrl(form.logoUrl);
  const previewIcon =
    normalizeBrandingUrl(form.iconUrl) ??
    DEFAULT_BRANDING.iconUrl ??
    "/brand/brizbuilder-icon.png";
  const previewStyle = {
    "--client-brand": previewPrimary,
    "--client-accent": previewAccent,
    "--client-ink": readableInkOn(previewPrimary),
  } as CSSProperties;
  const savedSubdomain = baseline.subdomain.trim();
  const installPath = installPathForSlug(savedSubdomain);
  const installUrl = installPath
    ? tenantRootDomain
      ? `https://${tenantRootDomain}${installPath}`
      : installPath
    : null;

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!brandingOpen && !qrUrl) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setBrandingOpen(false);
      setQrUrl("");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [brandingOpen, qrUrl]);

  function updateForm(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setError("");
    setSuccess("");
  }

  function chooseClient(nextId: string) {
    if (
      dirty &&
      !window.confirm("Discard unsaved Client App changes and switch workspace?")
    ) {
      return;
    }
    setClientId(nextId);
  }

  function cancelBranding() {
    setForm(baseline);
    setError("");
    setBrandingOpen(false);
  }

  async function saveChanges(closeEditor = false) {
    if (!clientId || !dirty) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await mutate(
        {
          action: "save_client_branding",
          clientId,
          appName: form.appName,
          logoUrl: form.logoUrl,
          iconUrl: form.iconUrl,
          primaryColor: form.primaryColor,
          accentColor: form.accentColor,
          subdomain: form.subdomain,
          notifications: form.notifications,
          thresholds: {
            staleLeadHours: form.staleLeadHours,
            hotLeadScore: form.hotLeadScore,
          },
        },
        "Client App settings saved.",
      );
      setBaseline(form);
      setSuccess("Changes saved.");
      if (closeEditor) setBrandingOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Client App settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  function absoluteInstallUrl(): string | null {
    if (!installUrl) return null;
    return installUrl.startsWith("http")
      ? installUrl
      : `${window.location.origin}${installUrl}`;
  }

  async function copyInstallLink(message = "Link copied.") {
    const url = absoluteInstallUrl();
    if (!url) {
      setLinkFeedback("Add and save a Client App Address under Advanced first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setLinkFeedback(message);
    } catch {
      setLinkFeedback("Copy was blocked. Select the link above to copy it.");
    }
  }

  function clientInstallMessage(url: string) {
    return `Your ${previewName} app is ready. Tap this link to install it on your phone: ${url}`;
  }

  async function copyInstallMessage() {
    const url = absoluteInstallUrl();
    if (!url) {
      setLinkFeedback("Add and save a Client App Address under Advanced first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(clientInstallMessage(url));
      setLinkFeedback("Install message copied.");
    } catch {
      setLinkFeedback("Copy was blocked. Copy the install link above instead.");
    }
  }

  async function sendApp() {
    const url = absoluteInstallUrl();
    if (!url) {
      setLinkFeedback("Add and save a Client App Address under Advanced first.");
      return;
    }
    const shareData = {
      title: previewName,
      text: `Your ${previewName} app is ready. Tap this link to install it on your phone.`,
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        setLinkFeedback("App link shared.");
        return;
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
      }
    }
    await copyInstallLink("Sharing is unavailable here, so the link was copied.");
  }

  function showQrCode() {
    const url = absoluteInstallUrl();
    if (!url) {
      setLinkFeedback("Add and save a Client App Address under Advanced first.");
      return;
    }
    setQrUrl(url);
  }

  function downloadQrCode() {
    const canvas = document.getElementById(qrCanvasId) as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${savedSubdomain || "client-app"}-install-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function handleInstallAction() {
    setInstallNotice("");
    if (installPrompt.state === "installed") {
      setInstallNotice("This app is already installed on this device.");
      return;
    }
    if (installPrompt.state === "available") {
      await installPrompt.event.prompt();
      const choice = await installPrompt.event.userChoice;
      setInstallNotice(
        choice.outcome === "accepted"
          ? "Installation started."
          : "Installation was dismissed.",
      );
      return;
    }
    setInstallNotice(
      installPrompt.state === "ios"
        ? "iPhone: open in Safari, tap Share, then Add to Home Screen."
        : "Open your browser menu and choose Install app or Add to Home Screen.",
    );
  }

  if (!clients.length) {
    return (
      <article className="crm-settings-section">
        <h4>Client App</h4>
        <p>Add a sub-account before configuring its branded app.</p>
      </article>
    );
  }

  return (
    <div className="crm-client-app-simple">
      <div className="crm-client-app-toolbar">
        <label>
          <span>Client workspace</span>
          <select
            value={clientId}
            onChange={(event) => chooseClient(event.target.value)}
          >
            {clients.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.businessName}
              </option>
            ))}
          </select>
        </label>
        {dirty ? <span className="crm-client-unsaved">Unsaved changes</span> : null}
      </div>

      <section className="crm-client-app-hero" style={previewStyle}>
        <div className="crm-client-app-intro">
          <div className="crm-client-app-mark">
            {/* eslint-disable-next-line @next/next/no-img-element -- tenant CDN URLs are dynamic. */}
            <img src={previewLogo ?? previewIcon} alt="" />
          </div>
          <div>
            <p>Client App</p>
            <h3>{previewName}</h3>
            <span>Your client&apos;s branded mobile workspace</span>
          </div>
          <div className="crm-client-app-primary-actions">
            <button type="button" onClick={() => setBrandingOpen(true)}>
              Edit Branding
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                installSectionRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
            >
              <Send aria-hidden="true" /> Send App
            </button>
          </div>
        </div>

        <div className="crm-app-mini-phone" aria-label="Live preview">
          <div className="crm-app-mini-screen">
            <div className="crm-app-mini-status"><span>9:41</span><i /></div>
            <header>
              {/* eslint-disable-next-line @next/next/no-img-element -- tenant CDN URLs are dynamic. */}
              <img src={previewLogo ?? previewIcon} alt="" />
              <Bell aria-hidden="true" />
            </header>
            <div className="crm-app-mini-welcome">
              <small>Good morning</small>
              <strong>{shortAppName(previewName)}</strong>
            </div>
            <div className="crm-app-mini-stats">
              <div><strong>14</strong><span>New leads</span></div>
              <div><strong>82%</strong><span>Response</span></div>
            </div>
            <div className="crm-app-mini-lead">
              <div className="crm-app-mini-avatar">MJ</div>
              <div><strong>Michael Jones</strong><span>New estimate request</span></div>
              <i />
            </div>
            <nav aria-label="Preview navigation">
              <span className="active"><Home /><small>Home</small></span>
              <span><Users /><small>Leads</small></span>
              <span><CalendarDays /><small>Calendar</small></span>
            </nav>
          </div>
        </div>
      </section>

      {(success || error) ? (
        <div className={`crm-client-feedback ${error ? "error" : "success"}`}>
          {error ? null : <Check aria-hidden="true" />}
          <span>{error || success}</span>
        </div>
      ) : null}

      <section className="crm-client-install-simple" ref={installSectionRef}>
        <div>
          <p>Install App</p>
          <h4>Share the mobile workspace</h4>
          <span>
            Send one link. Your client can open it and add the app to their
            home screen.
          </span>
        </div>
        <div className="crm-client-install-link">
          {installUrl ? (
            <a href={installUrl} target="_blank" rel="noreferrer">
              {installUrl}
            </a>
          ) : (
            <span>Add a Client App Address under Advanced to create the link.</span>
          )}
          <button
            type="button"
            disabled={!installUrl}
            onClick={() => void copyInstallLink()}
          >
            <Copy aria-hidden="true" /> Copy Link
          </button>
        </div>
        <div className="crm-client-install-actions">
          <button type="button" disabled={!installUrl} onClick={() => void sendApp()}>
            <Send aria-hidden="true" /> Send to Client
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!installUrl}
            onClick={() => void copyInstallMessage()}
          >
            <Copy aria-hidden="true" /> Copy Message
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void handleInstallAction()}
          >
            <Download aria-hidden="true" /> Install App
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!installUrl}
            onClick={showQrCode}
          >
            <QrCode aria-hidden="true" /> Show QR Code
          </button>
        </div>
        {(linkFeedback || installNotice) ? (
          <p className="crm-client-install-feedback">
            {linkFeedback || installNotice}
          </p>
        ) : null}
      </section>

      <details className="crm-client-app-advanced">
        <summary>
          <span><strong>Advanced</strong>Notifications and secondary settings</span>
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="crm-client-advanced-body">
          <section>
            <div className="crm-client-section-heading">
              <h4>Notifications</h4>
              <p>Choose which activity should alert this client workspace.</p>
            </div>
            <div className="crm-client-notification-list">
              {NOTIFICATION_KEYS.map((key) => (
                <div className="crm-client-notification-row" key={key}>
                  <div>
                    <strong>{notificationNames[key]}</strong>
                    <span>{NOTIFICATION_DESCRIPTIONS[key]}</span>
                    {key === "leadNotContacted" ? (
                      <label className="crm-client-inline-number">
                        After
                        <input
                          type="number"
                          min={STALE_LEAD_HOURS_MIN}
                          max={STALE_LEAD_HOURS_MAX}
                          value={form.staleLeadHours}
                          onChange={(event) =>
                            updateForm({ staleLeadHours: event.target.value })
                          }
                        />
                        hours
                      </label>
                    ) : null}
                    {key === "hotLead" ? (
                      <label className="crm-client-inline-number">
                        Score
                        <input
                          type="number"
                          min={HOT_LEAD_SCORE_MIN}
                          max={HOT_LEAD_SCORE_MAX}
                          value={form.hotLeadScore}
                          onChange={(event) =>
                            updateForm({ hotLeadScore: event.target.value })
                          }
                        />
                        or higher
                      </label>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.notifications[key]}
                    aria-label={notificationNames[key]}
                    className="crm-client-toggle"
                    onClick={() =>
                      updateForm({
                        notifications: {
                          ...form.notifications,
                          [key]: !form.notifications[key],
                        },
                      })
                    }
                  >
                    <i />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="crm-client-secondary-settings">
            <div className="crm-client-section-heading">
              <h4>Secondary branding</h4>
              <p>Optional details used by the existing tenant PWA.</p>
            </div>
            <label>
              <span>Accent Color</span>
              <div className="crm-client-color-field">
                <input
                  type="color"
                  value={previewAccent}
                  aria-label="Accent color picker"
                  onChange={(event) =>
                    updateForm({ accentColor: event.target.value })
                  }
                />
                <input
                  value={form.accentColor}
                  spellCheck={false}
                  onChange={(event) =>
                    updateForm({ accentColor: event.target.value })
                  }
                />
              </div>
            </label>
            <label>
              <span>Client App Address</span>
              <div className="crm-client-domain-field">
                <input
                  value={form.subdomain}
                  maxLength={63}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="client-name"
                  onChange={(event) =>
                    updateForm({ subdomain: event.target.value.toLowerCase() })
                  }
                />
                {tenantRootDomain ? <em>.{tenantRootDomain}</em> : null}
              </div>
            </label>
          </section>

          <div className="crm-client-advanced-save">
            <span>{dirty ? "Unsaved changes" : "All changes saved"}</span>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => void saveChanges()}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </details>

      {brandingOpen ? (
        <div className="crm-client-branding-backdrop" role="presentation">
          <div
            className="crm-client-branding-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-branding-title"
          >
            <header>
              <div>
                <p>Client App</p>
                <h3 id="client-branding-title">Edit Branding</h3>
              </div>
              <button
                type="button"
                aria-label="Close branding editor"
                onClick={cancelBranding}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="crm-client-branding-fields">
              <label className="crm-client-text-field">
                <span>App Name</span>
                <input
                  value={form.appName}
                  maxLength={60}
                  placeholder={client?.businessName ?? "Client Workspace"}
                  onChange={(event) => updateForm({ appName: event.target.value })}
                />
                <small>
                  Appears inside the app and as {shortAppName(previewName)} on
                  the home screen.
                </small>
              </label>

              <AssetControl
                key={`${clientId}-logo`}
                label="Client Logo"
                hint="Used in the app header and dashboard."
                value={form.logoUrl}
                onChange={(logoUrl) => updateForm({ logoUrl })}
              />
              <AssetControl
                key={`${clientId}-icon`}
                label="App Icon"
                hint="Square artwork used on the home screen."
                value={form.iconUrl}
                onChange={(iconUrl) => updateForm({ iconUrl })}
              />

              <label className="crm-client-text-field">
                <span>Brand Color</span>
                <div className="crm-client-color-field primary">
                  <input
                    type="color"
                    value={previewPrimary}
                    aria-label="Brand color picker"
                    onChange={(event) =>
                      updateForm({ primaryColor: event.target.value })
                    }
                  />
                  <input
                    value={form.primaryColor}
                    spellCheck={false}
                    onChange={(event) =>
                      updateForm({ primaryColor: event.target.value })
                    }
                  />
                  <i style={{ background: previewPrimary }} />
                </div>
                <small>Applied to buttons, highlights, and the live preview.</small>
              </label>
            </div>
            <footer>
              <span>{dirty ? "Unsaved changes" : "No changes yet"}</span>
              <div>
                <button type="button" className="secondary" onClick={cancelBranding}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!dirty || saving}
                  onClick={() => void saveChanges(true)}
                >
                  {saving ? "Saving…" : "Save Branding"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}

      {qrUrl ? (
        <div className="crm-client-branding-backdrop" role="presentation">
          <section
            className="crm-client-qr-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-qr-title"
          >
            <header>
              <div className="crm-client-qr-identity">
                {/* eslint-disable-next-line @next/next/no-img-element -- tenant CDN URLs are dynamic. */}
                <img src={previewLogo ?? previewIcon} alt="" />
                <div>
                  <p>CLIENT APP</p>
                  <h3 id="client-qr-title">{previewName}</h3>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close QR code"
                onClick={() => setQrUrl("")}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <figure>
              <QRCodeCanvas
                id={qrCanvasId}
                value={qrUrl}
                size={220}
                marginSize={2}
                level="M"
                fgColor={previewPrimary}
                title={`Install ${previewName}`}
              />
              <figcaption>Scan with a phone to install the client app.</figcaption>
            </figure>
            <div className="crm-client-qr-link">{qrUrl}</div>
            {linkFeedback ? (
              <p className="crm-client-qr-feedback" aria-live="polite">
                {linkFeedback}
              </p>
            ) : null}
            <footer>
              <button type="button" onClick={() => void copyInstallLink("Link copied.")}>
                <Copy aria-hidden="true" /> Copy Link
              </button>
              <button type="button" className="secondary" onClick={downloadQrCode}>
                <Download aria-hidden="true" /> Download QR
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
