import type { ChatGPTUser } from "../app/chatgpt-auth";
import { decryptMetaSecret, encryptMetaSecret } from "../lib/meta-conversions";
import { buildInstagramSocialLogin, exchangeInstagramSocialCode, instagramSocialConfigured, refreshInstagramSocialToken } from "../lib/meta-social";
import type { SocialProviderAccount } from "../lib/meta-social-core";
import { SocialRequestError } from "../lib/social-core";
import { getSupabaseAdminClient as db } from "../lib/supabase/server";
import { supabaseRoleHasPermission } from "./supabase-crm";
import { authorizeSocial } from "./supabase-social";

type Scope = Awaited<ReturnType<typeof authorizeSocial>>;
const FLOW_TTL = 15 * 60_000;
const REFRESH_WINDOW = 7 * 86_400_000;

function requireManager(scope: Scope) {
  if (!supabaseRoleHasPermission(scope.context, "social.review")) {
    throw new SocialRequestError("Forbidden", 403);
  }
}

async function stateHash(state: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function instagramWorkspaceAccount(scope: Scope) {
  if (!instagramSocialConfigured()) return { configured: false, account: null };
  const { data, error } = await db().from("social_instagram_connections")
    .select("instagram_id,instagram_name,expires_at")
    .eq("organization_id", scope.context.organizationId).eq("client_id", scope.clientId).maybeSingle();
  // A Worker can receive configuration while the migration is still pending.
  // The Facebook account should still load in that case.
  if (error?.code === "42P01" || error?.code === "PGRST205") return { configured: false, account: null };
  if (error) throw error;
  return {
    configured: true, account: data && {
      id: data.instagram_id as string, name: data.instagram_name as string, source: "instagram" as const,
      needsReconnect: Date.parse(String(data.expires_at)) <= Date.now(),
    },
  };
}

export async function beginInstagramConnect(scope: Scope) {
  requireManager(scope);
  const state = crypto.randomUUID() + crypto.randomUUID();
  const login = buildInstagramSocialLogin(state);
  const organizationId = scope.context.organizationId;
  const flows = db().from("social_instagram_authorizations");
  const { error: cleanupError } = await flows.delete().eq("organization_id", organizationId)
    .eq("client_id", scope.clientId).lte("expires_at", new Date().toISOString());
  if (cleanupError) throw cleanupError;
  const { error } = await flows.insert({
    state_hash: await stateHash(state),
    organization_id: organizationId,
    client_id: scope.clientId,
    actor_email: scope.context.email,
    expires_at: new Date(Date.now() + FLOW_TTL).toISOString(),
  });
  if (error) throw error;
  return login;
}

export async function finishInstagramConnect(user: ChatGPTUser, state: string, code: string | null, back: URL) {
  if (!/^[a-f0-9-]{72}$/.test(state)) throw new SocialRequestError("Start the Instagram connection again.");
  const hash = await stateHash(state);
  const email = user.email.trim().toLowerCase();
  const now = new Date().toISOString();
  const client = db();
  const flows = client.from("social_instagram_authorizations");
  const { data: pending, error: lookupError } = await flows.select("client_id")
    .eq("state_hash", hash).eq("actor_email", email).gt("expires_at", now).is("consumed_at", null).maybeSingle();
  if (lookupError) throw lookupError;
  if (!pending) throw new SocialRequestError("The Instagram connection expired. Start it again.");
  const scope = await authorizeSocial(user, pending.client_id);
  requireManager(scope);
  const organizationId = scope.context.organizationId;
  back.searchParams.set("client", scope.clientId);

  const { data: claim, error: claimError } = await flows.update({ consumed_at: now })
    .eq("organization_id", organizationId).eq("client_id", scope.clientId)
    .eq("state_hash", hash).eq("actor_email", email).gt("expires_at", now).is("consumed_at", null)
    .select("state_hash").maybeSingle();
  if (claimError) throw claimError;
  if (!claim) throw new SocialRequestError("This Instagram authorization has already been used.");
  if (!code || code.length > 2048) throw new SocialRequestError("Instagram authorization was canceled or denied.");

  const account = await exchangeInstagramSocialCode(code);
  const encrypted = await encryptMetaSecret(account.token, organizationId, `${scope.clientId}:instagram:${account.id}`);
  const { data, error } = await client.rpc("complete_social_instagram_login", {
    p_organization: organizationId, p_client: scope.clientId, p_actor: email, p_state: hash,
    p_instagram_id: account.id, p_app_user_id: account.appUserId, p_username: account.username,
    p_ciphertext: encrypted.ciphertext, p_iv: encrypted.iv, p_expires_at: account.expiresAt,
  });
  if (error?.code === "23505") {
    throw new SocialRequestError(error.message.startsWith("Disconnect Instagram")
      ? error.message : "This Instagram account is already linked to another workspace.", 409);
  }
  if (error) throw error;
  if (!data) throw new SocialRequestError("This Instagram authorization expired or was canceled.", 409);
}

export async function disconnectInstagram(scope: Scope) {
  requireManager(scope);
  const { error } = await db().rpc("disconnect_social_instagram_login", {
    p_organization: scope.context.organizationId, p_client: scope.clientId, p_actor: scope.context.email,
  });
  if (error) throw error;
}

export async function removeInstagramSocialUser(id: string, issuedAt: number) {
  const { error } = await db().from("social_instagram_connections").delete()
    .eq("app_user_id", id).lte("connected_at", new Date(issuedAt * 1000 + 999).toISOString());
  if (error) throw error;
}

export async function instagramDirectAccess(scope: Scope): Promise<SocialProviderAccount | null> {
  if (!instagramSocialConfigured()) return null;
  const organizationId = scope.context.organizationId;
  const table = db().from("social_instagram_connections");
  const { data: row, error } = await table.select("id,instagram_id,app_user_id,expires_at,token_ciphertext,token_iv")
    .eq("organization_id", organizationId).eq("client_id", scope.clientId).maybeSingle();
  if (error?.code === "42P01" || error?.code === "PGRST205") return null;
  if (error) throw error;
  if (!row) return null;
  const expiresAt = Date.parse(String(row.expires_at));
  if (expiresAt <= Date.now()) throw new SocialRequestError("Instagram access expired. Reconnect Instagram.");

  const key = `${scope.clientId}:instagram:${row.instagram_id}`;
  let token = await decryptMetaSecret({ ciphertext: row.token_ciphertext, iv: row.token_iv }, organizationId, key);
  if (expiresAt - Date.now() < REFRESH_WINDOW) {
    // Keep using a still-valid token if a refresh request fails temporarily.
    const refreshed = await refreshInstagramSocialToken(token).catch(() => null);
    if (refreshed) {
      const encrypted = await encryptMetaSecret(refreshed.token, organizationId, key);
      const { data: updated, error: saveError } = await table.update({
        token_ciphertext: encrypted.ciphertext, token_iv: encrypted.iv, expires_at: refreshed.expiresAt,
      }).eq("organization_id", organizationId).eq("client_id", scope.clientId).eq("id", row.id)
        .eq("token_ciphertext", row.token_ciphertext).select("id").maybeSingle();
      if (saveError) throw saveError;
      if (!updated) throw new SocialRequestError("The Instagram connection changed. Try again.", 409);
      token = refreshed.token;
    }
  }
  return {
    channel: "instagram", login: "instagram", id: row.instagram_id, appUserId: row.app_user_id,
    connectionId: row.id, token, messagingId: row.instagram_id, messagingToken: token,
  };
}
