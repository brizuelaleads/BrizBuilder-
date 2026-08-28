"use client";

import { type FormEvent, useMemo, useState } from "react";
import type { CrmClient } from "../../db/crm";
import type { TenantBranding } from "../../db/branding";
import {
  DEFAULT_BRANDING,
  HOT_LEAD_SCORE_MAX,
  HOT_LEAD_SCORE_MIN,
  NOTIFICATION_DESCRIPTIONS,
  NOTIFICATION_KEYS,
  NOTIFICATION_LABELS,
  STALE_LEAD_HOURS_MAX,
  STALE_LEAD_HOURS_MIN,
  normalizeHexColor,
  readableInkOn,
  shortAppName,
  type NotificationKey,
} from "../../db/branding";

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;

type BrandingSettingsProps = {
  clients: CrmClient[];
  branding: TenantBranding[];
  mutate: Mutate;
  /** Root domain tenant subdomains live under, for the install URL preview. */
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
  // Held as strings so the number inputs stay editable while someone is
  // clearing and retyping a value; clamped on the server either way.
  staleLeadHours: string;
  hotLeadScore: string;
};

function toFormState(branding: TenantBranding | undefined): FormState {
  return {
    appName: branding?.appName ?? "",
    logoUrl: branding?.logoUrl ?? "",
    // The default icon is BrizBuilder's own; showing it as a pre-filled value
    // would imply the tenant had chosen it.
    iconUrl:
      branding?.iconUrl && branding.iconUrl !== DEFAULT_BRANDING.iconUrl
        ? branding.iconUrl
        : "",
    primaryColor: branding?.primaryColor ?? DEFAULT_BRANDING.primaryColor,
    accentColor: branding?.accentColor ?? DEFAULT_BRANDING.accentColor,
    subdomain: branding?.subdomain ?? "",
    notifications: { ...(branding?.notifications ?? DEFAULT_BRANDING.notifications) },
    staleLeadHours: String(
      branding?.thresholds.staleLeadHours ?? DEFAULT_BRANDING.thresholds.staleLeadHours,
    ),
    hotLeadScore: String(
      branding?.thresholds.hotLeadScore ?? DEFAULT_BRANDING.thresholds.hotLeadScore,
    ),
  };
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
  const [form, setForm] = useState<FormState>(() =>
    toFormState(selectedBranding),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Switching sub-accounts, or a save landing normalized server values,
  // reloads the form. Without this the previous tenant's colours stay on
  // screen and could be saved onto the newly selected one.
  //
  // Adjusted during render rather than in an effect: React re-runs this
  // component immediately with the new state and never commits the stale
  // paint, so there is no flash of the wrong tenant's branding.
  const [syncedBranding, setSyncedBranding] = useState(selectedBranding);
  if (syncedBranding !== selectedBranding) {
    setSyncedBranding(selectedBranding);
    setForm(toFormState(selectedBranding));
    setError("");
  }

  const client = clients.find((entry) => entry.id === clientId);
  const previewName = form.appName.trim() || client?.businessName || "Workspace";
  // A half-typed hex is not a valid CSS colour and would render the preview
  // transparent, so the tile holds the last complete value.
  const previewPrimary =
    normalizeHexColor(form.primaryColor) ?? DEFAULT_BRANDING.primaryColor;
  const previewAccent =
    normalizeHexColor(form.accentColor) ?? DEFAULT_BRANDING.accentColor;
  const installHost =
    form.subdomain.trim() && tenantRootDomain
      ? `${form.subdomain.trim()}.${tenantRootDomain}`
      : null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId) return;
    setSaving(true);
    setError("");
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
        "Branding updated.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Branding could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!clients.length) {
    return (
      <article className="crm-settings-section">
        <h4>Branding</h4>
        <p>Add a sub-account before configuring its branded app.</p>
      </article>
    );
  }

  return (
    <form className="crm-branding-form" onSubmit={onSubmit}>
      <article className="crm-settings-section">
        <h4>Sub-account</h4>
        <label className="crm-field">
          <span>Which workspace are you branding?</span>
          <select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            {clients.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.businessName}
              </option>
            ))}
          </select>
        </label>
      </article>

      <article className="crm-settings-section">
        <h4>App identity</h4>
        <div className="crm-branding-grid">
          <label className="crm-field">
            <span>App name</span>
            <input
              value={form.appName}
              maxLength={60}
              placeholder={client?.businessName ?? "Acme Field Services"}
              onChange={(event) =>
                setForm((state) => ({ ...state, appName: event.target.value }))
              }
            />
            <small>
              Shown under the home-screen icon as{" "}
              <strong>{shortAppName(previewName)}</strong>.
            </small>
          </label>
          <label className="crm-field">
            <span>Subdomain</span>
            <input
              value={form.subdomain}
              maxLength={63}
              placeholder="acme"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) =>
                setForm((state) => ({
                  ...state,
                  subdomain: event.target.value.toLowerCase(),
                }))
              }
            />
            <small>
              {installHost
                ? `Workspace opens at ${installHost}`
                : "Optional. Leave blank to use the shared app address."}
            </small>
          </label>
          <label className="crm-field">
            <span>Logo URL</span>
            <input
              value={form.logoUrl}
              placeholder="https://cdn.example.com/acme-logo.png"
              onChange={(event) =>
                setForm((state) => ({ ...state, logoUrl: event.target.value }))
              }
            />
            <small>Replaces the BrizBuilder wordmark inside the app.</small>
          </label>
          <label className="crm-field">
            <span>Icon URL</span>
            <input
              value={form.iconUrl}
              placeholder="https://cdn.example.com/acme-icon.png"
              onChange={(event) =>
                setForm((state) => ({ ...state, iconUrl: event.target.value }))
              }
            />
            <small>Square PNG, 512×512, used for the home-screen icon.</small>
          </label>
        </div>
      </article>

      <article className="crm-settings-section">
        <h4>Colors</h4>
        <div className="crm-branding-colors">
          {(
            [
              ["primaryColor", "Primary", "Buttons, links, and the phone status bar"],
              ["accentColor", "Accent", "Highlights and secondary emphasis"],
            ] as const
          ).map(([key, label, hint]) => (
            <label className="crm-field" key={key}>
              <span>{label}</span>
              <div className="crm-color-input">
                <input
                  type="color"
                  // A colour input only accepts a full #rrggbb. While someone
                  // is mid-way through typing one into the text field beside
                  // it, show the last valid colour instead of letting the
                  // browser silently snap the swatch to black.
                  value={normalizeHexColor(form[key]) ?? DEFAULT_BRANDING[key]}
                  aria-label={`${label} color picker`}
                  onChange={(event) =>
                    setForm((state) => ({ ...state, [key]: event.target.value }))
                  }
                />
                <input
                  value={form[key]}
                  maxLength={7}
                  aria-label={`${label} hex value`}
                  onChange={(event) =>
                    setForm((state) => ({ ...state, [key]: event.target.value }))
                  }
                />
              </div>
              <small>{hint}</small>
            </label>
          ))}
        </div>

        <div
          className="crm-branding-preview"
          style={{ background: previewPrimary }}
        >
          <div className="crm-branding-preview-icon">
            {form.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.iconUrl} alt="" />
            ) : (
              <span style={{ color: readableInkOn(previewPrimary) }}>
                {previewName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <strong style={{ color: readableInkOn(previewPrimary) }}>
            {shortAppName(previewName)}
          </strong>
          <em style={{ background: previewAccent }} aria-hidden="true" />
        </div>
      </article>

      <article className="crm-settings-section">
        <h4>Notifications</h4>
        <p>
          Which alerts this workspace receives on their phone. Each person still
          has to turn notifications on for their own device.
        </p>
        <ul className="crm-branding-notifications">
          {NOTIFICATION_KEYS.map((key) => (
            <li key={key}>
              <label>
                <input
                  type="checkbox"
                  checked={form.notifications[key]}
                  onChange={(event) =>
                    setForm((state) => ({
                      ...state,
                      notifications: {
                        ...state.notifications,
                        [key]: event.target.checked,
                      },
                    }))
                  }
                />
                <div>
                  <strong>{NOTIFICATION_LABELS[key]}</strong>
                  <small>{NOTIFICATION_DESCRIPTIONS[key]}</small>
                </div>
              </label>
              {/* The two alerts that need a number are configured inline,
                  and only while they are switched on. */}
              {key === "leadNotContacted" && form.notifications.leadNotContacted ? (
                <label className="crm-threshold">
                  <span>Alert after</span>
                  <input
                    type="number"
                    min={STALE_LEAD_HOURS_MIN}
                    max={STALE_LEAD_HOURS_MAX}
                    value={form.staleLeadHours}
                    onChange={(event) =>
                      setForm((state) => ({
                        ...state,
                        staleLeadHours: event.target.value,
                      }))
                    }
                  />
                  <span>hours without contact</span>
                </label>
              ) : null}
              {key === "hotLead" && form.notifications.hotLead ? (
                <label className="crm-threshold">
                  <span>Alert at score</span>
                  <input
                    type="number"
                    min={HOT_LEAD_SCORE_MIN}
                    max={HOT_LEAD_SCORE_MAX}
                    value={form.hotLeadScore}
                    onChange={(event) =>
                      setForm((state) => ({
                        ...state,
                        hotLeadScore: event.target.value,
                      }))
                    }
                  />
                  <span>or above</span>
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      </article>

      {error ? (
        <p className="crm-form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="crm-branding-actions">
        <button className="crm-button-primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save branding"}
        </button>
      </div>
    </form>
  );
}
