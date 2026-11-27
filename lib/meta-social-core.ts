import type { SocialChannel } from "./social-core";

export type MetaPage = {
  id: string;
  name: string;
  instagram: { id: string; name: string } | null;
};

export type MetaSocialWorkspace = {
  configured: boolean;
  canConnect: boolean;
  account: MetaPage | null;
  pages: MetaPage[];
  instagramConfigured: boolean;
  instagramAccount: { id: string; name: string; source: "facebook" | "instagram"; needsReconnect?: boolean } | null;
};

export type SocialDelivery = {
  status: "sending" | "sent" | "failed" | "unknown";
  detail: string;
  remoteId?: string;
  destination?: string;
};
export type SocialDeliveries = Partial<Record<SocialChannel, SocialDelivery>>;

export type SocialProviderAccount = {
  channel: SocialChannel;
  id: string;
  connectionId: string;
  login: "facebook" | "instagram";
  appUserId?: string;
  token: string;
  messagingId: string;
  messagingToken: string;
};

export type SocialAccountAccess = {
  accounts: Partial<Record<SocialChannel, SocialProviderAccount>>;
  errors: Partial<Record<SocialChannel, string>>;
};

export function socialDestination(account: Pick<SocialProviderAccount, "connectionId" | "id" | "login">) {
  return `${account.login}:${account.connectionId}:${account.id}`;
}

export type SocialInboxKind = "dm" | "comment";
export type SocialInboxFilter = SocialInboxKind | "all";

export type SocialInboxItem = {
  ref: string;
  channel: SocialChannel;
  kind: SocialInboxKind;
  name: string;
  text: string;
  date: string;
};

export type SocialInbox = {
  items: SocialInboxItem[];
  errors: string[];
  next: string | null;
};

export type SocialPublishedPost = {
  id: string;
  channel: "instagram";
  caption: string;
  mediaType: string;
  imageUrl: string | null;
  permalink: string | null;
  date: string;
  commentCount: number | null;
};

export type SocialPublishedProfile = {
  username: string;
  name: string;
  biography: string;
  website: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
};

export type SocialPublishedPage = {
  items: SocialPublishedPost[];
  stories: SocialPublishedPost[];
  tagged: SocialPublishedPost[];
  profile: SocialPublishedProfile | null;
  errors: string[];
};

export type SocialInboxEntry = {
  id: string;
  name: string;
  text: string;
  date: string;
  outgoing: boolean;
};

export type SocialThread = {
  entries: SocialInboxEntry[];
  canReply: boolean;
};

export function canReplyToMetaMessage(lastReceivedAt: string, now = Date.now()) {
  const timestamp = Date.parse(lastReceivedAt);
  return Number.isFinite(timestamp) && now >= timestamp && now - timestamp < 24 * 60 * 60 * 1000;
}

export async function firstNonEmptySocialPage<T>(
  load: (after?: string) => Promise<{ items: T[]; after?: string }>,
  after?: string,
  maxEmptyPages = 3,
) {
  let cursor = after;
  let page = await load(cursor);
  for (let skipped = 0; !page.items.length && page.after && page.after !== cursor && skipped < maxEmptyPages; skipped += 1) {
    cursor = page.after;
    page = await load(cursor);
  }
  return page;
}

export function metaPostContentError(channel: SocialChannel, caption: string, mediaUrl: string | null) {
  if (channel === "instagram" && !mediaUrl) {
    return "Add a public JPEG image link to publish on Instagram.";
  }
  if (!caption && !mediaUrl) return "Add a caption or an image link.";
  return null;
}
