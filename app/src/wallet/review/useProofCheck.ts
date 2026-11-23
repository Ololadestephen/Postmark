import { useState } from "react";
import type { Hex } from "viem";
import {
  chainReader, checkOnchainProof, claimEventsOf, claimedAtFor, proofCheckPassed, selectProof,
  type ProofCheckItem,
} from "../../chain/onchainCheck";
import { onchainEvidenceHashOf } from "../../formats/hashes";
import { useBounties, useIndex } from "../../hooks/queries";
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
  const bounties = useBounties(index.data?.bountyIds);
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
      // same rule the bots apply: a proof already paid on another bounty does not count
      if (proofCheckPassed(res) && res.blockTimestamp !== null) {
        const evidenceHash = onchainEvidenceHashOf(task.type, hash as Hex, res.blockTimestamp, bounty.payee);
        const taken = (bounties.data ?? [])
          .filter((b) => b.id !== id && b.bounty).map((b) => b.bounty!.initialEvidenceHash);
        if (!selectProof([{ txHash: hash as Hex, at: res.blockTimestamp, evidenceHash }], taken)) {
          throw new Error("This proof transaction was already used to pay another bounty.");
        }
      }
      setResult({ txHash: hash as Hex, checks: res.items, blockTimestamp: res.blockTimestamp });
    } catch (e) {
      setResult(null);
      setError(errorMessage(e, "Transaction lookup failed."));
    } finally { setBusy(false); }
  };

  return { txHash, setTxHash, result, error, busy, check };
}
