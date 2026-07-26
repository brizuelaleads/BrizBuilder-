export const dynamic = "force-dynamic";

// Only genuinely public, indexable pages belong here. Sign-in-gated routes are
// omitted on purpose: listing them would advertise pages crawlers cannot read.
const PUBLIC_PATHS = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly" },
  { path: "/terms", priority: "0.3", changefreq: "yearly" },
];

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const urls = PUBLIC_PATHS.map(
    ({ path, priority, changefreq }) =>
      `  <url>\n    <loc>${origin}${path}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`,
  ).join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
