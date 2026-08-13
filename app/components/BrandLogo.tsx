import Image from "next/image";

type BrandLogoProps = {
  className?: string;
  compact?: boolean;
  decorative?: boolean;
  priority?: boolean;
  size?: number;
  tone?: "dark" | "light";
};

export function BrandLogo({
  className = "",
  compact = false,
  decorative = false,
  priority = false,
  size,
  tone = "dark",
}: BrandLogoProps) {
  const variant = compact ? "mark" : "wordmark";
  const color = tone === "light" ? "white" : "dark";
  const src = `/brand/brizbuilder-${variant}-${color}.png`;
  const displayWidth = size ?? (compact ? 24 : 128);

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
