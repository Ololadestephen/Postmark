import { useAccount } from "wagmi";
import WalletRoot from "./WalletRoot";
import { useTxAction } from "../hooks/useTxAction";
import { useToast } from "../components/Toasts";
import { Card, SectionLabel } from "../components/ui";
import { sameAddress } from "../chain/address";
import { nowSec } from "../chain/time";
import type { Bounty } from "../chain/client";
import { NativeSend } from "./NativeSend";

function ActionButton({ label, run, busy }:
  { label: string; run: () => void; busy: boolean }) {
  return (
    <button onClick={run} disabled={busy}
      className="rounded-lg border border-salmon/50 px-4 py-2 text-sm font-medium text-deep transition hover:bg-salmon/10 disabled:cursor-not-allowed disabled:opacity-40">
      {label}
    </button>
  );
}

function ActionsInner({ id, bounty, connected }: { id: bigint; bounty: Bounty; connected: boolean }) {
  const { address } = useAccount();
  const tx = useTxAction();
  const toast = useToast();
  const { busy } = tx;
  const t = nowSec();
  const isFunder = sameAddress(address, bounty.funder);

  const refund = isFunder && (bounty.state === 0 || bounty.state === 1) && t >= bounty.deadline;
  const finalize = bounty.state === 2 && bounty.challengeEndsAt > 0n && t >= bounty.challengeEndsAt;
  const reopen = bounty.state === 1 && bounty.claimExpiresAt > 0n && t >= bounty.claimExpiresAt;

  const done = () => {
    toast({ kind: "success", title: "Transaction confirmed", text: "The bounty is updated." });
  };

  if (!refund && !finalize && !reopen) return null;
  if (!connected) {
    return (
      <Card tone="accent">
        <SectionLabel tone="accent">actions</SectionLabel>
        <p className="mt-3 text-sm text-charcoal">
          {finalize ? "Challenge window closed — ready to finalize. Connect a wallet to finalize this payout; anyone can."
            : "This claim has expired. Connect a wallet to reopen the bounty; anyone can."}
        </p>
        {finalize && <NativeSend call={{ functionName: "finalize", args: [id] }} label="Finalize with QoreX" onConfirmed={done} />}
      </Card>
    );
  }
  return (
    <Card>
      <SectionLabel>actions</SectionLabel>
      <div className="mt-3 flex flex-wrap gap-2">
        {refund && <ActionButton busy={busy} label="Refund expired bounty"
          run={() => void tx.run({ functionName: "refundExpired", args: [id], onConfirmed: done })} />}
        {finalize && <ActionButton busy={busy} label="Finalize payout"
          run={() => void tx.run({ functionName: "finalize", args: [id], onConfirmed: done })} />}
        {reopen && <ActionButton busy={busy} label="Reopen expired claim"
          run={() => void tx.run({ functionName: "reopen", args: [id], onConfirmed: done })} />}
      </div>
      {finalize && <NativeSend call={{ functionName: "finalize", args: [id] }} label="Finalize with QoreX" onConfirmed={done} disabled={busy} />}
      <TxPanel state={tx.state} />
    </Card>
  );
}

import { TxStatusPanel as TxPanel } from "./TxWidgets";

export default function TxActions(props: { id: bigint; bounty: Bounty }) {
  return <WalletRoot><Gate {...props} /></WalletRoot>;
}

function Gate(props: { id: bigint; bounty: Bounty }) {
  const { isConnected } = useAccount();
  return <ActionsInner {...props} connected={isConnected} />;
}
