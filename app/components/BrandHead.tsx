import type { TenantBranding } from "../../db/branding";
import { brandingCssVariables } from "../../db/branding";

/**
 * Emits the tenant-specific document head bits that Next's metadata API
 * cannot express, plus the brand colour custom properties.
 *
 * React 19 hoists bare `<link>`/`<style>` elements into `<head>`, so this
 * renders as part of the page tree while still landing in the right place.
 */
export function BrandHead({ branding }: { branding: TenantBranding }) {
  const variables = brandingCssVariables(branding);
  // Scoped to :root so the tokens are available to the CRM shell, the client
  // portal, and any modal that portals outside them.
  const css = `:root{${Object.entries(variables)
    .map(([name, value]) => `${name}:${value}`)
    .join(";")}}`;

  return (
    <>
      {/*
        crossorigin="use-credentials" is load-bearing: without it the browser
        fetches the manifest anonymously, the route cannot read the session,
        and every user on the shared app host installs the same unbranded app.
      */}
      <link
        rel="manifest"
        href="/manifest.webmanifest"
        crossOrigin="use-credentials"
      />
      <style
        // Values are hex colours and rgb() strings produced by
        // brandingCssVariables, never raw tenant input.
        dangerouslySetInnerHTML={{ __html: css }}
      />
    </>
  );
}
