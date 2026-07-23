import type { ChatGPTUser } from "../../app/chatgpt-auth";
import type { CrmBootstrap } from "../../db/crm";
import { getSupabaseCrmBootstrap } from "../../db/supabase-crm";
import { getSupabaseAdminClient } from "../supabase/server";
import {
  AI_CONNECTOR_ISSUER,
  AI_CONNECTOR_RESOURCE,
  AI_CONNECTOR_SCOPES,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
  OAUTH_CONSENT_TTL_SECONDS,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  type AiConnectorScope,
} from "./config";
import {
  classifyRefreshTokenUse,
  isExactOAuthResource,
  isOneTimeCredentialUsable,
  isPkceS256Challenge,
  isPkceVerifier,
  isSafeOAuthClientName,
  verifyPkceS256,
} from "./oauth-policy";

type DatabaseError = { message?: string } | null;
type DatabaseResponse<T> = { data: T; error: DatabaseError };

type OAuthClientRow = {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  created_at: string;
  revoked_at: string | null;
};

type ConsentRequestRow = {
  id: string;
  oauth_client_id: string;
  actor_email: string;
  actor_name: string;
  organization_id: string;
  available_client_ids: string[];
  redirect_uri: string;
  requested_scopes: string[];
  state: string | null;
  resource: string;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: string;
  consumed_at: string | null;
};

type AuthorizationRow = {
  id: string;
  oauth_client_id: string;
  organization_id: string;
  allowed_client_ids: string[];
  actor_email: string;
  actor_name: string;
  scopes: string[];
  status: string;
  revoked_at: string | null;
};

type AuthorizationCodeRow = {
  id: string;
  authorization_id: string;
  oauth_client_id: string;
  redirect_uri: string;
  resource: string;
  scopes: string[];
  code_challenge: string;
  code_challenge_method: string;
  expires_at: string;
  consumed_at: string | null;
};

type RefreshTokenRow = {
  id: string;
  authorization_id: string;
  oauth_client_id: string;
  resource: string;
  scopes: string[];
  expires_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
};

export type AiOAuthConsent = {
  consentToken: string;
  oauthClientName: string;
  oauthRedirectHost: string;
  organizationName: string;
  actorEmail: string;
  requestedScopes: AiConnectorScope[];
  clients: Array<{ id: string; name: string }>;
  expiresAt: string;
};

export type AiOAuthTokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
  resource: string;
};

export class AiOAuthError extends Error {
  readonly oauthError: string;
  readonly status: number;
  readonly scope?: string;

  constructor(
    oauthError: string,
    message: string,
    status = 400,
    scope?: string,
  ) {
    super(message);
    this.name = "AiOAuthError";
    this.oauthError = oauthError;
    this.status = status;
    this.scope = scope;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_ID_PATTERN = /^bb_client_[A-Za-z0-9_-]{43}$/;
const CONSENT_TOKEN_PATTERN = /^bb_consent_[A-Za-z0-9_-]{43}$/;
const AUTHORIZATION_CODE_PATTERN = /^bb_ac_[A-Za-z0-9_-]{43}$/;
const REFRESH_TOKEN_PATTERN = /^bb_rt_[A-Za-z0-9_-]{43}$/;
const MAX_OAUTH_BODY_BYTES = 32_768;
const MAX_STATE_LENGTH = 2_048;
const DCR_REGISTRATION_LIMIT_PER_FINGERPRINT = 100;
const TOKEN_TABLES = {
  clients: "ai_oauth_clients",
  consent: "ai_oauth_consent_requests",
  authorizations: "ai_authorizations",
  codes: "ai_oauth_authorization_codes",
  access: "ai_oauth_access_tokens",
  refresh: "ai_oauth_refresh_tokens",
} as const;

function supabase() {
  return getSupabaseAdminClient();
}

async function unwrap<T>(
  request: PromiseLike<DatabaseResponse<T>>,
  operation: string,
): Promise<T> {
  const { data, error } = await request;
  if (!error) return data;

  console.error(`AI connector OAuth database operation failed: ${operation}.`, {
    message: error.message,
  });
  throw new AiOAuthError(
    "temporarily_unavailable",
    "The BrizBuilder authorization service is temporarily unavailable.",
    503,
  );
}

function nowIso() {
  return new Date().toISOString();
}

function futureIso(seconds: number) {
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function opaqueValue(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}${base64UrlEncode(bytes)}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64UrlEncode(new Uint8Array(digest));
}

function boundedText(
  value: unknown,
  label: string,
  maximum: number,
): string {
  if (typeof value !== "string") {
    throw new AiOAuthError("invalid_request", `${label} is required.`);
  }
  const text = value.trim();
  if (!text || text.length > maximum || /[\u0000-\u001F\u007F]/u.test(text)) {
    throw new AiOAuthError("invalid_request", `${label} is invalid.`);
  }
  return text;
}

function safeUnverifiedClientName(value: unknown): string {
  const text = boundedText(value, "client_name", 100);
  if (!isSafeOAuthClientName(text)) {
    throw new AiOAuthError(
      "invalid_client_metadata",
      "client_name contains unsupported formatting characters.",
    );
  }
  return text;
}

function validRedirectUri(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim() || value.length > 2_048) {
    throw new AiOAuthError("invalid_redirect_uri", "A redirect URI is invalid.");
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !url.hostname
    ) {
      throw new Error("invalid");
    }
    return value;
  } catch {
    throw new AiOAuthError(
      "invalid_redirect_uri",
      "Redirect URIs must be complete HTTPS URLs without fragments.",
    );
  }
}

function uniqueStringArray(
  value: unknown,
  label: string,
  maximumItems: number,
): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumItems) {
    throw new AiOAuthError("invalid_client_metadata", `${label} is invalid.`);
  }
  const strings = value.map((item) => {
    if (typeof item !== "string" || !item) {
      throw new AiOAuthError("invalid_client_metadata", `${label} is invalid.`);
    }
    return item;
  });
  if (new Set(strings).size !== strings.length) {
    throw new AiOAuthError(
      "invalid_client_metadata",
      `${label} cannot contain duplicates.`,
    );
  }
  return strings;
}

function normalizedScopes(value: string | null | undefined): AiConnectorScope[] {
  if (!value) return ["crm:read"];
  if (value.length > 512 || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw new AiOAuthError("invalid_scope", "The requested scope is invalid.");
  }

  const requested = value.split(" ").filter(Boolean);
  if (!requested.length || new Set(requested).size !== requested.length) {
    throw new AiOAuthError("invalid_scope", "The requested scope is invalid.");
  }
  if (requested.some((scope) => !AI_CONNECTOR_SCOPES.includes(scope as AiConnectorScope))) {
    throw new AiOAuthError(
      "invalid_scope",
      "One or more requested permissions are not supported.",
    );
  }

  return AI_CONNECTOR_SCOPES.filter((scope) => requested.includes(scope));
}

function scopesFromDatabase(value: unknown): AiConnectorScope[] {
  if (!Array.isArray(value)) return [];
  return AI_CONNECTOR_SCOPES.filter((scope) => value.includes(scope));
}

function scopesAreNonEmptySubset(
  candidate: readonly AiConnectorScope[],
  granted: readonly AiConnectorScope[],
): boolean {
  return Boolean(candidate.length) && candidate.every((scope) => granted.includes(scope));
}

function consentClientsFromBootstrap(
  bootstrap: CrmBootstrap,
): Array<{ id: string; name: string }> {
  const permittedClients = bootstrap.clients
    .filter((clientRow) => UUID_PATTERN.test(clientRow.id))
    .filter(
      (clientRow) =>
        !bootstrap.viewer.clientId || clientRow.id === bootstrap.viewer.clientId,
    )
    .map((clientRow) => ({ id: clientRow.id, name: clientRow.businessName }));
  return Array.from(
    new Map(permittedClients.map((clientRow) => [clientRow.id, clientRow])).values(),
  );
}

function requireAiConnectorManager(bootstrap: CrmBootstrap): void {
  if (!bootstrap.viewer.permissions.includes("ai_connector.manage")) {
    throw new AiOAuthError(
      "access_denied",
      "Your BrizBuilder role cannot approve AI connections.",
      403,
    );
  }
}

function exactResource(value: string | null | undefined): string {
  if (!isExactOAuthResource(value, AI_CONNECTOR_RESOURCE)) {
    throw new AiOAuthError(
      "invalid_target",
      "This authorization request is for an unknown resource.",
    );
  }
  return value;
}

function safeState(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value.length > MAX_STATE_LENGTH || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw new AiOAuthError("invalid_request", "The OAuth state is invalid.");
  }
  return value;
}

function singleSearchParam(
  source: Record<string, string | string[] | undefined>,
  name: string,
  required = true,
): string | null {
  const value = source[name];
  if (Array.isArray(value)) {
    throw new AiOAuthError("invalid_request", `${name} must appear only once.`);
  }
  if (typeof value !== "string" || (!value && required)) {
    if (!required) return null;
    throw new AiOAuthError("invalid_request", `${name} is required.`);
  }
  return value;
}

function singleFormValue(
  form: URLSearchParams,
  name: string,
  required = true,
): string | null {
  const values = form.getAll(name);
  if (values.length > 1) {
    throw new AiOAuthError("invalid_request", `${name} must appear only once.`);
  }
  const value = values[0];
  if (value === undefined || (!value && required)) {
    if (!required) return null;
    throw new AiOAuthError("invalid_request", `${name} is required.`);
  }
  return value;
}

async function oauthClientByPublicId(clientId: string): Promise<OAuthClientRow | null> {
  if (!CLIENT_ID_PATTERN.test(clientId)) return null;
  return unwrap(
    supabase()
      .from(TOKEN_TABLES.clients)
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle() as unknown as PromiseLike<DatabaseResponse<OAuthClientRow | null>>,
    "read OAuth client",
  );
}

async function activeOAuthClient(clientId: string): Promise<OAuthClientRow> {
  const client = await oauthClientByPublicId(clientId);
  if (!client || client.revoked_at) {
    throw new AiOAuthError("invalid_client", "The OAuth client is not valid.", 401);
  }
  if (client.token_endpoint_auth_method !== "none") {
    throw new AiOAuthError("invalid_client", "The OAuth client is not public.", 401);
  }
  return client;
}

function ensureClientCanAuthorize(client: OAuthClientRow) {
  if (
    !client.grant_types.includes("authorization_code") ||
    !client.response_types.includes("code")
  ) {
    throw new AiOAuthError(
      "unauthorized_client",
      "This OAuth client cannot use the authorization-code flow.",
    );
  }
}

export async function registerAiOAuthClient(
  request: Request,
  input: unknown,
): Promise<Record<string, unknown>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AiOAuthError(
      "invalid_client_metadata",
      "Client metadata must be a JSON object.",
    );
  }
  const metadata = input as Record<string, unknown>;
  if (metadata.software_statement !== undefined) {
    throw new AiOAuthError(
      "unapproved_software_statement",
      "Software statements are not accepted by this registration endpoint.",
    );
  }

  const clientName = safeUnverifiedClientName(metadata.client_name);
  const redirectUris = uniqueStringArray(
    metadata.redirect_uris,
    "redirect_uris",
    8,
  ).map(validRedirectUri);
  const grantTypes = metadata.grant_types
    ? uniqueStringArray(metadata.grant_types, "grant_types", 2)
    : ["authorization_code", "refresh_token"];
  const responseTypes = metadata.response_types
    ? uniqueStringArray(metadata.response_types, "response_types", 1)
    : ["code"];
  const tokenEndpointAuthMethod =
    metadata.token_endpoint_auth_method === undefined
      ? "none"
      : String(metadata.token_endpoint_auth_method);

  if (
    !grantTypes.includes("authorization_code") ||
    grantTypes.some(
      (grant) => grant !== "authorization_code" && grant !== "refresh_token",
    ) ||
    responseTypes.length !== 1 ||
    responseTypes[0] !== "code" ||
    tokenEndpointAuthMethod !== "none"
  ) {
    throw new AiOAuthError(
      "invalid_client_metadata",
      "BrizBuilder accepts public authorization-code clients with PKCE only.",
    );
  }

  if (metadata.scope !== undefined) {
    if (typeof metadata.scope !== "string") {
      throw new AiOAuthError("invalid_client_metadata", "scope is invalid.");
    }
    normalizedScopes(metadata.scope);
  }

  const rawConnectingIp = (request.headers.get("cf-connecting-ip") ?? "")
    .trim()
    .toLowerCase();
  const connectingIp = /^[0-9a-f:.]{3,80}$/i.test(rawConnectingIp)
    ? rawConnectingIp
    : "unknown";
  const fingerprint = await sha256(
    [
      "brizbuilder-dcr-ip-v1",
      AI_CONNECTOR_ISSUER,
      connectingIp,
    ].join("\n"),
  );
  const since = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
  const rateResult = await (supabase()
    .from(TOKEN_TABLES.clients)
    .select("id", { count: "exact", head: true })
    .eq("registration_fingerprint", fingerprint)
    .gte("created_at", since) as unknown as PromiseLike<
    DatabaseResponse<null> & { count?: number | null }
  >);
  if (rateResult.error) {
    console.error("AI connector OAuth registration rate check failed.", {
      message: rateResult.error.message,
    });
    throw new AiOAuthError(
      "temporarily_unavailable",
      "The BrizBuilder authorization service is temporarily unavailable.",
      503,
    );
  }
  if ((rateResult.count ?? 0) >= DCR_REGISTRATION_LIMIT_PER_FINGERPRINT) {
    throw new AiOAuthError(
      "invalid_client_metadata",
      "Too many registrations were attempted. Try again later.",
      429,
    );
  }

  const publicClientId = opaqueValue("bb_client_");
  const created = await unwrap(
    supabase()
      .from(TOKEN_TABLES.clients)
      .insert({
        client_id: publicClientId,
        client_name: clientName,
        redirect_uris: redirectUris,
        grant_types: grantTypes,
        response_types: responseTypes,
        token_endpoint_auth_method: "none",
        registration_fingerprint: fingerprint,
      })
      .select("created_at")
      .single() as unknown as PromiseLike<
      DatabaseResponse<{ created_at: string }>
    >,
    "register OAuth client",
  );

  return {
    client_id: publicClientId,
    client_id_issued_at: Math.floor(Date.parse(created.created_at) / 1_000),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: "none",
    ...(typeof metadata.scope === "string" ? { scope: metadata.scope } : {}),
  };
}

export async function prepareAiOAuthConsent(
  user: ChatGPTUser,
  input: Record<string, string | string[] | undefined>,
): Promise<AiOAuthConsent> {
  if (singleSearchParam(input, "response_type") !== "code") {
    throw new AiOAuthError(
      "unsupported_response_type",
      "Only the authorization-code response type is supported.",
    );
  }
  const publicClientId = singleSearchParam(input, "client_id")!;
  const client = await activeOAuthClient(publicClientId);
  ensureClientCanAuthorize(client);

  const redirectUri = singleSearchParam(input, "redirect_uri")!;
  if (!client.redirect_uris.includes(redirectUri)) {
    throw new AiOAuthError(
      "invalid_request",
      "The redirect URI does not match this OAuth client.",
    );
  }

  const resource = exactResource(singleSearchParam(input, "resource"));
  const codeChallenge = singleSearchParam(input, "code_challenge")!;
  if (!isPkceS256Challenge(codeChallenge)) {
    throw new AiOAuthError(
      "invalid_request",
      "A valid PKCE S256 code challenge is required.",
    );
  }
  if (singleSearchParam(input, "code_challenge_method") !== "S256") {
    throw new AiOAuthError(
      "invalid_request",
      "Only the PKCE S256 challenge method is supported.",
    );
  }
  const state = safeState(singleSearchParam(input, "state", false));
  const requestedScopes = normalizedScopes(
    singleSearchParam(input, "scope", false),
  );

  const bootstrap = await getSupabaseCrmBootstrap(user);
  requireAiConnectorManager(bootstrap);
  if (!UUID_PATTERN.test(bootstrap.organization.id)) {
    throw new AiOAuthError(
      "access_denied",
      "This workspace is not ready for AI connections.",
      403,
    );
  }

  const clients = consentClientsFromBootstrap(bootstrap);
  if (!clients.length) {
    throw new AiOAuthError(
      "access_denied",
      "No active business workspace is available for this connection.",
      403,
    );
  }
  if (clients.length > 250) {
    throw new AiOAuthError(
      "access_denied",
      "This agency has too many businesses for a single consent request.",
      403,
    );
  }

  const consentToken = opaqueValue("bb_consent_");
  const expiresAt = futureIso(OAUTH_CONSENT_TTL_SECONDS);
  const actorEmail = user.email.trim().toLowerCase();
  const actorName = (bootstrap.viewer.name || user.displayName).trim().slice(0, 200);
  await unwrap(
    supabase().from(TOKEN_TABLES.consent).insert({
      consent_token_hash: await sha256(consentToken),
      oauth_client_id: client.id,
      actor_email: actorEmail,
      actor_name: actorName,
      organization_id: bootstrap.organization.id,
      available_client_ids: clients.map((clientRow) => clientRow.id),
      redirect_uri: redirectUri,
      requested_scopes: requestedScopes,
      state,
      resource,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      expires_at: expiresAt,
    }) as unknown as PromiseLike<DatabaseResponse<null>>,
    "create consent request",
  );

  await unwrap(
    supabase()
      .from(TOKEN_TABLES.clients)
      .update({ last_seen_at: nowIso() })
      .eq("id", client.id) as unknown as PromiseLike<DatabaseResponse<null>>,
    "update OAuth client activity",
  );

  return {
    consentToken,
    oauthClientName: client.client_name,
    oauthRedirectHost: new URL(redirectUri).hostname,
    organizationName: bootstrap.organization.name,
    actorEmail,
    requestedScopes,
    clients,
    expiresAt,
  };
}

function redirectWithParameters(
  redirectUri: string,
  parameters: Record<string, string | null>,
): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== null) url.searchParams.set(name, value);
  }
  return url.toString();
}

async function consumeConsentRequest(id: string): Promise<void> {
  const consumed = await unwrap(
    supabase()
      .from(TOKEN_TABLES.consent)
      .update({ consumed_at: nowIso() })
      .eq("id", id)
      .is("consumed_at", null)
      .select("id")
      .maybeSingle() as unknown as PromiseLike<
      DatabaseResponse<{ id: string } | null>
    >,
    "consume consent request",
  );
  if (!consumed) {
    throw new AiOAuthError(
      "invalid_request",
      "This authorization request has already been used.",
    );
  }
}

export async function completeAiOAuthConsent(
  user: ChatGPTUser,
  input: {
    consentToken: string;
    decision: "approve" | "deny";
    clientId?: string | null;
  },
): Promise<string> {
  if (!CONSENT_TOKEN_PATTERN.test(input.consentToken)) {
    throw new AiOAuthError("invalid_request", "The consent request is invalid.");
  }
  const consent = await unwrap(
    supabase()
      .from(TOKEN_TABLES.consent)
      .select("*")
      .eq("consent_token_hash", await sha256(input.consentToken))
      .maybeSingle() as unknown as PromiseLike<
      DatabaseResponse<ConsentRequestRow | null>
    >,
    "read consent request",
  );
  if (
    !consent ||
    !isOneTimeCredentialUsable({
      consumedAt: consent.consumed_at,
      expiresAt: consent.expires_at,
    })
  ) {
    throw new AiOAuthError(
      "invalid_request",
      "This authorization request has expired or was already used.",
    );
  }
  if (consent.actor_email !== user.email.trim().toLowerCase()) {
    throw new AiOAuthError(
      "access_denied",
      "This authorization request belongs to a different signed-in user.",
      403,
    );
  }

  const client = await unwrap(
    supabase()
      .from(TOKEN_TABLES.clients)
      .select("*")
      .eq("id", consent.oauth_client_id)
      .maybeSingle() as unknown as PromiseLike<
      DatabaseResponse<OAuthClientRow | null>
    >,
    "read consent OAuth client",
  );
  if (
    !client ||
    client.revoked_at ||
    client.token_endpoint_auth_method !== "none" ||
    !client.redirect_uris.includes(consent.redirect_uri) ||
    consent.resource !== AI_CONNECTOR_RESOURCE
  ) {
    throw new AiOAuthError("invalid_client", "The OAuth client is no longer valid.", 401);
  }
  ensureClientCanAuthorize(client);

  if (input.decision === "deny") {
    await consumeConsentRequest(consent.id);
    return redirectWithParameters(consent.redirect_uri, {
      error: "access_denied",
      error_description: "The user declined the BrizBuilder connection.",
      state: consent.state,
    });
  }

  const selectedClientId = input.clientId ?? "";
  if (
    !UUID_PATTERN.test(selectedClientId) ||
    !consent.available_client_ids.includes(selectedClientId)
  ) {
    throw new AiOAuthError(
      "invalid_request",
      "Choose a business you are allowed to access.",
    );
  }

  const currentBootstrap = await getSupabaseCrmBootstrap(user);
  requireAiConnectorManager(currentBootstrap);
  if (currentBootstrap.organization.id !== consent.organization_id) {
    throw new AiOAuthError(
      "access_denied",
      "Your BrizBuilder workspace access changed. Start the connection again.",
      403,
    );
  }
  const currentClientIds = new Set(
    consentClientsFromBootstrap(currentBootstrap).map((clientRow) => clientRow.id),
  );
  if (!currentClientIds.has(selectedClientId)) {
    throw new AiOAuthError(
      "access_denied",
      "You no longer have access to the selected business.",
      403,
    );
  }
  const consentScopes = scopesFromDatabase(consent.requested_scopes);
  if (
    !consentScopes.length ||
    consentScopes.length !== consent.requested_scopes.length
  ) {
    throw new AiOAuthError(
      "invalid_scope",
      "The consent request contains an unsupported permission.",
    );
  }

  await consumeConsentRequest(consent.id);
  const authorization = await unwrap(
    supabase()
      .from(TOKEN_TABLES.authorizations)
      .insert({
        oauth_client_id: client.id,
        organization_id: consent.organization_id,
        allowed_client_ids: [selectedClientId],
        actor_email: consent.actor_email,
        actor_name: consent.actor_name,
        scopes: consentScopes,
        status: "active",
      })
      .select("id")
      .single() as unknown as PromiseLike<DatabaseResponse<{ id: string }>>,
    "create AI authorization",
  );

  const code = opaqueValue("bb_ac_");
  try {
    await unwrap(
      supabase().from(TOKEN_TABLES.codes).insert({
        code_hash: await sha256(code),
        authorization_id: authorization.id,
        oauth_client_id: client.id,
        redirect_uri: consent.redirect_uri,
        resource: consent.resource,
        scopes: consentScopes,
        code_challenge: consent.code_challenge,
        code_challenge_method: "S256",
        expires_at: futureIso(OAUTH_AUTHORIZATION_CODE_TTL_SECONDS),
      }) as unknown as PromiseLike<DatabaseResponse<null>>,
      "create authorization code",
    );
    await unwrap(
      supabase().from("audit_events").insert({
        organization_id: consent.organization_id,
        client_id: selectedClientId,
        actor_email: consent.actor_email,
        action: "ai.authorization.created",
        record_type: "ai_authorization",
        record_id: authorization.id,
        metadata: {
          oauth_client_name: client.client_name.slice(0, 100),
          scopes: consentScopes,
        },
      }) as unknown as PromiseLike<DatabaseResponse<null>>,
      "audit AI authorization",
    );
  } catch (error) {
    await supabase()
      .from(TOKEN_TABLES.authorizations)
      .update({ status: "revoked", revoked_at: nowIso(), last_error: "code_issue_failed" })
      .eq("id", authorization.id);
    throw error;
  }

  return redirectWithParameters(consent.redirect_uri, {
    code,
    state: consent.state,
  });
}

async function authorizationById(id: string): Promise<AuthorizationRow | null> {
  return unwrap(
    supabase()
      .from(TOKEN_TABLES.authorizations)
      .select("*")
      .eq("id", id)
      .maybeSingle() as unknown as PromiseLike<
      DatabaseResponse<AuthorizationRow | null>
    >,
    "read AI authorization",
  );
}

function ensureActiveAuthorization(
  authorization: AuthorizationRow | null,
  oauthClientId: string,
): asserts authorization is AuthorizationRow {
  if (
    !authorization ||
    authorization.oauth_client_id !== oauthClientId ||
    authorization.status !== "active" ||
    authorization.revoked_at
  ) {
    throw new AiOAuthError(
      "invalid_grant",
      "The authorization grant is no longer valid.",
    );
  }
}

async function revokeAuthorizationFamily(
  authorizationId: string,
  reason: string,
): Promise<void> {
  const timestamp = nowIso();
  // Revoke the parent grant first. Every access-token check requires an active
  // parent, so this single update fails closed even if token cleanup later has
  // a transient problem.
  await unwrap(
    supabase()
      .from(TOKEN_TABLES.authorizations)
      .update({
        status: "revoked",
        revoked_at: timestamp,
        revoked_by_email: "system@brizbuilder",
        last_error: reason.slice(0, 200),
      })
      .eq("id", authorizationId) as unknown as PromiseLike<
      DatabaseResponse<null>
    >,
    "revoke reused authorization",
  );
  await Promise.all([
    unwrap(
      supabase()
        .from(TOKEN_TABLES.access)
        .update({ revoked_at: timestamp })
        .eq("authorization_id", authorizationId)
        .is("revoked_at", null) as unknown as PromiseLike<
        DatabaseResponse<null>
      >,
      "revoke reused access tokens",
    ),
    unwrap(
      supabase()
        .from(TOKEN_TABLES.refresh)
        .update({ revoked_at: timestamp })
        .eq("authorization_id", authorizationId)
        .is("revoked_at", null) as unknown as PromiseLike<
        DatabaseResponse<null>
      >,
      "revoke reused refresh tokens",
    ),
  ]);
}

async function issueTokenPair(
  authorization: AuthorizationRow,
  client: OAuthClientRow,
  resource: string,
  scopes: AiConnectorScope[],
): Promise<AiOAuthTokenResponse & { refreshTokenId?: string }> {
  const accessToken = opaqueValue("bb_at_");
  const accessExpiresAt = futureIso(OAUTH_ACCESS_TOKEN_TTL_SECONDS);
  const accessRow = await unwrap(
    supabase()
      .from(TOKEN_TABLES.access)
      .insert({
        token_hash: await sha256(accessToken),
        authorization_id: authorization.id,
        oauth_client_id: client.id,
        resource,
        scopes,
        expires_at: accessExpiresAt,
      })
      .select("id")
      .single() as unknown as PromiseLike<DatabaseResponse<{ id: string }>>,
    "issue access token",
  );

  let refreshToken: string | undefined;
  let refreshTokenId: string | undefined;
  if (client.grant_types.includes("refresh_token")) {
    refreshToken = opaqueValue("bb_rt_");
    try {
      const refreshRow = await unwrap(
        supabase()
          .from(TOKEN_TABLES.refresh)
          .insert({
            token_hash: await sha256(refreshToken),
            authorization_id: authorization.id,
            oauth_client_id: client.id,
            resource,
            scopes,
            expires_at: futureIso(OAUTH_REFRESH_TOKEN_TTL_SECONDS),
          })
          .select("id")
          .single() as unknown as PromiseLike<DatabaseResponse<{ id: string }>>,
        "issue refresh token",
      );
      refreshTokenId = refreshRow.id;
    } catch (error) {
      await supabase()
        .from(TOKEN_TABLES.access)
        .update({ revoked_at: nowIso() })
        .eq("id", accessRow.id);
      throw error;
    }
  }

  await supabase()
    .from(TOKEN_TABLES.authorizations)
    .update({ last_used_at: nowIso(), last_success_at: nowIso(), last_error: null })
    .eq("id", authorization.id);

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    scope: scopes.join(" "),
    resource,
    ...(refreshTokenId ? { refreshTokenId } : {}),
  };
}

function publicTokenResponse(
  result: AiOAuthTokenResponse & { refreshTokenId?: string },
): AiOAuthTokenResponse {
  return {
    access_token: result.access_token,
    token_type: result.token_type,
    expires_in: result.expires_in,
    ...(result.refresh_token ? { refresh_token: result.refresh_token } : {}),
    scope: result.scope,
    resource: result.resource,
  };
}

async function exchangeAuthorizationCode(
  form: URLSearchParams,
  client: OAuthClientRow,
): Promise<AiOAuthTokenResponse> {
  ensureClientCanAuthorize(client);
  const code = singleFormValue(form, "code")!;
  const redirectUri = singleFormValue(form, "redirect_uri")!;
  const codeVerifier = singleFormValue(form, "code_verifier")!;
  const resource = exactResource(singleFormValue(form, "resource"));
  if (!AUTHORIZATION_CODE_PATTERN.test(code) || !isPkceVerifier(codeVerifier)) {
    throw new AiOAuthError("invalid_grant", "The authorization code is invalid.");
  }

  const codeRow = await unwrap(
    supabase()
      .from(TOKEN_TABLES.codes)
      .select("*")
      .eq("code_hash", await sha256(code))
      .maybeSingle() as unknown as PromiseLike<
      DatabaseResponse<AuthorizationCodeRow | null>
    >,
    "read authorization code",
  );
  if (
    !codeRow ||
    !isOneTimeCredentialUsable({
      consumedAt: codeRow.consumed_at,
      expiresAt: codeRow.expires_at,
    }) ||
    codeRow.oauth_client_id !== client.id ||
    codeRow.redirect_uri !== redirectUri ||
    codeRow.resource !== resource ||
    codeRow.code_challenge_method !== "S256"
  ) {
    throw new AiOAuthError("invalid_grant", "The authorization code is invalid.");
  }
  if (!(await verifyPkceS256(codeVerifier, codeRow.code_challenge))) {
    throw new AiOAuthError("invalid_grant", "PKCE verification failed.");
  }

  const authorization = await authorizationById(codeRow.authorization_id);
  ensureActiveAuthorization(authorization, client.id);
  const codeScopes = scopesFromDatabase(codeRow.scopes);
  const authorizationScopes = scopesFromDatabase(authorization.scopes);
  if (!scopesAreNonEmptySubset(codeScopes, authorizationScopes)) {
    throw new AiOAuthError("invalid_grant", "The authorization grant is invalid.");
  }
  const consumed = await unwrap(
    supabase()
      .from(TOKEN_TABLES.codes)
      .update({ consumed_at: nowIso() })
      .eq("id", codeRow.id)
      .is("consumed_at", null)
      .select("id")
      .maybeSingle() as unknown as PromiseLike<
      DatabaseResponse<{ id: string } | null>
    >,
    "consume authorization code",
  );
  if (!consumed) {
    throw new AiOAuthError("invalid_grant", "The authorization code was already used.");
  }

  const tokenResponse = await issueTokenPair(
    authorization,
    client,
    resource,
    codeScopes,
  );
  return publicTokenResponse(tokenResponse);
}

async function exchangeRefreshToken(
  form: URLSearchParams,
  client: OAuthClientRow,
): Promise<AiOAuthTokenResponse> {
  if (!client.grant_types.includes("refresh_token")) {
    throw new AiOAuthError(
      "unauthorized_client",
      "This OAuth client cannot use refresh tokens.",
    );
  }
  const presentedToken = singleFormValue(form, "refresh_token")!;
  const resource = exactResource(singleFormValue(form, "resource"));
  if (!REFRESH_TOKEN_PATTERN.test(presentedToken)) {
    throw new AiOAuthError("invalid_grant", "The refresh token is invalid.");
  }

  const refreshRow = await unwrap(
    supabase()
      .from(TOKEN_TABLES.refresh)
      .select("*")
      .eq("token_hash", await sha256(presentedToken))
      .maybeSingle() as unknown as PromiseLike<
      DatabaseResponse<RefreshTokenRow | null>
    >,
    "read refresh token",
  );
  if (!refreshRow || refreshRow.oauth_client_id !== client.id) {
    throw new AiOAuthError("invalid_grant", "The refresh token is invalid.");
  }
  const refreshDecision = classifyRefreshTokenUse({
    rotatedAt: refreshRow.rotated_at,
    revokedAt: refreshRow.revoked_at,
    expiresAt: refreshRow.expires_at,
  });
  if (refreshDecision === "reuse") {
    await revokeAuthorizationFamily(
      refreshRow.authorization_id,
      "refresh_token_reuse_detected",
    );
    throw new AiOAuthError(
      "invalid_grant",
      "Refresh-token reuse was detected. Reconnect BrizBuilder.",
    );
  }
  if (
    refreshDecision === "invalid" ||
    refreshRow.resource !== resource
  ) {
    throw new AiOAuthError("invalid_grant", "The refresh token is invalid.");
  }

  const authorization = await authorizationById(refreshRow.authorization_id);
  ensureActiveAuthorization(authorization, client.id);
  const currentScopes = scopesFromDatabase(refreshRow.scopes);
  const authorizationScopes = scopesFromDatabase(authorization.scopes);
  if (!scopesAreNonEmptySubset(currentScopes, authorizationScopes)) {
    throw new AiOAuthError("invalid_grant", "The refresh token is invalid.");
  }
  const requestedScope = singleFormValue(form, "scope", false);
  const scopes = requestedScope ? normalizedScopes(requestedScope) : currentScopes;
  if (scopes.some((scope) => !currentScopes.includes(scope))) {
    throw new AiOAuthError(
      "invalid_scope",
      "A refresh request cannot add permissions.",
    );
  }

  const rotated = await unwrap(
    supabase()
      .from(TOKEN_TABLES.refresh)
      .update({ rotated_at: nowIso() })
      .eq("id", refreshRow.id)
      .is("rotated_at", null)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle() as unknown as PromiseLike<
      DatabaseResponse<{ id: string } | null>
    >,
    "rotate refresh token",
  );
  if (!rotated) {
    await revokeAuthorizationFamily(
      refreshRow.authorization_id,
      "refresh_token_concurrent_reuse_detected",
    );
    throw new AiOAuthError(
      "invalid_grant",
      "Refresh-token reuse was detected. Reconnect BrizBuilder.",
    );
  }

  const tokenResponse = await issueTokenPair(
    authorization,
    client,
    resource,
    scopes,
  );
  if (tokenResponse.refreshTokenId) {
    await supabase()
      .from(TOKEN_TABLES.refresh)
      .update({ replacement_token_id: tokenResponse.refreshTokenId })
      .eq("id", refreshRow.id);
  }
  return publicTokenResponse(tokenResponse);
}

export async function processAiOAuthTokenRequest(
  request: Request,
): Promise<AiOAuthTokenResponse> {
  const authorizationHeader = request.headers.get("authorization");
  if (authorizationHeader) {
    throw new AiOAuthError(
      "invalid_client",
      "This endpoint accepts public clients without a client secret.",
      401,
    );
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    throw new AiOAuthError(
      "invalid_request",
      "Content-Type must be application/x-www-form-urlencoded.",
      415,
    );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_OAUTH_BODY_BYTES) {
    throw new AiOAuthError("invalid_request", "The token request is too large.", 413);
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_OAUTH_BODY_BYTES) {
    throw new AiOAuthError("invalid_request", "The token request is too large.", 413);
  }
  const form = new URLSearchParams(body);
  if (
    form.has("client_secret") ||
    form.has("client_assertion") ||
    form.has("client_assertion_type")
  ) {
    throw new AiOAuthError(
      "invalid_client",
      "This endpoint accepts public clients without a client secret.",
      401,
    );
  }
  const grantType = singleFormValue(form, "grant_type")!;
  const clientId = singleFormValue(form, "client_id")!;
  const client = await activeOAuthClient(clientId);

  if (grantType === "authorization_code") {
    return exchangeAuthorizationCode(form, client);
  }
  if (grantType === "refresh_token") {
    return exchangeRefreshToken(form, client);
  }
  throw new AiOAuthError(
    "unsupported_grant_type",
    "Only authorization_code and refresh_token are supported.",
  );
}


function quotedChallengeValue(value: string) {
  return value.replace(/["\\\r\n]/g, "");
}

export function createAiBearerChallenge(
  scopes: readonly AiConnectorScope[] = ["crm:read"],
  error?: Pick<AiOAuthError, "oauthError" | "message">,
): string {
  const metadata = `${AI_CONNECTOR_ISSUER}/.well-known/oauth-protected-resource/mcp`;
  const values = [
    `resource_metadata="${quotedChallengeValue(metadata)}"`,
    `scope="${quotedChallengeValue(scopes.join(" "))}"`,
  ];
  if (error) {
    values.push(`error="${quotedChallengeValue(error.oauthError)}"`);
    values.push(`error_description="${quotedChallengeValue(error.message)}"`);
  }
  return `Bearer ${values.join(", ")}`;
}

export function aiOAuthErrorResponse(
  error: unknown,
  defaultMessage = "The authorization request could not be completed.",
): Response {
  const oauthError =
    error instanceof AiOAuthError
      ? error
      : new AiOAuthError("server_error", defaultMessage, 500);
  if (!(error instanceof AiOAuthError)) {
    console.error("Unexpected AI connector OAuth error.", error);
  }

  const headers = new Headers({
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
  if (oauthError.status === 401 || oauthError.status === 403) {
    headers.set(
      "WWW-Authenticate",
      createAiBearerChallenge(
        oauthError.scope
          ? (oauthError.scope.split(" ") as AiConnectorScope[])
          : ["crm:read"],
        oauthError,
      ),
    );
  }
  if (oauthError.status === 429) headers.set("Retry-After", "3600");

  return Response.json(
    {
      error: oauthError.oauthError,
      error_description: oauthError.message,
    },
    { status: oauthError.status, headers },
  );
}

export function publicAiOAuthError(error: unknown): {
  code: string;
  message: string;
  status: number;
} {
  if (error instanceof AiOAuthError) {
    return {
      code: error.oauthError,
      message: error.message,
      status: error.status,
    };
  }
  console.error("Unexpected AI connector consent error.", error);
  return {
    code: "server_error",
    message: "The BrizBuilder authorization service is temporarily unavailable.",
    status: 500,
  };
}
