"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Database,
  Funnel,
  History,
  KeyRound,
  LayoutDashboard,
  MessageSquareText,
  PhoneCall,
  Plug,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import type {
  CrmAiAuthorization,
  CrmClient,
  CrmProviderConnection,
  CrmStage,
  CrmWorkflow,
  CrmWorkflowEdge,
  CrmWorkflowNode,
  CrmWorkflowRun,
} from "../../db/crm";
import {
  CALLRAIL_INGESTION_CLEANUP_PENDING,
  CALLRAIL_INGESTION_ON,
  callRailIngestionView,
} from "../../lib/callrail-ingestion-state";
import { Badge, dateTime } from "./ui";

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;

type TwilioVisibleBalance = {
  balance: number | null;
  currency: string | null;
  balanceStatus: "parent" | "available" | "shared" | "unavailable";
};

const CALLRAIL_EVENT_LABELS: Record<string, string> = {
  post_call_webhook: "Completed calls",
  updated_call_webhook: "Updated calls",
};

const callRailEventLabel = (event: string) =>
  CALLRAIL_EVENT_LABELS[event] ?? event;

type IntegrationStatus = "connected" | "setup" | "available";

/**
 * Ad spend in the ad account's own currency.
 *
 * A Meta ad account bills in one currency and it is not always the operator's,
 * so the code Meta reports is used rather than assumed. An unknown code falls
 * back to a plain number instead of silently labelling euros as dollars.
 */
function formatAdSpend(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return value.toFixed(0);
  }
}

function integrationSyncLabel(value: string | null | undefined) {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "—";
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return date.toDateString() === new Date().toDateString()
    ? `Today at ${time}`
    : `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${time}`;
}

function clientChoice(
  clients: CrmClient[],
  selectedClientId: string,
  local: string,
) {
  return selectedClientId !== "all"
    ? selectedClientId
    : local || clients[0]?.id || "";
}

export function ConnectionsView({
  clients,
  connections,
  aiAuthorizations,
  selectedClientId,
  mutate,
  canReadSharedBilling,
  onOpenAiConnector,
  onViewCalls,
}: {
  clients: CrmClient[];
  connections: CrmProviderConnection[];
  aiAuthorizations: CrmAiAuthorization[];
  selectedClientId: string;
  mutate: Mutate;
  canReadSharedBilling: boolean;
  onOpenAiConnector: (clientId: string) => void;
  onViewCalls: () => void;
}) {
  const [localClient, setLocalClient] = useState(clients[0]?.id ?? "");
  const [integrationQuery, setIntegrationQuery] = useState("");
  const [integrationFilter, setIntegrationFilter] =
    useState<"all" | IntegrationStatus>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedIntegration, setExpandedIntegration] = useState<
    "twilio" | "callrail" | "meta" | "meta-ads" | null
  >(null);
  const clientId = clientChoice(clients, selectedClientId, localClient);
  const client = clients.find((item) => item.id === clientId);
  const connection = connections.find(
    (item) => item.clientId === clientId && item.provider === "twilio",
  );
  const isLinked = Boolean(connection?.isLinked);
  const isActive = Boolean(connection?.isActive);
  const activeAiAuthorizations = aiAuthorizations.filter(
    (authorization) =>
      authorization.status === "active" &&
      authorization.clientIds.includes(clientId),
  );
  const aiConnected = activeAiAuthorizations.length > 0;
  const metaConnection = connections.find(
    (item) => item.clientId === clientId && item.provider === "meta",
  );
  const metaLinked = Boolean(metaConnection?.isLinked);
  const metaLive = metaConnection?.mode === "live";
  const metaModeLabel = metaLive ? "Live" : "Test mode";
  const [metaDatasetId, setMetaDatasetId] = useState("");
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaTestEventCode, setMetaTestEventCode] = useState("");
  // Meta Ads is the read side: spend and delivery out of an ad account. A
  // separate connection from Conversions above, because the tokens carry
  // different permissions and a business may well have one without the other.
  const metaAdsConnection = connections.find(
    (item) => item.clientId === clientId && item.provider === "meta_ads",
  );
  const metaAdsLinked = Boolean(metaAdsConnection?.isLinked);
  const [metaAdsToken, setMetaAdsToken] = useState("");
  const [metaAdsAccountId, setMetaAdsAccountId] = useState("");
  const [metaAdsAccounts, setMetaAdsAccounts] = useState<
    Array<{ id: string; name: string; currency: string | null }>
  >([]);
  const callRailConnection = connections.find(
    (item) => item.clientId === clientId && item.provider === "callrail",
  );
  // A CallRail connection exists as soon as the key is stored, which is before
  // an account or company has been chosen. isLinked is keyed on the external
  // account id and would read false during that window, so status is what
  // decides whether the connect form or the setup steps are shown.
  const callRailStored =
    callRailConnection?.status === "connected" ||
    callRailConnection?.status === "setup_required" ||
    callRailConnection?.status === "attention";
  const callRailSetup = callRailConnection?.setupStatus ?? null;
  // Three states, decided in one place the server writes and this reads
  // back: on, off, and off-but-still-registered-at-CallRail. The third is
  // recoverable on its own and must not be offered the Enable button.
  const callRailIngestion = callRailIngestionView(callRailConnection);
  const callRailIngesting = callRailIngestion === CALLRAIL_INGESTION_ON;
  const callRailCleanupPending =
    callRailIngestion === CALLRAIL_INGESTION_CLEANUP_PENDING;
  const callRailIngestEvents = callRailConnection?.callIngestionEvents ?? [];
  const emptyCallRail = {
    apiKey: "",
    accounts: [] as Array<{ id: string; name: string }>,
    companies: [] as Array<{ id: string; name: string }>,
    check: "",
    // Ingestion carries its own pending and error state rather than borrowing
    // the page-wide one. Switching it on is the moment this integration starts
    // writing to a business's CRM, so the outcome belongs next to the button
    // that caused it, not in a toast at the top of the page.
    ingestionPending: "" as
      | ""
      | "enable"
      | "disable"
      | "retry"
      | "recover"
      | "media",
    ingestionError: "",
    // A result that is neither failure nor nothing: “no missed calls” is
    // the good outcome of a recovery, and reporting it in red would say
    // something went wrong when nothing did.
    ingestionNote: "",
  };
  const [callRailState, setCallRailState] = useState({
    clientId,
    ...emptyCallRail,
  });
  // Scoped by deriving during render rather than by clearing in an effect:
  // anything fetched for one business is simply not shown against another, and
  // switching business costs no cascading render.
  const callRail =
    callRailState.clientId === clientId
      ? callRailState
      : { clientId, ...emptyCallRail };
  const patchCallRail = (patch: Partial<typeof emptyCallRail>) =>
    setCallRailState({ ...callRail, clientId, ...patch });

  // Disable and Retry cleanup are the same request. The action is
  // idempotent — it rewrites ingest_enabled=false, which is already the
  // case on a retry, and asks CallRail again — so recovering from a
  // stranded cleanup never means re-enabling ingestion first.
  const runCallRailDisable = async (mode: "disable" | "retry") => {
    patchCallRail({ ingestionPending: mode, ingestionError: "" });
    try {
      const result = (await mutate(
        { action: "disable_callrail_ingestion", clientId },
        // Says only what is certain once the request succeeded. Whether
        // CallRail actually dropped the URLs is in the returned flag.
        mode === "retry" ? "Cleanup retried." : "Call ingestion turned off.",
      )) as { cleanupConfirmed?: boolean } | null;
      patchCallRail({
        ingestionPending: "",
        ingestionError:
          result?.cleanupConfirmed === false
            ? "CallRail did not confirm the webhook URLs were removed. Ingestion stays off; use Retry cleanup to try again."
            : "",
      });
    } catch (error) {
      patchCallRail({
        ingestionPending: "",
        ingestionError:
          error instanceof Error
            ? error.message
            : mode === "retry"
              ? "The webhook cleanup could not be retried."
              : "Call ingestion could not be turned off.",
      });
    }
  };
  // Fetches calls the webhooks may have missed and ingests them. The schedule
  // already does this every fifteen minutes; this is for what it cannot reach
  // — a delivery refused before a fix, or a call older than its lookback. It
  // reports what it actually found rather than claiming success.
  const runCallRailRecovery = async (lookbackDays: number) => {
    patchCallRail({
      ingestionPending: "recover",
      ingestionError: "",
      ingestionNote: "",
    });
    try {
      const result = (await mutate(
        { action: "recover_callrail_calls", clientId, lookbackDays },
        "Checked CallRail for missed calls.",
      )) as {
        callsSeen?: number;
        callsIngested?: number;
        callsRecovered?: number;
        skipped?: number;
        failures?: number;
      } | null;
      const found =
        (result?.callsIngested ?? 0) + (result?.callsRecovered ?? 0);
      const days = `${lookbackDays} day${lookbackDays === 1 ? "" : "s"}`;
      patchCallRail({
        ingestionPending: "",
        ingestionError: result?.skipped
          ? "A check was already running for this business, so this one did nothing. Try again in a minute."
          : result?.failures
            ? "CallRail could not be read in full, so some calls may still be missing. Try again."
            : "",
        ingestionNote:
          result?.skipped || result?.failures
            ? ""
            : found === 0
              ? `No missed calls in the last ${days}. Everything CallRail has is already recorded.`
              : `Recovered ${found} call${found === 1 ? "" : "s"} from the last ${days}.`,
      });
    } catch (error) {
      patchCallRail({
        ingestionPending: "",
        ingestionNote: "",
        ingestionError:
          error instanceof Error
            ? error.message
            : "CallRail could not be checked for missed calls.",
      });
    }
  };

  // Asks CallRail again about each call's audio, and changes nothing else.
  // A recording is often not ready the moment a call ends, so the answer can
  // differ from the one ingestion got.
  const runCallRailMediaRefresh = async () => {
    patchCallRail({
      ingestionPending: "media",
      ingestionError: "",
      ingestionNote: "",
    });
    try {
      const result = (await mutate(
        { action: "refresh_callrail_call_media", clientId },
        "Checked CallRail for recordings.",
      )) as {
        checked?: number;
        withRecording?: number;
        changed?: number;
        failed?: number;
      } | null;
      const checked = result?.checked ?? 0;
      const withRecording = result?.withRecording ?? 0;
      patchCallRail({
        ingestionPending: "",
        ingestionError: result?.failed
          ? `CallRail did not answer for ${result.failed} of ${checked + (result.failed ?? 0)} calls. Try again.`
          : "",
        ingestionNote: result?.failed
          ? ""
          : withRecording === 0
            ? `Checked ${checked} call${checked === 1 ? "" : "s"}. CallRail has no recordings for any of them.`
            : `Checked ${checked} call${checked === 1 ? "" : "s"}. ${withRecording} now ${withRecording === 1 ? "has" : "have"} a recording.`,
      });
    } catch (error) {
      patchCallRail({
        ingestionPending: "",
        ingestionNote: "",
        ingestionError:
          error instanceof Error
            ? error.message
            : "CallRail could not be checked for recordings.",
      });
    }
  };

  const [balanceResult, setBalanceResult] = useState<{
    key: string;
    data: TwilioVisibleBalance | null;
    error: string | null;
  }>({ key: "", data: null, error: null });
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const balanceRequestKey = `${clientId}:${connection?.connectedAt ?? ""}:${balanceRefreshKey}`;

  useEffect(() => {
    const controller = new AbortController();
    if (!canReadSharedBilling || !isLinked || !clientId)
      return () => controller.abort();

    void fetch(
      `/api/integrations/twilio/balance?clientId=${encodeURIComponent(clientId)}&refresh=${balanceRefreshKey > 0 ? "true" : "false"}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          data?: TwilioVisibleBalance;
          error?: string;
        };
        if (!response.ok || !payload.data)
          throw new Error(payload.error || "Twilio balance could not be loaded.");
        return payload.data;
      })
      .then((data) => {
        if (!controller.signal.aborted)
          setBalanceResult({ key: balanceRequestKey, data, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setBalanceResult({
            key: balanceRequestKey,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : "Twilio balance could not be loaded.",
          });
      });

    return () => controller.abort();
  }, [
    balanceRefreshKey,
    balanceRequestKey,
    canReadSharedBilling,
    clientId,
    isLinked,
  ]);

  const currentBalanceResult =
    canReadSharedBilling && isLinked && balanceResult.key === balanceRequestKey
      ? balanceResult
      : null;
  const visibleBalance = currentBalanceResult?.data ?? null;
  const balanceError = currentBalanceResult?.error ?? null;
  const balanceLoading = Boolean(
    canReadSharedBilling &&
      isLinked &&
      clientId &&
      balanceResult.key !== balanceRequestKey,
  );
  const displayedBalance = visibleBalance?.balance ?? null;
  const displayedBalanceStatus =
    visibleBalance?.balanceStatus ?? connection?.balanceStatus;
  const displayedCurrency = visibleBalance?.currency ?? connection?.currency;
  const money = (
    value: number | null | undefined,
    currency = connection?.currency,
  ) =>
    value == null
      ? isLinked
        ? "Not available"
        : "Not loaded"
      : new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currency || "USD",
        }).format(value);
  const lowBalance =
    canReadSharedBilling &&
    displayedBalance != null &&
    displayedBalance < 10;

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>("#crm-integrations-search")
          ?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const twilioStatus: IntegrationStatus = isLinked ? "connected" : "setup";
  const aiStatus: IntegrationStatus = aiConnected ? "connected" : "setup";
  const callRailStatus: IntegrationStatus =
    callRailStored &&
    callRailSetup === "ready" &&
    callRailConnection?.status !== "attention"
      ? "connected"
      : "setup";
  const metaStatus: IntegrationStatus = metaLinked ? "connected" : "available";
  const metaAdsStatus: IntegrationStatus = metaAdsLinked
    ? "connected"
    : "available";
  const integrationStatuses = [
    twilioStatus,
    aiStatus,
    callRailStatus,
    metaStatus,
    metaAdsStatus,
  ];
  const statusCount = (status: IntegrationStatus) =>
    integrationStatuses.filter((item) => item === status).length;
  const integrationMatches = (
    name: string,
    description: string,
    status: IntegrationStatus,
  ) => {
    const needle = integrationQuery.trim().toLowerCase();
    return (
      (integrationFilter === "all" || integrationFilter === status) &&
      (!needle || `${name} ${description}`.toLowerCase().includes(needle))
    );
  };
  const twilioVisible = integrationMatches(
    "Twilio",
    "Business phone system calls and two-way texting",
    twilioStatus,
  );
  const aiVisible = integrationMatches(
    "AI Connector",
    "Let your AI account safely work with this CRM",
    aiStatus,
  );
  const callRailVisible = integrationMatches(
    "CallRail",
    "Track calls and analyze phone conversations",
    callRailStatus,
  );
  const metaVisible = integrationMatches(
    "Meta Conversions",
    "Report web and ads conversions and analyze customers",
    metaStatus,
  );
  const metaAdsVisible = integrationMatches(
    "Meta Ads",
    "Pull campaign spend clicks and cost per lead into reporting",
    metaAdsStatus,
  );
  const visibleIntegrationCount = [
    twilioVisible,
    aiVisible,
    callRailVisible,
    metaVisible,
    metaAdsVisible,
  ].filter(Boolean).length;
  const showAllIntegrations = () => {
    setIntegrationQuery("");
    setIntegrationFilter("all");
    setFiltersOpen(false);
    window.setTimeout(
      () =>
        document
          .querySelector("#crm-your-integrations")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  };

  return (
    <div className="crm-view crm-connections-view">
      <section className="crm-integrations-header">
        <div className="crm-integrations-title">
          <h2>Integrations</h2>
          <p>Connect and manage the tools that power your business.</p>
          {selectedClientId === "all" ? (
            <label className="crm-integrations-client-picker">
              <span>Business</span>
              <select
                value={clientId}
                onChange={(event) => setLocalClient(event.target.value)}
              >
                {clients.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.businessName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="crm-integrations-toolbar">
          <label className="crm-integrations-search" htmlFor="crm-integrations-search">
            <Search aria-hidden="true" />
            <input
              id="crm-integrations-search"
              type="search"
              value={integrationQuery}
              onChange={(event) => setIntegrationQuery(event.target.value)}
              placeholder="Search integrations..."
            />
            <kbd>Ctrl K</kbd>
          </label>
          <div className="crm-integrations-filter-wrap">
            <button
              className={integrationFilter !== "all" ? "active" : ""}
              type="button"
              aria-haspopup="menu"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <Funnel aria-hidden="true" />
              Filters
            </button>
            {filtersOpen ? (
              <div className="crm-integrations-filter-menu" role="menu">
                {(
                  [
                    ["all", "All integrations"],
                    ["connected", "Connected"],
                    ["setup", "Needs setup"],
                    ["available", "Available"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={integrationFilter === value ? "active" : ""}
                    onClick={() => {
                      setIntegrationFilter(value);
                      setFiltersOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            className="crm-integrations-browse"
            type="button"
            onClick={showAllIntegrations}
          >
            <LayoutDashboard aria-hidden="true" />
            Browse all integrations
          </button>
        </div>
      </section>
      {!client ? (
        <section className="crm-empty-state">
          <h3>Add a client first</h3>
          <p>
            Connections belong to one business and cannot be shared across
            clients.
          </p>
        </section>
      ) : (
        <div className="crm-integrations-content">
          <section className="crm-integrations-summary" aria-label="Integration summary">
            <article>
              <span className="crm-integrations-summary-icon connected"><Plug /></span>
              <strong>{statusCount("connected")}</strong>
              <div><b>Connected</b><small>Active and syncing</small></div>
            </article>
            <article>
              <span className="crm-integrations-summary-icon setup"><Settings /></span>
              <strong>{statusCount("setup")}</strong>
              <div><b>Needs setup</b><small>Finish configuration</small></div>
            </article>
            <article>
              <span className="crm-integrations-summary-icon available"><LayoutDashboard /></span>
              <strong>{statusCount("available")}</strong>
              <div><b>Available</b><small>Ready to connect</small></div>
            </article>
            <article>
              <span className="crm-integrations-summary-icon total"><Database /></span>
              <strong>{integrationStatuses.length}</strong>
              <div><b>Total</b><small>All integrations</small></div>
            </article>
          </section>
          <div className="crm-integrations-section-heading" id="crm-your-integrations">
            <h3>Your integrations</h3>
            {integrationFilter !== "all" || integrationQuery ? (
              <button type="button" onClick={showAllIntegrations}>Clear filters</button>
            ) : null}
          </div>
          <div className="crm-integration-card-grid">
          {twilioVisible ? (
          <article className={`crm-connection-card crm-integration-card featured ${expandedIntegration === "twilio" ? "expanded" : ""}`}>
            <header>
              <span className="crm-twilio-mark" aria-hidden="true">
                <svg viewBox="0 0 42 42">
                  <circle cx="21" cy="21" r="17" />
                  <circle cx="16" cy="16" r="3" />
                  <circle cx="26" cy="16" r="3" />
                  <circle cx="16" cy="26" r="3" />
                  <circle cx="26" cy="26" r="3" />
                </svg>
                <b>twilio</b>
              </span>
              <div>
                <h3>Twilio</h3>
                <p>Business phone system, calls, and two-way texting.</p>
              </div>
              <Badge tone={isLinked ? "green" : "orange"}>
                {isLinked ? "Connected" : "Needs setup"}
              </Badge>
              <span className="crm-integration-chevron" aria-hidden="true">›</span>
            </header>
            <div className="crm-integration-facts">
              <div><PhoneCall /><span>Phone &amp; calling<strong>{isActive ? "On" : "—"}</strong></span></div>
              <div><MessageSquareText /><span>Two-way texting<strong>{isActive ? "On" : "—"}</strong></span></div>
              <div><History /><span>Last synced<strong>{integrationSyncLabel(connection?.lastHealthCheckAt ?? connection?.connectedAt)}</strong></span></div>
            </div>
            <div className="crm-integration-footer">
              {isLinked ? (
                <>
                  <button type="button" className="crm-integration-secondary" aria-expanded={expandedIntegration === "twilio"} onClick={() => setExpandedIntegration((current) => current === "twilio" ? null : "twilio")}><Settings />Manage connection</button>
                  <button type="button" className="crm-integration-secondary" onClick={onViewCalls}><PhoneCall />View calls</button>
                  <button type="button" className="crm-integration-more" aria-label="More Twilio actions" onClick={() => setExpandedIntegration((current) => current === "twilio" ? null : "twilio")}>•••</button>
                </>
              ) : (
                <>
                  <a className="crm-integration-primary" href={`/api/integrations/twilio/connect?clientId=${encodeURIComponent(clientId)}`}>Connect</a>
                  <button type="button" className="crm-integration-learn" aria-expanded={expandedIntegration === "twilio"} onClick={() => setExpandedIntegration((current) => current === "twilio" ? null : "twilio")}>Learn more <span aria-hidden="true">↗</span></button>
                </>
              )}
            </div>
            <div className="crm-integration-advanced">
            <div className="crm-connection-details crm-connection-details-simple">
              <div className="crm-twilio-balance"><span>Available balance</span><strong>{connection?.balanceStatus === "restricted" ? "Restricted" : balanceLoading ? "Loading..." : balanceError ? "Not available" : displayedBalanceStatus === "shared" ? "Shared balance" : money(displayedBalance, displayedCurrency)}</strong></div>
              <div><span>Calls this month</span><strong>{connection?.monthCalls ?? (isLinked ? "—" : "Not connected")}</strong></div>
              <div><span>Texts this month</span><strong>{connection?.monthMessages ?? (isLinked ? "—" : "Not connected")}</strong></div>
              <div><span>Status</span><strong>{isActive ? "Active" : isLinked ? "Needs attention" : "Not connected"}</strong></div>
            </div>
            {lowBalance ? (
              <p className="crm-balance-warning">
                <strong>Low Twilio balance.</strong> Add funds in Twilio soon so calls, texts and automations do not stop.
              </p>
            ) : null}
            {connection?.lastError ? (
              <p className="crm-inline-error">
                <strong>Needs attention:</strong> {connection.lastError}
              </p>
            ) : null}
            <div className="crm-connection-actions">
              {isLinked ? (
                <>
                  <button
                    onClick={async () => {
                      await mutate(
                        { action: "check_provider_connection", clientId },
                        "Twilio connection status refreshed.",
                      );
                      setBalanceRefreshKey((value) => value + 1);
                    }}
                  >
                    Refresh connection
                  </button>
                  <button
                    className="danger"
                    onClick={() =>
                      window.confirm(
                        "Disconnect Twilio? Phone calls, texts and automations will stop.",
                      ) &&
                      mutate(
                        { action: "disconnect_provider", clientId },
                        "Twilio disconnected.",
                      )
                    }
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <a
                  className="crm-button-primary"
                  href={`/api/integrations/twilio/connect?clientId=${encodeURIComponent(clientId)}`}
                >
                  Connect
                </a>
              )}
            </div>
            </div>
          </article>
          ) : null}
          {aiVisible ? (
          <article className="crm-connection-card crm-integration-card ai">
            <header>
              <span className="crm-ai-mark" aria-hidden="true"><Sparkles /><Sparkles /></span>
              <div>
                <h3>AI Connector</h3>
                <p>Let your AI account safely work with this CRM.</p>
              </div>
              <Badge tone={aiConnected ? "green" : "orange"}>
                {aiConnected ? "Connected" : "Needs setup"}
              </Badge>
              <span className="crm-integration-chevron" aria-hidden="true">›</span>
            </header>
            <div className="crm-integration-facts">
              <div><Sparkles /><span>Connected apps<strong>{activeAiAuthorizations.length}</strong></span></div>
              <div><History /><span>Last synced<strong>{integrationSyncLabel(activeAiAuthorizations[0]?.lastSuccessAt ?? activeAiAuthorizations[0]?.connectedAt)}</strong></span></div>
              <div><Database /><span>Data status<strong>{aiConnected ? "Active" : "—"}</strong></span></div>
            </div>
            <div className="crm-connection-details compact crm-connection-details-simple">
              <div><span>Status</span><strong>{aiConnected ? "Active" : "Not connected"}</strong></div>
              <div><span>Connected apps</span><strong>{activeAiAuthorizations.length}</strong></div>
            </div>
            <div className="crm-integration-footer">
              <button
                className="crm-integration-primary"
                type="button"
                onClick={() => onOpenAiConnector(clientId)}
              >
                {aiConnected ? "Manage" : "Connect"}
              </button>
              {activeAiAuthorizations.length === 1 ? (
                <button
                  className="danger"
                  type="button"
                  onClick={() => {
                    const authorization = activeAiAuthorizations[0];
                    if (
                      authorization &&
                      window.confirm(
                        `Disconnect ${authorization.appName}? It will immediately lose access to every business approved for this connection.`,
                      )
                    ) {
                      void mutate(
                        {
                          action: "revoke_ai_authorization",
                          authorizationId: authorization.id,
                        },
                        `${authorization.appName} disconnected.`,
                      );
                    }
                  }}
                >
                  Disconnect
                </button>
              ) : null}
              <button type="button" className="crm-integration-learn" onClick={() => onOpenAiConnector(clientId)}>Learn more <span aria-hidden="true">↗</span></button>
            </div>
          </article>
          ) : null}
          {metaVisible ? (
          <article className={`crm-connection-card crm-integration-card meta ${expandedIntegration === "meta" ? "expanded" : ""}`}>
            <header>
              <span className="crm-meta-mark" aria-hidden="true">∞</span>
              <div>
                <h3>Meta Conversions</h3>
                <p>Report web and ad conversions and analyze customers.</p>
              </div>
              <Badge tone={metaLinked ? "green" : "blue"}>
                {metaLinked ? "Connected" : "Available"}
              </Badge>
              <span className="crm-integration-chevron" aria-hidden="true">›</span>
            </header>
            <div className="crm-integration-facts">
              <div><Database /><span>Dataset<strong>{metaConnection?.accountLabel ?? "—"}</strong></span></div>
              <div><KeyRound /><span>Access token<strong>{metaLinked ? "Active" : "—"}</strong></span></div>
              <div><Sparkles /><span>Test event code<strong>{metaLinked && !metaLive ? "Enabled" : "—"}</strong></span></div>
            </div>
            <div className="crm-integration-footer">
              <button type="button" className="crm-integration-primary" aria-expanded={expandedIntegration === "meta"} onClick={() => setExpandedIntegration((current) => current === "meta" ? null : "meta")}>{metaLinked ? "Manage" : "Configure"}</button>
              <button type="button" className="crm-integration-learn" onClick={() => setExpandedIntegration((current) => current === "meta" ? null : "meta")}>Learn more <span aria-hidden="true">↗</span></button>
            </div>
            <div className="crm-integration-advanced">
            <div className="crm-connection-details compact crm-connection-details-simple">
              <div><span>Dataset</span><strong>{metaConnection?.accountLabel ?? "Not connected"}</strong></div>
              <div>
                <span>Mode</span>
                <strong>
                  {metaLinked ? metaModeLabel : "Not connected"}
                </strong>
              </div>
            </div>
            {metaLinked ? (
              <>
                {metaLive ? (
                  <p className="crm-connection-note">
                    Conversions from this business count toward its ad
                    optimization.
                  </p>
                ) : (
                  <p className="crm-connection-note">
                    Conversions are sent with a test event code so they show in
                    Meta&rsquo;s Test Events view. Meta only routes them there
                    while that code is the active one for this dataset, so check
                    Test Events to confirm they are arriving. Go live when you
                    want conversions to start counting.
                  </p>
                )}
                <div className="crm-connection-actions">
                  {metaLive ? null : (
                    <button
                      className="crm-button-primary"
                      type="button"
                      onClick={() =>
                        window.confirm(
                          "Go live? Conversions will start counting toward this business's ad optimization. Returning to test mode means disconnecting and reconnecting with a new test event code.",
                        ) &&
                        mutate(
                          { action: "set_meta_conversions_live", clientId },
                          "Meta is now live.",
                        )
                      }
                    >
                      Go live
                    </button>
                  )}
                  <button
                    className="danger"
                    type="button"
                    onClick={() =>
                      window.confirm(
                        "Disconnect Meta? Facebook and Instagram will stop learning which ad clicks turn into customers.",
                      ) &&
                      mutate(
                        { action: "disconnect_meta_conversions", clientId },
                        "Meta disconnected.",
                      )
                    }
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <form
                className="crm-connection-connect-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await mutate(
                    {
                      action: "connect_meta_conversions",
                      clientId,
                      datasetId: metaDatasetId,
                      accessToken: metaAccessToken,
                      testEventCode: metaTestEventCode,
                    },
                    "Meta conversions connected.",
                  );
                  // Never keep the customer's token in browser state after use.
                  setMetaAccessToken("");
                }}
              >
                <p>
                  This business creates both of these in their own Meta Events
                  Manager, on the dataset for their pixel. BrizBuilder stores the
                  token encrypted and never sees their Meta password.
                </p>
                <label>
                  Dataset (pixel) ID
                  <input
                    value={metaDatasetId}
                    onChange={(event) => setMetaDatasetId(event.target.value)}
                    inputMode="numeric"
                    placeholder="1234567890123456"
                    required
                  />
                </label>
                <label>
                  Conversions API access token
                  <input
                    type="password"
                    value={metaAccessToken}
                    onChange={(event) => setMetaAccessToken(event.target.value)}
                    autoComplete="off"
                    required
                  />
                </label>
                <label>
                  Test event code
                  <input
                    value={metaTestEventCode}
                    onChange={(event) =>
                      setMetaTestEventCode(event.target.value)
                    }
                    autoComplete="off"
                    placeholder="From the Test Events tab"
                    required
                  />
                </label>
                <p>
                  Connecting sends one test event to confirm the token works. The
                  test event code keeps it in the Test Events view, out of this
                  business&rsquo;s real reporting.
                </p>
                <button className="crm-button-primary" type="submit">
                  Connect
                </button>
              </form>
            )}
            </div>
          </article>
          ) : null}
          {metaAdsVisible ? (
          <article className={`crm-connection-card crm-integration-card meta ${expandedIntegration === "meta-ads" ? "expanded" : ""}`}>
            <header>
              <span className="crm-meta-mark" aria-hidden="true">∞</span>
              <div>
                <h3>Meta Ads</h3>
                <p>Pull campaign spend, clicks, and cost per lead into reporting.</p>
              </div>
              <Badge tone={metaAdsLinked ? "green" : "blue"}>
                {metaAdsLinked ? "Connected" : "Available"}
              </Badge>
            </header>
            <div className="crm-integration-facts">
              <div><Database /><span>Ad account<strong>{metaAdsConnection?.accountLabel ?? "—"}</strong></span></div>
              <div><KeyRound /><span>Access token<strong>{metaAdsLinked ? "Active" : "—"}</strong></span></div>
              <div><Sparkles /><span>Spend this month<strong>{metaAdsConnection?.monthSpend != null ? formatAdSpend(metaAdsConnection.monthSpend, metaAdsConnection.currency) : "—"}</strong></span></div>
            </div>
            <div className="crm-integration-actions">
              <button type="button" className="crm-integration-primary" aria-expanded={expandedIntegration === "meta-ads"} onClick={() => setExpandedIntegration((current) => current === "meta-ads" ? null : "meta-ads")}>{metaAdsLinked ? "Manage" : "Configure"}</button>
              <button type="button" className="crm-integration-learn" onClick={() => setExpandedIntegration((current) => current === "meta-ads" ? null : "meta-ads")}>Learn more <span aria-hidden="true">↗</span></button>
            </div>
            <div className="crm-integration-detail" hidden={expandedIntegration !== "meta-ads"}>
            <div className="crm-connection-grid">
              <div><span>Ad account</span><strong>{metaAdsConnection?.accountLabel ?? "Not connected"}</strong></div>
              <div><span>Last updated</span><strong>{metaAdsConnection?.lastHealthCheckAt ? dateTime(metaAdsConnection.lastHealthCheckAt) : "Not connected"}</strong></div>
            </div>
            {metaAdsLinked ? (
              <>
                <p>
                  Spend refreshes automatically every fifteen minutes. Meta keeps
                  adjusting the last few days after the fact, so recent numbers
                  settle on their own rather than staying frozen at whatever was
                  first reported.
                </p>
                {metaAdsConnection?.lastError ? (
                  <p className="crm-connection-error">{metaAdsConnection.lastError}</p>
                ) : null}
                <div className="crm-connection-actions">
                  <button
                    className="crm-button-secondary"
                    type="button"
                    onClick={() =>
                      mutate({ action: "sync_meta_ads", clientId }, "Ad spend refreshed.")
                    }
                  >
                    Refresh now
                  </button>
                  <button
                    className="crm-button-danger"
                    type="button"
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Disconnect Meta Ads? Spend and cost-per-lead stop updating. Figures already reported stay as they are.",
                        )
                      )
                        return;
                      void mutate(
                        { action: "disconnect_meta_ads", clientId },
                        "Meta Ads disconnected.",
                      );
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <form
                className="crm-connection-connect-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await mutate(
                    {
                      action: "connect_meta_ads",
                      clientId,
                      adAccountId: metaAdsAccountId,
                      accessToken: metaAdsToken,
                    },
                    "Meta Ads connected.",
                  );
                  // Never keep the customer's token in browser state after use.
                  setMetaAdsToken("");
                  setMetaAdsAccounts([]);
                  setMetaAdsAccountId("");
                }}
              >
                <p>
                  Create a System User in your Business Manager, give it{" "}
                  <code>ads_read</code> on this business&rsquo;s ad account, and
                  generate a token. That token never expires and needs no app
                  review. BrizBuilder stores it encrypted.
                </p>
                <label>
                  System User access token
                  <input
                    type="password"
                    value={metaAdsToken}
                    onChange={(event) => setMetaAdsToken(event.target.value)}
                    autoComplete="off"
                    required
                  />
                </label>
                {metaAdsAccounts.length > 0 ? (
                  <label>
                    Ad account
                    <select
                      value={metaAdsAccountId}
                      onChange={(event) => setMetaAdsAccountId(event.target.value)}
                      required
                    >
                      <option value="">Choose an ad account</option>
                      {metaAdsAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                          {account.currency ? ` · ${account.currency}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  // The picker is filled from the token itself, so nobody has to
                  // transcribe an act_ id out of Ads Manager and get it wrong.
                  <button
                    className="crm-button-secondary"
                    type="button"
                    disabled={!metaAdsToken}
                    onClick={async () => {
                      const result = (await mutate(
                        { action: "list_meta_ad_accounts", accessToken: metaAdsToken },
                        "Ad accounts loaded.",
                      )) as {
                        accounts?: Array<{
                          id: string;
                          name: string;
                          currency: string | null;
                        }>;
                      } | null;
                      setMetaAdsAccounts(result?.accounts ?? []);
                    }}
                  >
                    Choose an ad account
                  </button>
                )}
                <p>
                  Connecting checks the token can read the account, then pulls the
                  last three days so the numbers are there straight away.
                </p>
                <button
                  className="crm-button-primary"
                  type="submit"
                  disabled={!metaAdsAccountId}
                >
                  Connect
                </button>
              </form>
            )}
            </div>
          </article>
          ) : null}
          {callRailVisible ? (
          <article className={`crm-connection-card callrail crm-integration-card ${expandedIntegration === "callrail" ? "expanded" : ""}`}>
            <header>
              <span className="crm-callrail-mark" aria-hidden="true">CallRail</span>
              <div>
                <h3>CallRail</h3>
                <p>Track calls and analyze phone conversations.</p>
              </div>
              <Badge
                tone={
                  !callRailStored
                    ? "orange"
                    : callRailConnection?.status === "attention"
                      ? "orange"
                      : callRailSetup === "ready"
                        ? "green"
                        : "purple"
                }
              >
                {!callRailStored
                  ? "Needs setup"
                  : callRailConnection?.status === "attention"
                    ? "Needs attention"
                    : callRailSetup === "ready"
                      ? "Connected"
                      : "Finish setup"}
              </Badge>
              <span className="crm-integration-chevron" aria-hidden="true">›</span>
            </header>
            <div className="crm-integration-facts">
              <div><PhoneCall /><span>Recording sync<strong className={callRailIngesting ? "active" : ""}>{callRailIngesting ? "On" : "—"}</strong></span></div>
              <div><Plug /><span>Webhooks<strong>{callRailIngesting ? "Active" : callRailCleanupPending ? "Cleanup needed" : "—"}</strong></span></div>
              <div><History /><span>Last synced<strong>{integrationSyncLabel(callRailConnection?.lastHealthCheckAt ?? callRailConnection?.connectedAt)}</strong></span></div>
            </div>
            <div className="crm-integration-footer">
              {callRailStatus === "connected" ? (
                <>
                  <button type="button" className="crm-integration-secondary" aria-expanded={expandedIntegration === "callrail"} onClick={() => setExpandedIntegration((current) => current === "callrail" ? null : "callrail")}><Settings />Manage connection</button>
                  <button type="button" className="crm-integration-secondary" onClick={onViewCalls}><PhoneCall />View calls</button>
                  <button type="button" className="crm-integration-more" aria-label="More CallRail actions" onClick={() => setExpandedIntegration((current) => current === "callrail" ? null : "callrail")}>•••</button>
                </>
              ) : (
                <button type="button" className="crm-integration-primary" aria-expanded={expandedIntegration === "callrail"} onClick={() => setExpandedIntegration((current) => current === "callrail" ? null : "callrail")}>{callRailStored ? "Finish setup" : "Connect"}</button>
              )}
            </div>
            <div className="crm-integration-advanced">
            {callRailStored ? (
              <>
                <div className="crm-connection-details compact crm-connection-details-simple">
                  <div>
                    <span>Account</span>
                    <strong>
                      {callRailConnection?.accountLabel ?? "Not chosen yet"}
                    </strong>
                  </div>
                  <div>
                    <span>Company</span>
                    <strong>
                      {callRailConnection?.companyName ?? "Not chosen yet"}
                    </strong>
                  </div>
                  <div>
                    <span>Tracking script</span>
                    <strong>
                      {callRailConnection?.dniActive === true
                        ? "Detected on the site"
                        : callRailConnection?.dniActive === false
                          ? "Not detected"
                          : "Never installed"}
                    </strong>
                  </div>
                  <div>
                    <span>CallScribe</span>
                    <strong>
                      {callRailConnection?.callScribeEnabled === true
                        ? "Enabled on this company"
                        : callRailConnection?.callScribeEnabled === false
                          ? "Off for this company"
                          : "Unknown"}
                    </strong>
                  </div>
                </div>
                <p className="crm-connection-note">
                  CallScribe being enabled means the feature is switched on for
                  this company. It does not confirm that this CallRail
                  subscription returns call transcripts through the API — that
                  is a separate plan entitlement, and an account can show
                  CallScribe on while the API still returns nothing. Confirm it
                  with CallRail before relying on transcripts.
                </p>
                {callRailSetup !== "ready" ? (
                  <div className="crm-connection-connect-form">
                    {callRailSetup === "needs_account" ? (
                      callRail.accounts.length > 0 ? (
                        <label>
                          CallRail account
                          <select
                            defaultValue=""
                            onChange={async (event) => {
                              const accountId = event.target.value;
                              if (!accountId) return;
                              const result = (await mutate(
                                {
                                  action: "select_callrail_account",
                                  clientId,
                                  accountId,
                                },
                                "CallRail account selected.",
                              )) as {
                                companies?: Array<{ id: string; name: string }>;
                              } | null;
                              patchCallRail({ companies: result?.companies ?? [] });
                            }}
                          >
                            <option value="">Choose an account…</option>
                            {callRail.accounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <button
                          className="crm-button-primary"
                          type="button"
                          onClick={async () => {
                            const result = (await mutate(
                              { action: "list_callrail_accounts", clientId },
                              "Accounts loaded.",
                            )) as {
                              accounts?: Array<{ id: string; name: string }>;
                            } | null;
                            patchCallRail({ accounts: result?.accounts ?? [] });
                          }}
                        >
                          Choose an account
                        </button>
                      )
                    ) : callRail.companies.length > 0 ? (
                      <label>
                        CallRail company
                        <select
                          defaultValue=""
                          onChange={async (event) => {
                            const companyId = event.target.value;
                            if (!companyId) return;
                            await mutate(
                              {
                                action: "select_callrail_company",
                                clientId,
                                companyId,
                              },
                              "CallRail company selected.",
                            );
                          }}
                        >
                          <option value="">Choose a company…</option>
                          {callRail.companies.map((company) => (
                            <option key={company.id} value={company.id}>
                              {company.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <button
                        className="crm-button-primary"
                        type="button"
                        onClick={async () => {
                          const result = (await mutate(
                            { action: "list_callrail_companies", clientId },
                            "Companies loaded.",
                          )) as {
                            companies?: Array<{ id: string; name: string }>;
                          } | null;
                          patchCallRail({ companies: result?.companies ?? [] });
                        }}
                      >
                        Choose a company
                      </button>
                    )}
                  </div>
                ) : null}
                {callRail.check ? (
                  <p className="crm-connection-note">{callRail.check}</p>
                ) : null}
                {callRailSetup === "ready" ? (
                  <>
                    <div className="crm-connection-details compact crm-connection-details-simple">
                      <div>
                        <span>Call ingestion</span>
                        <strong>{callRailIngesting ? "On" : "Off"}</strong>
                      </div>
                      <div>
                        <span>Webhooks</span>
                        <strong>
                          {callRailCleanupPending
                            ? "Webhook cleanup needed"
                            : !callRailIngesting
                              ? "Not configured"
                              : callRailIngestEvents.length
                                ? callRailIngestEvents
                                    .map(callRailEventLabel)
                                    .join(", ")
                                : "Configured"}
                        </strong>
                      </div>
                    </div>
                    <p className="crm-connection-note">
                      {callRailCleanupPending
                        ? "Ingestion is off and no calls are being recorded, but BrizBuilder’s webhook URLs are still registered at CallRail because the last cleanup did not complete. Retry the cleanup to withdraw them. Nothing needs re-enabling, and the CallRail connection does not need disconnecting."
                        : callRailIngesting
                          ? "Completed calls for this business become contacts and leads in the CRM. Turning ingestion off stops new calls immediately and withdraws only BrizBuilder’s own webhook URLs from CallRail: the API connection stays, and every other tool’s URLs are left exactly as they are."
                          : "No calls are being recorded. Enabling adds BrizBuilder’s webhook URLs to this company’s CallRail Webhooks integration, alongside any URLs already there, and starts creating contacts and leads from completed calls."}
                    </p>
                    {callRail.ingestionError ? (
                      <p className="crm-inline-error" role="alert">
                        {callRail.ingestionError}
                      </p>
                    ) : null}
                    {callRail.ingestionNote ? (
                      <p className="crm-connection-note" role="status">
                        {callRail.ingestionNote}
                      </p>
                    ) : null}
                    <div className="crm-connection-actions">
                      {callRailIngesting ? (
                        <button
                          className="danger"
                          type="button"
                          disabled={Boolean(callRail.ingestionPending)}
                          onClick={() => {
                            if (
                              !window.confirm(
                                "Turn off call ingestion?\n\nBrizBuilder stops recording this business’s calls, then removes only its own webhook URLs from CallRail. The CallRail connection stays, and any other tool’s webhook URLs are left alone.\n\nA call already being processed may still finish and create a contact or lead. Ingestion is rechecked immediately before anything is written to the CRM, which narrows that window but does not cancel work that is already past the check.",
                              )
                            )
                              return;
                            void runCallRailDisable("disable");
                          }}
                        >
                          {callRail.ingestionPending === "disable"
                            ? "Turning off…"
                            : "Disable ingestion"}
                        </button>
                      ) : callRailCleanupPending ? (
                        <button
                          className="danger"
                          type="button"
                          disabled={Boolean(callRail.ingestionPending)}
                          onClick={() => {
                            if (
                              !window.confirm(
                                "Retry the webhook cleanup?\n\nBrizBuilder asks CallRail again to remove only its own webhook URLs. Ingestion stays off either way, the CallRail connection is untouched, and any other tool’s webhook URLs are left alone.",
                              )
                            )
                              return;
                            void runCallRailDisable("retry");
                          }}
                        >
                          {callRail.ingestionPending === "retry"
                            ? "Retrying…"
                            : "Retry cleanup"}
                        </button>
                      ) : (
                        <button
                          className="crm-button-primary"
                          type="button"
                          disabled={Boolean(callRail.ingestionPending)}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                "Enable call ingestion?\n\nBrizBuilder will add its webhook URLs to this company’s CallRail integration, keeping any URLs already there, and will start creating contacts and leads from completed calls.",
                              )
                            )
                              return;
                            patchCallRail({
                              ingestionPending: "enable",
                              ingestionError: "",
                            });
                            try {
                              await mutate(
                                {
                                  action: "enable_callrail_ingestion",
                                  clientId,
                                },
                                "Call ingestion is on.",
                              );
                              patchCallRail({
                                ingestionPending: "",
                                ingestionError: "",
                              });
                            } catch (error) {
                              patchCallRail({
                                ingestionPending: "",
                                ingestionError:
                                  error instanceof Error
                                    ? error.message
                                    : "Call ingestion could not be enabled.",
                              });
                            }
                          }}
                        >
                          {callRail.ingestionPending === "enable"
                            ? "Enabling…"
                            : "Enable ingestion"}
                        </button>
                      )}
                      {callRailIngesting ? (
                        <button
                          type="button"
                          disabled={Boolean(callRail.ingestionPending)}
                          onClick={() => {
                            if (
                              !window.confirm(
                                "Check CallRail for missed calls?\n\nBrizBuilder reads this business’s last 7 days of calls and creates contacts and leads for any that were never recorded. Calls already recorded are left as they are.",
                              )
                            )
                              return;
                            void runCallRailRecovery(7);
                          }}
                        >
                          {callRail.ingestionPending === "recover"
                            ? "Checking…"
                            : "Recover missed calls"}
                        </button>
                      ) : null}
                      {callRailIngesting ? (
                        <button
                          type="button"
                          disabled={Boolean(callRail.ingestionPending)}
                          onClick={() => {
                            if (
                              !window.confirm(
                                "Check CallRail for recordings?\n\nBrizBuilder asks again whether each of this business’s tracked calls has audio, and updates only that. Contacts, leads and attribution are not touched.",
                              )
                            )
                              return;
                            void runCallRailMediaRefresh();
                          }}
                        >
                          {callRail.ingestionPending === "media"
                            ? "Checking…"
                            : "Refresh recordings"}
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
                <div className="crm-connection-actions">
                  <button
                    type="button"
                    onClick={async () => {
                      const result = (await mutate(
                        { action: "check_callrail_connection", clientId },
                        "CallRail connection checked.",
                      )) as { ok?: boolean; message?: string | null } | null;
                      patchCallRail({
                        check: result?.ok
                          ? "CallRail answered and the selected company is reachable."
                          : (result?.message ??
                            "CallRail did not confirm the connection."),
                      });
                    }}
                  >
                    Check connection
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() =>
                      window.confirm(
                        "Disconnect CallRail? The stored API key is deleted. Call tracking in CallRail keeps running; BrizBuilder simply stops reading it.",
                      ) &&
                      mutate(
                        { action: "disconnect_callrail", clientId },
                        "CallRail disconnected.",
                      ).then(() =>
                        patchCallRail({
                          accounts: [],
                          companies: [],
                          check: "",
                        }),
                      )
                    }
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <form
                className="crm-connection-connect-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const result = (await mutate(
                    {
                      action: "connect_callrail",
                      clientId,
                      apiKey: callRail.apiKey,
                    },
                    "CallRail connected.",
                  )) as {
                    accounts?: Array<{ id: string; name: string }>;
                    companies?: Array<{ id: string; name: string }>;
                  } | null;
                  // Never keep the customer's key in browser state after use.
                  patchCallRail({
                    accounts: result?.accounts ?? [],
                    companies: result?.companies ?? [],
                    apiKey: "",
                  });
                }}
              >
                <p>
                  This business creates the key in their own CallRail account,
                  under a user that can see the company you want to track.
                  BrizBuilder stores it encrypted and never shows it again.
                </p>
                <label>
                  CallRail API key
                  <input
                    type="password"
                    value={callRail.apiKey}
                    onChange={(event) => patchCallRail({ apiKey: event.target.value })}
                    autoComplete="off"
                    required
                  />
                </label>
                <p>
                  No account ID is needed. BrizBuilder asks CallRail which
                  accounts this key can reach and lets you pick from those, so a
                  mistyped ID cannot point the connection at the wrong place.
                </p>
                <button className="crm-button-primary" type="submit">
                  Connect
                </button>
              </form>
            )}
            </div>
          </article>
          ) : null}
          {visibleIntegrationCount === 0 ? (
            <section className="crm-integrations-no-results">
              <Search aria-hidden="true" />
              <h3>No integrations found</h3>
              <p>Try another search or clear the current filter.</p>
              <button type="button" onClick={showAllIntegrations}>Clear filters</button>
            </section>
          ) : null}
          </div>
          <section className="crm-integrations-banner">
            <span><Sparkles aria-hidden="true" /></span>
            <div>
              <h3>Don&rsquo;t see the integration you need?</h3>
              <p>Browse our full library of integrations or request a custom integration.</p>
            </div>
            <button type="button" onClick={showAllIntegrations}>
              Browse all integrations <b aria-hidden="true">›</b>
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

const nodeLibrary: Array<{
  type: CrmWorkflowNode["type"];
  label: string;
  description: string;
  color: string;
}> = [
  {
    type: "send_sms",
    label: "Send SMS",
    description: "Send a compliant text",
    color: "violet",
  },
  {
    type: "create_task",
    label: "Create task",
    description: "Assign team follow-up",
    color: "blue",
  },
  {
    type: "add_tag",
    label: "Add contact tag",
    description: "Organize the contact",
    color: "green",
  },
  {
    type: "update_stage",
    label: "Update lead stage",
    description: "Move an opportunity",
    color: "orange",
  },
  {
    type: "condition",
    label: "If / else",
    description: "Choose a path",
    color: "gray",
  },
];

function defaultConfig(
  type: CrmWorkflowNode["type"],
): CrmWorkflowNode["config"] {
  if (type === "send_sms")
    return {
      message:
        "Hi {{contact_first_name}}, how can we help? Reply STOP to unsubscribe.",
    };
  if (type === "create_task")
    return {
      title: "Follow up with {{contact_first_name}}",
      priority: "MEDIUM",
    };
  if (type === "add_tag") return { tag: "automation" };
  if (type === "update_stage") return { stageId: "" };
  if (type === "condition")
    return { field: "serviceRequested", operator: "contains", value: "" };
  return { eventKey: "lead.created" };
}

function lineStyle(source: CrmWorkflowNode, target: CrmWorkflowNode) {
  const x1 = source.x + 190,
    y1 = source.y + 42,
    x2 = target.x,
    y2 = target.y + 42;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return { left: x1, top: y1, width: length, transform: `rotate(${angle}deg)` };
}

function WorkflowEditor({
  workflow,
  clients,
  stages,
  runs,
  mutate,
  onBack,
}: {
  workflow: CrmWorkflow;
  clients: CrmClient[];
  stages: CrmStage[];
  runs: CrmWorkflowRun[];
  mutate: Mutate;
  onBack: () => void;
}) {
  const [graph, setGraph] = useState(workflow.graph);
  const [selectedId, setSelectedId] = useState(
    workflow.graph.nodes[0]?.id ?? "",
  );
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [drag, setDrag] = useState<{
    id: string;
    dx: number;
    dy: number;
  } | null>(null);
  const selected = graph.nodes.find((node) => node.id === selectedId);
  const client = clients.find((item) => item.id === workflow.clientId);
  function addNode(item: (typeof nodeLibrary)[number]) {
    const id = `${item.type}-${crypto.randomUUID().slice(0, 8)}`;
    const source = selected ?? graph.nodes.at(-1);
    const node: CrmWorkflowNode = {
      id,
      type: item.type,
      label: item.label,
      x: source ? Math.min(source.x + 280, 920) : 360,
      y:
        source && source.x > 800 ? source.y + 150 : (source?.y ?? 180),
      config: defaultConfig(item.type),
    };
    const edge: CrmWorkflowEdge | null = source
      ? {
          id: `edge-${crypto.randomUUID().slice(0, 8)}`,
          source: source.id,
          target: id,
          branch: source.type === "condition" ? "yes" : "always",
        }
      : null;
    setGraph({
      nodes: [...graph.nodes, node],
      edges: edge ? [...graph.edges, edge] : graph.edges,
    });
    setSelectedId(id);
  }
  function updateSelected(
    patch: Partial<CrmWorkflowNode>,
    config?: Record<string, string | number | boolean>,
  ) {
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === selectedId
          ? {
              ...node,
              ...patch,
              config: config ? { ...node.config, ...config } : node.config,
            }
          : node,
      ),
    }));
  }
  function removeSelected() {
    if (!selected || selected.type === "trigger") return;
    setGraph((current) => ({
      nodes: current.nodes.filter((node) => node.id !== selected.id),
      edges: current.edges.filter(
        (edge) => edge.source !== selected.id && edge.target !== selected.id,
      ),
    }));
    setSelectedId(graph.nodes[0]?.id ?? "");
  }
  function updateEdge(edgeId: string, patch: Partial<CrmWorkflowEdge>) {
    setGraph((current) => ({
      ...current,
      edges: current.edges.map((edge) =>
        edge.id === edgeId ? { ...edge, ...patch } : edge,
      ),
    }));
  }
  function removeEdge(edgeId: string) {
    setGraph((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.id !== edgeId),
    }));
  }
  function addConnection() {
    if (!selected) return;
    const existingTargets = new Set(
      graph.edges
        .filter((edge) => edge.source === selected.id)
        .map((edge) => edge.target),
    );
    const target = graph.nodes.find(
      (node) => node.id !== selected.id && !existingTargets.has(node.id),
    );
    if (!target) return;
    setGraph((current) => ({
      ...current,
      edges: [
        ...current.edges,
        {
          id: `edge-${crypto.randomUUID().slice(0, 8)}`,
          source: selected.id,
          target: target.id,
          branch: selected.type === "condition" ? "no" : "always",
        },
      ],
    }));
  }
  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === drag.id
          ? {
              ...node,
              x: Math.max(
                20,
                Math.min(1000, event.clientX - rect.left - drag.dx),
              ),
              y: Math.max(
                20,
                Math.min(620, event.clientY - rect.top - drag.dy),
              ),
            }
          : node,
      ),
    }));
  }
  async function save() {
    await mutate(
      {
        action: "save_workflow",
        workflowId: workflow.id,
        name,
        description,
        graph,
      },
      "Workflow draft saved.",
    );
  }
  async function test() {
    await save();
    await mutate(
      { action: "test_workflow", workflowId: workflow.id },
      "Safe test completed. No outside actions were sent.",
    );
  }
  async function publish() {
    await save();
    await mutate(
      { action: "publish_workflow", workflowId: workflow.id },
      "Workflow published.",
    );
  }
  return (
    <div className="crm-workflow-builder">
      <header className="crm-builder-header">
        <button onClick={onBack}>← Workflows</button>
        <div>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Workflow name"
          />
          <span>
            {client?.businessName} · Version {workflow.currentVersion}
          </span>
        </div>
        <div>
          <Badge tone={workflow.status === "active" ? "green" : "orange"}>
            {workflow.status.replaceAll("_", " ")}
          </Badge>
          <button onClick={test}>
            Test
          </button>
          <button onClick={save}>Save draft</button>
          {workflow.status === "active" ? (
            <button
              onClick={() =>
                mutate(
                  { action: "pause_workflow", workflowId: workflow.id },
                  "Workflow paused.",
                )
              }
            >
              Pause
            </button>
          ) : (
            <button className="crm-button-primary" onClick={publish}>
              Publish
            </button>
          )}
        </div>
      </header>
      <div className="crm-builder-body">
        <aside className="crm-node-library">
          <p>STEPS</p>
          {nodeLibrary.map((item) => (
            <button key={item.type} onClick={() => addNode(item)}>
              <i className={item.color}>{item.label.slice(0, 2)}</i>
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <b>+</b>
            </button>
          ))}
          <div className="crm-builder-help">
            <strong>How it works</strong>
            <p>
              Add steps, drag them into place, select each one to configure it,
              then test before publishing.
            </p>
          </div>
        </aside>
        <div
          className="crm-workflow-canvas"
          onPointerMove={pointerMove}
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
        >
          {graph.edges.map((edge) => {
            const source = graph.nodes.find((node) => node.id === edge.source);
            const target = graph.nodes.find((node) => node.id === edge.target);
            return source && target ? (
              <i
                className="crm-visual-edge"
                key={edge.id}
                style={lineStyle(source, target)}
              >
                <b>
                  {edge.branch && edge.branch !== "always" ? edge.branch : ""}
                </b>
              </i>
            ) : null;
          })}
          {graph.nodes.map((node) => (
            <button
              key={node.id}
              style={{ left: node.x, top: node.y }}
              className={`crm-visual-node ${node.type} ${selectedId === node.id ? "selected" : ""}`}
              onClick={() => setSelectedId(node.id)}
              onPointerDown={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrag({
                  id: node.id,
                  dx: event.clientX - rect.left,
                  dy: event.clientY - rect.top,
                });
                setSelectedId(node.id);
              }}
            >
              <span>
                {node.type === "trigger"
                  ? "TR"
                  : node.label.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <small>{node.type.replaceAll("_", " ")}</small>
                <strong>{node.label}</strong>
              </div>
              <em>⋮⋮</em>
            </button>
          ))}
        </div>
        <aside className="crm-node-settings">
          {selected ? (
            <>
              <p>STEP SETTINGS</p>
              <input
                className="crm-node-title-input"
                value={selected.label}
                onChange={(event) =>
                  updateSelected({ label: event.target.value })
                }
              />
              {selected.type === "trigger" ? (
                <label>
                  <span>Starts when</span>
                  <select
                    value={String(selected.config.eventKey ?? "lead.created")}
                    onChange={(event) =>
                      updateSelected({}, { eventKey: event.target.value })
                    }
                  >
                    <option value="lead.created">New lead is created</option>
                    <option value="sms.received">Customer sends a text</option>
                    <option value="call.missed">Call is missed</option>
                  </select>
                </label>
              ) : null}
              {selected.type === "send_sms" ? (
                <label>
                  <span>Message</span>
                  <textarea
                    rows={6}
                    value={String(selected.config.message ?? "")}
                    onChange={(event) =>
                      updateSelected({}, { message: event.target.value })
                    }
                  />
                  <small>
                    Available: {"{{contact_first_name}}"}, {"{{business_name}}"}
                  </small>
                </label>
              ) : null}
              {selected.type === "create_task" ? (
                <>
                  <label>
                    <span>Task title</span>
                    <input
                      value={String(selected.config.title ?? "")}
                      onChange={(event) =>
                        updateSelected({}, { title: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Priority</span>
                    <select
                      value={String(selected.config.priority ?? "MEDIUM")}
                      onChange={(event) =>
                        updateSelected({}, { priority: event.target.value })
                      }
                    >
                      <option>LOW</option>
                      <option>MEDIUM</option>
                      <option>HIGH</option>
                      <option>URGENT</option>
                    </select>
                  </label>
                </>
              ) : null}
              {selected.type === "add_tag" ? (
                <label>
                  <span>Tag</span>
                  <input
                    value={String(selected.config.tag ?? "")}
                    onChange={(event) =>
                      updateSelected({}, { tag: event.target.value })
                    }
                  />
                </label>
              ) : null}
              {selected.type === "update_stage" ? (
                <label>
                  <span>Pipeline stage</span>
                  <select
                    value={String(selected.config.stageId ?? "")}
                    onChange={(event) =>
                      updateSelected({}, { stageId: event.target.value })
                    }
                  >
                    <option value="">Choose stage</option>
                    {stages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {selected.type === "condition" ? (
                <>
                  <label>
                    <span>Event field</span>
                    <select
                      value={String(
                        selected.config.field ?? "serviceRequested",
                      )}
                      onChange={(event) =>
                        updateSelected({}, { field: event.target.value })
                      }
                    >
                      <option value="serviceRequested">
                        Service requested
                      </option>
                      <option value="messageBody">Incoming message</option>
                      <option value="callStatus">Call status</option>
                    </select>
                  </label>
                  <label>
                    <span>Comparison</span>
                    <select
                      value={String(selected.config.operator ?? "contains")}
                      onChange={(event) =>
                        updateSelected({}, { operator: event.target.value })
                      }
                    >
                      <option value="contains">Contains</option>
                      <option value="equals">Equals</option>
                      <option value="not_equals">Does not equal</option>
                    </select>
                  </label>
                  <label>
                    <span>Value</span>
                    <input
                      value={String(selected.config.value ?? "")}
                      onChange={(event) =>
                        updateSelected({}, { value: event.target.value })
                      }
                    />
                  </label>
                </>
              ) : null}
              <div className="crm-edge-settings">
                <div>
                  <span>Next steps</span>
                  <button type="button" onClick={addConnection}>
                    + Connect
                  </button>
                </div>
                {graph.edges
                  .filter((edge) => edge.source === selected.id)
                  .map((edge) => (
                    <div className="crm-edge-setting" key={edge.id}>
                      {selected.type === "condition" ? (
                        <select
                          aria-label="Connection branch"
                          value={edge.branch ?? "yes"}
                          onChange={(event) =>
                            updateEdge(edge.id, {
                              branch: event.target.value as "yes" | "no",
                            })
                          }
                        >
                          <option value="yes">If yes</option>
                          <option value="no">If no</option>
                        </select>
                      ) : (
                        <span>Then</span>
                      )}
                      <select
                        aria-label="Connected step"
                        value={edge.target}
                        onChange={(event) =>
                          updateEdge(edge.id, { target: event.target.value })
                        }
                      >
                        {graph.nodes
                          .filter((node) => node.id !== selected.id)
                          .map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.label}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        aria-label="Remove connection"
                        onClick={() => removeEdge(edge.id)}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
              </div>
              {selected.type !== "trigger" ? (
                <button className="crm-remove-node" onClick={removeSelected}>
                  Remove step
                </button>
              ) : null}
            </>
          ) : (
            <p>Select a step to edit it.</p>
          )}
          <label className="crm-workflow-description">
            <span>Workflow description</span>
            <textarea
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </aside>
      </div>
      <section className="crm-builder-runs">
        <header>
          <div>
            <h3>Recent runs</h3>
            <p>Every execution and safe test is recorded.</p>
          </div>
        </header>
        {runs
          .filter((run) => run.workflowId === workflow.id)
          .slice(0, 10)
          .map((run) => (
            <article key={run.id}>
              <i className={run.status} />
              <span>
                <strong>
                  {run.isTest
                    ? "Safe test"
                    : run.triggerKey.replaceAll(".", " ")}
                </strong>
                <small>{new Date(run.startedAt).toLocaleString()}</small>
              </span>
              <Badge
                tone={
                  run.status.includes("completed")
                    ? "green"
                    : run.status === "failed"
                      ? "red"
                      : "orange"
                }
              >
                {run.status.replaceAll("_", " ")}
              </Badge>
              {run.error ? <em>{run.error}</em> : null}
            </article>
          ))}
        {!runs.some((run) => run.workflowId === workflow.id) ? (
          <p>
            No runs yet. Use Test to validate every step without sending
            messages or changing customer records.
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function VisualAutomationsView({
  clients,
  connections,
  workflows,
  runs,
  stages,
  selectedClientId,
  mutate,
  onOpenConnections,
}: {
  clients: CrmClient[];
  connections: CrmProviderConnection[];
  workflows: CrmWorkflow[];
  runs: CrmWorkflowRun[];
  stages: CrmStage[];
  selectedClientId: string;
  mutate: Mutate;
  onOpenConnections: (clientId: string) => void;
}) {
  const [localClient, setLocalClient] = useState(clients[0]?.id ?? "");
  const clientId = clientChoice(clients, selectedClientId, localClient);
  const client = clients.find((item) => item.id === clientId);
  const twilioConnection = connections.find(
    (item) => item.clientId === clientId && item.provider === "twilio",
  );
  const hasActiveTwilio = Boolean(
    twilioConnection?.isLinked && twilioConnection.isActive,
  );
  const visible = workflows.filter((item) => item.clientId === clientId);
  const [editingId, setEditingId] = useState("");
  const editing = visible.find((item) => item.id === editingId);
  const stats = useMemo(
    () => ({
      active: visible.filter((item) => item.status === "active").length,
      runs: runs.filter((item) => item.clientId === clientId).length,
      failed: runs.filter(
        (item) => item.clientId === clientId && item.status === "failed",
      ).length,
    }),
    [visible, runs, clientId],
  );
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = (await mutate(
      {
        action: "create_workflow",
        clientId,
        name: form.get("name"),
        triggerKey: form.get("triggerKey"),
      },
      "Workflow created.",
    )) as { id?: string };
    if (result?.id) setEditingId(result.id);
  }
  return (
    <div className="crm-view crm-workflows-home">
      <section className="crm-page-heading">
        <div>
          <p>VISUAL AUTOMATION</p>
          <h2>Workflows</h2>
          <span>
            Build advanced follow-up systems visually, then test and publish
            them safely.
          </span>
        </div>
        {selectedClientId === "all" ? (
          <label className="crm-phone-client-picker">
            <span>Business</span>
            <select
              value={clientId}
              onChange={(event) => setLocalClient(event.target.value)}
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
        <section className="crm-empty-state">
          <h3>Add a client first</h3>
          <p>Automations belong to one business and cannot be shared.</p>
        </section>
      ) : !hasActiveTwilio ? (
        <section className="crm-empty-state crm-communication-gate">
          <Badge tone="orange">Twilio required</Badge>
          <h3>Connect Twilio to use automations</h3>
          <p>
            {client.businessName} needs an active Twilio connection before you
            can create or edit automated follow-up. Manage the connection from
            the Connections page.
          </p>
          <button
            className="crm-button-primary"
            type="button"
            onClick={() => onOpenConnections(clientId)}
          >
            Go to Connections
          </button>
        </section>
      ) : editing ? (
        <WorkflowEditor
          key={`${editing.id}-${editing.currentVersion}`}
          workflow={editing}
          clients={clients}
          stages={stages}
          runs={runs}
          mutate={mutate}
          onBack={() => setEditingId("")}
        />
      ) : (
        <>
          <div className="crm-workflow-home-grid">
            <section className="crm-workflow-list">
              <header>
                <div>
                  <h3>Workflows</h3>
                  <p>{visible.length} total · {stats.active} active</p>
                </div>
              </header>
              {visible.map((workflow) => (
                <button
                  key={workflow.id}
                  onClick={() => setEditingId(workflow.id)}
                >
                  <span className="crm-workflow-list-icon">WF</span>
                  <div>
                    <strong>{workflow.name}</strong>
                    <p>
                      {workflow.description ||
                        `${workflow.graph.nodes.length} steps · ${workflow.triggerKey.replaceAll(".", " ")}`}
                    </p>
                    <small>
                      Version {workflow.currentVersion} · Updated{" "}
                      {new Date(workflow.updatedAt).toLocaleDateString()}
                    </small>
                  </div>
                  <Badge
                    tone={workflow.status === "active" ? "green" : "orange"}
                  >
                    {workflow.status.replaceAll("_", " ")}
                  </Badge>
                  <b>→</b>
                </button>
              ))}
              {!visible.length ? (
                <div className="crm-empty-state">
                  <h3>No workflows yet</h3>
                  <p>Create the first visual automation for this client.</p>
                </div>
              ) : null}
            </section>
            <form className="crm-new-workflow" onSubmit={create}>
              <p>NEW WORKFLOW</p>
              <h3>Start with a trigger</h3>
              <label>
                <span>Name</span>
                <input name="name" required placeholder="New lead follow-up" />
              </label>
              <label>
                <span>Starts when</span>
                <select name="triggerKey">
                  <option value="lead.created">New lead is created</option>
                  <option value="sms.received">Customer sends a text</option>
                  <option value="call.missed">Call is missed</option>
                </select>
              </label>
              <button className="crm-button-primary" disabled={!clientId}>
                Create workflow
              </button>
              <small>
                A safe task step is added automatically. Nothing runs until you
                publish.
              </small>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
