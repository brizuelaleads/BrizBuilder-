import { readRuntimeValue } from "./supabase/env";
import { SocialRequestError } from "./social-core";
import type { MetaPage, SocialProviderAccount } from "./meta-social-core";

const GRAPH = "https://graph.facebook.com";
const INSTAGRAM_GRAPH = "https://graph.instagram.com";
const REQUIRED_CONFIG = [
  "META_SOCIAL_APP_ID", "META_SOCIAL_APP_SECRET", "META_SOCIAL_LOGIN_CONFIG_ID",
  "META_SOCIAL_REDIRECT_URI", "META_TOKEN_ENCRYPTION_KEY",
];

function config() {
  if (!metaSocialConfigured()) throw new SocialRequestError("Meta account access is awaiting setup.", 503);
  return {
    id: readRuntimeValue("META_SOCIAL_APP_ID"),
    secret: readRuntimeValue("META_SOCIAL_APP_SECRET"),
    loginConfig: readRuntimeValue("META_SOCIAL_LOGIN_CONFIG_ID"),
    redirect: readRuntimeValue("META_SOCIAL_REDIRECT_URI"),
    version: readRuntimeValue("META_SOCIAL_GRAPH_VERSION") || "v27.0",
  };
}

export function metaSocialConfigured() {
  if (!REQUIRED_CONFIG.every((name) => Boolean(readRuntimeValue(name)))) return false;
  const version = readRuntimeValue("META_SOCIAL_GRAPH_VERSION");
  if (version && !/^v\d+\.\d+$/.test(version)) return false;
  try {
    const url = new URL(readRuntimeValue("META_SOCIAL_REDIRECT_URI"));
    return url.protocol === "https:" && !url.username && !url.password &&
      url.pathname === "/api/integrations/meta-social/callback" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function buildMetaSocialLogin(state: string) {
  const { id, version, loginConfig, redirect } = config();
  const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
  url.search = new URLSearchParams({
    client_id: id, config_id: loginConfig, redirect_uri: redirect, state,
    response_type: "code", override_default_response_type: "true",
  }).toString();
  return url.toString();
}

const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
];

function instagramConfig() {
  const id = readRuntimeValue("META_SOCIAL_INSTAGRAM_APP_ID");
  const secret = readRuntimeValue("META_SOCIAL_INSTAGRAM_APP_SECRET");
  const redirect = readRuntimeValue("META_SOCIAL_INSTAGRAM_REDIRECT_URI");
  const version = readRuntimeValue("META_SOCIAL_GRAPH_VERSION") || "v27.0";
  if (!metaSocialId(id) || !secret || !redirect || !/^v\d+\.\d+$/.test(version) ||
      !readRuntimeValue("META_TOKEN_ENCRYPTION_KEY")) return null;
  try {
    const url = new URL(redirect);
    if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
        url.pathname.replace(/\/$/, "") === "/api/integrations/instagram-social/callback") {
      return { id, secret, redirect, version };
    }
  } catch {
    // The connection stays disabled until the exact redirect is configured.
  }
  return null;
}

export function instagramSocialConfigured() {
  return instagramConfig() !== null;
}

function requireInstagramConfig() {
  const settings = instagramConfig();
  if (!settings) throw new SocialRequestError("Instagram sign-in is awaiting administrator setup.", 503);
  return settings;
}

export function buildInstagramSocialLogin(state: string) {
  const { id, redirect } = requireInstagramConfig();
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: id, redirect_uri: redirect, state, response_type: "code",
    enable_fb_login: "false", force_reauth: "true", scope: INSTAGRAM_SCOPES.join(","),
  }).toString();
  return url.toString();
}

export class MetaSocialError extends SocialRequestError {
  constructor(message: string, readonly uncertain = false) {
    super(message, 502);
  }
}

async function callGraph<T>(url: URL, headers: HeadersInit, body?: BodyInit) {
  type GraphResult = T & { error?: { code?: number; is_transient?: boolean } };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  let result: GraphResult | null;
  try {
    response = await fetch(url.toString(), {
      method: body ? "POST" : "GET",
      headers,
      body,
      // Workers supports manual/follow. Keep bearer credentials on the Graph host.
      redirect: "manual",
      signal: controller.signal,
    });
    result = await response.json().catch(() => null) as GraphResult | null;
  } catch {
    throw new MetaSocialError("Meta did not confirm the request. Check the account in Meta before retrying.", true);
  } finally {
    clearTimeout(timeout);
  }
  if ((response.status >= 300 && response.status < 400) || response.status >= 500 ||
      !result || result.error?.is_transient || result.error?.code === 1 || result.error?.code === 2) {
    throw new MetaSocialError("Meta did not confirm the request. Check the account in Meta before retrying.", true);
  }
  if (response.ok && !result.error) return result as T;
  const code = result.error?.code;
  if (code === 190 || code === 102) throw new MetaSocialError("Meta access expired. Reconnect the account.");
  if (code === 10 || code === 200 || code === 294) {
    throw new MetaSocialError("Meta denied this action. Check the account's app permissions and reply window.");
  }
  if (response.status === 429 || code === 4 || code === 17 || code === 613) {
    throw new MetaSocialError("Meta is rate limiting requests. Try again later.");
  }
  throw new MetaSocialError("Meta rejected the request. Check the account access and any attached media.");
}

export async function metaSocialHmac(secret: string, input: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function metaSocialRequest<T>(
  path: string,
  token: string,
  query: Record<string, string> = {},
  body?: Record<string, unknown>,
) {
  const { version, secret } = config();
  return requestGraph<T>(GRAPH, version, path, token, {
    ...query, appsecret_proof: await metaSocialHmac(secret, token),
  }, body);
}

function requestGraph<T>(
  origin: string, version: string, path: string, token: string, query: Record<string, string>,
  body?: Record<string, unknown>,
) {
  if (!/^(?:me|[a-zA-Z0-9_=-]{1,350})(?:\/[a-z_]+)?$/.test(path)) {
    throw new SocialRequestError("Meta returned an invalid reference.");
  }
  const url = new URL(`${origin}/${version}/${path}`);
  url.search = new URLSearchParams(query).toString();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (!body) return callGraph<T>(url, headers);
  if (Object.values(body).every((value) => typeof value !== "object")) {
    return callGraph<T>(url, headers, new URLSearchParams(
      Object.entries(body).map(([name, value]) => [name, String(value)]),
    ));
  }
  return callGraph<T>(url, { ...headers, "Content-Type": "application/json" }, JSON.stringify(body));
}

export function socialAccountRequest<T>(
  access: SocialProviderAccount, path: string, token: string, query: Record<string, string> = {},
  body?: Record<string, unknown>,
) {
  return access.login === "instagram"
    ? requestGraph<T>(INSTAGRAM_GRAPH, requireInstagramConfig().version, path, token, query, body)
    : metaSocialRequest<T>(path, token, query, body);
}

export function metaSocialId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,40}$/.test(value);
}

function instagramId(value: unknown) {
  if (metaSocialId(value)) return value;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}

type InstagramToken = { access_token?: string; expires_in?: number };

function longLivedToken(result: InstagramToken) {
  if (!result.access_token || !Number.isSafeInteger(result.expires_in) || !result.expires_in || result.expires_in <= 0 || result.expires_in > 90 * 86_400) {
    throw new SocialRequestError("Instagram did not return a usable authorization.");
  }
  return { token: result.access_token, expiresAt: new Date(Date.now() + result.expires_in * 1000).toISOString() };
}

export async function exchangeInstagramSocialCode(code: string) {
  const { id, secret, redirect, version } = requireInstagramConfig();
  const body = new FormData();
  for (const [name, value] of Object.entries({
    client_id: id, client_secret: secret, grant_type: "authorization_code", redirect_uri: redirect, code,
  })) body.set(name, value);
  type Grant = { access_token?: string; permissions?: string | string[]; user_id?: unknown };
  const grant = await callGraph<Grant & { data?: Grant[] }>(new URL("https://api.instagram.com/oauth/access_token"), {}, body);
  const short = grant.data?.[0] ?? grant;
  if (!short.access_token) throw new SocialRequestError("Instagram did not grant account access.");
  if (short.permissions) {
    const permissions = Array.isArray(short.permissions) ? short.permissions : short.permissions.split(/[ ,]+/u);
    if (!INSTAGRAM_SCOPES.every((scope) => permissions.includes(scope))) {
      throw new SocialRequestError("Authorize publishing, messages, and comments to connect Instagram.");
    }
  }

  const url = new URL("/access_token", INSTAGRAM_GRAPH);
  url.search = new URLSearchParams({
    grant_type: "ig_exchange_token", client_secret: secret, access_token: short.access_token,
  }).toString();
  const long = longLivedToken(await callGraph<InstagramToken>(url, {}));

  type Profile = { id?: unknown; user_id?: unknown; username?: string };
  const result = await requestGraph<Profile & { data?: Profile[] }>(
    INSTAGRAM_GRAPH, version, "me", long.token, { fields: "id,user_id,username" },
  );
  const profile = result.data?.[0] ?? result;
  const userId = instagramId(profile.user_id);
  const appUserId = instagramId(profile.id) ?? instagramId(short.user_id);
  if (!userId || !appUserId || !profile.username || !/^[a-zA-Z0-9._]{1,30}$/.test(profile.username)) {
    throw new SocialRequestError("Instagram did not return a professional account.");
  }
  return { ...long, id: userId, appUserId, username: profile.username };
}

export async function refreshInstagramSocialToken(token: string) {
  const url = new URL("/refresh_access_token", INSTAGRAM_GRAPH);
  url.search = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token }).toString();
  return longLivedToken(await callGraph<InstagramToken>(url, {}));
}

export type MetaPageWithToken = MetaPage & { token: string };
export type MetaAuthorization = { userId: string; userToken: string; pages: MetaPageWithToken[] };

export async function exchangeMetaSocialCode(code: string): Promise<MetaAuthorization> {
  const { id, secret, version, redirect } = config();
  async function exchange(parameters: Record<string, string>) {
    const url = new URL(`${GRAPH}/${version}/oauth/access_token`);
    url.search = new URLSearchParams({ client_id: id, client_secret: secret, ...parameters }).toString();
    const { access_token } = await callGraph<{ access_token: string }>(url, {});
    if (!access_token) throw new MetaSocialError("Meta did not return account authorization.");
    return access_token;
  }
  const shortToken = await exchange({ redirect_uri: redirect, code });
  const userToken = await exchange({ grant_type: "fb_exchange_token", fb_exchange_token: shortToken });
  const [{ id: userId }, result] = await Promise.all([
    metaSocialRequest<{ id: string }>("me", userToken, { fields: "id" }),
    metaSocialRequest<{
      data: {
        id: string; name: string; access_token: string;
        instagram_business_account?: { id: string; username?: string };
      }[];
    }>("me/accounts", userToken, { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" }),
  ]);
  const pages = (result.data ?? []).filter((page) =>
    metaSocialId(page.id) && typeof page.name === "string" && typeof page.access_token === "string",
  ).map(({ id, name, access_token, instagram_business_account: instagram }) => ({
    id, name, token: access_token,
    instagram: instagram && metaSocialId(instagram.id)
      ? { id: instagram.id, name: instagram.username || "Instagram professional account" }
      : null,
  }));
  if (!metaSocialId(userId) || !pages.length) {
    throw new SocialRequestError("Meta did not grant access to any Facebook Pages. Check your Page access and try again.");
  }
  return { userId, userToken, pages };
}

export async function publishMetaSocialPost(
  access: SocialProviderAccount,
  caption: string,
  mediaUrl: string | null,
) {
  if (access.channel === "facebook") {
    const result = mediaUrl
      ? await socialAccountRequest<{ id?: string; post_id?: string }>(access, `${access.id}/photos`, access.token, {}, {
        url: mediaUrl, caption, published: true,
      })
      : await socialAccountRequest<{ id?: string; post_id?: string }>(access, `${access.id}/feed`, access.token, {}, {
        message: caption,
      });
    const id = result.post_id ?? result.id;
    if (!id) throw new MetaSocialError("Facebook did not confirm publication.", true);
    return id;
  }

  if (!mediaUrl) throw new SocialRequestError("Add a public JPEG link to publish on Instagram.");
  let container: string;
  try {
    const { id } = await socialAccountRequest<{ id: string }>(access, `${access.id}/media`, access.token, {}, {
      image_url: mediaUrl, caption,
    });
    if (!metaSocialId(id)) throw new MetaSocialError("Instagram could not prepare the image.");
    container = id;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { status_code } = await socialAccountRequest<{ status_code: string }>(access, container, access.token, { fields: "status_code" });
      if (status_code === "FINISHED") {
        break;
      }
      if (status_code === "ERROR" || status_code === "EXPIRED" || attempt === 4) {
        throw new MetaSocialError("Instagram could not prepare the image. Check the public JPEG link and retry.");
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  } catch (error) {
    // A container can exist after a timeout, but it cannot post without media_publish.
    throw new MetaSocialError(error instanceof SocialRequestError ? error.message : "Instagram could not prepare the image.");
  }
  const { id } = await socialAccountRequest<{ id: string }>(access, `${access.id}/media_publish`, access.token, {}, {
    creation_id: container,
  });
  if (!metaSocialId(id)) throw new MetaSocialError("Instagram did not confirm publication.", true);
  return id;
}
