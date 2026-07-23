import assert from "node:assert/strict";
import test from "node:test";

import worker, { gatewayConfig } from "../ai-gateway/src/index.ts";

const publicOrigin = gatewayConfig.publicOrigin;

function mockEnv(handler) {
  return { BRIZBUILDER: { fetch: handler } };
}

test("gateway exposes only public OAuth and MCP metadata", async () => {
  const env = mockEnv(() => {
    throw new Error("metadata must not call the protected Worker");
  });
  const protectedMetadata = await worker.fetch(
    new Request(`${publicOrigin}/.well-known/oauth-protected-resource/mcp`),
    env,
  );
  assert.equal(protectedMetadata.status, 200);
  assert.deepEqual(await protectedMetadata.json(), {
    resource: gatewayConfig.publicResource,
    authorization_servers: [publicOrigin],
    scopes_supported: gatewayConfig.scopes,
    bearer_methods_supported: ["header"],
    resource_documentation: `${gatewayConfig.mainOrigin}/?view=ai`,
  });

  const authorizationMetadata = await worker.fetch(
    new Request(`${publicOrigin}/.well-known/oauth-authorization-server`),
    env,
  );
  const authorizationBody = await authorizationMetadata.json();
  assert.equal(authorizationBody.issuer, publicOrigin);
  assert.equal(authorizationBody.authorization_endpoint, `${publicOrigin}/oauth/authorize`);
  assert.equal(authorizationBody.token_endpoint, `${publicOrigin}/oauth/token`);

  for (const path of ["/", "/api/clients", "/signin-with-chatgpt", "/oauth/approve"]) {
    const response = await worker.fetch(new Request(`${publicOrigin}${path}`), env);
    assert.equal(response.status, 404, `${path} stays private`);
  }
});

test("authorization redirects to the protected consent screen with an internal resource", async () => {
  const source = new URL(`${publicOrigin}/oauth/authorize`);
  source.searchParams.set("client_id", "client-1");
  source.searchParams.set("resource", gatewayConfig.publicResource);
  const response = await worker.fetch(new Request(source), mockEnv(() => new Response()),);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, gatewayConfig.mainOrigin);
  assert.equal(location.pathname, "/oauth/authorize");
  assert.equal(location.searchParams.get("client_id"), "client-1");
  assert.equal(location.searchParams.get("resource"), gatewayConfig.mainResource);

  const rejected = await worker.fetch(
    new Request(`${publicOrigin}/oauth/authorize?resource=https://attacker.example/mcp`),
    mockEnv(() => new Response()),
  );
  assert.equal(rejected.status, 400);
});

test("token exchange translates only the exact public resource", async () => {
  let downstreamRequest;
  const env = mockEnv(async (request) => {
    downstreamRequest = request;
    return Response.json({
      access_token: "opaque-token",
      token_type: "Bearer",
      resource: gatewayConfig.mainResource,
    });
  });
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: "client-1",
    code: "code-1",
    code_verifier: "v".repeat(43),
    redirect_uri: "https://chatgpt.com/connector/oauth/callback",
    resource: gatewayConfig.publicResource,
  });
  const response = await worker.fetch(
    new Request(`${publicOrigin}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    }),
    env,
  );
  assert.equal(response.status, 200);
  const sent = new URLSearchParams(await downstreamRequest.text());
  assert.equal(new URL(downstreamRequest.url).origin, gatewayConfig.publicOrigin);
  assert.equal(sent.get("resource"), gatewayConfig.mainResource);
  assert.equal((await response.json()).resource, gatewayConfig.publicResource);

  const duplicate = `${form.toString()}&resource=${encodeURIComponent(gatewayConfig.publicResource)}`;
  const rejected = await worker.fetch(
    new Request(`${publicOrigin}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: duplicate,
    }),
    env,
  );
  assert.equal(rejected.status, 400);
});

test("MCP calls pass through while public challenges never point at the private machine URL", async () => {
  const env = mockEnv(async (request) => {
    assert.equal(new URL(request.url).pathname, "/mcp");
    return new Response(null, {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${gatewayConfig.mainOrigin}/.well-known/oauth-protected-resource/mcp"`,
        Link: `<${gatewayConfig.mainOrigin}/.well-known/oauth-protected-resource>; rel="oauth-protected-resource"`,
        "Set-Cookie": "private-session=must-not-leak",
      },
    });
  });
  const response = await worker.fetch(
    new Request(`${publicOrigin}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    env,
  );
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate"), new RegExp(publicOrigin));
  assert.doesNotMatch(response.headers.get("www-authenticate"), new RegExp(gatewayConfig.mainOrigin));
  assert.match(response.headers.get("link"), new RegExp(publicOrigin));
  assert.equal(response.headers.get("set-cookie"), null);
});

test("gateway rejects unexpected hosts and methods", async () => {
  const env = mockEnv(() => new Response());
  assert.equal((await worker.fetch(new Request("https://example.com/mcp"), env)).status, 421);
  assert.equal((await worker.fetch(new Request(`${publicOrigin}/oauth/token`), env)).status, 405);
  assert.equal(
    (await worker.fetch(new Request(`${publicOrigin}/mcp`, { method: "PUT" }), env)).status,
    405,
  );
});
