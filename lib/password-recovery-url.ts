const PRODUCTION_ORIGIN = "https://brizbuilder.com";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function passwordRecoveryUrl(
  path: "/reset-password" | "/forgot-password?sent=1",
  request?: Request,
  params: Record<string, string> = {},
): URL {
  const requestUrl = request && new URL(request.url);
  const origin = requestUrl && LOOPBACK_HOSTS.has(requestUrl.hostname)
    ? requestUrl.origin
    : PRODUCTION_ORIGIN;
  const url = new URL(path, origin);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url;
}

export function legacyPasswordResetRedirect(url: URL, method: string): Response | undefined {
  if ((method !== "GET" && method !== "HEAD") ||
    url.pathname !== "/reset-password" || !url.hostname.endsWith(".workers.dev")) {
    return;
  }
  const destination = passwordRecoveryUrl("/reset-password");
  destination.search = url.search;
  return new Response(null, {
    status: 307,
    headers: { Location: destination.href, "Cache-Control": "no-store" },
  });
}
