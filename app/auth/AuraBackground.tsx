import styles from "../landing.module.css";

// Grainy monochrome aura behind the glass: blurred light fields drifting slowly,
// with an SVG noise layer on top. Pure CSS/SVG, so the entry pages ship no images.
export function AuraBackground() {
  return (
    <div className={styles.aura} aria-hidden="true">
      <span className={styles.auraOne} />
      <span className={styles.auraTwo} />
      <span className={styles.auraThree} />
      <svg className={styles.grain} width="100%" height="100%" focusable="false">
        <filter id="entry-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#entry-grain)" />
      </svg>
    </div>
  );
}
