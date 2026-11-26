import { SignJWT, decodeJwt, jwtVerify } from "jose";
import { readRuntimeValue } from "./supabase/env";
import {
  metaSocialId, socialAccountRequest, MetaSocialError,
} from "./meta-social";
import {
  canReplyToMetaMessage, firstNonEmptySocialPage, socialDestination, type SocialInbox, type SocialInboxEntry,
  type SocialInboxItem, type SocialInboxKind, type SocialPublishedPage, type SocialPublishedPost, type SocialThread,
  type SocialAccountAccess, type SocialProviderAccount,
} from "./meta-social-core";
import { SocialRequestError, type SocialChannel } from "./social-core";

type Person = { id?: string; name?: string; username?: string };
type Data<T> = { data?: T[]; paging?: { next?: string; cursors?: { after?: string } } };
type Message = { id: string; created_time?: string; message?: string; from?: Person; to?: Data<Person>; attachments?: Data<object> };
type Conversation = { id: string; updated_time?: string; participants?: Data<Person>; messages?: Data<Message> };
type Comment = {
  id: string; created_time?: string; timestamp?: string; message?: string; text?: string;
  from?: Person; username?: string; is_hidden?: boolean; hidden?: boolean;
};
type PublishedMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  comments_count?: number;
};
type Ref = {
  kind: SocialInboxKind;
  channel: SocialChannel;
  id: string;
  peer?: string;
};

function refContext(access: SocialProviderAccount) {
  const secret = readRuntimeValue(access.login === "instagram" ? "META_SOCIAL_INSTAGRAM_APP_SECRET" : "META_SOCIAL_APP_SECRET");
  return new TextEncoder().encode(`brizbuilder:social-inbox:${secret}:${socialDestination(access)}`);
}

function issueRef(access: SocialProviderAccount, ref: Ref) {
  return new SignJWT({ kind: ref.kind, channel: ref.channel, id: ref.id, peer: ref.peer })
    .setProtectedHeader({ alg: "HS256" }).setAudience("brizbuilder-social-inbox")
    .setSubject(socialDestination(access)).setIssuedAt().setExpirationTime("30m").sign(refContext(access));
}

async function verifyRef(access: SocialAccountAccess, ref: unknown): Promise<{ target: SocialProviderAccount; ref: Ref }> {
  if (typeof ref === "string" && ref.length < 1500) {
    try {
      const { sub, channel } = decodeJwt(ref);
      const target = channel === "facebook" || channel === "instagram" ? access.accounts[channel] : null;
      if (target && sub === socialDestination(target)) {
        const { payload } = await jwtVerify(ref, refContext(target), {
          algorithms: ["HS256"], audience: "brizbuilder-social-inbox", subject: sub,
        });
        const { kind, id, peer } = payload;
        if (typeof id === "string" && (kind === "comment" ||
            (kind === "dm" && (metaSocialId(peer) || target.login === "instagram")))) {
          return { target, ref: { kind, channel: target.channel, id, peer: metaSocialId(peer) ? peer : undefined } };
        }
      }
    } catch {
      // Old references are replaced by the next inbox refresh.
    }
  }
  throw new SocialRequestError("Refresh the inbox and open the conversation again.", 409);
}

function displayName(person?: Person, fallback = "Customer") {
  return person?.name || person?.username || fallback;
}

const commentFields = {
  facebook: "id,message,from{id,name},created_time,is_hidden",
  instagram: "id,text,from{id,username},timestamp,hidden",
};

function isOwnId(access: SocialProviderAccount, id: string | undefined) {
  return Boolean(id && (id === access.id || id === access.appUserId));
}

async function listDirectMessages(access: SocialProviderAccount, after?: string) {
  const { channel } = access;
  const endpoint = `${access.messagingId}/conversations`;
  // Instagram Login documents the conversation list as an ID/time lookup. Expanded
  // participants or messages can make Meta return an empty page without an error.
  // Resolve message details only after the user opens a conversation.
  const query = access.login === "instagram" ? {
    platform: "instagram", limit: "25", ...(after ? { after } : {}),
  } : {
    platform: channel === "instagram" ? "instagram" : "messenger",
    fields: "id,updated_time,participants,messages.limit(1){message,created_time}",
    limit: "25", ...(after ? { after } : {}),
  };
  const data = await socialAccountRequest<Data<Conversation>>(access, endpoint, access.messagingToken, query);

  const items = await Promise.all((data.data ?? []).flatMap((thread) => {
    const participants = thread.participants?.data ?? [];
    if (participants.length > 2) return [];
    const customer = participants.length === 2 && participants.some(({ id }) => isOwnId(access, id))
      ? participants.find(({ id }) => !isOwnId(access, id))
      : undefined;
    const peer = metaSocialId(customer?.id) ? customer.id : undefined;
    if (!peer && access.login !== "instagram") return [];
    const preview = thread.messages?.data?.[0];
    return [issueRef(access, { kind: "dm", channel, id: thread.id, peer }).then((ref): SocialInboxItem => ({
      ref, channel, kind: "dm", name: displayName(customer, "Instagram conversation"),
      text: preview?.message || "Direct message", date: thread.updated_time || preview?.created_time || "",
    }))];
  }));
  return { items, after: data.paging?.next ? data.paging.cursors?.after : undefined };
}

async function listComments(access: SocialProviderAccount, after?: string) {
  const { channel } = access;
  const isInstagram = channel === "instagram";
  let comments: Comment[];
  let next: string | undefined;
  if (isInstagram) {
    const media = await socialAccountRequest<Data<{ id: string }>>(
      access, `${access.id}/media`, access.token,
      { fields: "id", limit: "12", ...(after ? { after } : {}) },
    );
    const pages: Data<Comment>[] = [];
    const posts = media.data ?? [];
    // Meta documents comments as a direct media edge. Keep concurrency bounded to
    // avoid a burst for accounts with a full page of recent posts.
    for (let offset = 0; offset < posts.length; offset += 4) {
      pages.push(...await Promise.all(posts.slice(offset, offset + 4).map(({ id }) =>
        socialAccountRequest<Data<Comment>>(access, `${id}/comments`, access.token, {
          fields: commentFields.instagram, limit: "20",
        }))));
    }
    comments = pages.flatMap((page) => page.data ?? []);
    next = media.paging?.next ? media.paging.cursors?.after : undefined;
  } else {
    const data = await socialAccountRequest<Data<{ comments?: Data<Comment> }>>(
      access, `${access.id}/published_posts`, access.token,
      {
        fields: `id,comments.limit(20){${commentFields.facebook}}`, limit: "12",
        ...(after ? { after } : {}),
      },
    );
    comments = (data.data ?? []).flatMap(({ comments: page }) => page?.data ?? []);
    next = data.paging?.next ? data.paging.cursors?.after : undefined;
  }
  const items = await Promise.all(comments
    .filter((comment) => !isOwnId(access, comment.from?.id) && !comment.hidden && !comment.is_hidden)
    .map(async (comment): Promise<SocialInboxItem> => ({
      ref: await issueRef(access, { kind: "comment", channel, id: comment.id }),
      channel, kind: "comment", name: displayName(comment.from, comment.username),
      text: comment.text || comment.message || "Comment with media", date: comment.timestamp || comment.created_time || "",
    })));
  return { items, after: next };
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function loadPublishedSocialPosts(access: SocialAccountAccess): Promise<SocialPublishedPage> {
  const errors = Object.values(access.errors);
  const account = access.accounts.instagram;
  if (!account) return { items: [], errors };
  try {
    const data = await socialAccountRequest<Data<PublishedMedia>>(account, `${account.id}/media`, account.token, {
      fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count",
      limit: "25",
    });
    const items: SocialPublishedPost[] = (data.data ?? []).map((post) => ({
      id: post.id,
      channel: "instagram",
      caption: post.caption?.trim() ?? "",
      mediaType: post.media_type || "POST",
      imageUrl: safeHttpsUrl(post.thumbnail_url) ?? safeHttpsUrl(post.media_url),
      permalink: safeHttpsUrl(post.permalink),
      date: post.timestamp || "",
      commentCount: Number.isSafeInteger(post.comments_count) && (post.comments_count ?? -1) >= 0
        ? post.comments_count ?? null : null,
    }));
    return { items, errors };
  } catch (error) {
    const message = error instanceof SocialRequestError ? error.message : "Could not load this channel.";
    return { items: [], errors: [...errors, `Instagram posts: ${message}`] };
  }
}

function inboxCursors(value: string | null) {
  if (!value) return null;
  try {
    const parsed: unknown = value.length <= 4500 ? JSON.parse(value) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed);
      if (entries.length && entries.every(([key, cursor]) =>
        /^(facebook|instagram):(dm|comment)$/.test(key) && typeof cursor === "string" && cursor.length <= 1000,
      )) return Object.fromEntries(entries) as Record<string, string>;
    }
  } catch {
    // A cursor is only meaningful for the page that issued it.
  }
  throw new SocialRequestError("Refresh the inbox to continue.");
}

export async function loadSocialInbox(access: SocialAccountAccess, kind: unknown, after: string | null): Promise<SocialInbox> {
  if (kind !== "all" && kind !== "dm" && kind !== "comment") throw new SocialRequestError("Choose an inbox filter.");
  const cursors = inboxCursors(after);
  const accounts = Object.values(access.accounts);
  const kinds: SocialInboxKind[] = kind === "all" ? ["dm", "comment"] : [kind];
  const feeds = accounts.flatMap((account) => kinds.map((source) => ({
    account, source, key: `${account.channel}:${source}`,
  }))).filter(({ key }) => !cursors || Boolean(cursors[key]));
  const results = await Promise.allSettled(feeds.map(({ account, source, key }) =>
    firstNonEmptySocialPage(
      (cursor) => source === "dm" ? listDirectMessages(account, cursor) : listComments(account, cursor),
      cursors?.[key],
    ),
  ));
  const items: SocialInboxItem[] = [];
  const errors: string[] = Object.values(access.errors);
  const next: Record<string, string> = {};
  results.forEach((result, index) => {
    const { account: { channel }, source, key } = feeds[index];
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
      if (result.value.after && result.value.after.length <= 1000) next[key] = result.value.after;
    }
    else {
      const network = channel === "facebook" ? "Facebook" : "Instagram";
      const message = result.reason instanceof SocialRequestError ? result.reason.message : "Could not load this channel.";
      errors.push(`${network} ${source === "dm" ? "messages" : "comments"}: ${message}`);
    }
  });
  items.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  return { items, errors, next: Object.keys(next).length ? JSON.stringify(next) : null };
}

async function directInstagramMessages(access: SocialProviderAccount, id: string) {
  const account = access.messagingToken;
  const fields = "id,from,to,message,created_time";
  let result: { messages?: Data<Message> };
  try {
    result = await socialAccountRequest(access, id, account, { fields: `messages.limit(20){${fields}}` });
  } catch (error) {
    if (!(error instanceof MetaSocialError) || error.uncertain) throw error;
    result = await socialAccountRequest(access, id, account, { fields: "messages" });
  }
  const messages = (result.messages?.data ?? []).slice(0, 20);
  const entries: Message[] = [];
  for (let offset = 0; offset < messages.length; offset += 5) {
    const batch = await Promise.all(messages.slice(offset, offset + 5).map((message) => message.from && message.to
      ? Promise.resolve(message) : socialAccountRequest<Message>(access, message.id, account, { fields })));
    entries.push(...batch);
  }
  return entries;
}

async function loadDirectThread(access: SocialProviderAccount, ref: Ref): Promise<SocialThread & { recipient: string | null }> {
  const data = access.login === "instagram"
    ? await directInstagramMessages(access, ref.id)
    : (await socialAccountRequest<Data<Message>>(access, `${ref.id}/messages`, access.messagingToken, {
      fields: "id,from,message,created_time,attachments.limit(1){id}", limit: ref.channel === "instagram" ? "20" : "50",
    })).data ?? [];

  const peers = new Set(data.flatMap((message) => {
    const sender = message.from?.id;
    const recipients = message.to?.data ?? [];
    if (isOwnId(access, sender)) return recipients.map(({ id }) => id).filter(metaSocialId);
    return metaSocialId(sender) && recipients.some(({ id }) => isOwnId(access, id)) ? [sender] : [];
  }));
  const discovered = peers.size === 1 ? [...peers][0] : null;
  const recipient = ref.peer ?? discovered;
  let lastReceivedAt = "";
  const entries = (data ?? []).flatMap((message): SocialInboxEntry[] => {
    const sender = message.from?.id;
    const outgoing = isOwnId(access, sender);
    if (!sender || (!outgoing && sender !== recipient)) return [];
    const date = message.created_time || "";
    if (!outgoing && sender === recipient && Date.parse(date) > (Date.parse(lastReceivedAt) || 0)) lastReceivedAt = date;
    return [{
      id: message.id, name: displayName(message.from, outgoing ? "Business" : "Customer"),
      text: message.message || (message.attachments?.data?.length ? "Attachment. Open in Meta to view." : "Message"),
      date, outgoing,
    }];
  });
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return { entries, recipient, canReply: Boolean(recipient) && (access.login !== "instagram" || peers.size <= 1) && canReplyToMetaMessage(lastReceivedAt) };
}

export async function loadSocialThread(access: SocialAccountAccess, value: unknown): Promise<SocialThread> {
  const { target, ref } = await verifyRef(access, value);
  if (ref.kind === "dm") {
    const { entries, canReply } = await loadDirectThread(target, ref);
    return { entries, canReply };
  }
  const isInstagram = ref.channel === "instagram";
  const token = target.token;
  const [root, replies] = await Promise.all([
    socialAccountRequest<Comment>(target, ref.id, token, { fields: commentFields[ref.channel] }),
    socialAccountRequest<Data<Comment>>(target, `${ref.id}/${isInstagram ? "replies" : "comments"}`, token, {
      fields: commentFields[ref.channel], limit: "25",
    }),
  ]);
  return {
    entries: [root, ...(replies.data ?? [])].map((comment) => ({
      id: comment.id,
      name: displayName(comment.from, comment.username),
      text: comment.text || comment.message || "Comment with media",
      date: comment.timestamp || comment.created_time || "",
      outgoing: isOwnId(target, comment.from?.id),
    })),
    canReply: !root.hidden && !root.is_hidden,
  };
}

export async function replySocialThread(access: SocialAccountAccess, value: unknown, message: unknown) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || text.length > 1000 || text.includes("\0")) {
    throw new SocialRequestError("Enter a reply of up to 1,000 characters.");
  }
  const { target, ref } = await verifyRef(access, value);
  if (ref.kind === "dm") {
    const thread = await loadDirectThread(target, ref);
    if (!thread.canReply || !thread.recipient) {
      throw new SocialRequestError("Meta's standard reply window has closed. Open Meta Business Suite to check your reply options.");
    }
    const response = await socialAccountRequest<{ message_id?: string }>(target, `${target.messagingId}/messages`, target.messagingToken, {}, {
      recipient: { id: thread.recipient }, message: { text },
      ...(ref.channel === "facebook" ? { messaging_type: "RESPONSE" } : {}),
    });
    if (!response.message_id) throw new MetaSocialError("Meta did not confirm the reply. Refresh the inbox before retrying.", true);
    return;
  }
  const isInstagram = ref.channel === "instagram";
  const response = await socialAccountRequest<{ id?: string }>(
    target, `${ref.id}/${isInstagram ? "replies" : "comments"}`,
    target.token, {}, { message: text },
  );
  if (!response.id) throw new MetaSocialError("Meta did not confirm the reply. Refresh the inbox before retrying.", true);
}
