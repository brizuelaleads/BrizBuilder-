"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { CrmClient, CrmGoogleProfile } from "../../db/crm";
import { Badge, EmptyState, Field, getFormValue, shortDate } from "./ui";

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;

type GoogleLocationCandidate = {
  accountResourceName: string;
  accountName: string;
  locationResourceName: string;
  businessName: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  primaryCategory: string | null;
  reviewUrl: string | null;
};

type CandidateState = "idle" | "loading" | "loaded" | "error";

function candidateText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, 500);
}

function parseLocationCandidates(value: unknown): GoogleLocationCandidate[] {
  if (!Array.isArray(value)) return [];
  const parsed: GoogleLocationCandidate[] = [];
  for (const item of value.slice(0, 500)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const accountResourceName = candidateText(row.accountResourceName);
    const accountName = candidateText(row.accountName);
    const locationResourceName = candidateText(row.locationResourceName);
    const businessName = candidateText(row.businessName);
    if (
      !accountResourceName ||
      !accountName ||
      !locationResourceName ||
      !businessName
    )
      continue;
    parsed.push({
      accountResourceName,
      accountName,
      locationResourceName,
      businessName,
      address: candidateText(row.address),
      phone: candidateText(row.phone),
      website: candidateText(row.website),
      primaryCategory: candidateText(row.primaryCategory),
      reviewUrl: candidateText(row.reviewUrl),
    });
  }
  return parsed;
}

function candidateKey(candidate: GoogleLocationCandidate) {
  return `${candidate.accountResourceName}:${candidate.locationResourceName}`;
}

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
  canConnect,
}: {
  clients: CrmClient[];
  profiles: CrmGoogleProfile[];
  selectedClientId: string;
  mutate: Mutate;
  runtime: { configured: boolean };
  canManage: boolean;
  canConnect: boolean;
}) {
  const [localClientId, setLocalClientId] = useState(clients[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [candidateOwnerId, setCandidateOwnerId] = useState("");
  const [candidateState, setCandidateState] = useState<CandidateState>("idle");
  const [candidates, setCandidates] = useState<GoogleLocationCandidate[]>([]);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionErrorOwnerId, setActionErrorOwnerId] = useState("");
  const [selectedAccountResourceName, setSelectedAccountResourceName] =
    useState("");
  const [selectingLocation, setSelectingLocation] = useState("");
  const clientId = clientChoice(clients, selectedClientId, localClientId);
  const client = clients.find((item) => item.id === clientId) ?? null;
  const profile = profiles.find((item) => item.clientId === clientId) ?? null;
  const activeCandidates = useMemo(
    () => (candidateOwnerId === clientId ? candidates : []),
    [candidateOwnerId, candidates, clientId],
  );
  const activeCandidateState =
    candidateOwnerId === clientId ? candidateState : "idle";
  const activeActionError =
    actionErrorOwnerId === clientId ? actionError : null;

  const accountChoices = useMemo(() => {
    const accounts = new Map<string, string>();
    for (const candidate of activeCandidates) {
      accounts.set(candidate.accountResourceName, candidate.accountName);
    }
    return [...accounts.entries()].map(([resourceName, name]) => ({
      resourceName,
      name,
    }));
  }, [activeCandidates]);

  const activeAccountResourceName = accountChoices.some(
    (account) => account.resourceName === selectedAccountResourceName,
  )
    ? selectedAccountResourceName
    : accountChoices[0]?.resourceName ?? "";
  const visibleCandidates = activeCandidates.filter(
    (candidate) =>
      candidate.accountResourceName === activeAccountResourceName,
  );

  const loadLocations = useCallback(async () => {
    if (!clientId || !canConnect || !runtime.configured) return;
    setCandidateOwnerId(clientId);
    setCandidateState("loading");
    setCandidateError(null);
    setActionError(null);
    try {
      const result = await mutate(
        { action: "list_google_profile_locations", clientId },
        "Google Business Profile locations loaded",
      );
      const parsed = parseLocationCandidates(result);
      const current = parsed.find(
        (candidate) => candidate.locationResourceName === profile?.locationId,
      );
      setCandidates(parsed);
      setSelectedAccountResourceName(
        current?.accountResourceName ?? parsed[0]?.accountResourceName ?? "",
      );
      setCandidateState("loaded");
      if (!parsed.length) {
        setCandidateError(
          "Google did not return any Business Profile locations. Confirm that this Google account manages a verified profile, then try again.",
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Google locations could not be loaded.";
      setCandidates([]);
      setCandidateState("error");
      setCandidateError(message);
    }
  }, [canConnect, clientId, mutate, profile?.locationId, runtime.configured]);

  useEffect(() => {
    if (
      profile?.status === "attention" &&
      !profile.locationId &&
      activeCandidateState === "idle" &&
      canConnect &&
      runtime.configured
    ) {
      const timer = window.setTimeout(() => void loadLocations(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [
    activeCandidateState,
    canConnect,
    loadLocations,
    profile?.locationId,
    profile?.status,
    runtime.configured,
  ]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId || !canManage) return;
    setBusy(true);
    setActionError(null);
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
    } catch (error) {
      setActionErrorOwnerId(clientId);
      setActionError(
        error instanceof Error
          ? error.message
          : "The Google review link could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const retryingRevocation = Boolean(
      profile?.status === "disconnected" && profile.lastError,
    );
    const confirmation = retryingRevocation
      ? "Retry removing BrizBuilder's access from this Google account?"
      : "Disconnect this Google Business Profile from BrizBuilder?";
    if (!clientId || !canConnect || !window.confirm(confirmation)) return;
    setDisconnecting(true);
    setActionError(null);
    try {
      const result = await mutate(
        { action: "disconnect_google_profile", clientId },
        retryingRevocation
          ? "Google disconnect retried"
          : "Disconnected from BrizBuilder",
      );
      const revocationWarning =
        result && typeof result === "object" && !Array.isArray(result)
          ? candidateText(
              (result as Record<string, unknown>).revocationWarning,
            )
          : null;
      if (revocationWarning) {
        setActionErrorOwnerId(clientId);
        setActionError(revocationWarning);
      }
      setCandidates([]);
      setCandidateOwnerId("");
      setCandidateState("idle");
    } catch (error) {
      setActionErrorOwnerId(clientId);
      setActionError(
        error instanceof Error
          ? error.message
          : "Google Business Profile could not be disconnected.",
      );
    } finally {
      setDisconnecting(false);
    }
  }

  async function refresh() {
    if (!clientId || !canManage || !runtime.configured) return;
    setRefreshing(true);
    setActionError(null);
    try {
      await mutate(
        { action: "refresh_google_profile", clientId },
        "Google profile refreshed",
      );
    } catch (error) {
      setActionErrorOwnerId(clientId);
      setActionError(
        error instanceof Error
          ? error.message
          : "Google Business Profile could not be refreshed.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function selectLocation(candidate: GoogleLocationCandidate) {
    if (!clientId || !canConnect || !runtime.configured) return;
    const key = candidateKey(candidate);
    setSelectingLocation(key);
    setActionError(null);
    try {
      await mutate(
        {
          action: "select_google_profile_location",
          clientId,
          accountResourceName: candidate.accountResourceName,
          locationResourceName: candidate.locationResourceName,
        },
        `${candidate.businessName} connected to BrizBuilder`,
      );
      setCandidates([]);
      setCandidateOwnerId("");
      setCandidateState("idle");
      setCandidateError(null);
    } catch (error) {
      setActionErrorOwnerId(clientId);
      setActionError(
        error instanceof Error
          ? error.message
          : "That Google location could not be selected.",
      );
    } finally {
      setSelectingLocation("");
    }
  }

  const profileLabel = profile?.businessName ?? client?.businessName ?? "Business profile";
  const locationSummary = useMemo(
    () => [profile?.address, profile?.phone].filter(Boolean).join(" / "),
    [profile?.address, profile?.phone],
  );
  const hasSelectedLocation = Boolean(profile?.locationId);
  const showExistingProfile = Boolean(
    hasSelectedLocation && profile?.status !== "disconnected",
  );
  const connectionBusy = Boolean(
    refreshing ||
      disconnecting ||
      selectingLocation ||
      activeCandidateState === "loading",
  );
  const showCandidateChooser = activeCandidateState !== "idle";
  const profileNeedsAttention = profile?.status === "attention";
  const profileStatusLabel = profileNeedsAttention
    ? "Needs attention"
    : profile?.status === "connected"
      ? "Connected"
      : "Connection pending";
  const canStartConnection = Boolean(
    canConnect && runtime.configured && !connectionBusy,
  );

  return (
    <div className="crm-view crm-google-profiles-view">
      <section className="crm-page-heading">
        <div>
          <p>LOCAL MARKETING</p>
          <h2>Google Business Profiles</h2>
          <span>
            Connect each client&apos;s verified Google profile, keep its details in one
            place, and prepare review management without sharing anyone&apos;s Google
            password.
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
      ) : showExistingProfile ? (
        <>
          <section className="crm-profile-layout">
            <article className="crm-profile-card crm-panel">
              <header>
                <div>
                  <p>{profileNeedsAttention ? "ACTION REQUIRED" : "CONNECTED LOCATION"}</p>
                  <h3>{profileLabel}</h3>
                  <span>{profile?.locationName ?? "Google Business Profile"}</span>
                </div>
                <Badge tone={profile ? statusTone(profile.status) : "neutral"}>
                  {profileStatusLabel}
                </Badge>
              </header>
              <div className="crm-profile-summary">
                <div className="crm-profile-mark">G</div>
                <div>
                  <strong>{profile?.businessName ?? profileLabel}</strong>
                  <span>
                    {locationSummary ||
                      "Location details will appear after the next sync."}
                  </span>
                </div>
              </div>
              {profile?.lastError ? (
                <div className="crm-inline-error" role="alert">
                  <strong>Google needs attention: </strong>
                  {profile.lastError}
                </div>
              ) : null}
              {!showCandidateChooser && activeActionError ? (
                <div className="crm-inline-error" role="alert">
                  {activeActionError}
                </div>
              ) : null}
              <dl className="crm-profile-details">
                <div>
                  <dt>Category</dt>
                  <dd>{profile?.primaryCategory ?? "Not reported"}</dd>
                </div>
                <div>
                  <dt>Website</dt>
                  <dd>{profile?.website ?? "Not reported"}</dd>
                </div>
                <div>
                  <dt>Last sync</dt>
                  <dd>{shortDate(profile?.lastSyncedAt ?? null)}</dd>
                </div>
                <div>
                  <dt>Profile access</dt>
                  <dd>Authorized by the business</dd>
                </div>
              </dl>
              <footer className="crm-profile-actions">
                <a
                  className="crm-button-secondary"
                  href="https://business.google.com/locations"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Google
                </a>
                {canManage ? (
                  <button
                    className="crm-button-secondary"
                    type="button"
                    onClick={() => void refresh()}
                    disabled={!runtime.configured || connectionBusy}
                  >
                    {refreshing ? "Refreshing..." : "Refresh profile"}
                  </button>
                ) : null}
                {canConnect ? (
                  <button
                    className="crm-button-secondary"
                    type="button"
                    onClick={() => void loadLocations()}
                    disabled={!runtime.configured || connectionBusy}
                  >
                    {activeCandidateState === "loading"
                      ? "Loading locations..."
                      : "Change location"}
                  </button>
                ) : null}
                {canConnect ? (
                  <button
                    className="crm-button-danger"
                    type="button"
                    onClick={() => void disconnect()}
                    disabled={connectionBusy}
                  >
                    {disconnecting ? "Disconnecting..." : "Disconnect"}
                  </button>
                ) : null}
              </footer>
            </article>

            <article className="crm-profile-card crm-panel">
              <header>
                <div>
                  <p>REVIEW SETUP</p>
                  <h3>Give customers the right review link</h3>
                  <span>
                    Use the official link from this business&apos;s Google profile.
                  </span>
                </div>
                <Badge tone={profile?.googleReviewUrl ? "green" : "orange"}>
                  {profile?.googleReviewUrl ? "Ready" : "Needs link"}
                </Badge>
              </header>
              <ReviewLinkForm
                key={profile?.id ?? `profile-${client.id}`}
                initialValue={profile?.googleReviewUrl ?? ""}
                saveSettings={saveSettings}
                busy={busy}
                canManage={canManage}
              />
            </article>
          </section>
          {showCandidateChooser ? (
            <LocationChooser
              state={activeCandidateState}
              accounts={accountChoices}
              selectedAccountResourceName={activeAccountResourceName}
              onAccountChange={setSelectedAccountResourceName}
              candidates={visibleCandidates}
              currentLocationId={profile?.locationId ?? null}
              candidateError={candidateError}
              actionError={activeActionError}
              selectingLocation={selectingLocation}
              disabled={!canConnect || connectionBusy}
              onReload={loadLocations}
              onSelect={selectLocation}
            />
          ) : null}
        </>
      ) : (
        <>
          <section className="crm-profile-setup crm-panel">
            <div className="crm-profile-setup-icon">G</div>
            <div>
              <p>{profileNeedsAttention ? "ACTION REQUIRED" : "GOOGLE CONNECTION"}</p>
              <h3>
                {profileNeedsAttention
                  ? "Choose a Google Business Profile location"
                  : `Connect ${client.businessName}'s Google Business Profile`}
              </h3>
              <span>
                The business owner or manager authorizes access from their own
                Google account. BrizBuilder never asks for or stores a Google
                password.
              </span>
              {profile?.lastError ? (
                <div className="crm-inline-error" role="alert">
                  <strong>Google needs attention: </strong>
                  {profile.lastError}
                </div>
              ) : null}
              {!showCandidateChooser && activeActionError ? (
                <div className="crm-inline-error" role="alert">
                  {activeActionError}
                </div>
              ) : null}
              <div className="crm-profile-steps">
                <article>
                  <b>1</b>
                  <span>
                    <strong>Confirm access</strong>
                    <small>
                      The client must be an owner or manager of the verified
                      profile.
                    </small>
                  </span>
                </article>
                <article>
                  <b>2</b>
                  <span>
                    <strong>Authorize Google</strong>
                    <small>
                      They sign in to Google and approve access to their business.
                    </small>
                  </span>
                </article>
                <article>
                  <b>3</b>
                  <span>
                    <strong>Choose the location</strong>
                    <small>
                      Select the correct business location, then manage it here.
                    </small>
                  </span>
                </article>
              </div>
              <div className="crm-profile-setup-actions">
                {profile?.status === "disconnected" &&
                profile.revocationRetryAvailable &&
                canConnect &&
                runtime.configured ? (
                  <button
                    className="crm-button-secondary"
                    type="button"
                    onClick={() => void disconnect()}
                    disabled={connectionBusy}
                  >
                    {disconnecting
                      ? "Retrying Google disconnect..."
                      : "Retry Google disconnect"}
                  </button>
                ) : null}
                {profileNeedsAttention && canConnect && runtime.configured ? (
                  <button
                    className="crm-button-primary"
                    type="button"
                    onClick={() => void loadLocations()}
                    disabled={connectionBusy}
                  >
                    {activeCandidateState === "loading"
                      ? "Loading locations..."
                      : "Choose location"}
                  </button>
                ) : null}
                <a
                  className={`crm-button-primary ${!canStartConnection ? "disabled" : ""}`}
                  href={
                    canStartConnection
                      ? `/api/integrations/google/connect?clientId=${encodeURIComponent(client.id)}`
                      : undefined
                  }
                  aria-disabled={!canStartConnection}
                  tabIndex={canStartConnection ? undefined : -1}
                  onClick={(event) => {
                    if (!canStartConnection) event.preventDefault();
                  }}
                >
                  {!runtime.configured
                    ? "Google connection not configured"
                    : profileNeedsAttention
                      ? "Reconnect Google"
                      : "Connect Google"}
                </a>
                <a
                  className="crm-button-secondary"
                  href="https://business.google.com/locations"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Google Business Profile
                </a>
              </div>
              {!canConnect ? (
                <small className="crm-profile-warning">
                  Only an account owner or agency administrator can connect or
                  disconnect Google.
                </small>
              ) : null}
              {!runtime.configured ? (
                <small className="crm-profile-warning">
                  The platform&apos;s Google connection and security settings are
                  incomplete. The platform owner must finish the Google setup in
                  Cloudflare before the Connect button can be used.
                </small>
              ) : null}
            </div>
            <div className="crm-profile-review-fallback">
              <div>
                <p>YOU CAN PREPARE REVIEWS NOW</p>
                <h4>Save the official review link</h4>
                <span>
                  Google&apos;s review link can be used for manual or SMS requests
                  while the full profile connection is being configured.
                </span>
              </div>
              <ReviewLinkForm
                key={`setup-${client.id}`}
                initialValue={profile?.googleReviewUrl ?? ""}
                saveSettings={saveSettings}
                busy={busy}
                canManage={canManage}
                compact
              />
            </div>
          </section>
          {showCandidateChooser ? (
            <LocationChooser
              state={activeCandidateState}
              accounts={accountChoices}
              selectedAccountResourceName={activeAccountResourceName}
              onAccountChange={setSelectedAccountResourceName}
              candidates={visibleCandidates}
              currentLocationId={profile?.locationId ?? null}
              candidateError={candidateError}
              actionError={activeActionError}
              selectingLocation={selectingLocation}
              disabled={!canConnect || connectionBusy}
              onReload={loadLocations}
              onSelect={selectLocation}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function LocationChooser({
  state,
  accounts,
  selectedAccountResourceName,
  onAccountChange,
  candidates,
  currentLocationId,
  candidateError,
  actionError,
  selectingLocation,
  disabled,
  onReload,
  onSelect,
}: {
  state: CandidateState;
  accounts: Array<{ resourceName: string; name: string }>;
  selectedAccountResourceName: string;
  onAccountChange: (resourceName: string) => void;
  candidates: GoogleLocationCandidate[];
  currentLocationId: string | null;
  candidateError: string | null;
  actionError: string | null;
  selectingLocation: string;
  disabled: boolean;
  onReload: () => Promise<void>;
  onSelect: (candidate: GoogleLocationCandidate) => Promise<void>;
}) {
  const isLoading = state === "loading";
  const hasLocations = state === "loaded" && candidates.length > 0;
  const canRetry = state === "error" || (state === "loaded" && !candidates.length);

  return (
    <section
      className="crm-profile-card crm-panel"
      aria-live="polite"
      aria-busy={isLoading || Boolean(selectingLocation)}
    >
      <header>
        <div>
          <p>CHOOSE A LOCATION</p>
          <h3>Select the business customers should find on Google</h3>
          <span>
            Choose the exact location for this client. Only the selected business
            will be connected to this workspace.
          </span>
        </div>
        <Badge tone={hasLocations ? "purple" : state === "error" ? "red" : "neutral"}>
          {isLoading
            ? "Loading"
            : hasLocations
              ? `${candidates.length} ${candidates.length === 1 ? "location" : "locations"}`
              : "Needs selection"}
        </Badge>
      </header>

      {isLoading ? (
        <div className="crm-profile-summary">
          <div className="crm-profile-mark">G</div>
          <div>
            <strong>Loading locations securely from Google...</strong>
            <span>This normally takes only a few seconds.</span>
          </div>
        </div>
      ) : null}

      {accounts.length > 1 && !isLoading ? (
        <label className="crm-select-stack">
          <span>Google Business Profile account</span>
          <select
            value={selectedAccountResourceName}
            onChange={(event) => onAccountChange(event.target.value)}
            disabled={disabled}
          >
            {accounts.map((account) => (
              <option key={account.resourceName} value={account.resourceName}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {candidateError ? (
        <div className="crm-inline-error" role="alert">
          {candidateError}
        </div>
      ) : null}
      {actionError ? (
        <div className="crm-inline-error" role="alert">
          {actionError}
        </div>
      ) : null}

      {hasLocations ? (
        <div className="crm-profile-steps">
          {candidates.map((candidate, index) => {
            const key = candidateKey(candidate);
            const isCurrent = candidate.locationResourceName === currentLocationId;
            const isSelecting = selectingLocation === key;
            const details = [
              candidate.address,
              candidate.phone,
              candidate.primaryCategory,
            ].filter(Boolean);

            return (
              <article key={key}>
                <b>{index + 1}</b>
                <span>
                  <strong>{candidate.businessName}</strong>
                  <small>
                    {details.join(" / ") ||
                      "Google did not report additional location details."}
                  </small>
                  {candidate.website ? <small>{candidate.website}</small> : null}
                  <div className="crm-profile-actions">
                    <button
                      className={isCurrent ? "crm-button-secondary" : "crm-button-primary"}
                      type="button"
                      disabled={disabled || isCurrent}
                      onClick={() => void onSelect(candidate)}
                    >
                      {isCurrent
                        ? "Current location"
                        : isSelecting
                          ? "Connecting..."
                          : "Use this location"}
                    </button>
                  </div>
                </span>
              </article>
            );
          })}
        </div>
      ) : null}

      {canRetry ? (
        <footer className="crm-profile-actions">
          <button
            className="crm-button-secondary"
            type="button"
            onClick={() => void onReload()}
            disabled={disabled}
          >
            Try loading locations again
          </button>
        </footer>
      ) : null}
    </section>
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
      <p className="crm-form-note">
        In Google Business Profile, open{" "}
        <strong>Read Reviews -&gt; Get more reviews</strong>, copy the link, and
        paste it here.
      </p>
      {canManage ? <button className="crm-button-primary" type="submit" disabled={busy}>{busy ? "Saving..." : "Save review link"}</button> : null}
    </form>
  );
}
