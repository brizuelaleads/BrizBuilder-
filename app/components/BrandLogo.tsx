import Image from "next/image";

type BrandLogoProps = {
  className?: string;
  compact?: boolean;
  decorative?: boolean;
  priority?: boolean;
  size?: number;
  tone?: "dark" | "light";
  /**
   * A tenant's own logo. When set, it replaces the BrizBuilder wordmark
   * entirely -- a white-label workspace must never show the platform's mark.
   */
  logoUrl?: string | null;
  /** Alt text for a tenant logo; falls back to the BrizBuilder label. */
  brandName?: string;
};

export function BrandLogo({
  className = "",
  compact = false,
  decorative = false,
  priority = false,
  size,
  tone = "dark",
  logoUrl = null,
  brandName,
}: BrandLogoProps) {
  const variant = compact ? "mark" : "wordmark";
  const color = tone === "light" ? "white" : "dark";
  const src = `/brand/brizbuilder-${variant}-${color}.png`;
  const displayWidth = size ?? (compact ? 24 : 128);

  if (logoUrl) {
    // A plain <img>: tenant logos are arbitrary remote assets of unknown
    // intrinsic size, so there is nothing useful to hand next/image and
    // nothing to gain from routing them through the optimizer.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={`brand-logo-image brand-logo-image-tenant ${className}`.trim()}
        src={logoUrl}
        alt={decorative ? "" : (brandName ?? "Workspace logo")}
        style={{
          maxWidth: displayWidth,
          maxHeight: compact ? displayWidth : displayWidth * 0.42,
          width: "auto",
          height: "auto",
          objectFit: "contain",
        }}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
      />
    );
  }

  return (
    <Image
      className={`brand-logo-image ${compact ? "brand-logo-image-mark" : "brand-logo-image-wordmark"} ${className}`.trim()}
      src={src}
      alt={decorative ? "" : "BrizBuilder"}
      width={compact ? 512 : 1109}
      height={compact ? 512 : 257}
      priority={priority}
      style={{
        width: displayWidth,
        height: compact ? displayWidth : "auto",
      }}
      unoptimized
    />
  );
}
