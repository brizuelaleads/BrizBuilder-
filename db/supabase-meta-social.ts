import type { ChatGPTUser } from "../app/chatgpt-auth";
import { decryptMetaSecret, encryptMetaSecret } from "../lib/meta-conversions";
import {
  buildMetaSocialLogin, exchangeMetaSocialCode, metaSocialConfigured, metaSocialId,
  MetaSocialError, publishMetaSocialPost, type MetaAuthorization,
} from "../lib/meta-social";
import {
  metaPostContentError, socialDestination,
  type MetaPage, type MetaSocialWorkspace, type SocialDeliveries, type SocialAccountAccess, type SocialProviderAccount,
} from "../lib/meta-social-core";
import { SOCIAL_CHANNELS, SocialRequestError, socialUuid, type SocialChannel } from "../lib/social-core";
import { getSupabaseAdminClient as db } from "../lib/supabase/server";
import { supabaseRoleHasPermission, writeSupabaseAuditEvent } from "./supabase-crm";
import { authorizeSocial, POST_COLUMNS, postSummary, type PostRow } from "./supabase-social";
import { instagramDirectAccess, instagramWorkspaceAccount } from "./supabase-instagram-social";

type Scope = Awaited<ReturnType<typeof authorizeSocial>>;
type Connection = {
  id: string;
  page_id: string;
  page_name: string;
  instagram_id: string | null;
  instagram_name: string | null;
  token_ciphertext: string;
  token_iv: string;
};
const CONNECTION_COLUMNS = "id,page_id,page_name,instagram_id,instagram_name,token_ciphertext,token_iv";
const FLOW_TTL = 15 * 60_000;

function requireSocialManager(scope: Scope) {
  if (!supabaseRoleHasPermission(scope.context, "social.review")) {
    throw new SocialRequestError("Forbidden", 403);
  }
}

async function stateHash(state: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state)))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function activeAuthorization(scope: Scope) {
  return db().from("social_meta_authorizations")
    .select("id,token_ciphertext,token_iv")
    .eq("organization_id", scope.context.organizationId)
    .eq("client_id", scope.clientId)
    .eq("actor_email", scope.context.email)
    .gt("expires_at", new Date().toISOString())
    .not("token_ciphertext", "is", null)
    .order("consumed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

async function connection(scope: Scope) {
  const { data, error } = await db().from("social_meta_connections").select(CONNECTION_COLUMNS)
    .eq("organization_id", scope.context.organizationId).eq("client_id", scope.clientId).maybeSingle();
  if (error) throw error;
  return data as Connection | null;
}

async function openMetaAuthorization(scope: Scope, flow: { token_ciphertext: string; token_iv: string }) {
  return JSON.parse(await decryptMetaSecret(
    { ciphertext: flow.token_ciphertext, iv: flow.token_iv },
    scope.context.organizationId, `${scope.clientId}:social:authorization`,
  )) as MetaAuthorization;
}

export async function getMetaSocialWorkspace(scope: Scope): Promise<MetaSocialWorkspace> {
  const canConnect = supabaseRoleHasPermission(scope.context, "social.review");
  const configured = metaSocialConfigured();

  const [account, flow, instagram] = await Promise.all([
    configured ? connection(scope) : null,
    configured && canConnect ? activeAuthorization(scope) : null,
    instagramWorkspaceAccount(scope),
  ]);
  if (flow?.error) throw flow.error;
  const pages: MetaPage[] = flow?.data
    ? (await openMetaAuthorization(scope, flow.data)).pages.map(({ id, name, instagram }) => ({ id, name, instagram }))
    : [];
  const page = account && {
    id: account.page_id, name: account.page_name,
    instagram: account.instagram_id
      ? { id: account.instagram_id, name: account.instagram_name || "Instagram professional account" }
      : null,
  };
  return { configured, canConnect, pages, account: page,
    instagramConfigured: instagram.configured,
    instagramAccount: instagram.account ?? (page?.instagram ? { ...page.instagram, source: "facebook" } : null),
  };
}

export async function beginMetaSocialConnect(scope: Scope) {
  requireSocialManager(scope);
  const state = crypto.randomUUID() + crypto.randomUUID();
  const url = buildMetaSocialLogin(state);
  const { error: cleanupError } = await db().from("social_meta_authorizations").delete()
    .eq("organization_id", scope.context.organizationId).eq("client_id", scope.clientId)
    .lte("expires_at", new Date().toISOString());
  if (cleanupError) throw cleanupError;

  const { error } = await db().from("social_meta_authorizations").insert({
    organization_id: scope.context.organizationId,
    client_id: scope.clientId,
    actor_email: scope.context.email,
    state_hash: await stateHash(state),
    expires_at: new Date(Date.now() + FLOW_TTL).toISOString(),
  });
  if (error) throw error;
  return url;
}

export async function finishMetaSocialConnect(user: ChatGPTUser, state: string, code: string | null, back: URL) {
  if (!/^[a-f0-9-]{72}$/.test(state)) throw new SocialRequestError("Start the Meta connection again.");
  const dbClient = db();
  const hash = await stateHash(state);
  const now = new Date().toISOString();
  const email = user.email.trim().toLowerCase();
  const { data: location, error: lookupError } = await dbClient.from("social_meta_authorizations")
    .select("client_id").eq("state_hash", hash).eq("actor_email", email)
    .gt("expires_at", now).is("consumed_at", null).maybeSingle();
  if (lookupError) throw lookupError;
  if (!location) throw new SocialRequestError("The Meta connection expired. Start it again.");
  const scope = await authorizeSocial(user, location.client_id);
  requireSocialManager(scope);
  back.searchParams.set("client", scope.clientId);

  const { data: flow, error } = await dbClient.from("social_meta_authorizations")
    .update({ consumed_at: now }).eq("state_hash", hash).eq("actor_email", email)
    .eq("organization_id", scope.context.organizationId).eq("client_id", scope.clientId)
    .gt("expires_at", now).is("consumed_at", null).select("id").maybeSingle();
  if (error) throw error;
  if (!flow) throw new SocialRequestError("The Meta connection expired. Start it again.");
  if (!code || code.length > 2048) throw new SocialRequestError("Meta authorization was canceled or denied.");

  const authorization = await exchangeMetaSocialCode(code);
  const encrypted = await encryptMetaSecret(
    JSON.stringify(authorization), scope.context.organizationId, `${scope.clientId}:social:authorization`,
  );
  const { error: saveError } = await dbClient.from("social_meta_authorizations")
    .update({ meta_user_id: authorization.userId, token_ciphertext: encrypted.ciphertext, token_iv: encrypted.iv })
    .eq("id", flow.id).eq("organization_id", scope.context.organizationId).eq("client_id", scope.clientId);
  if (saveError) throw saveError;
}

export async function selectMetaSocialPage(scope: Scope, pageId: unknown) {
  requireSocialManager(scope);
  if (!metaSocialId(pageId)) throw new SocialRequestError("Choose a Facebook Page.");
  const [flow, existing] = await Promise.all([activeAuthorization(scope), connection(scope)]);
  if (flow.error) throw flow.error;
  if (!flow.data) throw new SocialRequestError("The Meta authorization expired. Reconnect your account.", 409);
  const auth = await openMetaAuthorization(scope, flow.data);
  const page = auth.pages.find((possible) => possible.id === pageId);
  if (!page) throw new SocialRequestError("Choose a Page authorized by Meta.");
  if (existing && (existing.page_id !== pageId || (existing.instagram_id && existing.instagram_id !== page.instagram?.id))) {
    throw new SocialRequestError("Disconnect the current accounts before choosing a different Page or Instagram account.", 409);
  }

  const organizationId = scope.context.organizationId;
  const encrypted = await encryptMetaSecret(
    JSON.stringify({ pageToken: page.token, userToken: auth.userToken }),
    organizationId, `${scope.clientId}:social:${pageId}`,
  );

  // Claim the selection before linking to prevent replay and concurrent choices.
  const { data: claimed, error: claimError } = await db().from("social_meta_authorizations")
    .delete().eq("id", flow.data.id).eq("organization_id", organizationId).eq("client_id", scope.clientId)
    .eq("actor_email", scope.context.email).gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new SocialRequestError("This authorization has already been used.", 409);

  const fields = {
    meta_user_id: auth.userId, page_id: page.id, page_name: page.name,
    instagram_id: page.instagram?.id ?? null, instagram_name: page.instagram?.name ?? null,
    token_ciphertext: encrypted.ciphertext, token_iv: encrypted.iv, connected_at: new Date().toISOString(),
  };
  const table = db().from("social_meta_connections");
  const query = existing
    ? table.update(fields).eq("id", existing.id).eq("organization_id", organizationId).eq("client_id", scope.clientId)
    : table.insert({ ...fields, organization_id: organizationId, client_id: scope.clientId });
  const { data, error } = await query.select("id").maybeSingle();
  if (error?.code === "23505") {
    throw new SocialRequestError("These accounts are already linked to a BrizBuilder workspace.", 409);
  }
  if (error) throw error;
  if (!data) throw new SocialRequestError("The connection changed. Connect Meta again.", 409);
  await writeSupabaseAuditEvent(scope.context, "social.meta.connected", "social_meta_connection", data.id, {}, scope.clientId);
  return getMetaSocialWorkspace(scope);
}

export async function disconnectMetaSocial(scope: Scope) {
  requireSocialManager(scope);
  const results = await Promise.all([
    db().from("social_meta_connections").delete()
      .eq("organization_id", scope.context.organizationId).eq("client_id", scope.clientId),
    db().from("social_meta_authorizations").delete()
      .eq("organization_id", scope.context.organizationId).eq("client_id", scope.clientId),
  ]);
  for (const { error } of results) if (error) throw error;
  await writeSupabaseAuditEvent(scope.context, "social.meta.disconnected", "social_meta_connection", null, {}, scope.clientId);
  return getMetaSocialWorkspace(scope);
}

export async function removeMetaSocialUser(userId: string, issuedAt: number) {
  const cutOff = new Date(issuedAt * 1000 + 999).toISOString();
  const [authorizations, connections] = await Promise.all([
    db().from("social_meta_authorizations").delete().eq("meta_user_id", userId).lte("consumed_at", cutOff),
    db().from("social_meta_connections").delete().eq("meta_user_id", userId).lte("connected_at", cutOff),
  ]);
  if (authorizations.error || connections.error) {
    throw new SocialRequestError("Meta could not confirm removal. Retry the request.", 503);
  }
}

async function facebookAccess(scope: Scope) {
  if (!metaSocialConfigured()) return null;
  const account = await connection(scope);
  if (!account) return null;
  const { pageToken, userToken } = JSON.parse(await decryptMetaSecret(
    { ciphertext: account.token_ciphertext, iv: account.token_iv },
    scope.context.organizationId, `${scope.clientId}:social:${account.page_id}`,
  )) as { pageToken: string; userToken: string };
  const common = { login: "facebook" as const, connectionId: account.id, messagingId: account.page_id, messagingToken: pageToken };
  const facebook: SocialProviderAccount = { ...common, channel: "facebook", id: account.page_id, token: pageToken };
  const instagram: SocialProviderAccount | null = account.instagram_id
    ? { ...common, channel: "instagram", id: account.instagram_id, token: userToken }
    : null;
  return { facebook, instagram };
}

export async function metaAccess(scope: Scope, channels: readonly SocialChannel[] = SOCIAL_CHANNELS): Promise<SocialAccountAccess> {
  const accounts: SocialAccountAccess["accounts"] = {};
  const errors: SocialAccountAccess["errors"] = {};
  const wantsFacebook = channels.includes("facebook");
  const wantsInstagram = channels.includes("instagram");
  const [direct] = await Promise.allSettled([wantsInstagram ? instagramDirectAccess(scope) : null]);
  // Direct authorization takes precedence. A failure on that authorization
  // cannot silently redirect a publish to a different Instagram account.
  if (wantsInstagram) {
    if (direct.status === "fulfilled" && direct.value) accounts.instagram = direct.value;
    if (direct.status === "rejected") {
      errors.instagram = direct.reason instanceof SocialRequestError ? direct.reason.message : "Could not open the Instagram connection.";
    }
  }
  if (wantsFacebook || (wantsInstagram && !accounts.instagram && !errors.instagram)) {
    try {
      const facebook = await facebookAccess(scope);
      if (wantsFacebook && facebook) accounts.facebook = facebook.facebook;
      if (wantsInstagram && facebook?.instagram && !accounts.instagram && !errors.instagram) accounts.instagram = facebook.instagram;
    } catch {
      if (wantsFacebook) errors.facebook = "Could not open the Facebook connection. Reconnect Facebook.";
      if (wantsInstagram && !accounts.instagram && !errors.instagram) {
        errors.instagram = "Could not open Instagram through Facebook. Reconnect Facebook or Instagram.";
      }
    }
  }
  return { accounts, errors };
}

export async function publishSocialPost(scope: Scope, input: Record<string, unknown>) {
  requireSocialManager(scope);
  const id = socialUuid(input.id, "Choose a post.");
  const revision = input.revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1 || revision >= 2147483646) {
    throw new SocialRequestError("Reload the post before publishing.");
  }
  const organizationId = scope.context.organizationId;
  const posts = db().from("social_posts");
  const { data: row, error: lookupError } = await posts.select(`${POST_COLUMNS},delivery_account_id`)
    .eq("id", id).eq("organization_id", organizationId).eq("client_id", scope.clientId)
    .eq("revision", revision).in("status", ["draft", "approved"]).maybeSingle();
  if (lookupError) throw lookupError;
  if (!row) throw new SocialRequestError("This post changed. Reload before publishing.", 409);
  const current = row as PostRow & { delivery_account_id: string | null };
  const post = postSummary(current);
  const deliveries: SocialDeliveries = { ...post.deliveries };
  if (post.publishingStartedAt || Object.values(deliveries).some(({ status }) => status === "unknown" || status === "sending")) {
    throw new SocialRequestError("Check the post on Meta before recording publication. Sending again could create duplicates.", 409);
  }
  const remaining = post.channels.filter((channel) => deliveries[channel]?.status !== "sent");
  const access = await metaAccess(scope, remaining);
  const expected = input.destinations;
  const targets = remaining.map((channel) => {
    const problem = metaPostContentError(channel, post.caption, post.mediaUrl);
    if (problem) throw new SocialRequestError(problem);
    const account = access.accounts[channel];
    if (!account) {
      throw new SocialRequestError(access.errors[channel] ?? `Connect ${channel === "facebook" ? "Facebook" : "Instagram"} for this business first.`);
    }
    if (expected !== undefined && (!expected || typeof expected !== "object" ||
        (expected as Record<string, unknown>)[channel] !== `${account.login}:${account.id}`)) {
      throw new SocialRequestError("The publishing account changed. Reload the planner to confirm the destination.", 409);
    }
    const previous = deliveries[channel];
    if ((previous?.destination && previous.destination !== socialDestination(account)) ||
        (previous && !previous.destination && current.delivery_account_id &&
          (account.login !== "facebook" || account.connectionId !== current.delivery_account_id))) {
      throw new SocialRequestError("This post was attempted with a different account. Check its publication on Meta.", 409);
    }
    return account;
  });
  const startedAt = new Date().toISOString();
  const ownedUpdate = () => posts.update({
    delivery_results: deliveries, updated_at: new Date().toISOString(), actor_email: scope.context.email,
  }).eq("id", id).eq("organization_id", organizationId).eq("client_id", scope.clientId)
    .eq("revision", revision + 1).eq("publishing_started_at", startedAt);

  const { data: claim, error: claimError } = await posts.update({
    status: "approved", revision: revision + 1, publishing_started_at: startedAt,
    // Old Worker versions reject retrying a direct Instagram attempt.
    delivery_account_id: targets.find((account) => account.login === "instagram")?.connectionId ??
      current.delivery_account_id ?? targets[0]?.connectionId ?? null,
    actor_email: scope.context.email, updated_at: startedAt,
  }).eq("id", id).eq("organization_id", organizationId).eq("client_id", scope.clientId)
    .eq("revision", revision).in("status", ["draft", "approved"]).is("publishing_started_at", null).select("id").maybeSingle();
  if (claimError) throw claimError;
  if (!claim) throw new SocialRequestError("This post changed. Reload before publishing.", 409);

  for (const account of targets) {
    const { channel } = account;
    const destination = socialDestination(account);
    deliveries[channel] = { status: "sending", detail: "Waiting for Meta.", destination };
    const { data: reserved, error: reserveError } = await ownedUpdate().select("id").maybeSingle();
    if (reserveError) throw reserveError;
    if (!reserved) throw new SocialRequestError("The publication record changed.", 409);
    try {
      const remoteId = await publishMetaSocialPost(account, post.caption, post.mediaUrl);
      deliveries[channel] = { status: "sent", detail: "Published.", remoteId, destination };
    } catch (error) {
      deliveries[channel] = {
        status: error instanceof MetaSocialError && !error.uncertain ? "failed" : "unknown",
        detail: error instanceof SocialRequestError ? error.message : "Check this post in Meta.",
        destination,
      };
    }
    const { error: saveError } = await ownedUpdate();
    if (saveError) throw saveError;
  }

  const sent = post.channels.every((channel) => deliveries[channel]?.status === "sent");
  const { data, error } = await posts.update({
    status: sent ? "published" : "approved",
    published_at: sent ? new Date().toISOString() : null,
    publishing_started_at: null,
    revision: revision + 2,
    delivery_results: deliveries,
    updated_at: new Date().toISOString(),
    actor_email: scope.context.email,
  }).eq("id", id).eq("organization_id", organizationId).eq("client_id", scope.clientId)
    .eq("revision", revision + 1).eq("publishing_started_at", startedAt).select(POST_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new SocialRequestError("Meta's results were recorded, but the planner changed. Reload to check publication.", 409);
  return postSummary(data as PostRow);
}
