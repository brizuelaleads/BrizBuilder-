"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  MessageSquareText,
  RefreshCw,
  Send,
  Settings as SettingsIcon,
} from "lucide-react";
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

/*
 * Reviews: one page with a Google status bar, four summary cards and three
 * tabs -- the review inbox, the tools that ask customers for reviews, and the
 * settings those requests follow. It reuses the Google Business Profile page's
 * bar, tabs and cards (gbw-*, gp-*) so the two Growth pages read as a pair.
 * Nothing here publishes or sends without a person clicking the button for it.
 */

type Mutate = (
  input: Record<string, unknown>,
  success: string,
) => Promise<unknown>;

type ReviewTab = "inbox" | "requests" | "settings";
type ReviewLoadStatus = "idle" | "loading" | "ready" | "error";

type ReviewsApiResponse = {
  data?: GoogleBusinessReviewsPage;
  error?: string;
};

const tabs: Array<{ id: ReviewTab; label: string; icon: ReactNode }> = [
  { id: "inbox", label: "Reviews", icon: <MessageSquareText size={16} aria-hidden="true" /> },
  { id: "requests", label: "Get more reviews", icon: <Send size={16} aria-hidden="true" /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon size={16} aria-hidden="true" /> },
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

function initialOf(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
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

function replyStatusLabel(status: string) {
  if (status === "APPROVED") return "Live on Google";
  if (status === "PENDING") return "Waiting on Google";
  if (status === "REJECTED") return "Rejected by Google";
  return status.toLowerCase();
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

function Stars({ rating, label }: { rating: number; label?: string }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span
      className="rv-stars"
      role="img"
      aria-label={label ?? `${rating} out of 5 stars`}
    >
      {"★".repeat(filled)}
      <i>{"★".repeat(5 - filled)}</i>
    </span>
  );
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
  const [tab, setTab] = useState<ReviewTab>("inbox");
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
        ? "Texting is connected, but carrier approval is still pending."
        : "Texting is connected and carrier-approved.";
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

  const reviewsReady = reviewLoadStatus === "ready";
  const needsReplyCount = reviewsReady
    ? (googleReviews?.reviews ?? []).filter((review) => !review.reply).length
    : 0;
  const googleTitle = googleConnected
    ? profile?.locationName || profile?.businessName || "Google location connected"
    : "Google isn't connected yet";
  const googleDetail = reviewsReady
    ? "Live reviews from Google. Replies you publish appear on Google."
    : reviewLoadStatus === "loading"
      ? "Loading reviews from Google…"
      : reviewLoadStatus === "error"
        ? googleApprovalPending
          ? "Google hasn't switched on review access for this business yet."
          : reviewLoadError
        : "Connect this business's Google profile to see and answer its reviews here.";
  const googleBadge = reviewsReady
    ? { tone: "green" as const, label: "Live" }
    : reviewLoadStatus === "loading"
      ? { tone: "neutral" as const, label: "Loading" }
      : reviewLoadStatus === "error"
        ? googleApprovalPending
          ? { tone: "orange" as const, label: "Access pending" }
          : { tone: "red" as const, label: "Needs attention" }
        : { tone: "orange" as const, label: "Not connected" };

  return (
    <div className="crm-view rv-view">
      <section className="crm-page-heading rv-heading">
        <div>
          <p>REPUTATION</p>
          <h2>Reviews</h2>
          <span>
            Read and answer Google reviews, and ask customers to leave new ones.
          </span>
        </div>
        <div className="rv-heading-actions">
          {selectedClientId === "all" && clients.length ? (
            <label className="gp-picker">
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
          ) : null}
          {client && canRequest ? (
            <button
              className="crm-button-primary"
              type="button"
              onClick={() => chooseTab("requests")}
            >
              Request a review
            </button>
          ) : null}
        </div>
      </section>

      {!client ? (
        <EmptyState
          title="Add a client first"
          description="Reviews, review links, and requests belong to a specific business."
        />
      ) : (
        <>
          <section
            className="crm-panel gbw-bar rv-bar"
            aria-label="Google reviews connection"
            aria-live="polite"
          >
            <span className="gp-mark" aria-hidden="true"><i>G</i></span>
            <div className="gbw-bar-copy">
              <h3>{googleTitle}</h3>
              <p><span>{googleDetail}</span></p>
            </div>
            <Badge tone={googleBadge.tone}>{googleBadge.label}</Badge>
            <div className="gbw-bar-actions">
              {googleConnected ? (
                <button
                  className="crm-button-secondary"
                  type="button"
                  onClick={refreshGoogleReviews}
                  disabled={reviewLoadStatus === "loading"}
                >
                  <RefreshCw size={14} aria-hidden="true" /> Refresh
                </button>
              ) : null}
              {canManageGoogle || !googleConnected ? (
                <button
                  className="crm-button-secondary"
                  type="button"
                  onClick={() => onOpenGoogleProfiles(client.id)}
                  disabled={!canManageGoogle}
                >
                  {canManageGoogle
                    ? googleConnected
                      ? "Manage Google"
                      : "Connect Google"
                    : "Ask an owner to connect"}
                </button>
              ) : null}
            </div>
          </section>

          <SummaryCards
            googleReviews={googleReviews}
            reviewsReady={reviewsReady}
            needsReplyCount={needsReplyCount}
            requests={clientRequests}
            onOpenInbox={() => chooseTab("inbox")}
          />

          <div className="gbw-tabs rv-tabs" role="tablist" aria-label="Reviews sections">
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
                {item.icon}
                {item.label}
                {item.id === "inbox" && needsReplyCount ? (
                  <span className="rv-count" aria-label={`${needsReplyCount} need a reply`}>
                    {needsReplyCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

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

/** Four numbers that answer "how are we doing?" before any tab is opened. */
function SummaryCards({
  googleReviews,
  reviewsReady,
  needsReplyCount,
  requests,
  onOpenInbox,
}: {
  googleReviews: GoogleBusinessReviewsPage | null;
  reviewsReady: boolean;
  needsReplyCount: number;
  requests: CrmReviewRequest[];
  onOpenInbox: () => void;
}) {
  const average = reviewsReady ? googleReviews?.averageRating ?? null : null;
  const total = reviewsReady ? googleReviews?.totalReviewCount ?? 0 : null;
  const partial = Boolean(googleReviews?.nextPageToken);
  const sent = requests.filter((request) =>
    ["sent", "delivered"].includes(request.status),
  ).length;
  return (
    <div className="gbw-kpis rv-kpis" aria-label="Review summary">
      <article className="gbw-kpi rv-kpi">
        <span className="gbw-kpi-label">Average rating</span>
        <strong>{average !== null ? average.toFixed(1) : "—"}</strong>
        {average !== null ? (
          <Stars rating={average} label={`${average.toFixed(1)} out of 5 stars`} />
        ) : (
          <small>Shown once reviews load</small>
        )}
      </article>
      <article className="gbw-kpi rv-kpi">
        <span className="gbw-kpi-label">Google reviews</span>
        <strong>{total !== null ? total.toLocaleString() : "—"}</strong>
        <small>All time</small>
      </article>
      <button
        type="button"
        className={`gbw-kpi rv-kpi${needsReplyCount ? " is-attention" : ""}`}
        onClick={onOpenInbox}
      >
        <span className="gbw-kpi-label">Needs a reply</span>
        <strong>{reviewsReady ? needsReplyCount : "—"}</strong>
        <small>
          {!reviewsReady
            ? "Open the inbox"
            : partial
              ? "Among the reviews loaded so far"
              : needsReplyCount
                ? "Open the inbox to answer"
                : "You're all caught up"}
        </small>
      </button>
      <article className="gbw-kpi rv-kpi">
        <span className="gbw-kpi-label">Requests sent</span>
        <strong>{sent}</strong>
        <small>Texts asking for a review</small>
      </article>
    </div>
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
  const detailRef = useRef<HTMLElement>(null);
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

  // On a phone the reply pane sits under the list, so bring it into view
  // when a review is picked.
  useEffect(() => {
    if (!selectedReviewId) return;
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedReviewId]);

  const ready = reviewLoadStatus === "ready";

  return (
    <section
      id="crm-review-panel-inbox"
      className="rv-panel"
      role="tabpanel"
      aria-labelledby="crm-review-tab-inbox"
    >
      <div className="crm-panel rv-inbox">
        <aside className="rv-list" aria-label="Google review list">
          <div className="rv-filters">
            <label className="rv-search">
              <span className="rv-sr-only">Search reviews</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={reviewLoadStatus !== "ready"}
                placeholder="Search by name or words"
              />
            </label>
            <div className="rv-filter-row">
              <label>
                <span className="rv-sr-only">Rating</span>
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
                <span className="rv-sr-only">Reply status</span>
                <select
                  value={replyStatus}
                  onChange={(event) => setReplyStatus(event.target.value)}
                  disabled={reviewLoadStatus !== "ready"}
                >
                  <option value="all">All replies</option>
                  <option value="unreplied">Needs reply</option>
                  <option value="replied">Replied</option>
                </select>
              </label>
            </div>
          </div>

          {reviewLoadStatus === "loading" ? (
            <div className="rv-list-empty" aria-live="polite">
              <span className="crm-loading-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <strong>Loading reviews from Google</strong>
            </div>
          ) : reviewLoadStatus === "error" ? (
            <div className="rv-list-empty">
              <strong>Reviews couldn&apos;t load</strong>
              <p>{reviewLoadError}</p>
              <button className="crm-button-secondary" type="button" onClick={onRefresh}>Try again</button>
            </div>
          ) : filteredReviews.length ? (
            <div className="rv-rows">
              {filteredReviews.map((review) => (
                <button
                  key={review.reviewId}
                  type="button"
                  className={`rv-row${selectedReview?.reviewId === review.reviewId ? " active" : ""}`}
                  aria-pressed={selectedReview?.reviewId === review.reviewId}
                  onClick={() => setSelectedReviewId(review.reviewId)}
                >
                  <span className="rv-avatar" aria-hidden="true">
                    {initialOf(review.reviewerName)}
                  </span>
                  <span className="rv-row-body">
                    <span className="rv-row-top">
                      <strong>{review.reviewerName}</strong>
                      <em className={review.reply ? "is-done" : ""}>
                        {review.reply ? "Replied" : "Needs reply"}
                      </em>
                    </span>
                    <span className="rv-row-meta">
                      <Stars rating={review.starRating} />
                      <small>{readableReviewDate(review.createTime)}</small>
                    </span>
                    <span className="rv-row-text">{reviewExcerpt(review)}</span>
                  </span>
                </button>
              ))}
              {googleReviews?.nextPageToken ? (
                <button
                  className="crm-button-secondary rv-load-more"
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading more…" : "Load more reviews"}
                </button>
              ) : null}
              {reviewLoadError ? (
                <p className="rv-page-error" role="alert">
                  {reviewLoadError}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="rv-list-empty">
              <strong>
                {ready
                  ? reviews.length
                    ? "No reviews match these filters"
                    : "No Google reviews yet"
                  : "No reviews to show"}
              </strong>
              <p>
                {ready && !reviews.length
                  ? "When customers review this business on Google, they'll show up here."
                  : ready
                    ? "Try a different rating or reply filter."
                    : "Reviews appear once Google is connected."}
              </p>
            </div>
          )}
        </aside>

        <section className="rv-detail-pane" ref={detailRef}>
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
            <div className="rv-detail-empty">
              <span className="gp-mark" aria-hidden="true"><i>G</i></span>
              <h3>
                {ready
                  ? reviews.length
                    ? "Pick a review to answer it"
                    : "Nothing to answer yet"
                  : googleConnected
                    ? "Waiting for Google"
                    : "Connect Google to see reviews"}
              </h3>
              <p>
                {ready
                  ? "Ask recent customers for a review to get the first ones coming in."
                  : googleConnected
                    ? "Reviews will appear here as soon as Google sends them."
                    : "Once this business's Google profile is connected, every review lands here."}
              </p>
              <div className="rv-actions">
                {!ready ? (
                  <button
                    className="crm-button-primary"
                    type="button"
                    onClick={onOpenGoogleProfiles}
                    disabled={!canManageGoogle}
                  >
                    {canManageGoogle
                      ? googleConnected
                        ? "Manage Google"
                        : "Connect Google"
                      : "Ask an owner to connect Google"}
                  </button>
                ) : null}
                <button
                  className="crm-button-secondary"
                  type="button"
                  onClick={onOpenRequests}
                >
                  Get more reviews
                </button>
              </div>
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
    <article className="rv-detail">
      <header className="rv-detail-head">
        <span className="rv-avatar is-large" aria-hidden="true">
          {initialOf(review.reviewerName)}
        </span>
        <div>
          <strong>{review.reviewerName}</strong>
          <span>
            <Stars rating={review.starRating} />
            <small>{readableReviewDate(review.createTime)}</small>
          </span>
        </div>
      </header>
      <p className="rv-detail-text">{reviewExcerpt(review)}</p>

      <form className="rv-reply" onSubmit={publishReply}>
        <div className="rv-reply-head">
          <h3>{review.reply ? "Your reply" : "Write a reply"}</h3>
          {review.reply?.status ? (
            <Badge tone={review.reply.status === "APPROVED" ? "green" : "orange"}>
              {replyStatusLabel(review.reply.status)}
            </Badge>
          ) : null}
        </div>
        {review.reply?.policyViolation ? (
          <div className="rv-callout is-warning" role="alert">
            <strong>Google flagged this reply</strong>
            <p>{review.reply.policyViolation}</p>
          </div>
        ) : null}
        <label>
          <span className="rv-sr-only">Reply text</span>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={5}
            disabled={!canReply || saving}
            maxLength={4096}
            placeholder="Thank the customer and answer in the business's own voice."
          />
        </label>
        <div className="rv-reply-meta">
          <small>
            {canReply
              ? "Posts publicly on Google exactly as written. Nothing is ever posted for you."
              : "Your role can read reviews but can't publish or delete replies."}
          </small>
          <small className={replyBytes > 4096 ? "is-over" : ""}>
            {replyBytes.toLocaleString()} / 4,096
          </small>
        </div>
        {error ? <div className="crm-inline-error" role="alert">{error}</div> : null}
        <div className="rv-actions">
          <button
            className="crm-button-primary"
            type="submit"
            disabled={!canPublish}
          >
            {saving ? "Publishing…" : review.reply ? "Update reply" : "Publish reply"}
          </button>
          {review.reply ? (
            <button
              className="danger"
              type="button"
              onClick={() => void deleteReply()}
              disabled={!canReply || saving}
            >
              Delete reply
            </button>
          ) : null}
        </div>
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
  if (!canRequest) disabledReason = "Your role can't send review requests.";
  else if (!reviewUrl)
    disabledReason = "Add the business's Google review link first.";
  else if (!smsReady) disabledReason = smsReadinessMessage;
  else if (!settings?.smsEnabled)
    disabledReason = "Turn on text review requests in Settings first.";
  else if (!contacts.length)
    disabledReason = "Add a contact with a phone number first.";

  async function handleCopy() {
    if (!reviewUrl) return;
    setCopyStatus("");
    try {
      await copyText(reviewUrl);
      setCopyStatus("Link copied.");
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
      className="rv-panel"
      role="tabpanel"
      aria-labelledby="crm-review-tab-requests"
    >
      <div className="rv-two-up">
        <section className="crm-panel rv-card">
          <div className="rv-card-head">
            <div>
              <h3>Share your review link</h3>
              <p>Print the QR code at the counter or paste the link anywhere.</p>
            </div>
            <Badge tone={reviewUrl ? "green" : "orange"}>
              {reviewUrl ? "Ready" : "Link needed"}
            </Badge>
          </div>
          {reviewUrl ? (
            <div className="rv-share">
              <figure aria-label={`Google review QR code for ${client.businessName}`}>
                <QRCodeCanvas
                  id={qrId}
                  value={reviewUrl}
                  size={144}
                  marginSize={2}
                  level="M"
                  title={`Google review QR code for ${client.businessName}`}
                />
                <figcaption>Scan to review</figcaption>
              </figure>
              <div className="rv-share-body">
                <label>
                  <span>Google review link</span>
                  <input value={reviewUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
                </label>
                <div className="rv-actions">
                  <button className="crm-button-primary" type="button" onClick={() => void handleCopy()}>
                    Copy link
                  </button>
                  <button className="crm-button-secondary" type="button" onClick={downloadQrCode}>
                    Download QR code
                  </button>
                </div>
                <span className="rv-live-status" aria-live="polite">
                  {copyStatus}
                </span>
              </div>
            </div>
          ) : (
            <div className="rv-card-empty">
              <p>
                Add the review link from this business&apos;s Google profile. The QR
                code and text requests both use it.
              </p>
              {canManageGoogle ? (
                <button className="crm-button-primary" type="button" onClick={onOpenGoogleProfiles}>
                  Add review link
                </button>
              ) : (
                <small>Ask an account owner to add the Google review link.</small>
              )}
            </div>
          )}
        </section>

        <form className="crm-panel rv-card rv-send" onSubmit={sendRequest}>
          <div className="rv-card-head">
            <div>
              <h3>Text a customer</h3>
              <p>Send one customer a text asking for a review.</p>
            </div>
            <Badge tone={smsReady ? "green" : "orange"}>
              {smsReady ? "Texting ready" : "Setup needed"}
            </Badge>
          </div>
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
              {!contacts.length ? <option value="">No contacts with a phone number</option> : null}
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.firstName} {contact.lastName} · {contact.phone}
                </option>
              ))}
            </select>
            <small>People who opted out of texts aren&apos;t listed.</small>
          </label>
          <div className="rv-message">
            <div className="rv-message-head">
              <span>Message they&apos;ll get</span>
              <button
                className="rv-link"
                type="button"
                onClick={onOpenSettings}
              >
                Edit message
              </button>
            </div>
            <p>{preview}</p>
            <small>{preview.length} characters</small>
          </div>
          <label className="rv-check">
            <input
              type="checkbox"
              checked={consentConfirmed}
              onChange={(event) => setConsentConfirmed(event.target.checked)}
              disabled={!canRequest || sending || !selectedContact}
              required
            />
            <span>
              This customer agreed to get texts from us and hasn&apos;t opted out.
            </span>
          </label>
          {disabledReason ? (
            <div className="rv-callout is-warning" role="note">
              <strong>Before you can send</strong>
              <p>{disabledReason}</p>
              {!reviewUrl && canManageGoogle ? (
                <button className="crm-button-secondary" type="button" onClick={onOpenGoogleProfiles}>Add review link</button>
              ) : !smsReady && canManageConnections ? (
                <button className="crm-button-secondary" type="button" onClick={onOpenConnections}>Open Connections</button>
              ) : !settings?.smsEnabled && canManageSettings ? (
                <button className="crm-button-secondary" type="button" onClick={onOpenSettings}>Open Settings</button>
              ) : null}
            </div>
          ) : null}
          {formError ? <div className="crm-inline-error" role="alert">{formError}</div> : null}
          <button
            className="crm-button-primary rv-send-button"
            type="submit"
            disabled={Boolean(disabledReason) || !consentConfirmed || !selectedContact || sending}
          >
            {sending ? "Sending…" : "Send request"}
          </button>
        </form>
      </div>

      <section className="crm-panel rv-card rv-history">
        <div className="rv-card-head">
          <div>
            <h3>Sent requests</h3>
            <p>
              {requests.length
                ? `${sent} sent · ${delivered} delivered · ${pending} in progress · ${failed} failed`
                : "Every request you send shows up here with its delivery status."}
            </p>
          </div>
        </div>
        {!requests.length ? (
          <p className="rv-history-empty">No review requests yet.</p>
        ) : (
          <ul>
            {requests.map((request) => (
              <li key={request.id}>
                <span className="rv-avatar" aria-hidden="true">
                  {initialOf(request.contactName)}
                </span>
                <div>
                  <strong>{request.contactName}</strong>
                  <p>{request.messageBody}</p>
                  <small>
                    {readableDate(request.sentAt ?? request.createdAt)} · by {request.requestedByEmail}
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

  const googleReady = profile?.status === "connected";

  return (
    <section
      id="crm-review-panel-settings"
      className="rv-panel"
      role="tabpanel"
      aria-labelledby="crm-review-tab-settings"
    >
      <div className="crm-panel rv-connections" aria-label="What reviews depend on">
        <article>
          <span className="gp-mark" aria-hidden="true"><i>G</i></span>
          <div>
            <strong>Google Business Profile</strong>
            <p>{profile?.locationName || profile?.businessName || "No location connected"}</p>
          </div>
          <Badge tone={googleReady ? "green" : "orange"}>
            {googleReady ? "Connected" : "Needs setup"}
          </Badge>
          <button
            className="crm-button-secondary"
            type="button"
            onClick={onOpenGoogleProfiles}
            disabled={!canManageGoogle}
          >
            {canManageGoogle ? "Manage" : "Owner only"}
          </button>
        </article>
        <article>
          <span className="rv-provider-mark" aria-hidden="true">T</span>
          <div>
            <strong>Twilio texting</strong>
            <p>{smsReadinessMessage}</p>
          </div>
          <Badge tone={smsReady ? "green" : "orange"}>
            {smsReady ? "Ready" : "Not ready"}
          </Badge>
          <button
            className="crm-button-secondary"
            type="button"
            onClick={onOpenConnections}
            disabled={!canManageConnections}
          >
            {canManageConnections ? "Manage" : "Owner only"}
          </button>
        </article>
      </div>

      <form className="crm-panel rv-settings" onSubmit={save}>
        <fieldset>
          <legend>
            <strong>Text requests</strong>
            <span>How review requests are worded and how many go out.</span>
          </legend>
          <label className="rv-switch">
            <span>
              <strong>Allow text review requests</strong>
              <small>Someone still picks each customer and confirms consent.</small>
            </span>
            <input
              type="checkbox"
              checked={smsEnabled}
              onChange={(event) => setSmsEnabled(event.target.checked)}
              disabled={!canManage || saving}
            />
          </label>
          <label>
            <span>Message</span>
            <textarea
              value={defaultSmsTemplate}
              onChange={(event) => setDefaultSmsTemplate(event.target.value)}
              rows={4}
              maxLength={1200}
              disabled={!canManage || saving}
              required
            />
            <small>
              Must include {"{{business_name}}"}, {"{{review_link}}"} and STOP.
              {" "}{"{{first_name}}"} is optional. Don&apos;t offer rewards or ask for a
              certain star rating.
            </small>
          </label>
          <label className="rv-narrow">
            <span>Most texts per day</span>
            <input
              type="number"
              min={1}
              max={250}
              value={dailyLimit}
              onChange={(event) => setDailyLimit(Number(event.target.value))}
              disabled={!canManage || saving}
              required
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>
            <strong>Quiet hours</strong>
            <span>No texts go out between these times ({client.timeZone}).</span>
          </legend>
          <div className="rv-field-row">
            <label>
              <span>From</span>
              <input
                type="time"
                value={quietHoursStart}
                onChange={(event) => setQuietHoursStart(event.target.value)}
                disabled={!canManage || saving}
                required
              />
            </label>
            <label>
              <span>Until</span>
              <input
                type="time"
                value={quietHoursEnd}
                onChange={(event) => setQuietHoursEnd(event.target.value)}
                disabled={!canManage || saving}
                required
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>
            <strong>
              Follow-up reminder <Badge tone="orange">Coming soon</Badge>
            </strong>
            <span>
              Saved for later. Automatic reminders aren&apos;t switched on yet, so
              nothing sends from this today.
            </span>
          </legend>
          <label className="rv-switch">
            <span>
              <strong>Send one reminder</strong>
              <small>To customers who haven&apos;t left a review yet.</small>
            </span>
            <input
              type="checkbox"
              checked={followUpEnabled}
              onChange={(event) => setFollowUpEnabled(event.target.checked)}
              disabled={!canManage || saving}
            />
          </label>
          <label className="rv-narrow">
            <span>Wait this many hours</span>
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
            <span>Reminder message</span>
            <textarea
              value={followUpTemplate}
              onChange={(event) => setFollowUpTemplate(event.target.value)}
              rows={3}
              maxLength={1200}
              disabled={!canManage || saving || !followUpEnabled}
              required
            />
            <small>
              Must include {"{{business_name}}"}, {"{{review_link}}"} and STOP.
            </small>
          </label>
        </fieldset>

        <fieldset>
          <legend>
            <strong>
              Email alerts <Badge tone="orange">Coming soon</Badge>
            </strong>
            <span>Who should hear about new reviews once email alerts are switched on.</span>
          </legend>
          <label>
            <span>Email addresses</span>
            <textarea
              value={notificationEmails}
              onChange={(event) => setNotificationEmails(event.target.value)}
              rows={2}
              placeholder="owner@example.com, manager@example.com"
              disabled={!canManage || saving}
            />
            <small>Separate addresses with commas.</small>
          </label>
        </fieldset>

        {formError ? <div className="crm-inline-error" role="alert">{formError}</div> : null}
        <div className="rv-settings-foot">
          {!canManage ? <span>You can view these settings but can&apos;t change them.</span> : null}
          {settings?.updatedAt ? <span>Last saved {readableDate(settings.updatedAt)}</span> : null}
          {canManage ? (
            <button className="crm-button-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
