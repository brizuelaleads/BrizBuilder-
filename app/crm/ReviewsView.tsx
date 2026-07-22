"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { QRCodeCanvas } from "qrcode.react";
import type {
  CrmClient,
  CrmContact,
  CrmGoogleProfile,
  CrmPhoneConfig,
  CrmProviderConnection,
  CrmReviewRequest,
  CrmReviewSettings,
} from "../../db/crm";
import type {
  GoogleBusinessReview,
  GoogleBusinessReviewsPage,
} from "../../lib/google-business";
import { Badge, EmptyState } from "./ui";

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;

type ReviewTab = "overview" | "inbox" | "requests" | "settings";
type ReviewLoadStatus = "idle" | "loading" | "ready" | "error";

type ReviewsApiResponse = {
  data?: GoogleBusinessReviewsPage;
  error?: string;
};

const tabs: Array<{ id: ReviewTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "inbox", label: "Review Inbox" },
  { id: "requests", label: "Review Requests" },
  { id: "settings", label: "Settings" },
];

const DEFAULT_REQUEST_TEMPLATE =
  "Hi {{first_name}}, thank you for choosing {{business_name}}. Would you share your experience? {{review_link}} Reply STOP to opt out.";

const DEFAULT_FOLLOW_UP_TEMPLATE =
  "Hi {{first_name}}, here is the review link again if you would still like to share your experience: {{review_link}} Reply STOP to opt out.";

function clientChoice(
  clients: CrmClient[],
  selectedClientId: string,
  localClientId: string,
) {
  return selectedClientId !== "all"
    ? selectedClientId
    : clients.some((client) => client.id === localClientId)
      ? localClientId
      : clients[0]?.id || "";
}

function readableDate(value: string | null) {
  if (!value) return "Not sent";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function readableReviewDate(value: string | null) {
  if (!value) return "Date not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

function reviewExcerpt(review: GoogleBusinessReview) {
  return review.comment?.trim() || "This reviewer left a star rating without a written comment.";
}

async function requestGoogleReviews(
  clientId: string,
  pageToken?: string | null,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ clientId });
  if (pageToken) params.set("pageToken", pageToken);
  const response = await fetch(`/api/reviews?${params.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as ReviewsApiResponse;
  if (!response.ok || !payload.data) {
    throw new Error(payload.error || "Google reviews could not be loaded.");
  }
  return payload.data;
}

function requestStatusTone(status: CrmReviewRequest["status"]) {
  if (status === "delivered") return "green" as const;
  if (status === "failed" || status === "cancelled") return "red" as const;
  if (status === "sent") return "blue" as const;
  return "orange" as const;
}

function renderRequestMessage(
  template: string,
  contact: CrmContact | null,
  client: CrmClient,
  reviewUrl: string,
) {
  return template
    .replaceAll("{{first_name}}", contact?.firstName || "there")
    .replaceAll("{{business_name}}", client.businessName)
    .replaceAll("{{review_link}}", reviewUrl || "[Google review link]");
}

function safeFilename(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "business"
  );
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("The review link could not be copied.");
}

export function ReviewsView({
  clients,
  contacts,
  phoneConfigs,
  googleProfiles,
  reviewRequests,
  reviewSettings,
  connections,
  selectedClientId,
  mutate,
  canReply,
  canRequest,
  canManage,
  canManageGoogle,
  canManageConnections,
  onOpenGoogleProfiles,
  onOpenConnections,
}: {
  clients: CrmClient[];
  contacts: CrmContact[];
  phoneConfigs: CrmPhoneConfig[];
  googleProfiles: CrmGoogleProfile[];
  reviewRequests: CrmReviewRequest[];
  reviewSettings: CrmReviewSettings[];
  connections: CrmProviderConnection[];
  selectedClientId: string;
  mutate: Mutate;
  canReply: boolean;
  canRequest: boolean;
  canManage: boolean;
  canManageGoogle: boolean;
  canManageConnections: boolean;
  onOpenGoogleProfiles: (clientId: string) => void;
  onOpenConnections: (clientId: string) => void;
}) {
  const [tab, setTab] = useState<ReviewTab>("overview");
  const [localClientId, setLocalClientId] = useState(clients[0]?.id ?? "");
  const clientId = clientChoice(clients, selectedClientId, localClientId);
  const client = clients.find((item) => item.id === clientId) ?? null;
  const profile =
    googleProfiles.find((item) => item.clientId === clientId) ?? null;
  const settings =
    reviewSettings.find((item) => item.clientId === clientId) ?? null;
  const twilioConnection = connections.find(
    (item) => item.clientId === clientId && item.provider === "twilio",
  );
  const twilioActive = Boolean(
    twilioConnection?.isLinked && twilioConnection.isActive,
  );
  const phoneConfig =
    phoneConfigs.find((item) => item.clientId === clientId) ?? null;
  const phoneConfigured =
    String(phoneConfig?.providerStatus ?? "").toLowerCase() === "connected";
  const a2pApproved =
    String(phoneConfig?.a2pStatus ?? "").toLowerCase() === "approved";
  const smsReady = twilioActive && phoneConfigured && a2pApproved;
  const smsReadinessMessage = !twilioActive
    ? "Connect and activate this business's Twilio account."
    : !phoneConfigured
      ? "Finish this business's phone and messaging setup."
      : !a2pApproved
        ? "Business texting is connected, but carrier approval is still pending."
        : "Business texting and carrier approval are ready.";
  const googleConnected = Boolean(
    profile?.status === "connected" && profile.locationId,
  );
  const reviewUrl = profile?.googleReviewUrl?.trim() ?? "";
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const reviewRequestKey = googleConnected
    ? `${clientId}:${reviewRefreshKey}`
    : "";
  const [googleReviewLoad, setGoogleReviewLoad] = useState<{
    key: string;
    status: ReviewLoadStatus;
    data: GoogleBusinessReviewsPage | null;
    error: string;
  }>({ key: "", status: "idle", data: null, error: "" });
  const googleReviews =
    googleReviewLoad.key === reviewRequestKey ? googleReviewLoad.data : null;
  const reviewLoadStatus: ReviewLoadStatus = !reviewRequestKey
    ? "idle"
    : googleReviewLoad.key === reviewRequestKey
      ? googleReviewLoad.status
      : "loading";
  const reviewLoadError =
    googleReviewLoad.key === reviewRequestKey ? googleReviewLoad.error : "";
  const googleApprovalPending = reviewLoadError.includes(
    "API access is not active",
  );
  const clientContacts = useMemo(
    () =>
      contacts.filter(
        (contact) =>
          contact.clientId === clientId &&
          Boolean(contact.phone) &&
          contact.marketingConsent !== "opt_out",
      ),
    [clientId, contacts],
  );
  const clientRequests = useMemo(
    () =>
      reviewRequests
        .filter((request) => request.clientId === clientId)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
    [clientId, reviewRequests],
  );

  useEffect(() => {
    if (!clientId || !googleConnected || !reviewRequestKey) return;

    const controller = new AbortController();
    void requestGoogleReviews(clientId, null, controller.signal)
      .then((data) => {
        setGoogleReviewLoad({
          key: reviewRequestKey,
          status: "ready",
          data,
          error: "",
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setGoogleReviewLoad({
          key: reviewRequestKey,
          status: "error",
          data: null,
          error:
            error instanceof Error
              ? error.message
              : "Google reviews could not be loaded.",
        });
      });
    return () => controller.abort();
  }, [clientId, googleConnected, reviewRequestKey]);

  function refreshGoogleReviews() {
    setReviewRefreshKey((value) => value + 1);
  }

  async function loadMoreGoogleReviews() {
    if (
      !clientId ||
      !googleReviews?.nextPageToken ||
      loadingMoreReviews
    ) {
      return;
    }
    setLoadingMoreReviews(true);
    try {
      const next = await requestGoogleReviews(
        clientId,
        googleReviews.nextPageToken,
      );
      setGoogleReviewLoad((current) => {
        if (current.key !== reviewRequestKey || !current.data) return current;
        const existing = new Set(
          current.data.reviews.map((review) => review.reviewId),
        );
        return {
          key: current.key,
          status: "ready",
          error: "",
          data: {
            ...next,
            averageRating: next.averageRating ?? current.data.averageRating,
            totalReviewCount: Math.max(
              next.totalReviewCount,
              current.data.totalReviewCount,
            ),
            reviews: [
              ...current.data.reviews,
              ...next.reviews.filter(
                (review) => !existing.has(review.reviewId),
              ),
            ],
          },
        };
      });
    } catch (error) {
      setGoogleReviewLoad((current) =>
        current.key === reviewRequestKey
          ? {
              ...current,
              error:
                error instanceof Error
                  ? error.message
                  : "More Google reviews could not be loaded.",
            }
          : current,
      );
    } finally {
      setLoadingMoreReviews(false);
    }
  }

  function chooseTab(next: ReviewTab) {
    setTab(next);
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
      return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    const nextTab = tabs[nextIndex];
    setTab(nextTab.id);
    window.requestAnimationFrame(() => {
      document.getElementById(`crm-review-tab-${nextTab.id}`)?.focus();
    });
  }

  return (
    <div className="crm-view crm-reviews-view">
      <section className="crm-page-heading crm-reviews-heading">
        <div>
          <p>REPUTATION</p>
          <h2>Reviews</h2>
          <span>
            Request genuine customer feedback and manage every Google review
            with the business owner in control.
          </span>
        </div>
        {client && canRequest ? (
          <button
            className="crm-button-primary"
            type="button"
            onClick={() => chooseTab("requests")}
          >
            Request a review
          </button>
        ) : null}
      </section>

      {selectedClientId === "all" && clients.length ? (
        <section className="crm-review-client-picker">
          <label>
            <span>Business</span>
            <select
              value={clientId}
              onChange={(event) => setLocalClientId(event.target.value)}
              aria-label="Choose a business for the reviews workspace"
            >
              {clients.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.businessName}
                </option>
              ))}
            </select>
          </label>
          <span>
            Review data and messages stay inside the selected client workspace.
          </span>
        </section>
      ) : null}

      {!client ? (
        <EmptyState
          title="Add a client first"
          description="Reviews, review links, and requests must belong to a specific business workspace."
        />
      ) : (
        <>
          <section
            className={`crm-review-access-banner ${reviewLoadStatus === "ready" ? "connected" : reviewLoadStatus === "error" ? "error" : "pending"}`}
            aria-live="polite"
          >
            <span className="crm-review-google-mark" aria-hidden="true">
              G
            </span>
            <div>
              <strong>
                {reviewLoadStatus === "ready"
                  ? "Live Google reviews connected"
                  : googleConnected
                    ? profile?.locationName ||
                      profile?.businessName ||
                      "Google location connected"
                    : "Connect a Google Business Profile"}
              </strong>
              <p>
                {reviewLoadStatus === "ready"
                  ? "Real reviews are loaded directly from Google for this session. BrizBuilder does not keep a permanent copy."
                  : googleConnected
                    ? reviewLoadStatus === "loading"
                      ? "Checking Google for this business's latest reviews."
                      : reviewLoadError ||
                        "The location is ready. Live reviews will activate when Google grants BrizBuilder API access."
                    : "You can prepare the official review link, QR code, and request settings now. The inbox needs a connected Google location."}
              </p>
            </div>
            <Badge tone={reviewLoadStatus === "ready" ? "green" : "orange"}>
              {reviewLoadStatus === "ready"
                ? "Live"
                  : reviewLoadStatus === "loading"
                  ? "Checking"
                  : reviewLoadStatus === "error"
                    ? googleApprovalPending
                      ? "Access pending"
                      : "Needs attention"
                  : googleConnected
                    ? "Location ready"
                    : "Setup needed"}
            </Badge>
            <button
              className="crm-button-secondary"
              type="button"
              onClick={() => onOpenGoogleProfiles(client.id)}
              disabled={!canManageGoogle}
            >
              {canManageGoogle
                ? googleConnected
                  ? "Manage Google"
                  : "Google setup"
                : "Owner setup required"}
            </button>
          </section>

          <div className="crm-review-tabs" role="tablist" aria-label="Reviews sections">
            {tabs.map((item, index) => (
              <button
                id={`crm-review-tab-${item.id}`}
                key={item.id}
                className={tab === item.id ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                aria-controls={`crm-review-panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => chooseTab(item.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {item.label}
                {item.id === "requests" && clientRequests.length ? (
                  <span>{clientRequests.length}</span>
                ) : null}
              </button>
            ))}
          </div>

          {tab === "overview" ? (
            <OverviewPanel
              client={client}
              profile={profile}
              requests={clientRequests}
              googleConnected={googleConnected}
              reviewUrl={reviewUrl}
              smsReady={smsReady}
              smsReadinessMessage={smsReadinessMessage}
              googleReviews={googleReviews}
              reviewLoadStatus={reviewLoadStatus}
              reviewLoadError={reviewLoadError}
              onOpenInbox={() => chooseTab("inbox")}
              onOpenRequests={() => chooseTab("requests")}
              onOpenSettings={() => chooseTab("settings")}
              onOpenGoogleProfiles={() => onOpenGoogleProfiles(client.id)}
              onOpenConnections={() => onOpenConnections(client.id)}
              canManageGoogle={canManageGoogle}
              canManageConnections={canManageConnections}
            />
          ) : null}

          {tab === "inbox" ? (
            <InboxPanel
              key={client.id}
              clientId={client.id}
              googleConnected={googleConnected}
              googleReviews={googleReviews}
              reviewLoadStatus={reviewLoadStatus}
              reviewLoadError={reviewLoadError}
              loadingMore={loadingMoreReviews}
              mutate={mutate}
              canReply={canReply}
              onRefresh={refreshGoogleReviews}
              onLoadMore={() => void loadMoreGoogleReviews()}
              onOpenGoogleProfiles={() => onOpenGoogleProfiles(client.id)}
              onOpenRequests={() => chooseTab("requests")}
              canManageGoogle={canManageGoogle}
            />
          ) : null}

          {tab === "requests" ? (
            <RequestsPanel
              key={`${client.id}-${settings?.updatedAt ?? "new"}-${reviewUrl}`}
              client={client}
              contacts={clientContacts}
              requests={clientRequests}
              settings={settings}
              reviewUrl={reviewUrl}
              smsReady={smsReady}
              smsReadinessMessage={smsReadinessMessage}
              mutate={mutate}
              canRequest={canRequest}
              canManageSettings={canManage}
              onOpenGoogleProfiles={() => onOpenGoogleProfiles(client.id)}
              onOpenConnections={() => onOpenConnections(client.id)}
              onOpenSettings={() => chooseTab("settings")}
              canManageGoogle={canManageGoogle}
              canManageConnections={canManageConnections}
            />
          ) : null}

          {tab === "settings" ? (
            <SettingsPanel
              key={`${client.id}-${settings?.updatedAt ?? "new"}`}
              client={client}
              profile={profile}
              settings={settings}
              smsReady={smsReady}
              smsReadinessMessage={smsReadinessMessage}
              mutate={mutate}
              canManage={canManage}
              onOpenGoogleProfiles={() => onOpenGoogleProfiles(client.id)}
              onOpenConnections={() => onOpenConnections(client.id)}
              canManageGoogle={canManageGoogle}
              canManageConnections={canManageConnections}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function OverviewPanel({
  client,
  profile,
  requests,
  googleConnected,
  reviewUrl,
  smsReady,
  smsReadinessMessage,
  googleReviews,
  reviewLoadStatus,
  reviewLoadError,
  onOpenInbox,
  onOpenRequests,
  onOpenSettings,
  onOpenGoogleProfiles,
  onOpenConnections,
  canManageGoogle,
  canManageConnections,
}: {
  client: CrmClient;
  profile: CrmGoogleProfile | null;
  requests: CrmReviewRequest[];
  googleConnected: boolean;
  reviewUrl: string;
  smsReady: boolean;
  smsReadinessMessage: string;
  googleReviews: GoogleBusinessReviewsPage | null;
  reviewLoadStatus: ReviewLoadStatus;
  reviewLoadError: string;
  onOpenInbox: () => void;
  onOpenRequests: () => void;
  onOpenSettings: () => void;
  onOpenGoogleProfiles: () => void;
  onOpenConnections: () => void;
  canManageGoogle: boolean;
  canManageConnections: boolean;
}) {
  const sent = requests.filter((request) =>
    ["sent", "delivered"].includes(request.status),
  ).length;
  const delivered = requests.filter(
    (request) => request.status === "delivered",
  ).length;
  const failed = requests.filter((request) => request.status === "failed").length;
  const liveReviews = googleReviews?.reviews ?? [];
  const ratingValue =
    reviewLoadStatus === "ready" && googleReviews?.averageRating !== null
      ? googleReviews?.averageRating?.toFixed(1) ?? "—"
      : "—";
  const reviewCountValue =
    reviewLoadStatus === "ready"
      ? String(googleReviews?.totalReviewCount ?? 0)
      : "—";
  const checklist = [
    {
      title: "Connect the Google location",
      description: googleConnected
        ? profile?.locationName || profile?.businessName || "Location connected"
        : "Authorize the verified Google Business Profile.",
      ready: googleConnected,
      action: onOpenGoogleProfiles,
      actionLabel: "Google setup",
      canAct: canManageGoogle,
    },
    {
      title: "Save the official review link",
      description: reviewUrl
        ? "The review link is ready to share."
        : "Add the link customers use to write a Google review.",
      ready: Boolean(reviewUrl),
      action: onOpenGoogleProfiles,
      actionLabel: "Add review link",
      canAct: canManageGoogle,
    },
    {
      title: "Connect business texting",
      description: smsReadinessMessage,
      ready: smsReady,
      action: onOpenConnections,
      actionLabel: "Connections",
      canAct: canManageConnections,
    },
    {
      title: "Send the first request",
      description: requests.length
        ? `${requests.length} real ${requests.length === 1 ? "request has" : "requests have"} been created.`
        : "No review requests have been sent yet.",
      ready: requests.length > 0,
      action: onOpenRequests,
      actionLabel: "Review requests",
      canAct: true,
    },
  ];

  return (
    <section
      id="crm-review-panel-overview"
      className="crm-review-panel"
      role="tabpanel"
      aria-labelledby="crm-review-tab-overview"
    >
      <div className="crm-review-metrics" aria-label="Review summary">
        <Metric
          label="Average Google rating"
          value={ratingValue}
          note={
            reviewLoadStatus === "ready"
              ? "Current value returned by Google"
              : "Available after the first live load"
          }
        />
        <Metric
          label="Google reviews"
          value={reviewCountValue}
          note={
            reviewLoadStatus === "ready"
              ? `${liveReviews.length} loaded in this session`
              : "Google has not returned review data yet"
          }
        />
        <Metric label="Requests sent" value={String(sent)} note={`${requests.length} total request records`} />
        <Metric label="Delivered" value={String(delivered)} note={failed ? `${failed} failed` : "No failed requests"} />
      </div>

      <div className="crm-review-overview-grid">
        <section className="crm-review-card crm-review-recent-card">
          <header>
            <div>
              <p>REVIEW INBOX</p>
              <h3>Recent Google reviews</h3>
            </div>
            <button type="button" onClick={onOpenInbox}>
              Open inbox
            </button>
          </header>
          {reviewLoadStatus === "loading" ? (
            <div className="crm-review-honest-empty" aria-live="polite">
              <span aria-hidden="true">G</span>
              <h4>Loading real Google reviews</h4>
              <p>BrizBuilder is checking Google for the latest customer feedback.</p>
            </div>
          ) : liveReviews.length ? (
            <ul className="crm-review-recent-list">
              {liveReviews.slice(0, 3).map((review) => (
                <li key={review.reviewId}>
                  <div>
                    <strong>{review.reviewerName}</strong>
                    <span aria-label={`${review.starRating} out of 5 stars`}>
                      {"★".repeat(review.starRating)}
                      <i>{"★".repeat(5 - review.starRating)}</i>
                    </span>
                  </div>
                  <p>{reviewExcerpt(review)}</p>
                  <small>{readableReviewDate(review.createTime)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <div className="crm-review-honest-empty">
              <span aria-hidden="true">★</span>
              <h4>
                {reviewLoadStatus === "ready"
                  ? "No Google reviews yet"
                  : "No Google reviews loaded"}
              </h4>
              <p>
                {reviewLoadStatus === "error"
                  ? reviewLoadError
                  : `BrizBuilder will show real reviews here after Google approves API access and ${client.businessName}'s location is synchronized.`}
              </p>
            </div>
          )}
        </section>

        <section className="crm-review-card crm-review-checklist">
          <header>
            <div>
              <p>SETUP CHECKLIST</p>
              <h3>Get review requests ready</h3>
            </div>
            <button type="button" onClick={onOpenSettings}>
              Settings
            </button>
          </header>
          <ol>
            {checklist.map((item) => (
              <li key={item.title}>
                <span className={item.ready ? "ready" : ""} aria-hidden="true">
                  {item.ready ? "✓" : ""}
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
                {!item.ready && item.canAct ? (
                  <button type="button" onClick={item.action}>
                    {item.actionLabel}
                  </button>
                ) : item.ready ? (
                  <Badge tone="green">Ready</Badge>
                ) : (
                  <Badge tone="neutral">Owner action</Badge>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function InboxPanel({
  clientId,
  googleConnected,
  googleReviews,
  reviewLoadStatus,
  reviewLoadError,
  loadingMore,
  mutate,
  canReply,
  onRefresh,
  onLoadMore,
  onOpenGoogleProfiles,
  onOpenRequests,
  canManageGoogle,
}: {
  clientId: string;
  googleConnected: boolean;
  googleReviews: GoogleBusinessReviewsPage | null;
  reviewLoadStatus: ReviewLoadStatus;
  reviewLoadError: string;
  loadingMore: boolean;
  mutate: Mutate;
  canReply: boolean;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpenGoogleProfiles: () => void;
  onOpenRequests: () => void;
  canManageGoogle: boolean;
}) {
  const [search, setSearch] = useState("");
  const [rating, setRating] = useState("all");
  const [replyStatus, setReplyStatus] = useState("all");
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const reviews = useMemo(
    () => googleReviews?.reviews ?? [],
    [googleReviews],
  );
  const filteredReviews = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reviews.filter((review) => {
      if (rating !== "all" && review.starRating !== Number(rating)) return false;
      if (replyStatus === "replied" && !review.reply) return false;
      if (replyStatus === "unreplied" && review.reply) return false;
      if (
        query &&
        !`${review.reviewerName} ${review.comment ?? ""}`
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }
      return true;
    });
  }, [rating, replyStatus, reviews, search]);
  const selectedReview =
    filteredReviews.find((review) => review.reviewId === selectedReviewId) ??
    filteredReviews[0] ??
    null;

  return (
    <section
      id="crm-review-panel-inbox"
      className="crm-review-panel"
      role="tabpanel"
      aria-labelledby="crm-review-tab-inbox"
    >
      <div className="crm-review-inbox">
        <aside aria-label="Google review list">
          <header>
            <div>
              <strong>Google reviews</strong>
              <small>
                {reviewLoadStatus === "ready"
                  ? `${reviews.length} loaded for this session`
                  : "Live reviews only"}
              </small>
            </div>
            <Badge tone={reviewLoadStatus === "ready" ? "blue" : "neutral"}>
              {reviewLoadStatus === "ready"
                ? `${googleReviews?.totalReviewCount ?? 0} reviews`
                : "Not loaded"}
            </Badge>
          </header>
          <div className="crm-review-inbox-filters">
            <label>
              <span>Search reviews</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={reviewLoadStatus !== "ready"}
                placeholder="Name or review text"
              />
            </label>
            <div>
              <label>
                <span>Rating</span>
                <select
                  value={rating}
                  onChange={(event) => setRating(event.target.value)}
                  disabled={reviewLoadStatus !== "ready"}
                >
                  <option value="all">All ratings</option>
                  <option value="5">5 stars</option>
                  <option value="4">4 stars</option>
                  <option value="3">3 stars</option>
                  <option value="2">2 stars</option>
                  <option value="1">1 star</option>
                </select>
              </label>
              <label>
                <span>Reply status</span>
                <select
                  value={replyStatus}
                  onChange={(event) => setReplyStatus(event.target.value)}
                  disabled={reviewLoadStatus !== "ready"}
                >
                  <option value="all">All replies</option>
                  <option value="replied">Replied</option>
                  <option value="unreplied">Needs reply</option>
                </select>
              </label>
            </div>
          </div>
          {reviewLoadStatus === "loading" ? (
            <div className="crm-review-inbox-list-empty" aria-live="polite">
              <strong>Loading from Google</strong>
              <p>Only real reviews will appear here.</p>
            </div>
          ) : reviewLoadStatus === "error" ? (
            <div className="crm-review-inbox-list-empty">
              <strong>Google reviews are not available yet</strong>
              <p>{reviewLoadError}</p>
              <button type="button" onClick={onRefresh}>Try again</button>
            </div>
          ) : filteredReviews.length ? (
            <div className="crm-review-inbox-list">
              {filteredReviews.map((review) => (
                <button
                  key={review.reviewId}
                  type="button"
                  className={selectedReview?.reviewId === review.reviewId ? "active" : ""}
                  aria-pressed={selectedReview?.reviewId === review.reviewId}
                  onClick={() => setSelectedReviewId(review.reviewId)}
                >
                  <span>
                    <strong>{review.reviewerName}</strong>
                    <small>{readableReviewDate(review.createTime)}</small>
                  </span>
                  <span
                    className="crm-review-stars"
                    aria-label={`${review.starRating} out of 5 stars`}
                  >
                    {"★".repeat(review.starRating)}
                    <i>{"★".repeat(5 - review.starRating)}</i>
                  </span>
                  <p>{reviewExcerpt(review)}</p>
                  <em>{review.reply ? "Replied" : "Needs reply"}</em>
                </button>
              ))}
              {googleReviews?.nextPageToken ? (
                <button
                  className="crm-review-load-more"
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading more…" : "Load more reviews"}
                </button>
              ) : null}
              {reviewLoadError ? (
                <p className="crm-review-page-error" role="alert">
                  {reviewLoadError}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="crm-review-inbox-list-empty">
              <strong>
                {reviewLoadStatus === "ready"
                  ? reviews.length
                    ? "No reviews match these filters"
                    : "No Google reviews yet"
                  : "No reviews loaded"}
              </strong>
              <p>No example or fabricated reviews are shown.</p>
            </div>
          )}
        </aside>
        <section>
          {selectedReview ? (
            <GoogleReviewDetail
              key={`${selectedReview.reviewId}-${selectedReview.reply?.updateTime ?? "new"}`}
              clientId={clientId}
              review={selectedReview}
              mutate={mutate}
              canReply={canReply}
              onRefresh={onRefresh}
            />
          ) : (
            <div className="crm-review-inbox-detail-empty">
              <span aria-hidden="true">G</span>
              <h3>
                {reviewLoadStatus === "ready"
                  ? "Choose a Google review"
                  : googleConnected
                    ? "Waiting for Google review access"
                    : "Connect a Google location first"}
              </h3>
              <p>
                {reviewLoadStatus === "ready"
                  ? "Select a real review from the list to read it and prepare a reply."
                  : googleConnected
                    ? "Google is still reviewing BrizBuilder's API access. The inbox and manual reply tools are already prepared and will activate when access is granted."
                    : "Choose the business's verified Google location before loading and replying to reviews."}
              </p>
              <div>
                <button
                  className="crm-button-primary"
                  type="button"
                  onClick={onOpenGoogleProfiles}
                  disabled={!canManageGoogle}
                >
                  {canManageGoogle
                    ? googleConnected
                      ? "Manage Google"
                      : "Google setup"
                    : "Ask an owner to manage Google"}
                </button>
                <button
                  className="crm-button-secondary"
                  type="button"
                  onClick={onOpenRequests}
                >
                  Review request tools
                </button>
              </div>
              <small>
                {canReply
                  ? "Nothing can publish without a person reviewing the exact message and clicking Publish reply."
                  : "You can view reviews when they become available, but your role cannot publish replies."}
              </small>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function GoogleReviewDetail({
  clientId,
  review,
  mutate,
  canReply,
  onRefresh,
}: {
  clientId: string;
  review: GoogleBusinessReview;
  mutate: Mutate;
  canReply: boolean;
  onRefresh: () => void;
}) {
  const [comment, setComment] = useState(review.reply?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const replyBytes = new TextEncoder().encode(comment.trim()).byteLength;
  const canPublish =
    canReply && Boolean(comment.trim()) && replyBytes <= 4096 && !saving;

  async function publishReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPublish) return;
    setSaving(true);
    setError("");
    try {
      await mutate(
        {
          action: "publish_google_review_reply",
          clientId,
          reviewId: review.reviewId,
          comment: comment.trim(),
          confirmed: true,
        },
        review.reply ? "Google reply updated" : "Google reply published",
      );
      onRefresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The Google reply could not be published.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteReply() {
    if (!canReply || !review.reply || saving) return;
    if (!window.confirm("Delete this public reply from Google? This cannot be undone.")) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await mutate(
        {
          action: "delete_google_review_reply",
          clientId,
          reviewId: review.reviewId,
          confirmed: true,
        },
        "Google reply deleted",
      );
      onRefresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The Google reply could not be deleted.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="crm-review-detail">
      <header>
        <div>
          <strong>{review.reviewerName}</strong>
          <span
            className="crm-review-stars"
            aria-label={`${review.starRating} out of 5 stars`}
          >
            {"★".repeat(review.starRating)}
            <i>{"★".repeat(5 - review.starRating)}</i>
          </span>
        </div>
        <small>{readableReviewDate(review.createTime)}</small>
      </header>
      <section>
        <p>{reviewExcerpt(review)}</p>
      </section>
      <form onSubmit={publishReply}>
        <div className="crm-review-reply-heading">
          <div>
            <p>PUBLIC GOOGLE REPLY</p>
            <h3>{review.reply ? "Review and update the reply" : "Write a reply"}</h3>
          </div>
          {review.reply?.status ? (
            <Badge tone={review.reply.status === "APPROVED" ? "green" : "orange"}>
              {review.reply.status.toLowerCase()}
            </Badge>
          ) : null}
        </div>
        {review.reply?.policyViolation ? (
          <div className="crm-review-callout warning" role="alert">
            <strong>Google policy notice</strong>
            <p>{review.reply.policyViolation}</p>
          </div>
        ) : null}
        <label>
          <span>Reply text</span>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={6}
            disabled={!canReply || saving}
            maxLength={4096}
            placeholder="Thank the customer and respond in the business's own voice."
          />
          <small className={replyBytes > 4096 ? "over-limit" : ""}>
            {replyBytes.toLocaleString()} of 4,096 bytes
          </small>
        </label>
        <div className="crm-review-message-preview">
          <span>Exact public reply preview</span>
          <p>{comment.trim() || "Your reply preview will appear here."}</p>
        </div>
        <p className="crm-review-publish-note">
          Google will publish this exact message. BrizBuilder never publishes a
          reply automatically.
        </p>
        {error ? <div className="crm-inline-error" role="alert">{error}</div> : null}
        <div className="crm-review-reply-actions">
          <button
            className="crm-button-primary"
            type="submit"
            disabled={!canPublish}
          >
            {saving ? "Publishing…" : review.reply ? "Update public reply" : "Publish reply"}
          </button>
          {review.reply ? (
            <button
              className="crm-button-danger"
              type="button"
              onClick={() => void deleteReply()}
              disabled={!canReply || saving}
            >
              Delete reply
            </button>
          ) : null}
        </div>
        {!canReply ? (
          <small>Your role can read reviews but cannot publish or delete replies.</small>
        ) : null}
      </form>
    </article>
  );
}

function RequestsPanel({
  client,
  contacts,
  requests,
  settings,
  reviewUrl,
  smsReady,
  smsReadinessMessage,
  mutate,
  canRequest,
  canManageSettings,
  onOpenGoogleProfiles,
  onOpenConnections,
  onOpenSettings,
  canManageGoogle,
  canManageConnections,
}: {
  client: CrmClient;
  contacts: CrmContact[];
  requests: CrmReviewRequest[];
  settings: CrmReviewSettings | null;
  reviewUrl: string;
  smsReady: boolean;
  smsReadinessMessage: string;
  mutate: Mutate;
  canRequest: boolean;
  canManageSettings: boolean;
  onOpenGoogleProfiles: () => void;
  onOpenConnections: () => void;
  onOpenSettings: () => void;
  canManageGoogle: boolean;
  canManageConnections: boolean;
}) {
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const effectiveContactId = contacts.some((item) => item.id === contactId)
    ? contactId
    : contacts[0]?.id ?? "";
  const selectedContact =
    contacts.find((item) => item.id === effectiveContactId) ?? null;
  const body = settings?.defaultSmsTemplate || DEFAULT_REQUEST_TEMPLATE;
  const preview = renderRequestMessage(body, selectedContact, client, reviewUrl);
  const qrId = `crm-review-qr-${client.id}`;
  const sent = requests.filter((request) =>
    ["sent", "delivered"].includes(request.status),
  ).length;
  const delivered = requests.filter(
    (request) => request.status === "delivered",
  ).length;
  const failed = requests.filter((request) => request.status === "failed").length;
  const pending = requests.filter((request) =>
    ["sending", "reconciling", "queued"].includes(request.status),
  ).length;

  let disabledReason = "";
  if (!canRequest) disabledReason = "Your role cannot send review requests.";
  else if (!reviewUrl)
    disabledReason = "Save the official Google review link before sending.";
  else if (!smsReady) disabledReason = smsReadinessMessage;
  else if (!settings?.smsEnabled)
    disabledReason = "Turn on SMS review requests in Settings before sending.";
  else if (!contacts.length)
    disabledReason = "Add an eligible contact with a phone number first.";

  async function handleCopy() {
    if (!reviewUrl) return;
    setCopyStatus("");
    try {
      await copyText(reviewUrl);
      setCopyStatus("Review link copied.");
    } catch (error) {
      setCopyStatus(
        error instanceof Error ? error.message : "The link could not be copied.",
      );
    }
  }

  function downloadQrCode() {
    const canvas = document.getElementById(qrId) as HTMLCanvasElement | null;
    if (!canvas) {
      setCopyStatus("The QR code is not ready to download.");
      return;
    }
    const download = document.createElement("a");
    download.download = `${safeFilename(client.businessName)}-google-review-qr.png`;
    download.href = canvas.toDataURL("image/png");
    download.click();
    setCopyStatus("QR code downloaded.");
  }

  async function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabledReason || !selectedContact || !consentConfirmed || sending)
      return;
    setSending(true);
    setFormError("");
    try {
      await mutate(
        {
          action: "send_review_request",
          clientId: client.id,
          contactId: selectedContact.id,
          body: preview,
          consentConfirmed,
          idempotencyKey: crypto.randomUUID(),
        },
        `Review request submitted for ${selectedContact.firstName}`,
      );
      setConsentConfirmed(false);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "The review request could not be sent.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      id="crm-review-panel-requests"
      className="crm-review-panel"
      role="tabpanel"
      aria-labelledby="crm-review-tab-requests"
    >
      <div className="crm-review-request-metrics" aria-label="Review request activity">
        <Metric label="Requests sent" value={String(sent)} note={`${requests.length} total records`} />
        <Metric label="Delivered" value={String(delivered)} note="Confirmed by the messaging provider" />
        <Metric label="Pending" value={String(pending)} note="Queued or currently sending" />
        <Metric label="Failed" value={String(failed)} note="Needs attention or retry" />
      </div>

      <div className="crm-review-tools-grid">
        <section className="crm-review-card crm-review-link-tool">
          <header>
            <div>
              <p>SHAREABLE LINK</p>
              <h3>Google review link and QR code</h3>
            </div>
            <Badge tone={reviewUrl ? "green" : "orange"}>
              {reviewUrl ? "Ready" : "Link needed"}
            </Badge>
          </header>
          {reviewUrl ? (
            <div className="crm-review-link-ready">
              <figure aria-label={`Google review QR code for ${client.businessName}`}>
                <QRCodeCanvas
                  id={qrId}
                  value={reviewUrl}
                  size={168}
                  marginSize={2}
                  level="M"
                  title={`Google review QR code for ${client.businessName}`}
                />
                <figcaption>Scan to write a Google review</figcaption>
              </figure>
              <div>
                <label>
                  <span>Official Google review link</span>
                  <input value={reviewUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
                </label>
                <p>
                  Print the QR code or share the exact link. Customers always
                  choose their own rating and review wording.
                </p>
                <div className="crm-review-tool-actions">
                  <button className="crm-button-primary" type="button" onClick={() => void handleCopy()}>
                    Copy link
                  </button>
                  <button className="crm-button-secondary" type="button" onClick={downloadQrCode}>
                    Download QR code
                  </button>
                </div>
                <span className="crm-review-live-status" aria-live="polite">
                  {copyStatus}
                </span>
              </div>
            </div>
          ) : (
            <div className="crm-review-tool-empty">
              <h4>Add the official Google review link</h4>
              <p>
                Copy it from this business&apos;s Google Business Profile. BrizBuilder
                will use the same link for QR codes and text requests.
              </p>
              {canManageGoogle ? (
                <button className="crm-button-primary" type="button" onClick={onOpenGoogleProfiles}>
                  Add review link
                </button>
              ) : (
                <small>Ask an account owner to add this business&apos;s Google review link.</small>
              )}
            </div>
          )}
        </section>

        <form className="crm-review-card crm-review-request-form" onSubmit={sendRequest}>
          <header>
            <div>
              <p>MANUAL SMS REQUEST</p>
              <h3>Send one review request</h3>
            </div>
            <Badge tone={smsReady ? "green" : "orange"}>
              {smsReady ? "Ready to send" : "Setup needed"}
            </Badge>
          </header>
          <div className="crm-review-form-body">
            <label>
              <span>Customer</span>
              <select
                value={effectiveContactId}
                onChange={(event) => {
                  setContactId(event.target.value);
                  setConsentConfirmed(false);
                }}
                disabled={!canRequest || sending || !contacts.length}
                required
              >
                {!contacts.length ? <option value="">No eligible contacts</option> : null}
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.firstName} {contact.lastName} · {contact.phone}
                  </option>
                ))}
              </select>
              <small>Contacts who opted out of marketing texts are excluded.</small>
            </label>
            <label>
              <span>Saved message template</span>
              <textarea
                value={body}
                rows={5}
                readOnly
                aria-readonly="true"
              />
              <small>
                BrizBuilder sends the saved, compliance-checked template. Change it
                from Review Settings before sending.
              </small>
            </label>
            <button
              className="crm-review-edit-template"
              type="button"
              onClick={onOpenSettings}
            >
              Edit saved message in Settings
            </button>
            <div className="crm-review-message-preview">
              <span>Exact message preview</span>
              <p>{preview}</p>
              <small>{preview.length} characters · Reply STOP language included</small>
            </div>
            <label className="crm-review-consent">
              <input
                type="checkbox"
                checked={consentConfirmed}
                onChange={(event) => setConsentConfirmed(event.target.checked)}
                disabled={!canRequest || sending || !selectedContact}
                required
              />
              <span>
                I confirm this customer gave permission to receive this review-request
                text and has not opted out.
              </span>
            </label>
            {disabledReason ? (
              <div className="crm-review-callout warning" role="note">
                <strong>Before you can send</strong>
                <p>{disabledReason}</p>
                {!reviewUrl && canManageGoogle ? (
                  <button type="button" onClick={onOpenGoogleProfiles}>Google setup</button>
                ) : !smsReady && canManageConnections ? (
                  <button type="button" onClick={onOpenConnections}>Connections</button>
                ) : !settings?.smsEnabled && canManageSettings ? (
                  <button type="button" onClick={onOpenSettings}>Review settings</button>
                ) : null}
              </div>
            ) : null}
            {formError ? <div className="crm-inline-error" role="alert">{formError}</div> : null}
            <button
              className="crm-button-primary crm-review-send-button"
              type="submit"
              disabled={Boolean(disabledReason) || !consentConfirmed || !selectedContact || sending}
            >
              {sending ? "Sending securely..." : "Send review request"}
            </button>
            <small className="crm-review-safety-note">
              Sending a request does not guarantee a review. BrizBuilder reports
              provider delivery status and never invents a completed-review result.
            </small>
          </div>
        </form>
      </div>

      <section className="crm-review-card crm-review-request-history">
        <header>
          <div>
            <p>REQUEST HISTORY</p>
            <h3>Real messages sent by this business</h3>
          </div>
          <Badge tone="neutral">{requests.length} total</Badge>
        </header>
        {!requests.length ? (
          <div className="crm-review-honest-empty compact">
            <h4>No review requests yet</h4>
            <p>The first real request will appear here after it is submitted.</p>
          </div>
        ) : (
          <ul>
            {requests.map((request) => (
              <li key={request.id}>
                <span className="crm-review-request-icon" aria-hidden="true">SMS</span>
                <div>
                  <strong>{request.contactName}</strong>
                  <p>{request.messageBody}</p>
                  <small>
                    Requested by {request.requestedByEmail} · {readableDate(request.sentAt ?? request.createdAt)}
                  </small>
                  {request.errorMessage ? <em>{request.errorMessage}</em> : null}
                </div>
                <Badge tone={requestStatusTone(request.status)}>
                  {request.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function SettingsPanel({
  client,
  profile,
  settings,
  smsReady,
  smsReadinessMessage,
  mutate,
  canManage,
  onOpenGoogleProfiles,
  onOpenConnections,
  canManageGoogle,
  canManageConnections,
}: {
  client: CrmClient;
  profile: CrmGoogleProfile | null;
  settings: CrmReviewSettings | null;
  smsReady: boolean;
  smsReadinessMessage: string;
  mutate: Mutate;
  canManage: boolean;
  onOpenGoogleProfiles: () => void;
  onOpenConnections: () => void;
  canManageGoogle: boolean;
  canManageConnections: boolean;
}) {
  const [smsEnabled, setSmsEnabled] = useState(settings?.smsEnabled ?? false);
  const [defaultSmsTemplate, setDefaultSmsTemplate] = useState(
    settings?.defaultSmsTemplate || DEFAULT_REQUEST_TEMPLATE,
  );
  const [followUpEnabled, setFollowUpEnabled] = useState(
    settings?.followUpEnabled ?? false,
  );
  const [followUpTemplate, setFollowUpTemplate] = useState(
    settings?.followUpTemplate || DEFAULT_FOLLOW_UP_TEMPLATE,
  );
  const [followUpDelayHours, setFollowUpDelayHours] = useState(
    settings?.followUpDelayHours ?? 72,
  );
  const [quietHoursStart, setQuietHoursStart] = useState(
    settings?.quietHoursStart || "20:00",
  );
  const [quietHoursEnd, setQuietHoursEnd] = useState(
    settings?.quietHoursEnd || "08:00",
  );
  const [dailyLimit, setDailyLimit] = useState(settings?.dailyLimit ?? 25);
  const [notificationEmails, setNotificationEmails] = useState(
    settings
      ? settings.notificationEmails.join(", ")
      : client.email || "",
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || saving) return;
    setSaving(true);
    setFormError("");
    try {
      await mutate(
        {
          action: "save_review_settings",
          clientId: client.id,
          smsEnabled,
          defaultSmsTemplate,
          followUpEnabled,
          followUpTemplate,
          followUpDelayHours,
          quietHoursStart,
          quietHoursEnd,
          dailyLimit,
          notificationEmails: notificationEmails
            .split(/[\n,]/)
            .map((email) => email.trim())
            .filter(Boolean),
        },
        "Review settings saved",
      );
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Review settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id="crm-review-panel-settings"
      className="crm-review-panel"
      role="tabpanel"
      aria-labelledby="crm-review-tab-settings"
    >
      <div className="crm-review-settings-status">
        <article>
          <span className="crm-review-google-mark" aria-hidden="true">G</span>
          <div>
            <strong>Google Business Profile</strong>
            <p>{profile?.locationName || profile?.businessName || "No location connected"}</p>
          </div>
          <Badge tone={profile?.status === "connected" ? "green" : "orange"}>
            {profile?.status === "connected" ? "Connected" : "Needs setup"}
          </Badge>
          <button
            type="button"
            onClick={onOpenGoogleProfiles}
            disabled={!canManageGoogle}
          >
            {canManageGoogle ? "Manage" : "Owner only"}
          </button>
        </article>
        <article>
          <span className="crm-provider-logo twilio" aria-hidden="true">T</span>
          <div>
            <strong>Twilio messaging</strong>
            <p>{smsReadinessMessage}</p>
          </div>
          <Badge tone={smsReady ? "green" : "orange"}>
            {smsReady ? "Ready" : "Not ready"}
          </Badge>
          <button
            type="button"
            onClick={onOpenConnections}
            disabled={!canManageConnections}
          >
            {canManageConnections ? "Manage" : "Owner only"}
          </button>
        </article>
      </div>

      <form className="crm-review-settings-form" onSubmit={save}>
        <section className="crm-review-card">
          <header>
            <div>
              <p>MESSAGE SETTINGS</p>
              <h3>Manual SMS review requests</h3>
            </div>
            <Badge tone={smsEnabled ? "green" : "neutral"}>
              {smsEnabled ? "Enabled" : "Off"}
            </Badge>
          </header>
          <div className="crm-review-form-body">
            <label className="crm-review-switch">
              <span>
                <strong>Allow manual SMS review requests</strong>
                <small>A team member must still select a customer and confirm consent each time.</small>
              </span>
              <input
                type="checkbox"
                checked={smsEnabled}
                onChange={(event) => setSmsEnabled(event.target.checked)}
                disabled={!canManage || saving}
              />
            </label>
            <label>
              <span>Default SMS template</span>
              <textarea
                value={defaultSmsTemplate}
                onChange={(event) => setDefaultSmsTemplate(event.target.value)}
                rows={5}
                maxLength={1200}
                disabled={!canManage || saving}
                required
              />
              <small>
                Keep the request neutral. It must include {"{{business_name}}"}, {"{{review_link}}"}, and STOP. Do not offer rewards or ask only happy customers.
              </small>
            </label>
            <label>
              <span>Daily sending limit</span>
              <input
                type="number"
                min={1}
                max={250}
                value={dailyLimit}
                onChange={(event) => setDailyLimit(Number(event.target.value))}
                disabled={!canManage || saving}
                required
              />
              <small>Limits review requests from this business each day.</small>
            </label>
          </div>
        </section>

        <section className="crm-review-card">
          <header>
            <div>
              <p>DELIVERY WINDOW</p>
              <h3>Quiet hours and notifications</h3>
            </div>
            <Badge tone="neutral">{client.timeZone}</Badge>
          </header>
          <div className="crm-review-form-body">
            <div className="crm-review-field-grid">
              <label>
                <span>Quiet hours start</span>
                <input
                  type="time"
                  value={quietHoursStart}
                  onChange={(event) => setQuietHoursStart(event.target.value)}
                  disabled={!canManage || saving}
                  required
                />
              </label>
              <label>
                <span>Quiet hours end</span>
                <input
                  type="time"
                  value={quietHoursEnd}
                  onChange={(event) => setQuietHoursEnd(event.target.value)}
                  disabled={!canManage || saving}
                  required
                />
              </label>
            </div>
            <label>
              <span>Notification emails</span>
              <textarea
                value={notificationEmails}
                onChange={(event) => setNotificationEmails(event.target.value)}
                rows={3}
                placeholder="owner@example.com, manager@example.com"
                disabled={!canManage || saving}
              />
              <small>
                Preference only—email notifications are not active yet. Separate
                future recipients with commas.
              </small>
            </label>
          </div>
        </section>

        <section className="crm-review-card crm-review-follow-up-settings">
          <header>
            <div>
              <p>FOLLOW-UP PREFERENCE</p>
              <h3>Prepare one reminder</h3>
            </div>
            <Badge tone="orange">Automation not active</Badge>
          </header>
          <div className="crm-review-form-body">
            <div className="crm-review-callout warning" role="note">
              <strong>This saves the preference only</strong>
              <p>
                BrizBuilder does not schedule automatic review follow-ups yet.
                A background job system must be activated before reminders can send.
              </p>
            </div>
            <label className="crm-review-switch">
              <span>
                <strong>Prepare a follow-up preference</strong>
                <small>This setting will not send anything automatically today.</small>
              </span>
              <input
                type="checkbox"
                checked={followUpEnabled}
                onChange={(event) => setFollowUpEnabled(event.target.checked)}
                disabled={!canManage || saving}
              />
            </label>
            <label>
              <span>Follow-up delay in hours</span>
              <input
                type="number"
                min={24}
                max={720}
                value={followUpDelayHours}
                onChange={(event) => setFollowUpDelayHours(Number(event.target.value))}
                disabled={!canManage || saving || !followUpEnabled}
                required
              />
            </label>
            <label>
              <span>Follow-up template</span>
              <textarea
                value={followUpTemplate}
                onChange={(event) => setFollowUpTemplate(event.target.value)}
                rows={4}
                maxLength={1200}
                disabled={!canManage || saving || !followUpEnabled}
                required
              />
              <small>
                Must include {"{{business_name}}"}, {"{{review_link}}"}, and STOP.
              </small>
            </label>
          </div>
        </section>

        {formError ? <div className="crm-inline-error crm-review-settings-error" role="alert">{formError}</div> : null}
        <footer>
          {!canManage ? <span>You can view these settings but cannot change them.</span> : null}
          {settings?.updatedAt ? <span>Last saved {readableDate(settings.updatedAt)}</span> : null}
          {canManage ? (
            <button className="crm-button-primary" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save review settings"}
            </button>
          ) : null}
        </footer>
      </form>
    </section>
  );
}
