"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { CrmClient } from "../../db/crm";
import type { MetaPage, MetaSocialWorkspace } from "../../lib/meta-social-core";
import {
  SOCIAL_CHANNELS,
  SOCIAL_STATUSES,
  type SocialPage,
  type SocialPost,
  type SocialStatus,
} from "../../lib/social-core";
import { Badge, EmptyState, Field, Modal } from "./ui";
import { SocialAccounts, SocialInboxView } from "./SocialMetaViews";
import { socialData, socialRead } from "./social-api";

const channelName = { facebook: "Facebook", instagram: "Instagram" };
const statusLabel = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  published: "Published",
};
const statusTone = {
  draft: "neutral",
  in_review: "blue",
  changes_requested: "orange",
  approved: "green",
  published: "purple",
} as const;
const actionNotice: Record<string, string> = {
  create: "Draft saved.",
  edit: "Changes saved.",
  submit: "Post submitted for review.",
  withdraw: "Post returned to drafts.",
  approve: "Post approved.",
  request_changes: "Changes requested.",
  record_published: "Publication recorded.",
};

function formatDay(day: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

export function SocialView({
  clients, selectedClientId, isAgency, canReview, onSelectClient,
}: {
  clients: CrmClient[];
  selectedClientId: string | null;
  isAgency: boolean;
  canReview: boolean;
  onSelectClient: (clientId: string) => void;
}) {
  const activeClients = clients.filter((client) => client.status !== "archived");
  const client = activeClients.find(({ id }) => id === selectedClientId);

  return (
    <div className="crm-view crm-social">
      <section className="crm-page-heading">
        <div>
          <h2>Social</h2>
          <span>Publish posts and reply across Facebook and Instagram.</span>
        </div>
        {isAgency && activeClients.length > 0 && (
          <Field label="Business">
            <select value={client?.id ?? "all"} onChange={(event) => onSelectClient(event.target.value)}>
              <option value="all">Choose a business</option>
              {activeClients.map((business) => (
                <option key={business.id} value={business.id}>{business.businessName}</option>
              ))}
            </select>
          </Field>
        )}
      </section>
      {client ? (
        <SocialWorkspace key={client.id} client={client} canReview={canReview} />
      ) : (
        <EmptyState
          title={activeClients.length ? "Choose a business" : "No businesses available"}
          description={activeClients.length ? "Select a business to see its posts and approvals." : "A client business is required to start planning posts."}
        />
      )}
    </div>
  );
}

function SocialWorkspace({ client, canReview }: { client: CrmClient; canReview: boolean }) {
  const [callback] = useState(() => {
    const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
    const target = params.get("client");
    return {
      openAccounts: params.get("social_section") === "accounts" && (!target || target === client.id),
      error: params.get("social_connection_error") ?? "",
    };
  });
  const [section, setSection] = useState<"planner" | "inbox" | "accounts">(callback.openAccounts ? "accounts" : "planner");
  const [workspace, setWorkspace] = useState<MetaSocialWorkspace>();
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (callback.openAccounts) {
      url.searchParams.delete("social_section");
      url.searchParams.delete("social_connection_error");
      window.history.replaceState(window.history.state, "", url);
    }
  }, [callback.openAccounts]);

  useEffect(() => {
    const controller = new AbortController();
    void socialRead<MetaSocialWorkspace>({ clientId: client.id, view: "accounts" }, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setWorkspace(data); })
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [client.id, reload]);

  const sections = { planner: "Posts", inbox: "Inbox", accounts: "Accounts" } as const;
  return (
    <div className="crm-social-workspace">
      <nav className="crm-tabs" aria-label="Social sections">
        {(Object.keys(sections) as (keyof typeof sections)[]).map((key) => (
          <button type="button" key={key} aria-current={key === section ? "page" : undefined}
            className={key === section ? "active" : ""} onClick={() => setSection(key)}>{sections[key]}</button>
        ))}
      </nav>
      {section === "planner" && (
        <SocialPlanner client={client} canReview={canReview} account={workspace?.account ?? null} onAccounts={() => setSection("accounts")} />
      )}
      {section === "inbox" && (
        <SocialInboxView clientId={client.id} connected={Boolean(workspace?.account)} onAccounts={() => setSection("accounts")} />
      )}
      {section === "accounts" && (workspace ? (
        <SocialAccounts clientId={client.id} workspace={workspace} connectionError={callback.error} onChange={setWorkspace} />
      ) : error ? (
        <div className="crm-social-message" role="alert">
          <p>{error}</p>
          <button className="crm-button-secondary" type="button" onClick={() => {
            setError(""); setReload((value) => value + 1);
          }}>Try again</button>
        </div>
      ) : <p className="crm-social-message" role="status">Loading connected accounts…</p>)}
    </div>
  );
}

function SocialPlanner({ client, canReview, account, onAccounts }: {
  client: CrmClient;
  canReview: boolean;
  account: MetaPage | null;
  onAccounts: () => void;
}) {
  const [filter, setFilter] = useState<SocialStatus | "">("");
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: SocialPage; error?: string }>();
  const [editor, setEditor] = useState<SocialPost | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const key = `${filter}/${page}/${reload}`;
  const current = result?.key === key ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ clientId: client.id, page: String(page) });
    if (filter) params.set("status", filter);
    void fetch(`/api/social?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(socialData<SocialPage>)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setResult({ key, error: error.message });
      });
    return () => controller.abort();
  }, [client.id, filter, key, page]);

  const posts = current?.data?.posts ?? [];

  function refresh() {
    setPage(0);
    setReload((value) => value + 1);
  }

  return (
    <div className="crm-social-layout">
      <section className="crm-panel crm-social-planner" aria-label={`${client.businessName} content planner`}>
        <header>
          <div>
            <h3>Content planner</h3>
            <span className="crm-social-muted">{client.businessName}</span>
          </div>
          <button className="crm-button-primary" type="button" onClick={() => setEditor("new")} disabled={!current?.data}>
            <Plus size={16} aria-hidden="true" /> New post
          </button>
        </header>
        <div className="crm-social-filter">
          <label htmlFor="social-status">Post status</label>
          <select id="social-status" value={filter} onChange={(event) => {
            setFilter(event.target.value as SocialStatus | "");
            setPage(0);
            setNotice("");
          }}>
            <option value="">All posts</option>
            {SOCIAL_STATUSES.map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}
          </select>
          {notice && <span role="status">{notice}</span>}
        </div>
        {!current && <p className="crm-social-message" role="status">Loading posts…</p>}
        {current?.error && (
          <div className="crm-social-message" role="alert">
            <p>{current.error}</p>
            <button className="crm-button-secondary" type="button" onClick={refresh}>Try again</button>
          </div>
        )}
        {current?.data && !posts.length && (
          <div className="crm-social-message">
            <EmptyState
              title={filter ? "No posts with this status" : "No planned posts yet"}
              description={filter ? "Choose a different status to see more posts." : "Create a draft for this business to get started."}
            />
          </div>
        )}
        {posts.length > 0 && (
          <ul className="crm-social-posts">
            {posts.map((post) => (
              <li key={post.id}>
                <button className="crm-social-post" type="button" onClick={() => setEditor(post)}>
                  <div className="crm-social-post-content">
                    <strong>{post.title}</strong>
                    <span>{post.channels.map((channel) => channelName[channel]).join(" and ")}</span>
                  </div>
                  <span className="crm-social-date">
                    {post.plannedDate ? <time dateTime={post.plannedDate}>{formatDay(post.plannedDate)}</time> : "No planned date"}
                  </span>
                  {post.status !== "published" && Object.keys(post.deliveries).length > 0
                    ? <Badge tone="orange">{post.publishingStartedAt ? "Check publication" : "Needs attention"}</Badge>
                    : <Badge tone={statusTone[post.status]}>{statusLabel[post.status]}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {current?.data && (page > 0 || current.data.hasMore) && (
          <div className="crm-social-pagination">
            <button className="crm-button-secondary" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={16} aria-hidden="true" /> Previous
            </button>
            <span>Page {page + 1}</span>
            <button className="crm-button-secondary" type="button" disabled={!current.data.hasMore} onClick={() => setPage(page + 1)}>
              Next <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </section>
      <aside className="crm-panel crm-social-integration" aria-label="Connected accounts">
        <div>
          <h3>Publishing accounts</h3>
          <p>{account ? account.name : "Connect this business’s Facebook Page to publish from here."}</p>
          {account?.instagram && <p>Instagram: @{account.instagram.name}</p>}
          <button className="crm-button-secondary" type="button" onClick={onAccounts}>View accounts</button>
        </div>
      </aside>
      {editor && (
        <SocialPostModal
          key={editor === "new" ? "new" : `${editor.id}/${editor.revision}`}
          clientId={client.id}
          post={editor === "new" ? null : editor}
          canReview={canReview}
          account={account}
          onClose={() => setEditor(null)}
          onReload={() => { setEditor(null); refresh(); }}
          onSave={(action, post) => {
            setNotice(action === "publish_now"
              ? post.status === "published" ? "Post published." : "Check each channel’s publishing result."
              : actionNotice[action]);
            if (filter && filter !== post.status) setFilter("");
            setEditor(action === "publish_now" || (action === "create" && account && canReview) ? post : null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function SocialPostModal({ clientId, post, canReview, account, onClose, onReload, onSave }: {
  clientId: string;
  post: SocialPost | null;
  canReview: boolean;
  account: MetaPage | null;
  onClose: () => void;
  onReload: () => void;
  onSave: (action: string, post: SocialPost) => void;
}) {
  const [mode, setMode] = useState<"details" | "edit" | "feedback" | "publication" | "publish_now">(post ? "details" : "edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; stale: boolean }>();
  const isEditable = post?.status === "draft" || post?.status === "changes_requested";
  const deliveries = Object.values(post?.deliveries ?? {});
  const uncertain = deliveries.some(({ status }) => status === "unknown" || status === "sending");
  const canReturnToDraft = !post?.publishingStartedAt && deliveries.every(({ status }) => status === "failed");
  const mayPublish = canReview && Boolean(account) && !uncertain && !post?.publishingStartedAt &&
    (post?.status === "draft" || post?.status === "approved");

  async function save(action: string, details: Record<string, unknown> = {}) {
    setBusy(true);
    setError(undefined);
    let stale = false;
    try {
      const response = await fetch("/api/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, clientId, id: post?.id, revision: post?.revision, ...details }),
      });
      stale = response.status === 409;
      const updated = await socialData<SocialPost>(response);
      onSave(action, updated);
    } catch (error) {
      setError({ message: error instanceof Error ? error.message : "The post could not be saved.", stale });
    } finally {
      setBusy(false);
    }
  }

  function saveContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save(post ? "edit" : "create", {
      title: form.get("title"),
      caption: form.get("caption"),
      channels: form.getAll("channels"),
      plannedDate: form.get("plannedDate"),
      mediaUrl: form.get("mediaUrl"),
    });
  }

  const errorMessage = error && (
    <div className="crm-social-error crm-field-span" role="alert">
      <p>{error.message}</p>
      {error.stale && <button className="crm-button-secondary" type="button" onClick={onReload}>Reload planner</button>}
    </div>
  );
  const submitDisabled = busy || error?.stale;
  const back = () => {
    setError(undefined);
    setMode("details");
  };

  return (
    <Modal title={mode === "edit" ? (post ? "Edit draft" : "New social post") : post?.title ?? "Social post"}
      onClose={() => { if (!busy) onClose(); }} wide>
      {mode === "edit" && (
        <form className="crm-form crm-social-form" onSubmit={saveContent}>
          <Field label="Working title" span>
            <input name="title" required maxLength={120} defaultValue={post?.title} />
          </Field>
          <fieldset className="crm-social-channels crm-field-span">
            <legend>Channels</legend>
            {SOCIAL_CHANNELS.map((channel) => (
              <label key={channel}>
                <input type="checkbox" name="channels" value={channel} defaultChecked={post?.channels.includes(channel)} />
                {channelName[channel]}
              </label>
            ))}
          </fieldset>
          <Field label="Caption" span>
            <textarea name="caption" rows={5} maxLength={2200} defaultValue={post?.caption} />
          </Field>
          <Field label="Planned date">
            <input name="plannedDate" type="date" max="9999-12-31" defaultValue={post?.plannedDate ?? ""} />
          </Field>
          <Field label="Public image link">
            <input name="mediaUrl" type="url" placeholder="https://" maxLength={2000} defaultValue={post?.mediaUrl ?? ""} />
          </Field>
          {errorMessage}
          <footer>
            <button className="crm-button-secondary" type="button" disabled={busy} onClick={post ? back : onClose}>Cancel</button>
            <button className="crm-button-primary" type="submit" disabled={submitDisabled}>{busy ? "Saving…" : "Save draft"}</button>
          </footer>
        </form>
      )}
      {post && mode !== "edit" && (
        <form className="crm-form crm-social-form" onSubmit={(event) => {
          event.preventDefault();
          if (mode === "feedback") void save("request_changes", { feedback: new FormData(event.currentTarget).get("feedback") });
          if (mode === "publication") void save("record_published");
          if (mode === "publish_now") void save("publish_now");
        }}>
          <div className="crm-social-detail crm-field-span">
            <Badge tone={statusTone[post.status]}>{statusLabel[post.status]}</Badge>
            <dl>
              <div><dt>Channels</dt><dd>{post.channels.map((channel) => channelName[channel]).join(" and ")}</dd></div>
              <div><dt>Planned date</dt><dd>{post.plannedDate ? formatDay(post.plannedDate) : "Not set"}</dd></div>
              {post.publishedAt && (
                <div><dt>Recorded published</dt><dd>{new Date(post.publishedAt).toLocaleDateString()}</dd></div>
              )}
            </dl>
            <div><h3>Caption</h3><p>{post.caption || "No caption yet."}</p></div>
            {post.mediaUrl && <a href={post.mediaUrl} target="_blank" rel="noreferrer">Open media link</a>}
            {deliveries.length > 0 && <div><h3>Publishing results</h3><ul>
              {post.channels.map((channel) => post.deliveries[channel] && (
                <li key={channel}><strong>{channelName[channel]}</strong> {post.deliveries[channel].detail}</li>
              ))}
            </ul></div>}
            {post.status !== "published" && (post.publishingStartedAt || uncertain) &&
              <p>Check Facebook or Instagram for this post before recording publication.</p>}
            {post.feedback && <div><h3>Review feedback</h3><p>{post.feedback}</p></div>}
          </div>
          {mode === "feedback" && (
            <Field label="Changes needed" span><textarea name="feedback" required rows={4} maxLength={1000} /></Field>
          )}
          {mode === "publication" && (
            <p className="crm-form-note crm-field-span">Confirm this post has been published on every selected channel.</p>
          )}
          {mode === "publish_now" && (
            <p className="crm-form-note crm-field-span">
              Publish to {post.channels.map((channel) => channel === "facebook" ? account?.name : account?.instagram?.name ?? "Instagram").join(" and ")} now.
              {post.channels.includes("instagram") && " Instagram requires a public JPEG image link."}
            </p>
          )}
          {errorMessage}
          <footer>
            {mode !== "details" ? (
              <>
                <button type="button" className="crm-button-secondary" disabled={busy} onClick={back}>Back</button>
                <button type="submit" className="crm-button-primary" disabled={submitDisabled}>
                  {busy ? "Working…" : mode === "feedback" ? "Request changes" : mode === "publish_now" ? "Publish now" : "Record as published"}
                </button>
              </>
            ) : (
              <>
                {isEditable && <>
                  <button type="button" className="crm-button-secondary" disabled={submitDisabled} onClick={() => setMode("edit")}>Edit draft</button>
                  <button type="button" className="crm-button-primary" disabled={submitDisabled} onClick={() => void save("submit")}>Submit for review</button>
                </>}
                {canReturnToDraft && (post.status === "in_review" || post.status === "approved") && (
                  <button type="button" className="crm-button-secondary" disabled={submitDisabled} onClick={() => void save("withdraw")}>Return to draft</button>
                )}
                {canReview && post.status === "in_review" && <>
                  <button type="button" className="crm-button-secondary" disabled={submitDisabled} onClick={() => setMode("feedback")}>Request changes</button>
                  <button type="button" className="crm-button-primary" disabled={submitDisabled} onClick={() => void save("approve")}>Approve post</button>
                </>}
                {canReview && post.status === "approved" && (
                  <button type="button" className="crm-button-secondary" disabled={submitDisabled} onClick={() => setMode("publication")}>Record as published</button>
                )}
                {mayPublish && (
                  <button type="button" className="crm-button-primary" disabled={submitDisabled} onClick={() => setMode("publish_now")}>
                    {deliveries.length ? "Retry failed channels" : "Publish now"}
                  </button>
                )}
                {post.status === "published" && <button type="button" className="crm-button-secondary" onClick={onClose}>Close</button>}
              </>
            )}
          </footer>
        </form>
      )}
    </Modal>
  );
}
