// Dispute a Pending verdict: post the SPEC line on GitHub, prove it with a
// comment id, then bond the dispute. Evidence = keccak(login, commentId).
import { useState } from "react";
import WalletRoot from "./WalletRoot";
import { useTxAction } from "../hooks/useTxAction";
import { useToast } from "../components/Toasts";
import { TxStatusPanel } from "./TxWidgets";
import { Card, Qor, SectionLabel } from "../components/ui";
import { getAllComments, findDisputeComments } from "../github/client";
import { githubItemUrl, githubItemLabel } from "../github/parse";
import { disputeEvidenceHashOf } from "../formats/hashes";
import { disputeLine } from "../formats/lines";
import { ESCROW_ADDRESS } from "../chain/config";
import { errorMessage } from "../chain/errors";
import { nowSec } from "../chain/time";
import type { Bounty } from "../chain/client";
import type { BountyMeta } from "../chain/indexer";

function DisputePanelBody({ id, bounty, meta }: { id: bigint; bounty: Bounty; meta: BountyMeta }) {
  const tx = useTxAction();
  const toast = useToast();
  const [login, setLogin] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [found, setFound] = useState<{ commentId: bigint; hash: `0x${string}`; url: string } | null>(null);

  const closed = nowSec() >= bounty.challengeEndsAt;
  const itemUrl = githubItemUrl(meta);
  const line = disputeLine(id, ESCROW_ADDRESS);

  const scan = async () => {
    setScanning(true); setScanErr(null);
    try {
      const comments = await getAllComments(meta.ownerRepo, Number(meta.number));
      const hits = findDisputeComments(comments).filter((c) =>
        c.escrow === ESCROW_ADDRESS.toLowerCase() && c.bountyId === Number(id)
        && c.githubLogin === login.trim().toLowerCase());
      if (hits.length === 0) {
        setScanErr(`No dispute line from @${login.trim() || "?"} on this item yet — post it, then rescan.`);
        return;
      }
      const c = hits[0]!;
      setFound({ commentId: BigInt(c.commentId),
        hash: disputeEvidenceHashOf(c.githubLogin, BigInt(c.commentId)),
        url: `${itemUrl}#issuecomment-${c.commentId}` });
    } catch (e) {
      setScanErr(errorMessage(e, "GitHub lookup failed."));
    } finally { setScanning(false); }
  };

  const send = () => {
    if (!found) return;
    void tx.run({
      functionName: "dispute",
      args: [id, found.hash],
      value: bounty.bondAmount,
      onConfirmed: () => toast({ kind: "success", title: "Dispute bonded", text: "The payout is frozen until the verifiers rule." }),
      invalidates: [["bounty", id.toString()], ["index"]],
    });
  };

  if (closed) return null;

  return (
    <Card tone="warn">
      <SectionLabel tone="warn">dispute this verdict</SectionLabel>
      <p className="mt-2 text-sm text-gray">
        Anyone can bond <Qor wei={bounty.bondAmount} /> against this verdict before the window
        closes. Post this exact line as a comment on{" "}
        <a className="text-deep underline underline-offset-4" href={itemUrl} target="_blank" rel="noreferrer">
          {githubItemLabel(meta)}</a>, with your reasons:
      </p>
      <div className="mt-2 flex items-start gap-2">
        <code className="grow break-all rounded-lg border border-ink/10 bg-paper p-3 font-mono text-xs text-ink">{line}</code>
        <button type="button"
          onClick={() => { void navigator.clipboard.writeText(line); toast({ kind: "success", title: "Copied", text: "Dispute line copied — post it as a GitHub comment." }); }}
          className="shrink-0 rounded-lg border border-ink/15 px-3 py-2 text-xs text-gray hover:bg-ink/5">copy</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={login} onChange={(e) => setLogin(e.target.value)}
          placeholder="your GitHub login"
          className="w-52 rounded-lg border border-ink/10 bg-paper px-3 py-2 font-mono text-xs text-ink" />
        <button type="button" onClick={() => void scan()} disabled={scanning || !login.trim()}
          className="rounded-lg border border-orange/60 px-4 py-2 text-sm text-orange hover:bg-orange/10 disabled:opacity-40">
          {scanning ? "Scanning…" : "I've posted it — find my comment"}
        </button>
      </div>
      {scanErr && <p role="alert" className="mt-2 text-sm text-orange">{scanErr}</p>}
      {found && (
        <div className="mt-3">
          <p className="text-sm text-gray">
            Found the dispute line (comment {found.commentId.toString()}) ·{" "}
            <a className="underline decoration-dotted hover:text-deep" href={found.url} target="_blank" rel="noreferrer">link</a>
          </p>
          <p className="mt-1 break-all font-mono text-xs text-gray">evidence {found.hash}</p>
          <button type="button" onClick={send}
            className="mt-3 rounded-lg bg-orange px-5 py-2 text-sm font-medium text-paper hover:brightness-110">
            Bond dispute (<Qor wei={bounty.bondAmount} />)
          </button>
        </div>
      )}
      <TxStatusPanel state={tx.state} onRetry={tx.retry} />
    </Card>
  );
}

export default function DisputePanel(props: { id: bigint; bounty: Bounty; meta: BountyMeta }) {
  return <WalletRoot><DisputePanelBody {...props} /></WalletRoot>;
}
