// Liquid black-chrome backdrop behind the Glass theme's frosted panels: a few
// broad folds of dark metal catching a soft highlight, with film grain on top.
// Inline SVG, so it costs no image request and renders identically on server
// and client.
const W = 1600;
const H = 1000;

// Each fold is a closed ribbon; its gradient runs across the fold so the middle
// catches light and the edges fall away to black, which reads as curved metal.
const FOLDS = [
  { d: "M-200 760 C 180 520, 520 980, 900 700 S 1500 420, 1800 640 L 1800 1200 L -200 1200 Z", from: "#050506", mid: "#2c2c31", to: "#030304", angle: "0.15" },
  { d: "M-200 420 C 220 180, 560 640, 980 420 S 1520 120, 1800 300 L 1800 620 C 1480 460, 1180 820, 820 760 S 160 600, -200 800 Z", from: "#060607", mid: "#3a3a40", to: "#050506", angle: "0.25" },
  { d: "M-200 120 C 260 -60, 620 360, 1040 180 S 1560 -80, 1800 40 L 1800 280 C 1500 160, 1220 520, 860 470 S 220 280, -200 460 Z", from: "#040405", mid: "#26262b", to: "#040405", angle: "0.3" },
];

// Thin specular lines along the crest of each fold.
const HIGHLIGHTS = [
  { d: "M-200 760 C 180 520, 520 980, 900 700 S 1500 420, 1800 640", opacity: 0.32 },
  { d: "M-200 420 C 220 180, 560 640, 980 420 S 1520 120, 1800 300", opacity: 0.42 },
  { d: "M-200 120 C 260 -60, 620 360, 1040 180 S 1560 -80, 1800 40", opacity: 0.22 },
];

export function GlassBackdrop() {
  return (
    <svg className="crm-glass-backdrop" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        {FOLDS.map((fold, index) => (
          <linearGradient key={index} id={`crm-fold-${index}`} x1="0" y1="0" x2={fold.angle} y2="1">
            <stop offset="0" stopColor={fold.from} />
            <stop offset="0.55" stopColor={fold.mid} />
            <stop offset="1" stopColor={fold.to} />
          </linearGradient>
        ))}
        <linearGradient id="crm-fold-shine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id="crm-fold-soften" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <filter id="crm-fold-glow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <filter id="crm-fold-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <radialGradient id="crm-fold-vignette" cx="0.5" cy="0.45" r="0.8">
          <stop offset="0.35" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.75" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="#020203" />
      <g filter="url(#crm-fold-soften)">
        {FOLDS.map((fold, index) => <path key={index} d={fold.d} fill={`url(#crm-fold-${index})`} />)}
      </g>
      <g filter="url(#crm-fold-glow)" fill="none" stroke="url(#crm-fold-shine)" strokeWidth="3" strokeLinecap="round">
        {HIGHLIGHTS.map((line, index) => <path key={index} d={line.d} strokeOpacity={line.opacity} />)}
      </g>
      <rect width={W} height={H} filter="url(#crm-fold-grain)" opacity="0.07" />
      <rect width={W} height={H} fill="url(#crm-fold-vignette)" />
    </svg>
  );
}
