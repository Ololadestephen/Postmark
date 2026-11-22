import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { Link } from "react-router";
import BlurText from "../reactbits/BlurText";
import { createLoader, useEarlyAnimation } from "./early";

const countUpLoader = createLoader(() => import("../reactbits/CountUp"));
const decryptedLoader = createLoader(() => import("../reactbits/DecryptedText"));
const LogoLoop = lazy(() => import("../reactbits/LogoLoop"));
const Magnet = lazy(() => import("../reactbits/Magnet"));
const ShinyText = lazy(() => import("../reactbits/ShinyText"));
const SpotlightCard = lazy(() => import("../reactbits/SpotlightCard"));
const StarBorder = lazy(() => import("../reactbits/StarBorder"));

type CountUpProps = ComponentProps<typeof import("../reactbits/CountUp").default>;
type DecryptedProps = ComponentProps<typeof import("../reactbits/DecryptedText").default>;

/** Every wrapper renders its final content statically under prefers-reduced-motion. */

/** Two-line headline that blurs in word by word on mount; the accent word keeps its own colour. */
export function BlurHeadline({ line1, line2, accent, tail = "", accentClass }:
  { line1: string; line2: string; accent: string; tail?: string; accentClass: string }) {
  const reduce = useReducedMotion();
  const full = `${line1} ${line2} ${accent}${tail}`;
  const finalText = (
    <span>
      <span className="block">{line1}</span>{" "}
      <span className="block">{line2} <span className={accentClass}>{accent}</span>{tail}</span>
    </span>
  );
  if (reduce) return finalText;
  return (
    <span aria-label={full}>
      <span className="block"><BlurText text={line1} trigger="load" delay={70} className="justify-center" /></span>{" "}
      <span className="block">
        <BlurText text={line2} trigger="load" delay={70} className="justify-center" />{" "}
        <BlurText text={accent} trigger="load" delay={70} className={accentClass} />{tail}
      </span>
    </span>
  );
}

export function ShinyBar({ text }: { text: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{text}</>;
  return (
    <Suspense fallback={text}>
      <ShinyText text={text} color="rgba(243,243,238,0.8)" shineColor="#ffffff" speed={4} delay={2} />
    </Suspense>
  );
}

export function MagnetButton({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <Suspense fallback={children}>
      <Magnet magnetStrength={0.15} maxOffset={8} wrapperClassName="inline-block">{children}</Magnet>
    </Suspense>
  );
}

/** Slow text marquee. Copies are aria-hidden by LogoLoop; reduced motion shows one static row. */
export function TextMarquee({ items, ariaLabel }: { items: string[]; ariaLabel: string }) {
  const reduce = useReducedMotion();
  const staticRow = (
    <ul aria-label={ariaLabel} className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
      {items.map((t) => <li key={t} className="font-mono text-xs text-paper/85">{t}</li>)}
    </ul>
  );
  if (reduce) return staticRow;
  return (
    <Suspense fallback={staticRow}>
      <LogoLoop ariaLabel={ariaLabel} speed={40} gap={48} logoHeight={20} pauseOnHover fadeOut fadeOutColor="#1c1c18"
        logos={items.map((t) => ({ node: <span className="font-mono text-xs text-paper/85">{t}</span>, title: t }))} />
    </Suspense>
  );
}

export function ScrambleText({ text, className = "" }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  const [ref, Animated] = useEarlyAnimation<DecryptedProps, HTMLSpanElement>(decryptedLoader);
  return (
    <span ref={ref} className={className}>
      {!reduce && Animated
        ? <Animated text={text} animateOn="view" speed={30} maxIterations={12} sequential revealDirection="start"
            className={className} parentClassName={className} />
        : text}
    </span>
  );
}

/** Splits a formatQor-style string into CountUp props, or null when it can't be counted (e.g. "<0.0001"). */
export function countProps(text: string): { to: number; decimals: number } | null {
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return { to: Number(text), decimals: text.split(".")[1]?.length ?? 0 };
}

/** Shows a number; counts up to it only when `animate` is set (the landing page). Data pages show values
 * the moment they arrive. */
export function CountText({ text, className, suffix = "", animate = false }:
  { text: string; className?: string; suffix?: string; animate?: boolean }) {
  const reduce = useReducedMotion();
  const props = countProps(text);
  const [ref, Animated] = useEarlyAnimation<CountUpProps, HTMLSpanElement>(countUpLoader);
  const counting = animate && !reduce && props && Animated;
  return (
    <span ref={ref} className={className}>
      {counting ? (
        <>
          <span className="sr-only">{text}{suffix}</span>
          <span aria-hidden><Animated {...props} trigger="view" duration={1.2} suffix={suffix} /></span>
        </>
      ) : `${text}${suffix}`}
    </span>
  );
}

/** Card with a soft cursor spotlight; plain card under reduced motion. */
export function SpotCard({ className, spotlightColor, children }:
  { className: string; spotlightColor: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <Suspense fallback={<div className={className}>{children}</div>}>
      <SpotlightCard className={className} spotlightColor={spotlightColor}>{children}</SpotlightCard>
    </Suspense>
  );
}

/** Router link with an animated star border (landing CTA). */
export function StarLink({ to, className, children }: { to: string; className: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <Link to={to} className={className}>{children}</Link>;
  return (
    <Suspense fallback={<Link to={to} className={className}>{children}</Link>}>
      <StarBorder as={Link} to={to} className={className} color="#d4f57a" duration={6}>{children}</StarBorder>
    </Suspense>
  );
}
