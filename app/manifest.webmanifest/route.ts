import { getChatGPTUser } from "../chatgpt-auth";
import { resolveRequestBranding } from "../../db/runtime-branding";
import { buildTenantManifest } from "../../db/branding";

export const dynamic = "force-dynamic";

/**
 * The tenant-specific PWA manifest.
 *
 * One route serves every brand. Which one a request gets is decided by
 * resolveRequestBranding: the host subdomain when there is one, otherwise the
 * signed-in user's own tenant.
 *
 * The session path only works because the manifest link tag is marked
 * `crossorigin="use-credentials"` -- browsers otherwise fetch the manifest
 * anonymously and every user on the shared host would install the same
 * unbranded app.
 */
export async function GET(request: Request) {
  // A signed-out visitor on a tenant subdomain still gets that tenant's
  // branding, so a failure to identify the user is not an error here.
  let user = null;
  try {
    user = await getChatGPTUser();
  } catch {
    user = null;
  }

  const { branding, source } = await resolveRequestBranding(
    request.headers,
    user,
  );
  const manifest = buildTenantManifest(branding);

  return Response.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      // Per-tenant and, on the shared host, per-user: never let a shared cache
      // hand one client's branded manifest to another.
      "Cache-Control": "private, no-cache, must-revalidate",
      Vary: "Host, X-Forwarded-Host, Cookie",
      "X-Brizbuilder-Brand-Source": source,
    },
  });
}
