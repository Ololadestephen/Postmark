// The claimant's proof helper for on-chain task bounties: paste a transaction
// hash, run the same checks the verifiers run, copy the proof line for GitHub.
import { useState } from "react";
import type { Hex } from "viem";
import {
  chainReader, checkOnchainProof, claimEventsOf, claimedAtFor, proofCheckPassed, type ProofCheck,
} from "../chain/onchainCheck";
import { useIndex } from "../hooks/queries";
import { proofLine } from "../formats/lines";
import { errorMessage } from "../chain/errors";
import { nowSec } from "../chain/time";
import { explorerTx } from "../chain/config";
import type { Task } from "../github/task";
import type { Bounty } from "../chain/client";

export function ProofHelper({ id, bounty, task }: { id: bigint; bounty: Bounty; task: Task }) {
  const index = useIndex();
  const [tx, setTx] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(ProofCheck & { txHash: Hex }) | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const hash = tx.trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Paste a 0x transaction hash.");
      const claimedAt = await claimedAtFor(
        bounty, claimEventsOf(index.data?.events ?? [], id), chainReader);
      if (claimedAt === null) throw new Error("Can't tell when the claim was stamped on chain.");
      const res = await checkOnchainProof(task, { txHash: hash as Hex }, {
        claimant: bounty.payee, claimedAt, deadline: bounty.deadline, now: nowSec(),
      }, chainReader);
      setResult({ ...res, txHash: hash as Hex });
    } catch (e) {
      setError(errorMessage(e));
    } finally { setBusy(false); }
  };

  const line = result ? proofLine(result.txHash) : "";
  const copyLine = () => {
    void navigator.clipboard?.writeText(line);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-3 rounded-lg border border-ink/10 bg-white/70 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray">check your proof</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={tx} onChange={(e) => setTx(e.target.value)}
          placeholder="0x… transaction hash"
          className="min-w-0 w-full rounded-lg border border-ink/10 bg-paper px-3 py-2 font-mono text-xs text-ink sm:w-80" />
        <button type="button" onClick={() => void run()} disabled={busy}
          className="rounded-lg border border-ink/15 px-3 py-2 text-sm text-gray hover:bg-ink/5 disabled:opacity-40">
          {busy ? "Checking…" : "Check"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-orange">{error}</p>}
      {result && (
        <ul className="mt-3 space-y-1 text-sm">
          {result.items.map((c) => (
            <li key={c.label} className={c.ok ? "text-deep" : "text-orange"}>
              {c.ok ? "✓" : "✗"} {c.label}
            </li>
          ))}
          <li className="pt-1 font-mono text-xs text-gray">
            <a href={explorerTx(result.txHash)} target="_blank" rel="noreferrer"
              className="underline decoration-dotted hover:text-deep">
              tx {result.txHash.slice(0, 14)}…
            </a>
          </li>
        </ul>
      )}
      {result && proofCheckPassed(result) && (
        <div className="mt-3">
          <p className="text-xs text-gray">All checks pass — post this line on the issue:</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <code className="w-full grow break-all rounded-lg border border-ink/10 bg-paper p-3 font-mono text-xs text-ink">{line}</code>
            <button type="button" onClick={copyLine}
              className="shrink-0 rounded-lg bg-deep px-5 py-2 text-sm font-medium text-paper hover:brightness-110">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
