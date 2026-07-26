export const dynamic = "force-dynamic";

// Search engines may crawl the marketing pages only. Everything that needs a
// sign-in, plus machine endpoints, is explicitly disallowed so crawlers never
// waste budget on pages that will only redirect them to a login.
const DISALLOWED = [
  "/dashboard",
  "/login",
  "/local-login",
  "/api/",
  "/oauth/",
  "/mcp",
  "/.well-known/",
];

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const body = [
    "User-agent: *",
    ...DISALLOWED.map((path) => `Disallow: ${path}`),
    "Allow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
