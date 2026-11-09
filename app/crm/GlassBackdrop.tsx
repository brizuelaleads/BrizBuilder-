import type { CrmBackdrop } from "../../db/theme";

// Backdrops behind the Glass theme's frosted panels, chosen per user in
// Settings > Appearance. All inline SVG: no image requests, they scale to any
// aspect ratio, and they render identically on server and client. `idPrefix`
// keeps gradient/filter ids unique when a small preview of a backdrop is drawn
// on the same page as the full-screen one.
const W = 1600;
const H = 1000;

type BackdropProps = { variant: CrmBackdrop; className?: string; idPrefix?: string };

// Photographic backdrops. Shown at full height and repeated side by side
// (never scaled up to cover), so a portrait image keeps its own proportions.
const IMAGE_BACKDROPS: Partial<Record<CrmBackdrop, string>> = {
  eyes: "/crm-backdrops/eyes.webp",
  silk: "/crm-backdrops/silk.webp",
  "red-halftone": "/crm-backdrops/red-halftone.webp",
  "pink-swirl": "/crm-backdrops/pink-swirl.webp",
};

export function GlassBackdrop({ variant, className = "crm-glass-backdrop", idPrefix = "crm-bd" }: BackdropProps) {
  const image = IMAGE_BACKDROPS[variant];
  if (image) {
    return <div className={`${className} crm-backdrop-image`} style={{ backgroundImage: `url(${image})` }} aria-hidden="true" />;
  }
  const id = (name: string) => `${idPrefix}-${variant}-${name}`;
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {variant === "chrome" ? <Chrome id={id} /> : variant === "halftone" ? <Halftone id={id} /> : <Red id={id} />}
    </svg>
  );
}

type Ids = { id: (name: string) => string };

/* ---- Red grain: a saturated red field with soft, out-of-focus black forms
 * (a tall dark pane, lower bands, a thin lit seam) under heavy film grain. */
const RED_SHADOWS = [
  { x: 120, y: -80, w: 760, h: 560, r: 30, opacity: 0.95 },
  { x: 980, y: -120, w: 420, h: 380, r: 30, opacity: 0.55 },
  { x: 60, y: 690, w: 980, h: 150, r: 24, opacity: 0.9 },
  { x: 1180, y: 640, w: 520, h: 420, r: 30, opacity: 0.7 },
  { x: 160, y: 880, w: 700, h: 200, r: 24, opacity: 0.85 },
];

function Red({ id }: Ids) {
  return (
    <>
      <defs>
        <linearGradient id={id("field")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c8161c" />
          <stop offset="0.5" stopColor="#e3252a" />
          <stop offset="1" stopColor="#b51217" />
        </linearGradient>
        <filter id={id("blur")} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="34" />
        </filter>
        <filter id={id("streak")} x="-50%" y="-10%" width="200%" height="120%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id={id("grain")} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.9" />
          </feComponentTransfer>
        </filter>
        <radialGradient id={id("vignette")} cx="0.5" cy="0.5" r="0.85">
          <stop offset="0.45" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id("field")})`} />
      <g filter={`url(#${id("blur")})`}>
        {RED_SHADOWS.map((shape, index) => (
          <rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.r} fill="#070102" opacity={shape.opacity} />
        ))}
      </g>
      <path d="M300 -40 C 330 120, 250 220, 290 380 S 270 470, 280 520" fill="none" stroke="#e8262c" strokeWidth="14" strokeLinecap="round" opacity="0.75" filter={`url(#${id("streak")})`} />
      <rect width={W} height={H} filter={`url(#${id("grain")})`} opacity="0.28" style={{ mixBlendMode: "multiply" }} />
      <rect width={W} height={H} filter={`url(#${id("grain")})`} opacity="0.12" style={{ mixBlendMode: "screen" }} />
      <rect width={W} height={H} fill={`url(#${id("vignette")})`} />
    </>
  );
}

/* ---- Black chrome: broad folds of dark metal whose gradient runs across each
 * fold, so the middle catches light and the edges fall away to black. */
const CHROME_FOLDS = [
  { d: "M-200 760 C 180 520, 520 980, 900 700 S 1500 420, 1800 640 L 1800 1200 L -200 1200 Z", from: "#050506", mid: "#2c2c31", to: "#030304", angle: "0.15" },
  { d: "M-200 420 C 220 180, 560 640, 980 420 S 1520 120, 1800 300 L 1800 620 C 1480 460, 1180 820, 820 760 S 160 600, -200 800 Z", from: "#060607", mid: "#3a3a40", to: "#050506", angle: "0.25" },
  { d: "M-200 120 C 260 -60, 620 360, 1040 180 S 1560 -80, 1800 40 L 1800 280 C 1500 160, 1220 520, 860 470 S 220 280, -200 460 Z", from: "#040405", mid: "#26262b", to: "#040405", angle: "0.3" },
];
const CHROME_HIGHLIGHTS = [
  { d: "M-200 760 C 180 520, 520 980, 900 700 S 1500 420, 1800 640", opacity: 0.32 },
  { d: "M-200 420 C 220 180, 560 640, 980 420 S 1520 120, 1800 300", opacity: 0.42 },
  { d: "M-200 120 C 260 -60, 620 360, 1040 180 S 1560 -80, 1800 40", opacity: 0.22 },
];

function Chrome({ id }: Ids) {
  return (
    <>
      <defs>
        {CHROME_FOLDS.map((fold, index) => (
          <linearGradient key={index} id={id(`fold-${index}`)} x1="0" y1="0" x2={fold.angle} y2="1">
            <stop offset="0" stopColor={fold.from} />
            <stop offset="0.55" stopColor={fold.mid} />
            <stop offset="1" stopColor={fold.to} />
          </linearGradient>
        ))}
        <linearGradient id={id("shine")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id={id("soften")} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <filter id={id("glow")} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <filter id={id("grain")}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <radialGradient id={id("vignette")} cx="0.5" cy="0.45" r="0.8">
          <stop offset="0.35" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.75" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="#020203" />
      <g filter={`url(#${id("soften")})`}>
        {CHROME_FOLDS.map((fold, index) => <path key={index} d={fold.d} fill={`url(#${id(`fold-${index}`)})`} />)}
      </g>
      <g filter={`url(#${id("glow")})`} fill="none" stroke={`url(#${id("shine")})`} strokeWidth="3" strokeLinecap="round">
        {CHROME_HIGHLIGHTS.map((line, index) => <path key={index} d={line.d} strokeOpacity={line.opacity} />)}
      </g>
      <rect width={W} height={H} filter={`url(#${id("grain")})`} opacity="0.07" />
      <rect width={W} height={H} fill={`url(#${id("vignette")})`} />
    </>
  );
}

/* ---- Halftone: silky diagonal folds of light, seen only through a fine
 * rotated dot screen. The folds are drawn as a luminance mask, so each dot
 * glows as bright as the fabric behind it, like a printed halftone. */
// Bright crests of the fabric, laid diagonally like the reference: a lit
// corner at the top left, then folds of falling brightness down the page.
const SILK = [
  { d: "M-200 -150 L 520 -150 C 420 120, 200 260, -200 360 Z", opacity: 1, blur: 46 },
  { d: "M-100 520 C 240 300, 520 200, 980 -80", opacity: 0.85, blur: 22, stroke: 70 },
  { d: "M120 760 C 520 520, 860 380, 1400 140", opacity: 0.7, blur: 26, stroke: 90 },
  { d: "M760 640 C 960 520, 1180 560, 1420 380", opacity: 0.8, blur: 30, stroke: 110 },
  { d: "M-200 980 C 300 760, 760 860, 1800 620", opacity: 0.45, blur: 30, stroke: 120 },
  { d: "M1100 1100 C 1300 920, 1500 900, 1800 860", opacity: 0.35, blur: 24, stroke: 80 },
];

function Halftone({ id }: Ids) {
  return (
    <>
      <defs>
        <pattern id={id("dots")} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
          <circle cx="3" cy="3" r="1.45" fill="#fff" />
        </pattern>
        {SILK.map((fold, index) => (
          <filter key={index} id={id(`soft-${index}`)} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={fold.blur} />
          </filter>
        ))}
        <linearGradient id={id("sheen")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
        </linearGradient>
        <mask id={id("light")} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
          {/* White-on-transparent, so it reads the same whether the browser
              treats the mask by luminance or by alpha. */}
          <rect width={W} height={H} fill={`url(#${id("sheen")})`} />
          {SILK.map((fold, index) => (
            <path
              key={index}
              d={fold.d}
              fill={fold.stroke ? "none" : "#fff"}
              stroke={fold.stroke ? "#fff" : undefined}
              strokeWidth={fold.stroke}
              strokeLinecap="round"
              opacity={fold.opacity}
              filter={`url(#${id(`soft-${index}`)})`}
            />
          ))}
        </mask>
        <radialGradient id={id("vignette")} cx="0.45" cy="0.4" r="0.85">
          <stop offset="0.4" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.6" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="#0b0b0c" />
      {/* A dim base screen so the shadows still read as dots, not flat black. */}
      <rect width={W} height={H} fill={`url(#${id("dots")})`} opacity="0.1" />
      <rect width={W} height={H} fill={`url(#${id("dots")})`} mask={`url(#${id("light")})`} />
      <rect width={W} height={H} fill={`url(#${id("vignette")})`} />
    </>
  );
}
