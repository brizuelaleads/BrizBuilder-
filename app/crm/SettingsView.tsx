"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  Bell,
  Building2,
  ChevronRight,
  Download,
  KeyRound,
  Palette,
  PlugZap,
  ShieldCheck,
  Smartphone,
  UserRound,
  Upload,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type {
  CrmClient,
  CrmContact,
  CrmLead,
  CrmPermission,
  CrmProviderConnection,
  CrmRole,
  CrmTeamMember,
} from "../../db/crm";
import type { TenantBranding } from "../../db/branding";
import {
  CRM_BACKDROP_BLURS,
  CRM_BACKDROPS,
  CRM_PICKER_THEMES,
  type CrmBackdrop,
  type CrmBackdropBlur,
  type CrmTheme,
} from "../../db/theme";
import { PushOptIn } from "../components/PushOptIn";
import { BrandingSettings } from "./BrandingSettings";
import { GlassBackdrop } from "./GlassBackdrop";
import { Badge, BusinessMark } from "./ui";

/**
 * Turn a picked image into a small square PNG in the browser: fitted (never
 * cropped) into 256x256 on a transparent background. Keeps uploads tiny and
 * gives the app icon the square shape it needs.
 */
async function squareLogo(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Choose a PNG, JPEG or WebP image.");
  if (file.size > 10_000_000) throw new Error("That image is over 10 MB. Choose a smaller one.");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That image could not be read."));
      element.src = url;
    });
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare the image.");
    const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    const png = canvas.toDataURL("image/png");
    // Base64 of a 300 KB file is ~400 KB; WebP is the fallback for busy photos.
    return png.length < 400_000 ? png : canvas.toDataURL("image/webp", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Upload, replace or remove one business's logo. */
function LogoUploader({ client, logoUrl, canEdit, mutate }: { client: CrmClient; logoUrl: string | null; canEdit: boolean; mutate: Mutate }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function pick(file: File | undefined) {
    if (!file) return;
    setProblem("");
    setBusy(true);
    try {
      const image = await squareLogo(file);
      await mutate({ action: "upload_client_logo", clientId: client.id, image }, "Logo uploaded.");
    } catch (error) {
      // mutate shows server errors in the banner; image problems are shown here.
      if (error instanceof Error && /PNG|MB|image/.test(error.message)) setProblem(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await mutate({ action: "remove_client_logo", clientId: client.id }, "Logo removed.");
    } catch {
      // mutate shows the error banner.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="crm-set-logo">
      <BusinessMark name={client.businessName} logoUrl={logoUrl} className="crm-set-logo-mark" />
      <div>
        <strong>{logoUrl ? "Logo uploaded" : "No logo yet"}</strong>
        <span>PNG, JPEG or WebP. It is fitted into a square, so a square logo looks best.</span>
        {problem ? <span className="is-error" role="alert">{problem}</span> : null}
        {canEdit ? (
          <div className="crm-set-logo-actions">
            <label className={`crm-button-secondary crm-set-upload${busy ? " is-busy" : ""}`}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(event) => {
                  void pick(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <Upload aria-hidden="true" />
              {busy ? "Working..." : logoUrl ? "Replace logo" : "Upload logo"}
            </label>
            {logoUrl ? (
              <button type="button" className="crm-button-secondary" disabled={busy} onClick={() => void remove()}>
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/*
 * Settings: one place for everything a person configures, grouped by whose
 * setting it is - your own account, the businesses you manage, and the data
 * you hold. Every control here saves through an existing, permission-checked
 * server action; anything not configurable yet says so instead of pretending.
 */

type Mutate = (input: Record<string, unknown>, success: string) => Promise<unknown>;

type SectionId =
  | "profile"
  | "appearance"
  | "notifications"
  | "businesses"
  | "client-app"
  | "team"
  | "integrations"
  | "data"
  | "security";

const ROLE_LABELS: Record<CrmRole, string> = {
  LB_OWNER: "Owner",
  LB_ADMIN: "Admin",
  LB_TEAM_MEMBER: "Team member",
  SUPER_ADMIN: "Super admin",
  AGENCY_OWNER: "Agency owner",
  AGENCY_ADMIN: "Agency admin",
  AGENCY_MEMBER: "Agency member",
  CLIENT_OWNER: "Business owner",
  CLIENT_MANAGER: "Business manager",
  CLIENT_EMPLOYEE: "Employee",
};

const TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

// Providers a business connects, in the order a business usually sets them up.
const PROVIDERS: Array<{ id: string; name: string; does: string }> = [
  { id: "twilio", name: "Twilio", does: "Business phone number, calls and texts" },
  { id: "callrail", name: "CallRail", does: "Call tracking and call summaries" },
  { id: "meta_ads", name: "Meta Ads", does: "Ad spend and campaign results" },
  { id: "meta", name: "Meta Conversions", does: "Sends leads and sales back to Meta" },
  { id: "google_calendar", name: "Google Calendar", does: "Appointments on the business calendar" },
  { id: "stripe", name: "Stripe", does: "Card payments" },
  { id: "square", name: "Square", does: "Invoices and payments" },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SectionHead({ title, text }: { title: string; text: string }) {
  return (
    <header className="crm-set-head">
      <h3>{title}</h3>
      <p>{text}</p>
    </header>
  );
}

function Card({ title, text, children, aside }: { title?: string; text?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="crm-panel crm-set-card">
      {title ? (
        <header>
          <div>
            <h4>{title}</h4>
            {text ? <p>{text}</p> : null}
          </div>
          {aside}
        </header>
      ) : null}
      <div className="crm-set-card-body">{children}</div>
    </section>
  );
}

/** Change your own password: two fields, checked here and again on the server. */
function PasswordForm({ mutate }: { mutate: Mutate }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const tooShort = password.length > 0 && password.length < 12;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= 12 && confirm === password;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setDone(false);
    try {
      await mutate({ action: "change_own_password", password }, "Password changed.");
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch {
      // mutate shows the server's reason in the error banner.
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="crm-set-form" onSubmit={(event) => void submit(event)}>
      <label>
        <span>New password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setDone(false);
          }}
          aria-invalid={tooShort}
        />
        <small className={tooShort ? "is-error" : undefined}>At least 12 characters.</small>
      </label>
      <label>
        <span>Confirm new password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          aria-invalid={mismatch}
        />
        {mismatch ? <small className="is-error">The passwords do not match.</small> : null}
      </label>
      <footer>
        {done ? <span className="crm-set-saved">Password changed.</span> : null}
        <button type="submit" className="crm-button-primary" disabled={!ready || busy}>
          {busy ? "Saving..." : "Change password"}
        </button>
      </footer>
    </form>
  );
}

/** One business's profile. Keyed by business so switching resets the form. */
function BusinessForm({ client, canEdit, mutate }: { client: CrmClient; canEdit: boolean; mutate: Mutate }) {
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true);
    try {
      await mutate(
        {
          action: "update_client",
          clientId: client.id,
          businessName: value("businessName"),
          industry: value("industry"),
          website: value("website"),
          phone: value("phone"),
          email: value("email"),
          address: value("address"),
          city: value("city"),
          state: value("state"),
          zip: value("zip"),
          timeZone: value("timeZone"),
          monthlyAdBudgetCents: Math.round(Number(value("monthlyAdBudget") || 0) * 100),
          assignedAccountManager: value("assignedAccountManager"),
          serviceAreas: value("serviceAreas"),
          notes: value("notes"),
        },
        `${value("businessName") || "Business"} saved.`,
      );
      setDirty(false);
    } catch {
      // mutate shows the server's reason in the error banner.
    } finally {
      setBusy(false);
    }
  }

  const zones = TIME_ZONES.includes(client.timeZone) ? TIME_ZONES : [client.timeZone, ...TIME_ZONES];

  return (
    <form className="crm-set-form is-grid" onSubmit={(event) => void submit(event)} onChange={() => setDirty(true)}>
      <fieldset disabled={!canEdit || busy}>
        <legend>Business</legend>
        <label className="is-wide">
          <span>Business name</span>
          <input name="businessName" defaultValue={client.businessName} required maxLength={160} />
        </label>
        <label>
          <span>Industry</span>
          <input name="industry" defaultValue={client.industry} required maxLength={100} />
        </label>
        <label>
          <span>Website</span>
          <input name="website" type="url" defaultValue={client.website ?? ""} placeholder="https://" maxLength={200} />
        </label>
      </fieldset>
      <fieldset disabled={!canEdit || busy}>
        <legend>Contact</legend>
        <label>
          <span>Phone</span>
          <input name="phone" type="tel" defaultValue={client.phone ?? ""} maxLength={40} />
        </label>
        <label>
          <span>Email</span>
          <input name="email" type="email" defaultValue={client.email ?? ""} maxLength={160} />
        </label>
        <label className="is-wide">
          <span>Street address</span>
          <input name="address" defaultValue={client.address ?? ""} maxLength={240} />
        </label>
        <label>
          <span>City</span>
          <input name="city" defaultValue={client.city} maxLength={80} />
        </label>
        <div className="crm-set-pair">
          <label>
            <span>State</span>
            <input name="state" defaultValue={client.state} maxLength={30} />
          </label>
          <label>
            <span>ZIP</span>
            <input name="zip" defaultValue={client.zip} maxLength={20} />
          </label>
        </div>
      </fieldset>
      <fieldset disabled={!canEdit || busy}>
        <legend>Operations</legend>
        <label>
          <span>Time zone</span>
          <select name="timeZone" defaultValue={client.timeZone}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace("America/", "").replace("Pacific/", "").replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Monthly ad budget ($)</span>
          <input name="monthlyAdBudget" type="number" min="0" step="1" defaultValue={client.monthlyAdBudgetCents ? Math.round(client.monthlyAdBudgetCents / 100) : ""} />
        </label>
        <label>
          <span>Account manager</span>
          <input name="assignedAccountManager" defaultValue={client.assignedAccountManager ?? ""} maxLength={120} />
        </label>
        <label className="is-wide">
          <span>Service areas</span>
          <input name="serviceAreas" defaultValue={client.serviceAreas.join(", ")} placeholder="Austin, Round Rock, Georgetown" />
          <small>Separate towns with commas.</small>
        </label>
        <label className="is-wide">
          <span>Internal notes</span>
          <textarea name="notes" rows={3} defaultValue={client.notes} maxLength={1500} />
        </label>
      </fieldset>
      {canEdit ? (
        <footer>
          {dirty ? <span className="crm-set-unsaved">Unsaved changes</span> : null}
          <button type="submit" className="crm-button-primary" disabled={busy || !dirty}>
            {busy ? "Saving..." : "Save business"}
          </button>
        </footer>
      ) : (
        <p className="crm-set-muted">Only agency admins can change business details.</p>
      )}
    </form>
  );
}

export function SettingsView({
  organizationName,
  viewer,
  clients,
  branding,
  mutate,
  tenantRootDomain,
  appearance,
  push,
  providerConnections,
  team,
  leads,
  contacts,
  selectedClientId,
  onNavigate,
}: {
  organizationName: string;
  viewer: { name: string; email: string; role: CrmRole; permissions: CrmPermission[] };
  clients: CrmClient[];
  branding: TenantBranding[];
  mutate: Mutate;
  tenantRootDomain: string | null;
  appearance: {
    theme: CrmTheme;
    onTheme: (theme: CrmTheme) => void;
    glass: boolean;
    backdrop: CrmBackdrop;
    onBackdrop: (backdrop: CrmBackdrop) => void;
    blur: CrmBackdropBlur;
    onBlur: (blur: CrmBackdropBlur) => void;
  };
  push: { configured: boolean; vapidPublicKey: string | null; subscribedDevices: number };
  providerConnections: CrmProviderConnection[];
  team: CrmTeamMember[];
  leads: CrmLead[];
  contacts: CrmContact[];
  selectedClientId: string;
  onNavigate: (view: "team" | "connections") => void;
}) {
  const can = (permission: CrmPermission) => viewer.permissions.includes(permission);
  const sections: Array<{ id: SectionId; label: string; icon: LucideIcon; group: string; show: boolean }> = [
    { id: "profile", label: "Profile & password", icon: UserRound, group: "Your account", show: true },
    { id: "appearance", label: "Appearance", icon: Palette, group: "Your account", show: true },
    { id: "notifications", label: "Notifications", icon: Bell, group: "Your account", show: true },
    { id: "businesses", label: "Business profiles", icon: Building2, group: "Businesses", show: clients.length > 0 },
    { id: "client-app", label: "Client app", icon: Smartphone, group: "Businesses", show: can("clients.manage") },
    { id: "team", label: "Team & access", icon: UsersRound, group: "Businesses", show: can("team.manage") },
    { id: "integrations", label: "Integrations", icon: PlugZap, group: "Businesses", show: true },
    { id: "data", label: "Export data", icon: Download, group: "Data", show: true },
    { id: "security", label: "Privacy & security", icon: ShieldCheck, group: "Data", show: true },
  ];
  const visible = sections.filter((section) => section.show);
  const [section, setSection] = useState<SectionId>("profile");
  const active = visible.some((item) => item.id === section) ? section : "profile";

  const [businessId, setBusinessId] = useState<string>(
    clients.some((c) => c.id === selectedClientId) ? selectedClientId : (clients[0]?.id ?? ""),
  );
  const business = clients.find((c) => c.id === businessId) ?? clients[0];

  const scopeName =
    clients.find((c) => c.id === selectedClientId)?.businessName ??
    (clients.length === 1 ? clients[0].businessName : "all businesses");

  const providerStatus = useMemo(
    () =>
      PROVIDERS.map((provider) => {
        const rows = providerConnections.filter((connection) => connection.provider === provider.id);
        const connected = rows.filter((connection) => connection.isActive || connection.isLinked);
        return { ...provider, connected: connected.length, total: rows.length };
      }),
    [providerConnections],
  );

  const roleCounts = useMemo(() => {
    const active = team.filter((member) => member.status === "active");
    return {
      total: active.length,
      agency: active.filter((member) => !member.clientId).length,
      business: active.filter((member) => member.clientId).length,
      pending: active.filter((member) => !member.lastLoginAt).length,
      members: active.slice(0, 6),
    };
  }, [team]);

  const groups = [...new Set(visible.map((item) => item.group))];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="crm-view crm-dashboard-view crm-settings-view crm-set-view">
      <section className="crm-page-heading">
        <div>
          <p>ADMINISTRATION</p>
          <h2>Settings</h2>
          <span>Your account, the businesses you manage, and your data.</span>
        </div>
      </section>

      <div className="crm-set-layout">
        <nav className="crm-panel crm-set-nav" aria-label="Settings sections">
          {groups.map((group) => (
            <div key={group} className="crm-set-nav-group">
              <span>{group}</span>
              {visible
                .filter((item) => item.group === group)
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={active === item.id ? "is-active" : undefined}
                      aria-current={active === item.id ? "page" : undefined}
                      onClick={() => setSection(item.id)}
                    >
                      <Icon aria-hidden="true" />
                      {item.label}
                    </button>
                  );
                })}
            </div>
          ))}
        </nav>

        <div className="crm-set-content">
          {active === "profile" ? (
            <>
              <SectionHead title="Profile & password" text="Who you are signed in as, and your password." />
              <Card>
                <div className="crm-set-profile">
                  <span className="crm-set-avatar" aria-hidden="true">{initials(viewer.name || viewer.email)}</span>
                  <div>
                    <strong>{viewer.name || viewer.email}</strong>
                    <span>{viewer.email}</span>
                  </div>
                  <Badge tone="neutral">{ROLE_LABELS[viewer.role] ?? viewer.role}</Badge>
                </div>
                <dl className="crm-set-facts">
                  <div>
                    <dt>Workspace</dt>
                    <dd>{organizationName}</dd>
                  </div>
                  <div>
                    <dt>Businesses you can open</dt>
                    <dd>{clients.length}</dd>
                  </div>
                </dl>
              </Card>
              <Card title="Change password" text="Use a long password you don't use anywhere else.">
                <PasswordForm mutate={mutate} />
              </Card>
            </>
          ) : null}

          {active === "appearance" ? (
            <>
              <SectionHead title="Appearance" text="How BrizBuilder looks for you. Everyone else keeps their own choice." />
              <Card title="Theme">
                <div className="crm-set-choices" role="radiogroup" aria-label="Theme">
                  {CRM_PICKER_THEMES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={appearance.theme === option.id || (option.id === "classic" && appearance.theme !== "glass")}
                      className={`crm-set-theme is-${option.id}`}
                      onClick={() => appearance.onTheme(option.id)}
                    >
                      <span className="crm-set-theme-swatch" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <strong>{option.label}</strong>
                      <small>{option.id === "glass" ? "Dark frosted panels over a background" : "Light and clean"}</small>
                    </button>
                  ))}
                </div>
              </Card>
              {appearance.glass ? (
                <>
                  <Card title="Background blur" text="Soften the background so it sits further behind your work.">
                    <div className="crm-set-segment" role="radiogroup" aria-label="Background blur">
                      {CRM_BACKDROP_BLURS.map((level) => (
                        <button
                          key={level.id}
                          type="button"
                          role="radio"
                          aria-checked={appearance.blur === level.id}
                          className={appearance.blur === level.id ? "is-active" : undefined}
                          onClick={() => appearance.onBlur(level.id)}
                        >
                          {level.label}
                        </button>
                      ))}
                    </div>
                  </Card>
                  <Card title="Background">
                    <div className="crm-appearance-grid" role="radiogroup" aria-label="Glass background">
                      {CRM_BACKDROPS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={appearance.backdrop === option.id}
                          className="crm-appearance-option"
                          onClick={() => appearance.onBackdrop(option.id)}
                        >
                          <GlassBackdrop variant={option.id} className="crm-appearance-preview" idPrefix="crm-bd-preview" />
                          <span className="crm-appearance-label">
                            <strong>{option.label}</strong>
                            <small>{option.description}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </Card>
                </>
              ) : (
                <p className="crm-set-muted">Backgrounds and blur come with the Glass theme.</p>
              )}
            </>
          ) : null}

          {active === "notifications" ? (
            <>
              <SectionHead title="Notifications" text="Alerts on this device, even when BrizBuilder is closed." />
              <Card title="Push notifications" text="Turn them on separately on each phone or computer you use.">
                <PushOptIn
                  configured={push.configured}
                  vapidPublicKey={push.vapidPublicKey}
                  initialDeviceCount={push.subscribedDevices}
                />
              </Card>
              <Card title="What you'll be told about">
                <ul className="crm-set-list">
                  <li><strong>New leads</strong><span>The moment a lead comes in, with their name and what they need.</span></li>
                  <li><strong>Call summaries</strong><span>When a tracked call has been summarized.</span></li>
                  <li><strong>Leads waiting on you</strong><span>A reminder when a new lead hasn&apos;t been contacted.</span></li>
                  <li><strong>Appointments</strong><span>A reminder before an appointment starts.</span></li>
                </ul>
              </Card>
            </>
          ) : null}

          {active === "businesses" && business ? (
            <>
              <SectionHead title="Business profiles" text="The details BrizBuilder uses for each business: contact info, time zone, budget and service areas." />
              {clients.length > 1 ? (
                <label className="crm-set-picker">
                  <span>Business</span>
                  <select value={business.id} onChange={(event) => setBusinessId(event.target.value)}>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.businessName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <Card title="Logo" text="Shown on the Agency cards, the account switcher and the business's client app.">
                <LogoUploader
                  key={business.id}
                  client={business}
                  logoUrl={branding.find((entry) => entry.clientId === business.id)?.logoUrl ?? null}
                  canEdit={can("clients.manage")}
                  mutate={mutate}
                />
              </Card>
              <Card>
                <BusinessForm key={business.id} client={business} canEdit={can("clients.manage")} mutate={mutate} />
              </Card>
            </>
          ) : null}

          {active === "client-app" ? (
            <>
              <SectionHead title="Client app" text="Each business's own branded, installable app: name, logo, colours, notifications and the install link." />
              <div className="crm-set-client-app">
                <BrandingSettings clients={clients} branding={branding} mutate={mutate} tenantRootDomain={tenantRootDomain} />
              </div>
            </>
          ) : null}

          {active === "team" ? (
            <>
              <SectionHead title="Team & access" text="Who can sign in, and to which businesses." />
              <div className="crm-set-stats">
                <div>
                  <strong>{roleCounts.total}</strong>
                  <span>People with access</span>
                </div>
                <div>
                  <strong>{roleCounts.agency}</strong>
                  <span>Agency team</span>
                </div>
                <div>
                  <strong>{roleCounts.business}</strong>
                  <span>Business users</span>
                </div>
                <div>
                  <strong>{roleCounts.pending}</strong>
                  <span>Never signed in</span>
                </div>
              </div>
              <Card
                title="People"
                aside={
                  <button type="button" className="crm-button-secondary" onClick={() => onNavigate("team")}>
                    Manage team <ChevronRight aria-hidden="true" />
                  </button>
                }
              >
                {roleCounts.members.length ? (
                  <ul className="crm-set-people">
                    {roleCounts.members.map((member) => (
                      <li key={member.id}>
                        <span className="crm-set-avatar is-small" aria-hidden="true">{initials(member.displayName || member.email)}</span>
                        <div>
                          <strong>{member.displayName || member.email}</strong>
                          <span>{member.clientName ?? "Agency"}</span>
                        </div>
                        <Badge tone="neutral">{ROLE_LABELS[member.role] ?? member.role}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="crm-set-muted">Nobody else has access yet.</p>
                )}
              </Card>
            </>
          ) : null}

          {active === "integrations" ? (
            <>
              <SectionHead title="Integrations" text={`What is connected for ${scopeName}. Each business connects and pays for its own accounts.`} />
              <Card
                aside={undefined}
              >
                <ul className="crm-set-providers">
                  {providerStatus.map((provider) => (
                    <li key={provider.id}>
                      <span className="crm-set-provider-mark" aria-hidden="true">{provider.name.slice(0, 1)}</span>
                      <div>
                        <strong>{provider.name}</strong>
                        <span>{provider.does}</span>
                      </div>
                      {provider.connected ? (
                        <Badge tone="green">{clients.length > 1 && selectedClientId === "all" ? `${provider.connected} connected` : "Connected"}</Badge>
                      ) : (
                        <Badge tone="neutral">Not connected</Badge>
                      )}
                    </li>
                  ))}
                </ul>
                <footer className="crm-set-card-foot">
                  <button type="button" className="crm-button-secondary" onClick={() => onNavigate("connections")}>
                    Open Connections <ChevronRight aria-hidden="true" />
                  </button>
                </footer>
              </Card>
            </>
          ) : null}

          {active === "data" ? (
            <>
              <SectionHead title="Export data" text={`Download a spreadsheet of what you can see for ${scopeName}. It opens in Excel or Google Sheets.`} />
              <Card>
                <ul className="crm-set-exports">
                  <li>
                    <div>
                      <strong>Leads</strong>
                      <span>{leads.length.toLocaleString()} leads, with status, source, value and campaign.</span>
                    </div>
                    <button
                      type="button"
                      className="crm-button-secondary"
                      disabled={!leads.length}
                      onClick={() =>
                        downloadCsv(`leads-${today}.csv`, [
                          ["First name", "Last name", "Phone", "Email", "Business", "Service", "Source", "Status", "Estimated value", "Revenue", "Created"],
                          ...leads.map((lead) => [lead.firstName, lead.lastName, lead.phone, lead.email, lead.clientName, lead.serviceRequested, lead.source, lead.status, (lead.estimatedValueCents / 100).toFixed(2), (lead.finalRevenueCents / 100).toFixed(2), lead.createdAt]),
                        ])
                      }
                    >
                      <Download aria-hidden="true" /> Download CSV
                    </button>
                  </li>
                  <li>
                    <div>
                      <strong>Contacts</strong>
                      <span>{contacts.length.toLocaleString()} contacts, with phone, email and address.</span>
                    </div>
                    <button
                      type="button"
                      className="crm-button-secondary"
                      disabled={!contacts.length}
                      onClick={() =>
                        downloadCsv(`contacts-${today}.csv`, [
                          ["First name", "Last name", "Phone", "Email", "Address", "City", "State", "ZIP", "Created"],
                          ...contacts.map((contact) => [contact.firstName, contact.lastName, contact.phone, contact.email, contact.address, contact.city, contact.state, contact.zip, contact.createdAt]),
                        ])
                      }
                    >
                      <Download aria-hidden="true" /> Download CSV
                    </button>
                  </li>
                </ul>
              </Card>
              <p className="crm-set-muted">Files are made in your browser from the records on screen; nothing is emailed or stored elsewhere.</p>
            </>
          ) : null}

          {active === "security" ? (
            <>
              <SectionHead title="Privacy & security" text="How BrizBuilder protects accounts and customer data." />
              <Card>
                <ul className="crm-set-checks">
                  <li className="is-on"><KeyRound aria-hidden="true" /><div><strong>Password sign-in</strong><span>Passwords are at least 12 characters, and repeated failed sign-ins are slowed down.</span></div></li>
                  <li className="is-on"><ShieldCheck aria-hidden="true" /><div><strong>Each business kept separate</strong><span>Every read and write is checked on the server against the businesses you are allowed to open.</span></div></li>
                  <li className="is-on"><ShieldCheck aria-hidden="true" /><div><strong>Changes are recorded</strong><span>Important changes to leads, tasks, businesses, appointments and team access are logged.</span></div></li>
                  <li className="is-on"><ShieldCheck aria-hidden="true" /><div><strong>Consent tracked</strong><span>Consent is stored for every contact and lead.</span></div></li>
                  <li className="is-on"><ShieldCheck aria-hidden="true" /><div><strong>Archiving can be undone</strong><span>Archived records stay available to admins for audit and recovery.</span></div></li>
                  <li><ShieldCheck aria-hidden="true" /><div><strong>Automatic data deletion</strong><span>Not available yet: records are kept until someone deletes them.</span></div></li>
                </ul>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
