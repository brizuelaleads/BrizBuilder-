"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { CrmClient, CrmGoogleProfile } from "../../db/crm";
import { Badge, EmptyState, Field, getFormValue, shortDate } from "./ui";

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;

function clientChoice(
  clients: CrmClient[],
  selectedClientId: string,
  localClientId: string,
) {
  return selectedClientId !== "all"
    ? selectedClientId
    : localClientId || clients[0]?.id || "";
}

function statusTone(status: CrmGoogleProfile["status"]) {
  if (status === "connected") return "green" as const;
  if (status === "attention") return "orange" as const;
  if (status === "disconnected") return "red" as const;
  return "neutral" as const;
}

export function GoogleProfilesView({
  clients,
  profiles,
  selectedClientId,
  mutate,
  runtime,
  canManage,
}: {
  clients: CrmClient[];
  profiles: CrmGoogleProfile[];
  selectedClientId: string;
  mutate: Mutate;
  runtime: { configured: boolean };
  canManage: boolean;
}) {
  const [localClientId, setLocalClientId] = useState(clients[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const clientId = clientChoice(clients, selectedClientId, localClientId);
  const client = clients.find((item) => item.id === clientId) ?? null;
  const profile = profiles.find((item) => item.clientId === clientId) ?? null;

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId) return;
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      await mutate(
        {
          action: "save_google_profile_settings",
          clientId,
          googleReviewUrl: getFormValue(form, "googleReviewUrl"),
        },
        "Google profile settings saved",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!clientId || !window.confirm("Disconnect this Google Business Profile from BrizBuilder?")) return;
    await mutate(
      { action: "disconnect_google_profile", clientId },
      "Google Business Profile disconnected",
    );
  }

  async function refresh() {
    if (!clientId) return;
    await mutate(
      { action: "refresh_google_profile", clientId },
      "Google profile refreshed",
    );
  }

  const profileLabel = profile?.businessName ?? client?.businessName ?? "Business profile";
  const locationSummary = useMemo(
    () => [profile?.address, profile?.phone].filter(Boolean).join(" · "),
    [profile?.address, profile?.phone],
  );

  return (
    <div className="crm-view crm-google-profiles-view">
      <section className="crm-page-heading">
        <div>
          <p>LOCAL MARKETING</p>
          <h2>Google Business Profiles</h2>
          <span>
            Connect each client’s verified Google profile, keep its details in one place,
            and prepare review management without sharing anyone’s Google password.
          </span>
        </div>
        <a
          className="crm-button-secondary"
          href="https://business.google.com/locations"
          target="_blank"
          rel="noreferrer"
        >
          Open Google Business Profile
        </a>
      </section>

      {clients.length > 1 ? (
        <section className="crm-profile-client-picker">
          <label>
            <span>Business</span>
            <select
              value={clientId}
              onChange={(event) => setLocalClientId(event.target.value)}
              aria-label="Choose a business"
            >
              {clients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.businessName}
                </option>
              ))}
            </select>
          </label>
          <span className="crm-profile-client-help">
            Each business is isolated. A client can only see its own profile.
          </span>
        </section>
      ) : null}

      {!client ? (
        <EmptyState
          title="Add a client first"
          description="Google Business Profiles are attached to a specific business workspace."
        />
      ) : profile?.status === "connected" ? (
        <section className="crm-profile-layout">
          <article className="crm-profile-card crm-panel">
            <header>
              <div>
                <p>CONNECTED LOCATION</p>
                <h3>{profileLabel}</h3>
                <span>{profile.locationName ?? "Google Business Profile"}</span>
              </div>
              <Badge tone={statusTone(profile.status)}>Connected</Badge>
            </header>
            <div className="crm-profile-summary">
              <div className="crm-profile-mark">G</div>
              <div>
                <strong>{profile.businessName ?? profileLabel}</strong>
                <span>{locationSummary || "Location details will appear after the next sync."}</span>
              </div>
            </div>
            <dl className="crm-profile-details">
              <div><dt>Category</dt><dd>{profile.primaryCategory ?? "Not reported"}</dd></div>
              <div><dt>Website</dt><dd>{profile.website ?? "Not reported"}</dd></div>
              <div><dt>Last sync</dt><dd>{shortDate(profile.lastSyncedAt)}</dd></div>
              <div><dt>Profile access</dt><dd>Authorized by the business</dd></div>
            </dl>
            <footer className="crm-profile-actions">
              <a className="crm-button-secondary" href="https://business.google.com/locations" target="_blank" rel="noreferrer">Open in Google</a>
              <button className="crm-button-secondary" onClick={() => void refresh()} disabled={!runtime.configured}>Refresh profile</button>
              {canManage ? <button className="crm-button-danger" onClick={() => void disconnect()}>Disconnect</button> : null}
            </footer>
          </article>

          <article className="crm-profile-card crm-panel">
            <header>
              <div><p>REVIEW SETUP</p><h3>Give customers the right review link</h3><span>Use the official link from this business’s Google profile.</span></div>
              <Badge tone={profile.googleReviewUrl ? "green" : "orange"}>{profile.googleReviewUrl ? "Ready" : "Needs link"}</Badge>
            </header>
            <ReviewLinkForm key={profile.id} initialValue={profile.googleReviewUrl ?? ""} saveSettings={saveSettings} busy={busy} canManage={canManage} />
          </article>
        </section>
      ) : (
        <section className="crm-profile-setup crm-panel">
          <div className="crm-profile-setup-icon">G</div>
          <div>
            <p>GOOGLE CONNECTION</p>
            <h3>Connect {client.businessName}’s Google Business Profile</h3>
            <span>
              The business owner or manager authorizes access from their own Google account.
              BrizBuilder never asks for or stores a Google password.
            </span>
            <div className="crm-profile-steps">
              <article><b>1</b><span><strong>Confirm access</strong><small>The client must be an owner or manager of the verified profile.</small></span></article>
              <article><b>2</b><span><strong>Authorize Google</strong><small>They sign in to Google and choose the location to share.</small></span></article>
              <article><b>3</b><span><strong>Manage it here</strong><small>Profile details and review tools appear after the connection is approved.</small></span></article>
            </div>
            <div className="crm-profile-setup-actions">
              <a className={`crm-button-primary ${!runtime.configured ? "disabled" : ""}`} href={runtime.configured ? `/api/integrations/google/connect?clientId=${encodeURIComponent(client.id)}` : undefined} aria-disabled={!runtime.configured} onClick={(event) => { if (!runtime.configured) event.preventDefault(); }}>
                {runtime.configured ? "Connect Google" : "Google connection not configured"}
              </a>
              <a className="crm-button-secondary" href="https://business.google.com/locations" target="_blank" rel="noreferrer">Open Google Business Profile</a>
            </div>
            {!runtime.configured ? <small className="crm-profile-warning">The platform owner must add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in Cloudflare before the Connect button can be used.</small> : null}
          </div>
          <div className="crm-profile-review-fallback">
            <div><p>YOU CAN PREPARE REVIEWS NOW</p><h4>Save the official review link</h4><span>Google’s review link can be used for manual or SMS requests while the full profile connection is being configured.</span></div>
            <ReviewLinkForm key={`setup-${client.id}`} initialValue={profile?.googleReviewUrl ?? ""} saveSettings={saveSettings} busy={busy} canManage={canManage} compact />
          </div>
        </section>
      )}
    </div>
  );
}

function ReviewLinkForm({
  initialValue,
  saveSettings,
  busy,
  canManage,
  compact = false,
}: {
  initialValue: string;
  saveSettings: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  busy: boolean;
  canManage: boolean;
  compact?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <form className={`crm-form crm-profile-review-form ${compact ? "compact" : ""}`} onSubmit={(event) => void saveSettings(event)}>
      <Field label="Official Google review link" span>
        <input name="googleReviewUrl" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://g.page/r/.../review" inputMode="url" disabled={!canManage} />
      </Field>
      <p className="crm-form-note">In Google Business Profile, open <strong>Read Reviews → Get more reviews</strong>, copy the link, and paste it here.</p>
      {canManage ? <button className="crm-button-primary" type="submit" disabled={busy}>{busy ? "Saving..." : "Save review link"}</button> : null}
    </form>
  );
}
