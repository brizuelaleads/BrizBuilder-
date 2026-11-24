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
};

export type SocialDelivery = {
  status: "sending" | "sent" | "failed" | "unknown";
  detail: string;
  remoteId?: string;
};
export type SocialDeliveries = Partial<Record<SocialChannel, SocialDelivery>>;

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

export function metaPostContentError(channel: SocialChannel, caption: string, mediaUrl: string | null) {
  if (channel === "instagram" && !mediaUrl) {
    return "Add a public JPEG image link to publish on Instagram.";
  }
  if (!caption && !mediaUrl) return "Add a caption or an image link.";
  return null;
}
