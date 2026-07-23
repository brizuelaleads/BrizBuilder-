interface Env {
  BRIZBUILDER: Fetcher;
}

const MAIN_ORIGIN = "https://brizbuilder.brizuelaleads.workers.dev";
const PUBLIC_ORIGIN = "https://brizbuilder-ai.brizuelaleads.workers.dev";
const MAIN_RESOURCE = `${MAIN_ORIGIN}/mcp`;
const PUBLIC_RESOURCE = `${PUBLIC_ORIGIN}/mcp`;
const SCOPES = [
  "crm:read",
  "crm:tasks.write",
  "crm:opportunities.write",
] as const;
const MAX_TOKEN_BODY_BYTES = 32_768;

function responseHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  result.set("Pragma", "no-cache");
  result.set("Referrer-Policy", "no-referrer");
  result.set("X-Content-Type-Options", "nosniff");
  return result;
}

function methodNotAllowed(allow: string): Response {
  const headers = responseHeaders({ Allow: allow });
  return json({ error: "Method not allowed." }, 405, headers);
}

function json(
  body: Record<string, unknown>,
  status = 200,
  headers: Headers = responseHeaders(),
): Response {
  return Response.json(body, { status, headers });
}

function publicMetadata(pathname: string): Response {
  if (
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname === "/.well-known/oauth-protected-resource/mcp"
  ) {
    return json({
      resource: PUBLIC_RESOURCE,
      authorization_servers: [PUBLIC_ORIGIN],
      scopes_supported: SCOPES,
      bearer_methods_supported: ["header"],
      resource_documentation: `${MAIN_ORIGIN}/?view=ai`,
    });
  }
  return json({
    issuer: PUBLIC_ORIGIN,
    authorization_endpoint: `${PUBLIC_ORIGIN}/oauth/authorize`,
    token_endpoint: `${PUBLIC_ORIGIN}/oauth/token`,
    registration_endpoint: `${PUBLIC_ORIGIN}/oauth/register`,
    scopes_supported: SCOPES,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  });
}

function authorizationRedirect(request: Request): Response {
  const source = new URL(request.url);
  if (source.searchParams.getAll("resource").length !== 1) {
    return json({ error: "invalid_request", error_description: "One resource is required." }, 400);
  }
  if (source.searchParams.get("resource") !== PUBLIC_RESOURCE) {
    return json({ error: "invalid_target", error_description: "The requested resource is unknown." }, 400);
  }
  source.searchParams.set("resource", MAIN_RESOURCE);
  const target = new URL("/oauth/authorize", MAIN_ORIGIN);
  target.search = source.search;
  return new Response(null, {
    status: 302,
    headers: responseHeaders({ Location: target.toString() }),
  });
}

function downstreamRequest(
  request: Request,
  body?: BodyInit | null,
): Request {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cookie");
  headers.delete("cf-access-jwt-assertion");
  headers.delete("cf-access-authenticated-user-email");
  headers.delete("cf-access-client-id");
  headers.delete("cf-access-client-secret");
  if (body !== undefined) headers.delete("content-length");
  return new Request(request, {
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

function rewriteDownstreamHeaders(headers: Headers): Headers {
  const rewritten = responseHeaders(headers);
  rewritten.delete("Set-Cookie");
  rewritten.delete("CF-Access-Jwt-Assertion");
  rewritten.delete("CF-Access-Authenticated-User-Email");
  for (const name of ["WWW-Authenticate", "Link", "Location"]) {
    const value = rewritten.get(name);
    if (value) rewritten.set(name, value.replaceAll(MAIN_ORIGIN, PUBLIC_ORIGIN));
  }
  return rewritten;
}

async function passThrough(
  request: Request,
  env: Env,
): Promise<Response> {
  const response = await env.BRIZBUILDER.fetch(downstreamRequest(request));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: rewriteDownstreamHeaders(response.headers),
  });
}

async function tokenExchange(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return json({ error: "invalid_request", error_description: "Content-Type must be application/x-www-form-urlencoded." }, 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TOKEN_BODY_BYTES) {
    return json({ error: "invalid_request", error_description: "The token request is too large." }, 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_TOKEN_BODY_BYTES) {
    return json({ error: "invalid_request", error_description: "The token request is too large." }, 413);
  }
  const form = new URLSearchParams(text);
  if (
    form.getAll("resource").length !== 1 ||
    form.get("resource") !== PUBLIC_RESOURCE
  ) {
    return json({ error: "invalid_target", error_description: "The requested resource is unknown." }, 400);
  }
  form.set("resource", MAIN_RESOURCE);
  const response = await env.BRIZBUILDER.fetch(
    downstreamRequest(request, form.toString()),
  );
  const headers = rewriteDownstreamHeaders(response.headers);
  const responseType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!responseType.includes("application/json")) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  const responseText = await response.text();
  try {
    const payload = JSON.parse(responseText) as Record<string, unknown>;
    if (payload.resource === MAIN_RESOURCE) payload.resource = PUBLIC_RESOURCE;
    headers.delete("Content-Length");
    headers.delete("Content-Encoding");
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return new Response(responseText, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export const gatewayConfig = {
  mainOrigin: MAIN_ORIGIN,
  publicOrigin: PUBLIC_ORIGIN,
  mainResource: MAIN_RESOURCE,
  publicResource: PUBLIC_RESOURCE,
  scopes: SCOPES,
} as const;

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== PUBLIC_ORIGIN) {
      return json({ error: "Unknown connector host." }, 421);
    }

    if (
      url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
      url.pathname === "/.well-known/oauth-authorization-server"
    ) {
      return request.method === "GET"
        ? publicMetadata(url.pathname)
        : methodNotAllowed("GET");
    }
    if (url.pathname === "/oauth/authorize") {
      return request.method === "GET"
        ? authorizationRedirect(request)
        : methodNotAllowed("GET");
    }
    if (url.pathname === "/oauth/register") {
      return request.method === "POST"
        ? passThrough(request, env)
        : methodNotAllowed("POST");
    }
    if (url.pathname === "/oauth/token") {
      return request.method === "POST"
        ? tokenExchange(request, env)
        : methodNotAllowed("POST");
    }
    if (url.pathname === "/mcp") {
      return ["POST", "OPTIONS", "GET", "DELETE"].includes(request.method)
        ? passThrough(request, env)
        : methodNotAllowed("POST, OPTIONS");
    }
    return json({ error: "Not found." }, 404);
  },
};

export default worker;
