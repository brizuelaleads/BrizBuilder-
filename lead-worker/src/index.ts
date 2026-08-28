const BRIZBUILDER_ORIGIN = "https://brizbuilder.com";

function upstreamRequest(request: Request) {
  const source = new URL(request.url);
  const target = new URL(source.pathname + source.search, BRIZBUILDER_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete("host");
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  };
  if (init.body) init.duplex = "half";
  return new Request(target, init);
}

function securityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const worker = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, service: "brizbuilder-leads" }, { headers: { "Cache-Control": "no-store" } });
    }
    const isLeadCapture = url.pathname.startsWith("/api/website-leads/");
    const isTwilioWebhook = url.pathname.startsWith("/api/twilio/");
    const isTwilioDeauthorize = url.pathname === "/api/integrations/twilio/deauthorize";
    const isStripeWebhook = url.pathname === "/api/integrations/stripe/webhook";
    const isCallRailWebhook = url.pathname.startsWith("/api/callrail/webhook/");
    if (!isLeadCapture && !isTwilioWebhook && !isTwilioDeauthorize && !isStripeWebhook && !isCallRailWebhook) {
      return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    if (!["GET", "POST", "OPTIONS"].includes(request.method) || ((isTwilioWebhook || isTwilioDeauthorize || isStripeWebhook || isCallRailWebhook) && request.method !== "POST")) {
      return Response.json({ error: "Method not allowed." }, { status: 405, headers: { "Allow": "GET, POST, OPTIONS", "Cache-Control": "no-store" } });
    }
    return securityHeaders(await fetch(upstreamRequest(request)));
  },
};

export default worker;
