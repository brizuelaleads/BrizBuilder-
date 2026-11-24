"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type {
  MetaSocialWorkspace, SocialInbox, SocialInboxFilter, SocialInboxItem, SocialThread,
} from "../../lib/meta-social-core";
import { socialRead, socialWrite } from "./social-api";
import { Badge, EmptyState, Field, Modal } from "./ui";

export function SocialAccounts({ clientId, workspace, connectionError, onChange }: {
  clientId: string;
  workspace: MetaSocialWorkspace;
  connectionError: string;
  onChange: (workspace: MetaSocialWorkspace) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(connectionError);
  const [disconnect, setDisconnect] = useState<"Facebook" | "Instagram" | null>(null);
  const { account, instagramAccount } = workspace;

  async function connect(action: "meta_connect" | "instagram_connect") {
    setError("");
    setBusy(true);
    try {
      const { url } = await socialWrite<{ url: string }>({ clientId, action });
      window.location.assign(url);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not open the sign-in.");
      setBusy(false);
    }
  }

  async function save(action: "meta_select" | "meta_disconnect" | "instagram_disconnect", pageId?: FormDataEntryValue | null) {
    setBusy(true);
    setError("");
    try {
      onChange(await socialWrite<MetaSocialWorkspace>({ clientId, action, pageId }));
      setDisconnect(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update the accounts.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="crm-panel crm-social-accounts">
      <header>
        <div><h3>Connected accounts</h3><span className="crm-social-muted">Choose the accounts this business can publish to and reply from.</span></div>
      </header>
      {error && !disconnect && <p className="crm-social-message" role="alert">{error}</p>}
      <section className="crm-social-account" aria-label="Facebook connection">
        <div>
          <h4>Facebook</h4>
          <p>{account?.name ?? (workspace.configured ? "Choose a Facebook Page you manage." : "Facebook sign-in is awaiting administrator setup.")}</p>
        </div>
        {workspace.configured && workspace.canConnect && <div className="crm-social-account-actions">
          {account && <button className="crm-button-secondary" type="button" disabled={busy} onClick={() => setDisconnect("Facebook")}>Disconnect Facebook</button>}
          <button className={account ? "crm-button-secondary" : "crm-button-primary"} type="button" disabled={busy} onClick={() => void connect("meta_connect")}>
            {account ? "Reconnect Facebook" : "Connect Facebook"}
          </button>
        </div>}
      </section>
      {workspace.configured && workspace.pages.length > 0 && workspace.canConnect && (
        <form className="crm-form" onSubmit={(event) => {
          event.preventDefault();
          void save("meta_select", new FormData(event.currentTarget).get("pageId"));
        }}>
          <Field label="Facebook Page" span>
            <select name="pageId" required defaultValue={workspace.account?.id ?? ""}>
              <option value="" disabled>Choose the Page for this business</option>
              {workspace.pages.map((page) => <option key={page.id} value={page.id}>
                {page.name}{page.instagram ? ` / @${page.instagram.name}` : ""}
              </option>)}
            </select>
          </Field>
          <footer><button className="crm-button-primary" type="submit" disabled={busy}>Link Facebook Page</button></footer>
        </form>
      )}
      <section className="crm-social-account" aria-label="Instagram connection">
        <div>
          <h4>Instagram</h4>
          <p>{instagramAccount ? `@${instagramAccount.name}` : "Connect a professional Instagram account."}</p>
          {instagramAccount?.source === "facebook" && <p>Connected through Facebook.</p>}
          {instagramAccount?.needsReconnect && <p>Instagram access expired. Reconnect to resume publishing and replies.</p>}
          {!workspace.instagramConfigured && <p>Direct Instagram sign-in is awaiting administrator setup.</p>}
        </div>
        {workspace.instagramConfigured && workspace.canConnect && <div className="crm-social-account-actions">
          {instagramAccount?.source === "instagram" &&
            <button className="crm-button-secondary" type="button" disabled={busy} onClick={() => setDisconnect("Instagram")}>Disconnect Instagram login</button>}
          <button className={instagramAccount ? "crm-button-secondary" : "crm-button-primary"} type="button" disabled={busy} onClick={() => void connect("instagram_connect")}>
            {instagramAccount?.source === "instagram" ? "Reconnect Instagram" : "Connect Instagram"}
          </button>
        </div>}
      </section>
      {disconnect && <Modal title={`Disconnect ${disconnect}?`} onClose={() => { if (!busy) setDisconnect(null); }}>
        <div className="crm-form">
          <p className="crm-field-span">{disconnect === "Facebook"
            ? instagramAccount?.source === "facebook"
              ? "This removes access to the Page and the Instagram account linked through it."
              : "This removes BrizBuilder’s saved access to the Facebook Page."
            : account?.instagram
              ? "This removes the direct sign-in. Instagram will use the account linked to your Facebook Page."
              : "This removes BrizBuilder’s saved access to Instagram."}</p>
          {error && <p className="crm-field-span" role="alert">{error}</p>}
          <footer>
            <button className="crm-button-secondary" type="button" disabled={busy} onClick={() => setDisconnect(null)}>Cancel</button>
            <button className="crm-button-primary" type="button" disabled={busy} onClick={() => void save(disconnect === "Facebook" ? "meta_disconnect" : "instagram_disconnect")}>
              Disconnect {disconnect}
            </button>
          </footer>
        </div>
      </Modal>}
    </section>
  );
}

function readableTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) : "";
}

export function SocialInboxView({ clientId, connected, onAccounts }: {
  clientId: string;
  connected: boolean;
  onAccounts: () => void;
}) {
  const [kind, setKind] = useState<SocialInboxFilter>("all");
  const [selected, setSelected] = useState<SocialInboxItem | null>(null);
  const [reload, setReload] = useState(0);
  const [pages, setPages] = useState<string[]>([]);
  const after = pages.at(-1);
  const [result, setResult] = useState<{ key: string; data?: SocialInbox; error?: string }>();
  const key = `${kind}/${reload}/${after ?? ""}`;
  const current = result?.key === key ? result : null;

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    void socialRead<SocialInbox>({ clientId, view: "inbox", kind, ...(after ? { after } : {}) }, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setResult({ key, data }); })
      .catch((error: Error) => { if (!controller.signal.aborted) setResult({ key, error: error.message }); });
    return () => controller.abort();
  }, [after, clientId, connected, kind, key]);

  if (!connected) {
    return <EmptyState title="Connect a social account to open the inbox"
      description="Read and reply to messages and comments from this business’s Facebook and Instagram accounts."
      action={<button className="crm-button-secondary" type="button" onClick={onAccounts}>View accounts</button>} />;
  }

  return (
    <section className="crm-panel crm-social-inbox">
      <header>
        <div><h3>Social inbox</h3><span className="crm-social-muted">Recent activity from connected accounts</span></div>
        <button className="crm-button-secondary" type="button" onClick={() => {
          setSelected(null);
          setPages([]);
          setReload((value) => value + 1);
        }}><RefreshCw size={15} aria-hidden="true" /> Refresh inbox</button>
      </header>
      <div className="crm-social-inbox-filters">
        <nav className="crm-tabs" aria-label="Inbox filters">
          {(["all", "dm", "comment"] as const).map((filter) => (
            <button key={filter} type="button" aria-pressed={kind === filter} className={kind === filter ? "active" : ""} onClick={() => {
              setSelected(null); setPages([]); setKind(filter);
            }}>{filter === "all" ? "All activity" : filter === "dm" ? "DMs" : "Comments"}</button>
          ))}
        </nav>
      </div>
      {current?.error && <p className="crm-social-message" role="alert">{current.error}</p>}
      {current?.data?.errors.map((message) => <p key={message} className="crm-social-inbox-warning" role="status">{message}</p>)}
      <div className={`crm-social-inbox-body${selected ? " has-thread" : ""}`}>
        <div className="crm-social-inbox-list">
          {!current && <p className="crm-social-message" role="status">Loading inbox…</p>}
          {current?.data && current.data.items.length === 0 && (
            <p className="crm-social-message">{current.data.errors.length
              ? "No activity loaded. Check the connection and refresh."
              : "No activity on this page."}</p>
          )}
          {current?.data?.items.map((item) => (
            <button type="button" className="crm-social-inbox-row" key={item.ref}
              aria-pressed={selected?.ref === item.ref} onClick={() => setSelected(item)}>
              <strong>{item.name}</strong>
              <Badge tone={item.channel === "facebook" ? "blue" : "purple"}>{item.channel === "facebook" ? "Facebook" : "Instagram"}</Badge>
              <span>{item.text}</span>
              <small>{item.kind === "dm" ? "DM" : "Comment"} {readableTime(item.date)}</small>
            </button>
          ))}
        </div>
        {selected ? (
          <SocialThreadView key={selected.ref} item={selected} clientId={clientId} onBack={() => setSelected(null)} />
        ) : (
          <p className="crm-social-message crm-social-inbox-prompt">Select a message or comment to reply.</p>
        )}
      </div>
      {current && (pages.length > 0 || current.data?.next) && (
        <div className="crm-social-pagination">
          <button className="crm-button-secondary" type="button" disabled={pages.length === 0} onClick={() => {
            setSelected(null); setPages((stack) => stack.slice(0, -1));
          }}>Newer</button>
          <button className="crm-button-secondary" type="button" disabled={!current.data?.next} onClick={() => {
            const next = current.data?.next;
            if (next) { setSelected(null); setPages((stack) => [...stack, next]); }
          }}>Older</button>
        </div>
      )}
    </section>
  );
}

function SocialThreadView({ item, clientId, onBack }: { item: SocialInboxItem; clientId: string; onBack: () => void }) {
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ data?: SocialThread; error?: string }>();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyStatus, setReplyStatus] = useState<{ text: string; error?: boolean }>();

  useEffect(() => {
    const controller = new AbortController();
    void socialRead<SocialThread>({ clientId, view: "thread", ref: item.ref }, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setResult({ data }); })
      .catch((error: Error) => { if (!controller.signal.aborted) setResult({ error: error.message }); });
    return () => controller.abort();
  }, [clientId, item.ref, reload]);

  async function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setReplyStatus(undefined);
    try {
      await socialWrite({ clientId, action: "social_reply", ref: item.ref, text });
      setText("");
      setReplyStatus({ text: "Reply sent." });
      setReload((value) => value + 1);
    } catch (error) {
      setReplyStatus({ text: error instanceof Error ? error.message : "The reply could not be sent.", error: true });
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="crm-social-thread" aria-label={`Conversation with ${item.name}`}>
      <header>
        <button className="crm-button-secondary" type="button" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Back</button>
        <h4>{item.name}</h4>
      </header>
      <div className="crm-social-thread-content" aria-live="polite">
        {!result && <p>Loading conversation…</p>}
        {result?.error && <p role="alert">{result.error}</p>}
        {result?.data?.entries.map((entry) => (
          <article className={entry.outgoing ? "outgoing" : ""} key={entry.id}>
            <small>{entry.name} {readableTime(entry.date)}</small>
            <p>{entry.text}</p>
          </article>
        ))}
      </div>
      {result?.data?.canReply ? (
        <form className="crm-social-reply" onSubmit={(event) => void reply(event)}>
          <Field label={item.kind === "comment" ? "Public reply" : "Direct reply"}>
            <textarea rows={2} required maxLength={1000} value={text} disabled={sending} onChange={(event) => setText(event.target.value)} />
          </Field>
          {replyStatus && <p role={replyStatus.error ? "alert" : "status"}>{replyStatus.text}</p>}
          <button className="crm-button-primary" type="submit" disabled={sending || !text.trim()}>
            {sending ? "Sending…" : "Send reply"}
          </button>
        </form>
      ) : result?.data && (
        <p className="crm-social-message">{item.kind === "dm" ? "Meta’s standard reply window has closed." : "This comment can’t be replied to from BrizBuilder."}{" "}
          <a href="https://business.facebook.com/latest/inbox" target="_blank" rel="noreferrer">Open Meta Business Suite</a>
        </p>
      )}
    </section>
  );
}
