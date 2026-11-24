import type { ChatGPTUser } from "../app/chatgpt-auth";
import {
  SOCIAL_PAGE_SIZE,
  SocialRequestError,
  isSocialStatus,
  normalizeSocialContent,
  socialTransition,
  socialUuid,
  type SocialChannel,
  type SocialPage,
  type SocialPost,
} from "../lib/social-core";
import type { SocialDeliveries } from "../lib/meta-social-core";
import { getSupabaseAdminClient } from "../lib/supabase/server";
import {
  getSupabaseTenantContext,
  requireSupabaseClientAccess,
  supabaseRoleHasPermission,
} from "./supabase-crm";

export async function authorizeSocial(user: ChatGPTUser, client: unknown) {
  const clientId = socialUuid(client, "Choose a client business.");
  const context = await getSupabaseTenantContext(user);
  if (!supabaseRoleHasPermission(context, "social.plan")) {
    throw new SocialRequestError("Forbidden", 403);
  }
  await requireSupabaseClientAccess(context, clientId);
  return { clientId, context };
}

const PLANNER_COLUMNS =
  "id,title,caption,channels,planned_date,media_url,status,revision,review_feedback,published_at";
export const POST_COLUMNS = `${PLANNER_COLUMNS},delivery_results,publishing_started_at`;

let deliveryColumnsConfirmed = false;

async function socialPostColumns() {
  if (!deliveryColumnsConfirmed) {
    const { error } = await getSupabaseAdminClient().from("social_posts")
      .select("delivery_results,publishing_started_at,delivery_account_id").limit(0);
    if (error?.code === "42703" && /\b(delivery_results|publishing_started_at|delivery_account_id)\b/.test(error.message)) {
      // A code release may reach the Worker ahead of the new Meta migration.
      // Leave the original planner usable and recheck on the next request.
      return PLANNER_COLUMNS;
    }
    if (error) throw error;
    deliveryColumnsConfirmed = true;
  }
  return POST_COLUMNS;
}

export type PostRow = {
  id: string;
  title: string;
  caption: string;
  channels: SocialChannel[];
  planned_date: string | null;
  media_url: string | null;
  status: SocialPost["status"];
  revision: number;
  review_feedback: string | null;
  published_at: string | null;
  delivery_results?: SocialDeliveries;
  publishing_started_at?: string | null;
};

export function postSummary(row: PostRow): SocialPost {
  return {
    id: row.id,
    title: row.title,
    caption: row.caption,
    channels: row.channels,
    plannedDate: row.planned_date,
    mediaUrl: row.media_url,
    status: row.status,
    revision: row.revision,
    feedback: row.review_feedback,
    publishedAt: row.published_at,
    deliveries: row.delivery_results ?? {},
    publishingStartedAt: row.publishing_started_at ?? null,
  };
}

export async function listSocialPosts(
  user: ChatGPTUser,
  client: unknown,
  status: string | null,
  page: string | null,
): Promise<SocialPage> {
  const { context, clientId } = await authorizeSocial(user, client);
  if (status !== null && !isSocialStatus(status)) throw new SocialRequestError("Unknown post status.");
  if (page !== null && !/^\d{1,5}$/.test(page)) throw new SocialRequestError("Invalid page number.");

  const columns = await socialPostColumns();
  const offset = Number(page ?? 0) * SOCIAL_PAGE_SIZE;
  let query = getSupabaseAdminClient().from("social_posts")
    .select(columns)
    .eq("organization_id", context.organizationId)
    .eq("client_id", clientId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + SOCIAL_PAGE_SIZE)
    .overrideTypes<PostRow[], { merge: false }>();
  if (error) throw error;
  return {
    posts: data.slice(0, SOCIAL_PAGE_SIZE).map(postSummary),
    hasMore: data.length > SOCIAL_PAGE_SIZE,
  };
}

function contentColumns(input: Record<string, unknown>) {
  const post = normalizeSocialContent(input);
  return {
    title: post.title,
    caption: post.caption,
    channels: post.channels,
    planned_date: post.plannedDate,
    media_url: post.mediaUrl,
  };
}

export async function mutateSocialPost(user: ChatGPTUser, input: Record<string, unknown>): Promise<SocialPost> {
  const { clientId, context } = await authorizeSocial(user, input.clientId);
  const posts = getSupabaseAdminClient().from("social_posts");
  if (input.action === "create") {
    const { data, error } = await posts.insert({
      ...contentColumns(input),
      organization_id: context.organizationId,
      client_id: clientId,
      actor_email: context.email,
    }).select(PLANNER_COLUMNS).single();
    if (error) throw error;
    return postSummary(data as PostRow);
  }

  const id = socialUuid(input.id, "Choose a post.");
  const revision = input.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1 || revision >= 2147483647) {
    throw new SocialRequestError("Reload the post before changing it.");
  }

  const editing = input.action === "edit";
  const transition = editing ? null : socialTransition(
    input.action,
    supabaseRoleHasPermission(context, "social.review"),
    input.feedback,
  );
  const columns = await socialPostColumns();
  const trackDeliveries = columns === POST_COLUMNS;
  const now = new Date().toISOString();
  const changes = transition
    ? {
      status: transition.status,
      review_feedback: transition.feedback,
      published_at: transition.status === "published" ? now : null,
      ...(trackDeliveries ? { publishing_started_at: null } : {}),
      ...(trackDeliveries && input.action === "withdraw" ? { delivery_results: {}, delivery_account_id: null } : {}),
    }
    : contentColumns(input);

  // Scope, current status, and revision are checked on the write itself.
  let update = posts.update({
    ...changes, revision: revision + 1, updated_at: now, actor_email: context.email,
  })
    .eq("organization_id", context.organizationId)
    .eq("client_id", clientId)
    .eq("id", id)
    .eq("revision", revision)
    .in("status", transition?.from ?? ["draft", "changes_requested"]);
  // Allow manual reconciliation after a Worker interruption. A live attempt
  // owns the post for three minutes, longer than the bounded Graph calls.
  if (trackDeliveries && input.action === "record_published") {
    const expired = new Date(Date.now() - 3 * 60_000).toISOString();
    update = update.or(`publishing_started_at.is.null,publishing_started_at.lt.${expired}`);
  } else if (trackDeliveries && input.action === "withdraw") {
    const { data: current, error: lookupError } = await posts.select("delivery_results")
      .eq("organization_id", context.organizationId).eq("client_id", clientId)
      .eq("id", id).eq("revision", revision).is("publishing_started_at", null).maybeSingle();
    if (lookupError) throw lookupError;
    const results = Object.values(current?.delivery_results as SocialDeliveries ?? {});
    if (!current || results.some((delivery) => delivery.status !== "failed")) {
      throw new SocialRequestError("Check the publication results. A channel may have already published this post.", 409);
    }
    if (results.length && !supabaseRoleHasPermission(context, "social.review")) {
      throw new SocialRequestError("Forbidden", 403);
    }
    update = update.is("publishing_started_at", null);
  } else if (trackDeliveries) {
    update = update.is("publishing_started_at", null).filter("delivery_results", "eq", "{}");
  }
  const { data, error } = await update
    .select(columns)
    .maybeSingle()
    .overrideTypes<PostRow, { merge: false }>();
  if (error?.code === "23514" && error.message.includes("social_posts_review_content")) {
    throw new SocialRequestError("Add a caption or media link before submitting the post.");
  }
  if (error) throw error;
  if (!data) throw new SocialRequestError("This post is unavailable or has changed. Reload the planner and try again.", 409);
  return postSummary(data);
}
