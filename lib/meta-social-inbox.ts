import { SignJWT, jwtVerify } from "jose";
import { readRuntimeValue } from "./supabase/env";
import {
  metaSocialId, metaSocialRequest, MetaSocialError, type MetaAccountAccess,
} from "./meta-social";
import {
  canReplyToMetaMessage, type SocialInbox, type SocialInboxEntry, type SocialInboxItem, type SocialInboxKind,
  type SocialThread,
} from "./meta-social-core";
import { SocialRequestError, type SocialChannel } from "./social-core";

type Access = MetaAccountAccess & { connectionId: string };
type Person = { id?: string; name?: string; username?: string };
type Data<T> = { data?: T[]; paging?: { next?: string; cursors?: { after?: string } } };
type Message = { id: string; created_time?: string; message?: string; from?: Person; attachments?: Data<object> };
type Conversation = { id: string; updated_time?: string; participants?: Data<Person>; messages?: Data<Message> };
type Comment = {
  id: string; created_time?: string; timestamp?: string; message?: string; text?: string;
  from?: Person; username?: string; is_hidden?: boolean; hidden?: boolean;
};
type Ref = {
  kind: SocialInboxKind;
  channel: SocialChannel;
  id: string;
  peer?: string;
};

function refContext(access: Access) {
  return new TextEncoder().encode(`brizbuilder:social-inbox:${readRuntimeValue("META_SOCIAL_APP_SECRET")}:${access.connectionId}`);
}

function issueRef(access: Access, ref: Ref) {
  return new SignJWT({ kind: ref.kind, channel: ref.channel, id: ref.id, peer: ref.peer })
    .setProtectedHeader({ alg: "HS256" }).setAudience("brizbuilder-social-inbox")
    .setSubject(access.connectionId).setIssuedAt().setExpirationTime("30m").sign(refContext(access));
}

async function verifyRef(access: Access, ref: unknown): Promise<Ref> {
  if (typeof ref === "string" && ref.length < 1500) {
    try {
      const { payload } = await jwtVerify(ref, refContext(access), {
        algorithms: ["HS256"], audience: "brizbuilder-social-inbox", subject: access.connectionId,
      });
      const { kind, channel, id, peer } = payload;
      if ((channel === "facebook" || channel === "instagram") && typeof id === "string" &&
          (kind === "comment" || (kind === "dm" && metaSocialId(peer)))) {
        return { kind, channel, id, peer: typeof peer === "string" ? peer : undefined };
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

async function listDirectMessages(access: Access, channel: SocialChannel, after?: string) {
  const data = await metaSocialRequest<Data<Conversation>>(`${access.pageId}/conversations`, access.pageToken, {
    platform: channel === "instagram" ? "instagram" : "messenger",
    fields: "id,updated_time,participants,messages.limit(1){message,created_time}",
    limit: "25",
    ...(after ? { after } : {}),
  });
  const ownId = channel === "instagram" ? access.instagramId : access.pageId;

  const items = await Promise.all((data.data ?? []).flatMap((thread) => {
    const participants = thread.participants?.data ?? [];
    // Skip group/unknown conversations to keep a one-to-one reply address.
    if (participants.length !== 2 || !participants.some(({ id }) => id === ownId)) return [];
    const customer = participants.find(({ id }) => id !== ownId);
    if (!metaSocialId(customer?.id)) return [];
    const preview = thread.messages?.data?.[0];
    return [issueRef(access, { kind: "dm", channel, id: thread.id, peer: customer.id }).then((ref): SocialInboxItem => ({
      ref, channel, kind: "dm", name: displayName(customer),
      text: preview?.message || "Direct message", date: thread.updated_time || preview?.created_time || "",
    }))];
  }));
  return { items, after: data.paging?.next ? data.paging.cursors?.after : undefined };
}

async function listComments(access: Access, channel: SocialChannel, after?: string) {
  const isInstagram = channel === "instagram";
  const ownId = isInstagram ? access.instagramId : access.pageId;
  if (!ownId) return { items: [] };
  const data = await metaSocialRequest<Data<{ comments?: Data<Comment> }>>(
    isInstagram ? `${ownId}/media` : `${ownId}/published_posts`,
    isInstagram ? access.userToken : access.pageToken,
    {
      fields: `id,comments.limit(20){${commentFields[channel]}}`, limit: "12",
      ...(after ? { after } : {}),
    },
  );
  const comments = (data.data ?? []).flatMap(({ comments }) => comments?.data ?? []);
  const items = await Promise.all(comments
    .filter((comment) => comment.from?.id !== ownId && !comment.hidden && !comment.is_hidden)
    .map(async (comment): Promise<SocialInboxItem> => ({
      ref: await issueRef(access, { kind: "comment", channel, id: comment.id }),
      channel, kind: "comment", name: displayName(comment.from, comment.username),
      text: comment.text || comment.message || "Comment with media", date: comment.timestamp || comment.created_time || "",
    })));
  return { items, after: data.paging?.next ? data.paging.cursors?.after : undefined };
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

export async function loadSocialInbox(access: Access, kind: unknown, after: string | null): Promise<SocialInbox> {
  if (kind !== "all" && kind !== "dm" && kind !== "comment") throw new SocialRequestError("Choose an inbox filter.");
  const cursors = inboxCursors(after);
  const channels: SocialChannel[] = access.instagramId ? ["facebook", "instagram"] : ["facebook"];
  const kinds: SocialInboxKind[] = kind === "all" ? ["dm", "comment"] : [kind];
  const feeds = channels.flatMap((channel) => kinds.map((source) => ({
    channel, source, key: `${channel}:${source}`,
  }))).filter(({ key }) => !cursors || Boolean(cursors[key]));
  const results = await Promise.allSettled(feeds.map(({ channel, source, key }) =>
    source === "dm" ? listDirectMessages(access, channel, cursors?.[key]) : listComments(access, channel, cursors?.[key]),
  ));
  const items: SocialInboxItem[] = [];
  const errors: string[] = [];
  const next: Record<string, string> = {};
  results.forEach((result, index) => {
    const { channel, source, key } = feeds[index];
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

async function loadDirectThread(access: Access, ref: Ref): Promise<SocialThread> {
  const { data } = await metaSocialRequest<Data<Message>>(`${ref.id}/messages`, access.pageToken, {
    fields: "id,from,message,created_time,attachments.limit(1){id}",
    limit: ref.channel === "instagram" ? "20" : "50",
  });
  const ownId = ref.channel === "instagram" ? access.instagramId : access.pageId;
  let lastReceivedAt = "";
  const entries = (data ?? []).flatMap((message): SocialInboxEntry[] => {
    const sender = message.from?.id;
    if (!sender || (sender !== ownId && sender !== ref.peer)) return [];
    const date = message.created_time || "";
    if (sender === ref.peer && Date.parse(date) > (Date.parse(lastReceivedAt) || 0)) lastReceivedAt = date;
    return [{
      id: message.id, name: displayName(message.from, sender === ownId ? "Business" : "Customer"),
      text: message.message || (message.attachments?.data?.length ? "Attachment. Open in Meta to view." : "Message"),
      date, outgoing: sender === ownId,
    }];
  });
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return { entries, canReply: canReplyToMetaMessage(lastReceivedAt) };
}

export async function loadSocialThread(access: Access, value: unknown): Promise<SocialThread> {
  const ref = await verifyRef(access, value);
  if (ref.kind === "dm") return loadDirectThread(access, ref);
  const isInstagram = ref.channel === "instagram";
  const token = isInstagram ? access.userToken : access.pageToken;
  const ownId = isInstagram ? access.instagramId : access.pageId;
  const [root, replies] = await Promise.all([
    metaSocialRequest<Comment>(ref.id, token, { fields: commentFields[ref.channel] }),
    metaSocialRequest<Data<Comment>>(`${ref.id}/${isInstagram ? "replies" : "comments"}`, token, {
      fields: commentFields[ref.channel], limit: "25",
    }),
  ]);
  return {
    entries: [root, ...(replies.data ?? [])].map((comment) => ({
      id: comment.id,
      name: displayName(comment.from, comment.username),
      text: comment.text || comment.message || "Comment with media",
      date: comment.timestamp || comment.created_time || "",
      outgoing: comment.from?.id === ownId,
    })),
    canReply: !root.hidden && !root.is_hidden,
  };
}

export async function replySocialThread(access: Access, value: unknown, message: unknown) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || text.length > 1000 || text.includes("\0")) {
    throw new SocialRequestError("Enter a reply of up to 1,000 characters.");
  }
  const ref = await verifyRef(access, value);
  if (ref.kind === "dm") {
    const thread = await loadDirectThread(access, ref);
    if (!thread.canReply) {
      throw new SocialRequestError("Meta's standard reply window has closed. Open Meta Business Suite to check your reply options.");
    }
    const response = await metaSocialRequest<{ message_id?: string }>(`${access.pageId}/messages`, access.pageToken, {}, {
      recipient: { id: ref.peer }, message: { text },
      ...(ref.channel === "facebook" ? { messaging_type: "RESPONSE" } : {}),
    });
    if (!response.message_id) throw new MetaSocialError("Meta did not confirm the reply. Refresh the inbox before retrying.", true);
    return;
  }
  const isInstagram = ref.channel === "instagram";
  const response = await metaSocialRequest<{ id?: string }>(
    `${ref.id}/${isInstagram ? "replies" : "comments"}`,
    isInstagram ? access.userToken : access.pageToken, {}, { message: text },
  );
  if (!response.id) throw new MetaSocialError("Meta did not confirm the reply. Refresh the inbox before retrying.", true);
}
