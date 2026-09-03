import { buildInstallManifest } from "../../../../db/install-branding";
import { installBrandingBySlug } from "../../../../db/runtime-install-branding";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ clientSlug: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { clientSlug } = await context.params;
  const branding = await installBrandingBySlug(clientSlug);
  const manifest = branding ? buildInstallManifest(branding) : null;
  if (!manifest) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  return Response.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
