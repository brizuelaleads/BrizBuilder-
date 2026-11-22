"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  BarChart3,
  Bookmark,
  ChevronDown,
  ExternalLink,
  Image as ImageIcon,
  Globe,
  Navigation,
  PenLine,
  Pencil,
  Phone,
  RefreshCw,
  Settings,
  Share2,
} from "lucide-react";
import type { CrmClient, CrmGoogleProfile } from "../../db/crm";
import type { GoogleBusinessReviewsPage } from "../../lib/google-business";
import {
  GooglePerformancePanel,
  GoogleProfileHealthPanel,
  GooglePhotosPanel,
  GoogleProfileEditor,
  useGoogleListing,
  type LiveListing,
} from "./GoogleProfileWorkspace";
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

/**
 * Google's errors, said plainly. The commonest one is not a fault at all:
 * Google keeps the Business Profile API at 0 requests a minute until it has
 * approved the app's access request, and reports that as "quota exceeded".
 */
function explainGoogleError(message: string): { title: string; body: string; pendingApproval: boolean } {
  if (/quota exceeded/i.test(message) && /mybusiness/i.test(message)) {
    return {
      title: "Google hasn't switched on Business Profile access yet",
      body: "Google only lets approved apps read Business Profiles, and BrizBuilder's access request is still waiting for Google's approval, so Google is answering every request with \"limit 0\". Nothing is wrong with this business's Google account or sign-in. Once Google approves the request, Choose location will work straight away; there is no need to reconnect.",
      pendingApproval: true,
    };
  }
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(message)) {
    return {
      title: "A Google API is switched off",
      body: "One of the Business Profile APIs is not enabled for BrizBuilder's Google Cloud project. The platform owner needs to enable it in Google Cloud.",
      pendingApproval: false,
    };
  }
  if (/invalid_grant|expired|revoked|unauthori[sz]ed|401/i.test(message)) {
    return {
      title: "Google needs you to sign in again",
      body: "Google no longer accepts the saved sign-in for this business. Use Reconnect Google to sign in again.",
      pendingApproval: false,
    };
  }
  return { title: "Google needs attention", body: message, pendingApproval: false };
}

function GoogleIssue({ message, showRequestLink }: { message: string; showRequestLink: boolean }) {
  const issue = explainGoogleError(message);
  return (
    <div className={`gp-issue${issue.pendingApproval ? " is-pending" : ""}`} role="alert">
      <strong>{issue.title}</strong>
      {issue.body !== message ? <p>{issue.body}</p> : <p>{message}</p>}
      {issue.pendingApproval && showRequestLink ? (
        <p>
          Waiting on Google? Check the request or send it again on{" "}
          <a href="https://support.google.com/business/contact/api_default" target="_blank" rel="noreferrer">
            Google&apos;s Business Profile API access form
          </a>
          .
        </p>
      ) : null}
      {issue.body !== message ? (
        <details>
          <summary>Technical details</summary>
          <code>{message}</code>
        </details>
      ) : null}
    </div>
  );
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
  canReadReviews,
}: {
  clients: CrmClient[];
  profiles: CrmGoogleProfile[];
  selectedClientId: string;
  mutate: Mutate;
  runtime: { configured: boolean };
  canManage: boolean;
  canConnect: boolean;
  canReadReviews: boolean;
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
      : "Disconnect Google for this client? This stops Business Profile and Calendar syncing. Existing CRM appointments and Google Calendar events remain.";
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

  const [tab, setTab] = useState<ProfileTab>("overview");
  const [editSection, setEditSection] = useState<string | null>(null);
  const navigateProfile = useCallback((next: ProfileTab, section: string | null = null) => {
    setEditSection(section);
    setTab(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const activeTab: ProfileTab = activeCandidateState !== "idle" ? "settings" : tab;
  const profileLabel = profile?.businessName ?? client?.businessName ?? "Business profile";
  const locationSummary = useMemo(
    () => [profile?.address, profile?.phone].filter(Boolean).join(" · "),
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
  const website = profile?.website?.replace(/^https?:\/\//i, "").replace(/\/+$/, "") ?? null;

  return (
    <div className="crm-view crm-dashboard-view crm-google-profiles-view gp-view">
      <section className="crm-page-heading">
        <div>
          <p>LOCAL MARKETING</p>
          <h2>Google Business Profiles</h2>
          <span>See how customers find the business on Google, track results, and update the profile.</span>
        </div>
        {clients.length > 1 ? (
          <label className="gp-picker">
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
        ) : null}
      </section>

      {!client ? (
        <EmptyState
          title="Add a client first"
          description="Google Business Profiles are attached to a specific business workspace."
        />
      ) : showExistingProfile ? (
        <>
          {/* Connection status in one compact bar; details live under Settings. */}
          <section className="crm-panel gbw-bar" aria-label="Connected Google Business Profile">
            <span className="gp-mark" aria-hidden="true"><i>G</i></span>
            <div className="gbw-bar-copy">
              <h3>{profileLabel}</h3>
              <p>
                {locationSummary ? <span>{locationSummary}</span> : null}
                <span>Synced {shortDate(profile?.lastSyncedAt ?? null)}</span>
              </p>
            </div>
            <Badge tone={profile ? statusTone(profile.status) : "neutral"}>{profileStatusLabel}</Badge>
            <div className="gbw-bar-actions">
              <a className="crm-button-secondary" href="https://business.google.com/locations" target="_blank" rel="noreferrer">
                Open in Google <ExternalLink size={14} aria-hidden="true" />
              </a>
              {canManage ? (
                <button className="crm-button-secondary" type="button" onClick={() => void refresh()} disabled={!runtime.configured || connectionBusy}>
                  <RefreshCw size={14} aria-hidden="true" /> {refreshing ? "Refreshing…" : "Refresh"}
                </button>
              ) : null}
            </div>
          </section>
          {profile?.lastError && !(showCandidateChooser && candidateError) ? (
            <GoogleIssue message={profile.lastError} showRequestLink={canConnect} />
          ) : null}
          {!showCandidateChooser && activeActionError ? (
            <div className="crm-inline-error" role="alert">{activeActionError}</div>
          ) : null}

          <nav className="gbw-tabs" aria-label="Business profile sections">
            {PROFILE_TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={activeTab === item.key ? "active" : ""}
                aria-current={activeTab === item.key ? "page" : undefined}
                onClick={() => { setEditSection(null); setTab(item.key); }}
              >
                {item.icon}{item.label}
                {item.key === "settings" && !profile?.googleReviewUrl ? <span className="gbw-dot" role="img" aria-label="needs attention" /> : null}
              </button>
            ))}
          </nav>

          {activeTab === "settings" ? (
            <>
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

              {/* The review link every review request sends customers to. */}
              <section className="crm-panel gp-panel gp-review" aria-label="Google review link">
                <header>
                  <div>
                    <p>REVIEW SETUP</p>
                    <h3>Give customers the right review link</h3>
                    <span>Use the official link from this business&apos;s Google profile.</span>
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
                {profile?.googleReviewUrl ? (
                  <a className="crm-button-secondary gp-test-link" href={profile.googleReviewUrl} target="_blank" rel="noreferrer">
                    Test the link
                  </a>
                ) : null}
              </section>

              <section className="crm-panel gbw-connection" aria-labelledby="gbw-connection-title">
                <header className="gbw-panel-head">
                  <div>
                    <h3 id="gbw-connection-title">Google connection</h3>
                    <p>The Google account and location this workspace manages.</p>
                  </div>
                </header>
                <dl className="gbw-connection-facts">
                  <div><dt>Location</dt><dd>{profileLabel}</dd></div>
                  <div><dt>Status</dt><dd>{profileStatusLabel}</dd></div>
                  <div><dt>Last sync</dt><dd>{shortDate(profile?.lastSyncedAt ?? null)}</dd></div>
                  <div><dt>Website on file</dt><dd>{website ?? "Not reported"}</dd></div>
                </dl>
                <footer className="gp-actions">
                  {canConnect ? (
                    <button className="crm-button-secondary" type="button" onClick={() => void loadLocations()} disabled={!runtime.configured || connectionBusy}>
                      {activeCandidateState === "loading" ? "Loading locations…" : "Change location"}
                    </button>
                  ) : null}
                  <span className="gp-actions-gap" />
                  {canConnect ? (
                    <button className="crm-button-danger" type="button" onClick={() => void disconnect()} disabled={connectionBusy}>
                      {disconnecting ? "Disconnecting…" : "Disconnect Google"}
                    </button>
                  ) : null}
                </footer>
              </section>
            </>
          ) : (
            <ProfileTabContent
              key={JSON.stringify([client.id, profile?.locationId])}
              tab={activeTab}
              clientId={client.id}
              profile={profile}
              profileName={profileLabel}
              canManage={canManage}
              canReadReviews={canReadReviews}
              mutate={mutate}
              editSection={editSection}
              onNavigate={navigateProfile}
            />
          )}
        </>
      ) : (
        <>
          {/* Not connected yet: what happens, in three steps, and the button. */}
          <section className="crm-panel gp-setup" aria-label="Connect Google Business Profile">
            <div className="gp-identity">
              <span className="gp-mark" aria-hidden="true"><i>G</i></span>
              <div>
                <p>{profileNeedsAttention ? "ACTION REQUIRED" : "GOOGLE CONNECTION"}</p>
                <h3>
                  {profileNeedsAttention
                    ? "Choose a Google Business Profile location"
                    : `Connect ${client.businessName}'s Google Business Profile`}
                </h3>
                <span>
                  Sign in with the Google account that manages this business to view
                  its listing and reviews and publish changes you approve.{" "}
                  <a href="/privacy#google">Google data use</a>
                </span>
              </div>
            </div>
            <ol className="gp-steps">
              <li className={profileNeedsAttention ? "is-done" : undefined}>
                <b>1</b>
                <span><strong>Sign in with Google</strong><small>Use the Google account that manages this business&apos;s profile.</small></span>
              </li>
              <li>
                <b>2</b>
                <span><strong>Choose the location</strong><small>Pick the exact business customers find on Google.</small></span>
              </li>
              <li className={profile?.googleReviewUrl ? "is-done" : undefined}>
                <b>3</b>
                <span><strong>Add the review link</strong><small>So review requests send customers to the right place.</small></span>
              </li>
            </ol>
            {profile?.lastError && !(showCandidateChooser && candidateError) ? (
              <GoogleIssue message={profile.lastError} showRequestLink={canConnect} />
            ) : null}
            {!showCandidateChooser && activeActionError ? (
              <div className="crm-inline-error" role="alert">
                {activeActionError}
              </div>
            ) : null}
            <div className="gp-actions">
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
              <small className="gp-warning">
                Only an account owner or agency administrator can connect or
                disconnect Google.
              </small>
            ) : null}
            {!runtime.configured ? (
              <small className="gp-warning">
                The platform&apos;s Google connection and security settings are
                incomplete. The platform owner must finish the Google setup in
                Cloudflare before the Connect button can be used.
              </small>
            ) : null}
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

          <section className="crm-panel gp-panel gp-review" aria-label="Google review link">
            <header>
              <div>
                <p>OPTIONAL</p>
                <h4>Add the official review link</h4>
                <span>Use this link when requesting a Google review.</span>
              </div>
            </header>
            <ReviewLinkForm
              key={`setup-${client.id}`}
              initialValue={profile?.googleReviewUrl ?? ""}
              saveSettings={saveSettings}
              busy={busy}
              canManage={canManage}
              compact
            />
          </section>
        </>
      )}
    </div>
  );
}

function httpsLink(value: string | null | undefined) {
  return value && /^https:\/\//i.test(value) ? value : undefined;
}

const GBP_DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;
const WEEK_MINUTES = 7 * 24 * 60;

function minutesOf(time: string | null) {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

/** "17:30" → "5:30 PM", Google style ("5 PM" when on the hour). */
function formatGoogleTime(time: string | null) {
  const total = minutesOf(time) % (24 * 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours < 12 ? "AM" : "PM";
  const hour12 = hours % 12 || 12;
  return `${hour12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${suffix}`;
}

function titleCaseDay(day: string) {
  return day.charAt(0) + day.slice(1).toLowerCase();
}

type HoursPeriod = LiveListing["hours"][number];

/** Turns Google periods into week-minute intervals, handling overnight closes. */
function weeklyIntervals(periods: HoursPeriod[]) {
  return periods.flatMap((period) => {
    const openDay = GBP_DAYS.indexOf((period.openDay ?? "") as typeof GBP_DAYS[number]);
    if (openDay < 0) return [];
    const closeDayIndex = GBP_DAYS.indexOf((period.closeDay ?? period.openDay ?? "") as typeof GBP_DAYS[number]);
    const start = openDay * 1440 + minutesOf(period.openTime);
    let end = (closeDayIndex < 0 ? openDay : closeDayIndex) * 1440 + minutesOf(period.closeTime);
    if (end <= start) end += WEEK_MINUTES;
    return [{ start, end }];
  });
}

function hoursForDay(periods: HoursPeriod[], day: typeof GBP_DAYS[number]) {
  const todays = periods.filter((period) => period.openDay === day);
  if (!todays.length) return "Closed";
  if (todays.some((period) => minutesOf(period.openTime) === 0 && (minutesOf(period.closeTime) === 1440 || (period.closeDay !== day && minutesOf(period.closeTime) === 0)))) {
    return "Open 24 hours";
  }
  return todays
    .sort((a, b) => minutesOf(a.openTime) - minutesOf(b.openTime))
    .map((period) => `${formatGoogleTime(period.openTime)}–${formatGoogleTime(period.closeTime)}`)
    .join(", ");
}

function openNowStatus(periods: HoursPeriod[], now: Date) {
  const intervals = weeklyIntervals(periods);
  if (!intervals.length) return null;
  const current = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();
  const active = intervals.find(({ start, end }) =>
    (current >= start && current < end) || (current + WEEK_MINUTES >= start && current + WEEK_MINUTES < end));
  if (active) {
    if (active.end - active.start >= WEEK_MINUTES) return { tone: "open" as const, label: "Open 24 hours", detail: "" };
    const closesIn = ((active.end - current) % WEEK_MINUTES + WEEK_MINUTES) % WEEK_MINUTES;
    const closeLabel = formatGoogleTime(`${Math.floor((active.end % 1440) / 60)}:${String(active.end % 60).padStart(2, "0")}`);
    return closesIn <= 60
      ? { tone: "soon" as const, label: "Closes soon", detail: closeLabel }
      : { tone: "open" as const, label: "Open", detail: `Closes ${closeLabel}` };
  }
  const next = intervals
    .map(({ start }) => ({ start, wait: ((start - current) % WEEK_MINUTES + WEEK_MINUTES) % WEEK_MINUTES }))
    .sort((a, b) => a.wait - b.wait)[0];
  const startDay = Math.floor((next.start % WEEK_MINUTES) / 1440);
  const opensLabel = formatGoogleTime(`${Math.floor((next.start % 1440) / 60)}:${String(next.start % 60).padStart(2, "0")}`);
  const sameDay = startDay === now.getDay() && next.wait < 1440;
  return {
    tone: "closed" as const,
    label: "Closed",
    detail: `Opens ${opensLabel}${sameDay ? "" : ` ${titleCaseDay(GBP_DAYS[startDay]).slice(0, 3)}`}`,
  };
}

function formatPhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10 ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` : value;
}

function relativeReviewTime(value: string | null, now: Date) {
  if (!value) return "";
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  const plural = (count: number, unit: string) => count === 1 ? `a ${unit} ago` : `${count} ${unit}s ago`;
  if (days < 1) return "today";
  if (days < 7) return days === 1 ? "a day ago" : `${days} days ago`;
  if (days < 30) return plural(Math.floor(days / 7), "week");
  if (days < 365) return plural(Math.floor(days / 30), "month");
  return plural(Math.floor(days / 365), "year");
}

const AVATAR_COLORS = ["#1a73e8", "#e8710a", "#188038", "#a142f4", "#d93025", "#12b5cb", "#e52592", "#5f6368"];

function avatarColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function GoogleStars({ rating, size = "sm" }: { rating: number; size?: "sm" | "lg" }) {
  const percent = Math.max(0, Math.min(100, (rating / 5) * 100));
  return (
    <span className={`gbp-stars gbp-stars-${size}`} style={{ "--gbp-rating": `${percent}%` } as CSSProperties} role="img" aria-label={`Rated ${rating.toFixed(1)} out of 5`}>
      ★★★★★
    </span>
  );
}

type ProfileTab = "overview" | "edit" | "photos" | "settings";

const PROFILE_TABS: { key: ProfileTab; label: string; icon: ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <BarChart3 size={16} aria-hidden="true" /> },
  { key: "edit", label: "Edit profile", icon: <PenLine size={16} aria-hidden="true" /> },
  { key: "photos", label: "Photos", icon: <ImageIcon size={16} aria-hidden="true" /> },
  { key: "settings", label: "Settings", icon: <Settings size={16} aria-hidden="true" /> },
];

/** One business's live Google data, shared by the Overview, Edit and Photos tabs. */
function ProfileTabContent({ tab, clientId, profile, profileName, canManage, canReadReviews, mutate, editSection, onNavigate }: {
  tab: Exclude<ProfileTab, "settings">;
  editSection: string | null;
  onNavigate: (tab: ProfileTab, section?: string | null) => void;
  clientId: string;
  profile: CrmGoogleProfile | null;
  profileName: string;
  canManage: boolean;
  canReadReviews: boolean;
  mutate: Mutate;
}) {
  const connected = profile?.status === "connected";
  const { listing, reviews, listingStatus, reviewStatus, reload } = useGoogleListing(clientId, connected, canReadReviews);

  if (tab === "edit") {
    return <GoogleProfileEditor clientId={clientId} profile={profile} listing={listing} canManage={canManage} mutate={mutate} onSaved={reload} initialSection={editSection} />;
  }
  if (tab === "photos") {
    return <GooglePhotosPanel clientId={clientId} listing={listing} canManage={canManage} onChanged={reload} />;
  }
  return (
    <>
      {connected ? (
        <GoogleProfileHealthPanel
          listing={listing}
          reviews={canReadReviews ? reviews : null}
          hasReviewLink={Boolean(profile?.googleReviewUrl)}
          onFix={(fix) => fix.kind === "edit" ? onNavigate("edit", fix.section) : fix.kind === "tab" ? onNavigate(fix.tab) : undefined}
        />
      ) : null}
      {connected && canManage ? <GooglePerformancePanel clientId={clientId} /> : null}
      <GoogleKnowledgePanel
        profileName={profileName}
        profile={profile}
        listing={listing}
        reviews={canReadReviews ? reviews : null}
        connected={connected}
        listingStatus={listingStatus}
        reviewStatus={canReadReviews ? reviewStatus : ""}
        onRetry={reload}
        editor={null}
      />
    </>
  );
}

function GoogleKnowledgePanel({ profileName, profile, listing, reviews, connected, listingStatus, reviewStatus, onRetry, editor }: {
  profileName: string;
  profile: CrmGoogleProfile | null;
  listing: LiveListing | null;
  reviews: GoogleBusinessReviewsPage | null;
  connected: boolean;
  listingStatus: string;
  reviewStatus: string;
  onRetry: () => void;
  editor: ReactNode;
}) {
  const [hoursOpen, setHoursOpen] = useState(false);
  const [shareNotice, setShareNotice] = useState("");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const title = listing?.title ?? profileName;
  const category = listing?.primaryCategory ?? profile?.primaryCategory ?? null;
  const address = listing?.address ?? profile?.address ?? null;
  const serviceAreas = listing?.serviceAreas ?? [];
  const addressParts = address?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
  const city = addressParts.length >= 3 ? addressParts[addressParts.length - 2] : serviceAreas[0]?.split(",")[0] ?? null;
  const phoneDisplay = formatPhone(listing?.phone ?? profile?.phone);
  const phoneHref = (listing?.phone ?? profile?.phone)?.replace(/[^+\d]/g, "");
  const website = httpsLink(listing?.detailsAvailable ? listing.website : profile?.website);
  const mapsQuery = encodeURIComponent([title, address ?? serviceAreas[0]].filter(Boolean).join(" "));
  const mapsUrl = httpsLink(listing?.mapsUrl) ?? `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${mapsQuery}`;
  const reviewUrl = httpsLink(listing?.reviewUrl) ?? httpsLink(profile?.googleReviewUrl) ?? mapsUrl;

  const photos = (listing?.media ?? [])
    .map((item) => ({ ...item, src: httpsLink(item.thumbnail) ?? (item.kind === "PHOTO" ? httpsLink(item.url) : undefined) }))
    .filter((item): item is typeof item & { src: string } => Boolean(item.src));
  const coverFirst = [...photos].sort((a, b) => {
    const rank = (category: string | null) => category === "COVER" ? 0 : category === "LOGO" || category === "PROFILE" ? 2 : 1;
    return rank(a.category) - rank(b.category);
  });
  const gallery = coverFirst.slice(0, 3);

  const hours = listing?.hours ?? [];
  const status = listing?.openStatus === "CLOSED_PERMANENTLY"
    ? { tone: "closed" as const, label: "Permanently closed", detail: "" }
    : listing?.openStatus === "CLOSED_TEMPORARILY"
      ? { tone: "closed" as const, label: "Temporarily closed", detail: "" }
      : openNowStatus(hours, now);
  const todayIndex = now.getDay();
  const weekOrder = GBP_DAYS.map((_, offset) => GBP_DAYS[(todayIndex + offset) % 7]);
  const todayKey = now.toISOString().slice(0, 10);
  const upcomingSpecial = (listing?.specialHours ?? [])
    .filter((period) => period.date && period.date >= todayKey)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .slice(0, 3);

  const averageRating = reviews?.averageRating ?? null;
  const totalReviews = reviews?.totalReviewCount ?? 0;
  const loadedReviews = reviews?.reviews ?? [];
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: loadedReviews.filter((review) => review.starRating === stars).length,
  }));
  const distributionMax = Math.max(1, ...distribution.map((row) => row.count));

  async function share() {
    try {
      await navigator.clipboard.writeText(mapsUrl);
      setShareNotice("Link copied");
    } catch {
      setShareNotice("Copy failed");
    }
    window.setTimeout(() => setShareNotice(""), 2000);
  }

  return (
    <section className="crm-panel gbp-preview" aria-label="Customer view of the Google Business Profile">
      <header className="gbp-preview-head">
        <div>
          <span>Customer view</span>
          <p>How {title} appears on Google Search and Maps.</p>
        </div>
        <a href={mapsUrl} target="_blank" rel="noreferrer">Open on Google <ExternalLink size={14} aria-hidden="true" /></a>
      </header>

      <div className="gbp-layout">
        <article className="gbp-panel">
          <div className="gbp-gallery" data-count={gallery.length || 0}>
            {gallery.length ? gallery.map((photo, index) => (
              <a key={photo.name ?? index} href={httpsLink(photo.url) ?? mapsUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- Google's media thumbnail */}
                <img src={photo.src} alt={photo.description ?? `${title} photo ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" />
              </a>
            )) : (
              <iframe title={`Map of ${title}`} src={`https://maps.google.com/maps?q=${mapsQuery}&output=embed`} loading="lazy" referrerPolicy="no-referrer" />
            )}
            {photos.length ? (
              <a className="gbp-see-photos" href={mapsUrl} target="_blank" rel="noreferrer">
                <ImageIcon size={14} aria-hidden="true" /> See photos
              </a>
            ) : null}
          </div>

          <div className="gbp-body">
            <h3>{title}</h3>
            <div className="gbp-rating-row">
              {averageRating != null && totalReviews > 0 ? (
                <>
                  <span className="gbp-rating-value">{averageRating.toFixed(1)}</span>
                  <GoogleStars rating={averageRating} />
                  <a href={reviewUrl} target="_blank" rel="noreferrer">{totalReviews.toLocaleString()} Google review{totalReviews === 1 ? "" : "s"}</a>
                </>
              ) : (
                <span className="gbp-muted">No reviews</span>
              )}
            </div>
            {category ? <p className="gbp-category">{category}{city ? ` in ${city}` : ""}</p> : null}
            {status?.label.includes("closed") ? <p className="gbp-status-closed">{status.label}</p> : null}

            <div className="gbp-actions">
              {website ? <a href={website} target="_blank" rel="noreferrer"><span><Globe size={18} aria-hidden="true" /></span>Website</a> : null}
              <a href={directionsUrl} target="_blank" rel="noreferrer"><span><Navigation size={18} aria-hidden="true" /></span>Directions</a>
              <a href={mapsUrl} target="_blank" rel="noreferrer"><span><Bookmark size={18} aria-hidden="true" /></span>Save</a>
              <button type="button" onClick={() => void share()}><span><Share2 size={18} aria-hidden="true" /></span>{shareNotice || "Share"}</button>
              {phoneHref ? <a href={`tel:${phoneHref}`}><span><Phone size={18} aria-hidden="true" /></span>Call</a> : null}
            </div>

            {listing?.description ? (
              <div className="gbp-section gbp-description">
                <p>{listing.description}</p>
              </div>
            ) : null}

            <dl className="gbp-section gbp-facts">
              {address ? (
                <div><dt>Address:</dt><dd><a href={mapsUrl} target="_blank" rel="noreferrer" className="gbp-plain">{address}</a></dd></div>
              ) : null}
              {serviceAreas.length ? (
                <div><dt>Areas served:</dt><dd>{serviceAreas.join(", ")}</dd></div>
              ) : null}
              {hours.length || status ? (
                <div className="gbp-hours-row">
                  <dt>Hours:</dt>
                  <dd>
                    <button type="button" className="gbp-hours-toggle" aria-expanded={hoursOpen} onClick={() => setHoursOpen((open) => !open)}>
                      {status ? <span className={`gbp-open gbp-open-${status.tone}`}>{status.label}</span> : null}
                      {status?.detail ? <span> ⋅ {status.detail}</span> : null}
                      <ChevronDown size={16} aria-hidden="true" className={hoursOpen ? "is-open" : ""} />
                    </button>
                    {hoursOpen && hours.length ? (
                      <table className="gbp-hours-table">
                        <tbody>
                          {weekOrder.map((day) => (
                            <tr key={day} className={day === GBP_DAYS[todayIndex] ? "is-today" : ""}>
                              <th scope="row">{titleCaseDay(day)}</th>
                              <td>{hoursForDay(hours, day)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
                    {upcomingSpecial.length ? (
                      <p className="gbp-special">
                        Holiday hours: {upcomingSpecial.map((period) => {
                          const label = new Date(`${period.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
                          return `${label} ${period.closed ? "Closed" : `${formatGoogleTime(period.openTime)}–${formatGoogleTime(period.closeTime)}`}`;
                        }).join(" · ")}
                      </p>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              {phoneDisplay ? (
                <div><dt>Phone:</dt><dd><a href={`tel:${phoneHref}`}>{phoneDisplay}</a></dd></div>
              ) : null}
              {website ? (
                <div><dt>Website:</dt><dd><a href={website} target="_blank" rel="noreferrer">{website.replace(/^https:\/\/(www\.)?/i, "").replace(/\/$/, "")}</a></dd></div>
              ) : null}
              {listing?.services.length ? (
                <div><dt>Services:</dt><dd>{listing.services.slice(0, 8).join(", ")}{listing.services.length > 8 ? ` +${listing.services.length - 8} more` : ""}</dd></div>
              ) : null}
              {listing?.additionalCategories.length ? (
                <div><dt>Also:</dt><dd>{listing.additionalCategories.join(", ")}</dd></div>
              ) : null}
            </dl>

            {photos.length > 3 ? (
              <div className="gbp-section">
                <h4>Photos</h4>
                <div className="gbp-photo-strip">
                  {coverFirst.slice(3).map((photo, index) => (
                    <a key={photo.name ?? index} href={httpsLink(photo.url) ?? mapsUrl} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- Google's media thumbnail */}
                      <img src={photo.src} alt={photo.description ?? ""} loading="lazy" referrerPolicy="no-referrer" />
                    </a>
                  ))}
                  {listing?.hasMoreMedia ? <a className="gbp-more-photos" href={mapsUrl} target="_blank" rel="noreferrer">See more</a> : null}
                </div>
              </div>
            ) : null}

            <div className="gbp-section gbp-reviews">
              <div className="gbp-reviews-head">
                <h4>Google reviews</h4>
                <a className="gbp-write-review" href={reviewUrl} target="_blank" rel="noreferrer"><Pencil size={14} aria-hidden="true" /> Write a review</a>
              </div>
              {averageRating != null && totalReviews > 0 ? (
                <div className="gbp-review-summary">
                  <div className="gbp-review-bars">
                    {distribution.map((row) => (
                      <div key={row.stars}>
                        <span>{row.stars}</span>
                        <span className="gbp-bar"><span style={{ width: `${(row.count / distributionMax) * 100}%` }} /></span>
                      </div>
                    ))}
                  </div>
                  <div className="gbp-review-score">
                    <strong>{averageRating.toFixed(1)}</strong>
                    <GoogleStars rating={averageRating} size="lg" />
                    <span>{totalReviews.toLocaleString()} review{totalReviews === 1 ? "" : "s"}</span>
                  </div>
                </div>
              ) : null}
              {reviewStatus ? <p className="gbp-muted">{reviewStatus}</p> : null}
              {!reviewStatus && reviews && !loadedReviews.length ? <p className="gbp-muted">No reviews yet. Be the first to review this business.</p> : null}
              {loadedReviews.slice(0, 5).map((review) => (
                <article className="gbp-review" key={review.reviewId}>
                  <header>
                    <span className="gbp-avatar" style={{ background: avatarColor(review.reviewerName) }} aria-hidden="true">
                      {review.reviewerName.charAt(0).toUpperCase()}
                    </span>
                    <strong>{review.reviewerName}</strong>
                  </header>
                  <div className="gbp-review-meta">
                    <GoogleStars rating={review.starRating} />
                    <span>{relativeReviewTime(review.createTime, now)}</span>
                  </div>
                  {review.comment ? <p>{review.comment}</p> : null}
                  {review.reply ? (
                    <div className="gbp-owner-reply">
                      <strong>Response from the owner</strong>
                      {review.reply.updateTime ? <span> {relativeReviewTime(review.reply.updateTime, now)}</span> : null}
                      <p>{review.reply.comment}</p>
                    </div>
                  ) : null}
                </article>
              ))}
              {totalReviews > 5 ? <a className="gbp-more-reviews" href={mapsUrl} target="_blank" rel="noreferrer">More Google reviews</a> : null}
            </div>
          </div>
        </article>

        <aside className="gbp-side">
          {gallery.length ? (
            <iframe className="gbp-map" title={`Map of ${title}`} src={`https://maps.google.com/maps?q=${mapsQuery}&output=embed`} loading="lazy" referrerPolicy="no-referrer" />
          ) : null}
          {!connected ? <p className="gbp-note">Connect the location to load its live Google profile.</p> : null}
          {connected && listingStatus ? <p className="gbp-note">{listingStatus}</p> : null}
          {connected && listing && !listing.mediaAvailable ? <p className="gbp-note">Google media is unavailable right now.</p> : null}
          {connected && listing?.mediaAvailable && !photos.length ? <p className="gbp-note">No photos on this profile yet. Customers see a map instead — add a cover photo and logo on Google.</p> : null}
          {connected && (listingStatus === "Google listing data is unavailable." || (listing && (!listing.detailsAvailable || !listing.mediaAvailable))) ? (
            <button className="crm-button-secondary" type="button" onClick={onRetry}>Retry loading Google data</button>
          ) : null}
          {editor}
        </aside>
      </div>
    </section>
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
      className="crm-panel gp-panel gp-chooser"
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
        <div className="gp-loading">
          <div className="gp-mark" aria-hidden="true"><i>G</i></div>
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

      {candidateError ? <GoogleIssue message={candidateError} showRequestLink={!disabled} /> : null}
      {actionError ? (
        <div className="crm-inline-error" role="alert">
          {actionError}
        </div>
      ) : null}

      {hasLocations ? (
        <div className="gp-locations">
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
                  <div className="gp-location-action">
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
        <footer className="gp-actions">
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
