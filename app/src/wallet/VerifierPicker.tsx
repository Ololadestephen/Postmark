import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { usePqcStatus, useSelfListed } from "../hooks/queries";
import type { Listing } from "../formats/verifierListing";
import { VERIFIERS, JOIN_VERIFIER_PATH, type VerifierEntry } from "../data/verifiers";
import { sameAddress } from "../chain/address";
import { shortAddr } from "../components/ui";
import { useToast } from "../components/Toasts";

export const MAX_VERIFIERS = 3;

/** Click-to-toggle: removes the address if picked, otherwise takes the first empty slot (none left: unchanged). */
export function toggleVerifier(slots: string[], address: string): string[] {
  const at = slots.findIndex((s) => sameAddress(s, address));
  const next = [...slots];
  if (at >= 0) { next[at] = ""; return next; }
  const empty = next.findIndex((s) => s.trim() === "");
  if (empty < 0) return slots;
  next[empty] = address;
  return next;
}

/** Up to three live-key verifiers, never the connected account, in list order. */
export function pickForMe(
  candidates: { address: string; live: boolean | undefined }[], connected: string | undefined,
): string[] {
  return candidates
    .filter((c) => c.live === true && !sameAddress(c.address, connected))
    .slice(0, MAX_VERIFIERS).map((c) => c.address);
}

export const inviteMessage = (appUrl: string) =>
  "I'd like you to review work as a verifier on Postmark (a QoreChain testnet bounty app). "
  + "1) Install QoreX from https://qorechain.io. 2) Make one send in QoreX so your post-quantum key is registered. "
  + `3) Open ${appUrl} and list yourself as a verifier. Testnet only: test QOR, no monetary value.`;

function Card({ v, picked, disabled, onToggle, live }: {
  v: VerifierEntry; picked: boolean; disabled: boolean; onToggle: () => void; live: boolean | undefined;
}) {
  return (
    <button type="button" aria-pressed={picked} disabled={disabled && !picked} onClick={onToggle}
      className={`rounded-xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-deep disabled:opacity-50 ${
        picked ? "border-deep bg-leaf/30" : "border-ink/15 bg-white hover:bg-ink/5"}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{v.name}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          live === true ? "bg-leaf text-ink" : live === false ? "bg-salmon text-ink" : "bg-ink/10 text-charcoal"}`}>
          {live === true ? "PQ key live" : live === false ? "no live key" : "checking…"}
        </span>
      </span>
      <span className="mt-1 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          v.kind === "bot" ? "bg-ink text-paper" : "bg-mustard text-ink"}`}>{v.kind === "bot" ? "Bot" : "Human"}</span>
        <span className="font-mono text-[11px] text-gray">{shortAddr(v.address)}</span>
      </span>
      <span className="mt-1 block text-xs text-charcoal">{v.runner}</span>
      <span className="mt-1 block text-xs text-gray">{v.note}</span>
    </button>
  );
}

function ListedCard({ l, picked, disabled, onToggle }: {
  l: Listing; picked: boolean; disabled: boolean; onToggle: () => void;
}) {
  const live = usePqcStatus(l.address).data?.live;
  return (
    <div className={`rounded-xl border p-3 transition ${picked ? "border-deep bg-leaf/30" : "border-ink/15 bg-white"}`}>
      <button type="button" aria-pressed={picked} disabled={disabled && !picked} onClick={onToggle}
        aria-label={`@${l.login}`}
        className="block w-full text-left focus-visible:outline-2 focus-visible:outline-deep disabled:opacity-50">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">@{l.login}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            live === true ? "bg-leaf text-ink" : live === false ? "bg-salmon text-ink" : "bg-ink/10 text-charcoal"}`}>
            {live === true ? "PQ key live" : live === false ? "no live key" : "checking…"}
          </span>
        </span>
        <span className="mt-1 flex items-center gap-2">
          <span className="rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-charcoal">Self-listed · not vetted</span>
          <span className="font-mono text-[11px] text-gray">{shortAddr(l.address)}</span>
        </span>
      </button>
      <a className="mt-1 inline-block text-xs text-deep underline underline-offset-4" target="_blank" rel="noreferrer"
        href={`https://github.com/${l.login}`}>github.com/{l.login}</a>
    </div>
  );
}

export function VerifierPicker({ slots, onChange, connected, children }: {
  slots: string[]; onChange: (slots: string[]) => void; connected: string | undefined; children?: ReactNode;
}) {
  const toast = useToast();
  const [openManual, setOpenManual] = useState(false);
  const [needsMore, setNeedsMore] = useState(false);
  const manual = useRef<HTMLDivElement>(null);
  // VERIFIERS is a fixed list, so the hook count never changes between renders
  const statuses = VERIFIERS.map((v) => usePqcStatus(v.address).data?.live);
  const listed = useSelfListed();
  const selfListed = listed.data ?? [];
  const count = slots.filter((s) => s.trim() !== "").length;
  const full = count >= MAX_VERIFIERS;
  const pick = () => {
    const picks = pickForMe(VERIFIERS.map((v, i) => ({ address: v.address, live: statuses[i] })), connected);
    if (picks.length === 0) {
      toast({ kind: "warning", title: "No verifier ready", text: "No listed verifier has a live key right now. Add someone else below." });
      return;
    }
    onChange(Array.from({ length: MAX_VERIFIERS }, (_, i) => picks[i] ?? ""));
    setNeedsMore(picks.length < MAX_VERIFIERS);
    if (picks.length < MAX_VERIFIERS) setOpenManual(true);
  };
  useEffect(() => {
    if (!needsMore || !openManual) return;
    const empty = [...(manual.current?.querySelectorAll<HTMLInputElement>("input") ?? [])].find((i) => i.value.trim() === "");
    empty?.focus();
  }, [needsMore, openManual, slots]);
  const invite = () => {
    void navigator.clipboard.writeText(inviteMessage(`${window.location.origin}${JOIN_VERIFIER_PATH}`));
    toast({ kind: "success", title: "Copied", text: "Invite message copied — send it to a friend." });
  };
  return (
    <div>
      <p className="text-sm text-charcoal">3 verifiers review the work; any 2 agreeing releases the reward.</p>
      <p className="mt-1 text-xs text-gray">
        The curated set is two Postmark maintainer-run bots plus a human tie-breaker. All three are run by the
        Postmark maintainer today; replace one with your own repo's bot for more independence (
        <a className="text-deep underline underline-offset-4" target="_blank" rel="noreferrer"
          href="https://github.com/Ololadestephen/Postmark#run-your-own-verifier">run your own verifier</a>).
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={pick}
          className="rounded-lg bg-deep px-4 py-2 text-sm font-medium text-paper hover:brightness-110">Pick 3 for me</button>
        <span aria-live="polite" className="text-xs text-gray">{count} of {MAX_VERIFIERS} chosen</span>
      </div>
      <div role="group" aria-label="Verifiers" className="mt-3 grid gap-2 sm:grid-cols-2">
        {VERIFIERS.map((v, i) => (
          <Card key={v.address} v={v} live={statuses[i]}
            picked={slots.some((s) => sameAddress(s, v.address))} disabled={full}
            onToggle={() => onChange(toggleVerifier(slots, v.address))} />
        ))}
      </div>
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-charcoal">Self-listed verifiers (not vetted)</h3>
        <p className="mt-1 text-xs text-gray">
          Anyone with a live post-quantum key can list themselves. A listing proves key control, not independence: you choose whom to trust.
        </p>
        {listed.isError ? (
          <p role="status" className="mt-2 text-xs text-gray">Couldn't load self-listed verifiers right now.</p>
        ) : selfListed.length > 0 ? (
          <div role="group" aria-label="Self-listed verifiers" className="mt-2 grid gap-2 sm:grid-cols-2">
            {selfListed.map((l) => (
              <ListedCard key={l.address} l={l} disabled={full}
                picked={slots.some((s) => sameAddress(s, l.address))}
                onToggle={() => onChange(toggleVerifier(slots, l.address))} />
            ))}
          </div>
        ) : !listed.isPending ? (
          <p className="mt-2 text-xs text-gray">No one has listed yet.</p>
        ) : null}
      </div>
      {needsMore && count < MAX_VERIFIERS && (
        <p role="status" className="mt-3 rounded-lg bg-mustard/40 p-2 text-sm text-ink">
          {MAX_VERIFIERS - count} {MAX_VERIFIERS - count === 1 ? "slot" : "slots"} left: add your repo's verifier bot or another person below.
        </p>
      )}
      <details className="mt-3" open={openManual} onToggle={(e) => setOpenManual((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-sm font-medium text-deep">Add someone else</summary>
        <div ref={manual} className="mt-3 space-y-2">{children}</div>
      </details>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <button type="button" onClick={invite} className="text-deep underline underline-offset-4">Ask a friend to verify</button>
        <Link className="text-deep underline underline-offset-4" to={JOIN_VERIFIER_PATH}>Become a verifier</Link>
      </div>
    </div>
  );
}
