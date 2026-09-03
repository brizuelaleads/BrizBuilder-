import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { installPathForSlug } from "../../../db/install-branding";
import { publicInstallBrandingBySlug } from "../../../db/runtime-install-branding";
import { PwaRegistrar } from "../../components/PwaRegistrar";
import { InstallExperience } from "./InstallExperience";

export const dynamic = "force-dynamic";

type InstallPageProps = {
  params: Promise<{ clientSlug: string }>;
};

const brandingForInstall = cache((slug: string) =>
  publicInstallBrandingBySlug(slug),
);

export async function generateMetadata({
  params,
}: InstallPageProps): Promise<Metadata> {
  const { clientSlug } = await params;
  const branding = await brandingForInstall(clientSlug);
  if (!branding) return { title: { absolute: "Client app not found" } };
  const icon = branding.iconUrl ?? "/brand/brizbuilder-icon.png";
  return {
    title: { absolute: branding.appName },
    description: `Install the ${branding.businessName} business dashboard.`,
    robots: { index: false, follow: false },
    appleWebApp: {
      capable: true,
      title: branding.appName,
      statusBarStyle: "default",
    },
    icons: {
      icon: [{ url: icon }],
      apple: [{ url: icon, sizes: "180x180" }],
    },
    other: { "application-name": branding.appName },
  };
}

export async function generateViewport({
  params,
}: InstallPageProps): Promise<Viewport> {
  const { clientSlug } = await params;
  const branding = await brandingForInstall(clientSlug);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: branding?.primaryColor ?? "#6757e8",
  };
}

export default async function ClientInstallPage({ params }: InstallPageProps) {
  const { clientSlug } = await params;
  const branding = await brandingForInstall(clientSlug);
  const installPath = installPathForSlug(clientSlug);
  if (!branding || !installPath) notFound();

  return (
    <>
      {/* React 19 hoists this into <head>. The slug route is public, so the
          manifest does not need a session cookie to resolve its tenant. */}
      <link
        rel="manifest"
        href={`${installPath}/manifest.webmanifest`}
        crossOrigin="anonymous"
      />
      <PwaRegistrar />
      <InstallExperience branding={branding} />
    </>
  );
}
