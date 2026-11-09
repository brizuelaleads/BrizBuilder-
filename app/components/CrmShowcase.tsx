"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, MotionConfig, motion, useInView, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import { CalendarCheck, DollarSign, MessageSquareText, PhoneIncoming, UserPlus } from "lucide-react";
import styles from "../landing.module.css";

const EASE = [0.22, 1, 0.36, 1] as const;
const CYCLE_MS = 5200;

// Sample-data captures from work/ui-review/landing-shots.mjs. The chips narrate
// what each screen is for, using the same sample records the captures show.
const SCREENS = [
  {
    id: "dashboard",
    label: "Dashboard",
    caption: "Leads, missed calls, and revenue at a glance.",
    src: "/landing/crm-dashboard.webp",
    alt: "BrizBuilder dashboard showing leads, missed calls, revenue, lead sources, and today's appointments",
    chips: [
      { icon: UserPlus, title: "New lead", detail: "Alex Rivera · Google", at: { top: "20%", right: "-3%" } },
      { icon: DollarSign, title: "Lead won", detail: "+$3,500 revenue", at: { bottom: "14%", left: "-3%" } },
    ],
  },
  {
    id: "pipeline",
    label: "Pipeline",
    caption: "Every lead from New to Won, with its source and value.",
    src: "/landing/crm-pipeline.webp",
    alt: "BrizBuilder pipeline board with sample leads in New, Contacted, Qualified, and Appointment",
    chips: [
      { icon: PhoneIncoming, title: "Moved to Contacted", detail: "Jordan Chen · Facebook", at: { top: "16%", left: "38%" } },
      { icon: CalendarCheck, title: "Appointment set", detail: "Casey Rivera · Thu 2 PM", at: { bottom: "16%", right: "-3%" } },
    ],
  },
  {
    id: "conversations",
    label: "Conversations",
    caption: "Calls and texts with every customer, in one thread.",
    src: "/landing/crm-conversations.webp",
    alt: "BrizBuilder conversations view with a sample text thread",
    chips: [
      { icon: MessageSquareText, title: "New text", detail: "“Can someone look at a leak?”", at: { top: "18%", right: "-3%" } },
      { icon: CalendarCheck, title: "Booked from a text", detail: "Thursday at 2 PM", at: { bottom: "18%", left: "-3%" } },
    ],
  },
] as const;

export function CrmShowcase() {
  const stage = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(stage, { amount: 0.35 });
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  // The screen starts tipped back and settles flat as it scrolls into view.
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "start 0.25"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24, mass: 0.4 });
  const rotateX = useTransform(progress, [0, 1], [reduce ? 0 : 22, 0]);
  const scale = useTransform(progress, [0, 1], [reduce ? 1 : 0.9, 1]);
  const lift = useTransform(progress, [0, 1], [reduce ? 0 : 60, 0]);

  const running = inView && !paused && !reduce;
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setActive((index) => (index + 1) % SCREENS.length), CYCLE_MS);
    return () => window.clearTimeout(timer);
  }, [active, running]);

  const screen = SCREENS[active];

  return (
    <MotionConfig reducedMotion="user">
      <section className={styles.showcase} aria-label="A look inside BrizBuilder" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
        <div className={styles.showcaseTabs} role="tablist" aria-label="CRM screens">
          {SCREENS.map((item, index) => (
            <button key={item.id} type="button" role="tab" id={`showcase-tab-${item.id}`} aria-selected={index === active} aria-controls="showcase-panel" className={styles.showcaseTab} onClick={() => setActive(index)}>
              {index === active ? <motion.span layoutId="showcase-pill" className={styles.showcasePill} transition={{ type: "spring", stiffness: 380, damping: 32 }} /> : null}
              <span className={styles.showcaseTabLabel}>{item.label}</span>
              {index === active && running ? <motion.span key={`bar-${active}`} className={styles.showcaseTimer} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: CYCLE_MS / 1000, ease: "linear" }} /> : null}
            </button>
          ))}
        </div>

        <div className={styles.showcaseStage} ref={stage}>
          <motion.div className={styles.showcaseTilt} style={{ rotateX, scale, y: lift }}>
            <div className={`${styles.screenFrame} ${styles.showcaseFrame}`} id="showcase-panel" role="tabpanel" aria-labelledby={`showcase-tab-${screen.id}`}>
              <div className={styles.showcaseViewport}>
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.div key={screen.id} className={styles.showcaseShot} initial={{ opacity: 0, scale: 1.04, filter: "blur(8px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, scale: 0.98, filter: "blur(8px)" }} transition={{ duration: 0.7, ease: EASE }}>
                    <Image src={screen.src} alt={screen.alt} width={1800} height={1125} sizes="(max-width: 1400px) 92vw, 1300px" priority={screen.id === "dashboard"} unoptimized />
                  </motion.div>
                </AnimatePresence>
                <span className={styles.showcaseSheen} aria-hidden="true" />
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.ul key={screen.id} className={styles.showcaseChips} aria-hidden="true" initial="hidden" animate="shown" exit="hidden" variants={{ shown: { transition: { staggerChildren: 0.9, delayChildren: 0.5 } }, hidden: { transition: { staggerChildren: 0.05, staggerDirection: -1 } } }}>
                {screen.chips.map(({ icon: Icon, title, detail, at }) => (
                  <motion.li key={title} className={styles.showcaseChip} style={at} variants={{ hidden: { opacity: 0, y: 16, scale: 0.92 }, shown: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 260, damping: 22 } } }}>
                    <span className={styles.showcaseChipIcon}><Icon /></span>
                    <span><strong>{title}</strong><small>{detail}</small></span>
                  </motion.li>
                ))}
              </motion.ul>
            </AnimatePresence>
          </motion.div>
        </div>

        <AnimatePresence mode="wait">
          <motion.p key={screen.id} className={styles.showcaseCaption} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease: EASE }}>
            <strong>{screen.label}.</strong> {screen.caption} <span>Sample records shown.</span>
          </motion.p>
        </AnimatePresence>
      </section>
    </MotionConfig>
  );
}

export function HeroReveal({ lines }: { lines: string[] }) {
  return (
    <MotionConfig reducedMotion="user">
      <h1 aria-label={lines.join(" ")}>
        {lines.map((line, index) => (
          <span key={line} className={styles.heroLine} aria-hidden="true">
            <motion.span initial={{ y: "105%" }} animate={{ y: "0%" }} transition={{ duration: 0.9, delay: 0.1 + index * 0.12, ease: EASE }}>{line}</motion.span>
          </span>
        ))}
      </h1>
    </MotionConfig>
  );
}
