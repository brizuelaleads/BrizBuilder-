interface Env {
  BRIZBUILDER: Fetcher;
}

function securityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, service: "brizbuilder-leads" }, { headers: { "Cache-Control": "no-store" } });
    }
    const isLeadCapture = url.pathname.startsWith("/api/website-leads/");
    const isTwilioWebhook = url.pathname.startsWith("/api/twilio/");
    const isTwilioDeauthorize = url.pathname === "/api/integrations/twilio/deauthorize";
    if (!isLeadCapture && !isTwilioWebhook && !isTwilioDeauthorize) {
      return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    if (!["GET", "POST", "OPTIONS"].includes(request.method) || ((isTwilioWebhook || isTwilioDeauthorize) && request.method !== "POST")) {
      return Response.json({ error: "Method not allowed." }, { status: 405, headers: { "Allow": "GET, POST, OPTIONS", "Cache-Control": "no-store" } });
    }
    return securityHeaders(await env.BRIZBUILDER.fetch(request));
  },
};

export default worker;
