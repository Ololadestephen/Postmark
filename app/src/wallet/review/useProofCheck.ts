import { useState } from "react";
import type { Hex } from "viem";
import {
  chainReader, checkOnchainProof, claimEventsOf, claimedAtFor, type ProofCheckItem,
} from "../../chain/onchainCheck";
import { useIndex } from "../../hooks/queries";
import { errorMessage } from "../../chain/errors";
import { nowSec } from "../../chain/time";
import type { Task } from "../../github/task";
import type { Bounty } from "../../chain/client";

export interface ProofCheck {
  txHash: Hex; checks: ProofCheckItem[]; blockTimestamp: bigint | null;
}

/** Run the on-chain proof checks (same function the bots use) on a pasted transaction hash. */
export function useProofCheck(id: bigint, bounty: Bounty, task: Task | null) {
  const index = useIndex();
  const [txHash, setTxHash] = useState("");
  const [result, setResult] = useState<ProofCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true); setError(null);
    try {
      if (!task) throw new Error("No on-chain task on this bounty.");
      const hash = txHash.trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Paste a 0x transaction hash.");
      const claimedAt = await claimedAtFor(
        bounty, claimEventsOf(index.data?.events ?? [], id), chainReader);
      if (claimedAt === null) throw new Error("Can't tell when the claim was stamped on chain.");
      const res = await checkOnchainProof(task, { txHash: hash as Hex }, {
        claimant: bounty.payee, claimedAt, deadline: bounty.deadline, now: nowSec(),
      }, chainReader);
      setResult({ txHash: hash as Hex, checks: res.items, blockTimestamp: res.blockTimestamp });
    } catch (e) {
      setResult(null);
      setError(errorMessage(e, "Transaction lookup failed."));
    } finally { setBusy(false); }
  };

  return { txHash, setTxHash, result, error, busy, check };
}
