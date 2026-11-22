import { FadeIn } from "./FadeIn";
import { CountText, ScrambleText, SpotCard } from "../../components/motion";
import { PROOF, FAQ } from "./content";

export function Proof() {
  return (
    <section className="bg-paper px-4 py-20">
      <FadeIn className="mx-auto max-w-5xl">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Proof, not promises</h2>
        <p className="mt-3 max-w-xl text-charcoal">Real on-chain facts on diana testnet. Every link opens the explorer.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROOF.map((p) => (
            <SpotCard key={p.label} className="rounded-xl border border-ink/10 bg-white p-5 shadow-sm" spotlightColor="rgba(125,176,105,0.18)">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray">{p.label}</div>
              {p.href ? (
                <a href={p.href} target="_blank" rel="noreferrer"
                  className={`mt-2 block break-all text-deep underline decoration-deep/30 underline-offset-2 hover:decoration-deep ${p.mono ? "font-mono text-xs" : "text-sm font-medium"}`}>
                  {p.mono ? <ScrambleText text={p.value} /> : p.value}
                </a>
              ) : (
                <p className="mt-2 text-sm text-ink">
                  {p.count ? <><CountText animate text={p.count} /> {p.value}</> : p.value}
                </p>
              )}
              {p.hash && <p className="mt-2 break-all font-mono text-[11px] text-charcoal"><ScrambleText text={p.hash} /></p>}
              {p.note && <p className="mt-2 text-xs text-gray">{p.note}</p>}
            </SpotCard>
          ))}
        </div>
      </FadeIn>
    </section>
  );
}

export function Faq() {
  return (
    <section className="border-t border-ink/10 bg-paper px-4 py-20">
      <FadeIn className="mx-auto grid max-w-5xl gap-10 md:grid-cols-[1fr_1.6fr]">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Questions</h2>
        <div className="divide-y divide-ink/10 border-y border-ink/10">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium tracking-tight">
                {q}
                <span className="grid size-6 place-items-center rounded-full bg-ink/5 text-deep transition-transform group-open:rotate-45" aria-hidden>+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-charcoal">{a}</p>
            </details>
          ))}
        </div>
      </FadeIn>
    </section>
  );
}
