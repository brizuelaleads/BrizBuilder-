import type { SocialDeliveries } from "./meta-social-core";

export const SOCIAL_CHANNELS = ["facebook", "instagram"] as const;
export const SOCIAL_STATUSES = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "published",
] as const;

export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];
export type SocialStatus = (typeof SOCIAL_STATUSES)[number];

export type SocialContent = {
  title: string;
  caption: string;
  channels: SocialChannel[];
  plannedDate: string | null;
  mediaUrl: string | null;
};

export type SocialPost = SocialContent & {
  id: string;
  status: SocialStatus;
  revision: number;
  feedback: string | null;
  publishedAt: string | null;
  deliveries: SocialDeliveries;
  publishingStartedAt: string | null;
};

export const SOCIAL_PAGE_SIZE = 25;

export type SocialPage = { posts: SocialPost[]; hasMore: boolean };

export class SocialRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function socialUuid(value: unknown, message: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) {
    throw new SocialRequestError(message);
  }
  return value.toLowerCase();
}

export function isSocialStatus(value: unknown): value is SocialStatus {
  return SOCIAL_STATUSES.some((status) => status === value);
}

function socialText(value: unknown, label: string, max: number, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if ((required && !text) || (value != null && typeof value !== "string")) {
    throw new SocialRequestError(`Enter ${label}.`);
  }
  if (text.includes("\0")) throw new SocialRequestError(`Remove invalid characters from ${label}.`);
  if (text.length > max) throw new SocialRequestError(`Limit ${label} to ${max} characters.`);
  return text;
}

function plannedDay(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) {
    const stamp = new Date(`${value}T00:00:00Z`);
    if (Number.isFinite(stamp.getTime()) && stamp.toISOString().slice(0, 10) === value) {
      return value;
    }
  }
  throw new SocialRequestError("Enter a valid planned date.");
}

function sourceMediaUrl(value: unknown) {
  const input = socialText(value, "a media link", 2000);
  if (!input) return null;

  try {
    const url = new URL(input);
    if (url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2000) {
      return url.href;
    }
  } catch {
    // Report a validation error without exposing URL parser details.
  }
  throw new SocialRequestError("Enter an HTTPS media link.");
}

function isSocialChannel(value: unknown): value is SocialChannel {
  return SOCIAL_CHANNELS.some((channel) => channel === value);
}

export function normalizeSocialContent(input: Record<string, unknown>): SocialContent {
  const channels: unknown = input.channels;
  if (!Array.isArray(channels) || !channels.length || channels.length > SOCIAL_CHANNELS.length ||
      !channels.every(isSocialChannel) || new Set(channels).size !== channels.length) {
    throw new SocialRequestError("Choose Facebook, Instagram, or both.");
  }
  return {
    title: socialText(input.title, "a working title", 120, true),
    caption: socialText(input.caption, "the caption", 2200),
    channels,
    plannedDate: plannedDay(input.plannedDate),
    mediaUrl: sourceMediaUrl(input.mediaUrl),
  };
}

export function socialTransition(action: unknown, canReview: boolean, reason: unknown) {
  switch (action) {
    case "submit":
      return { from: ["draft", "changes_requested"], status: "in_review", feedback: null } as const;
    case "withdraw":
      return { from: ["in_review", "approved"], status: "draft", feedback: null } as const;
    case "approve":
      if (!canReview) throw new SocialRequestError("Forbidden", 403);
      return { from: ["in_review"], status: "approved", feedback: null } as const;
    case "request_changes":
      if (!canReview) throw new SocialRequestError("Forbidden", 403);
      return {
        from: ["in_review"],
        status: "changes_requested",
        feedback: socialText(reason, "feedback for the author", 1000, true),
      } as const;
    case "record_published":
      if (!canReview) throw new SocialRequestError("Forbidden", 403);
      return { from: ["approved"], status: "published", feedback: null } as const;
    default:
      throw new SocialRequestError("Unknown social planner action.");
  }
}
