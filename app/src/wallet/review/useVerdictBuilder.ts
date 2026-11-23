import { useState } from "react";
import type { Hex } from "viem";
import { buildVerdictFor, OUTCOME, type BuiltVerdict } from "../../chain/verdict";
import { errorMessage } from "../../chain/errors";
import { mergedAtSeconds } from "../../github/prcheck";
import {
  onchainEvidenceHashOf, payEvidenceHashOf, refundEvidenceHashOf, resolutionEvidenceHashOf, REFUND_REASONS,
} from "../../formats/hashes";
import type { Task } from "../../github/task";
import type { Bounty } from "../../chain/client";
import type { PrCheck } from "./usePrCheck";
import type { ProofCheck } from "./useProofCheck";
import type { DisputeComment } from "./useIdentityCheck";

/** Turn the verifier's PAY / REFUND decision into the exact verdict struct and signing bytes. */
export function useVerdictBuilder(args: {
  id: bigint; bounty: Bounty; phase: number; disputed: boolean;
  prCheck: PrCheck | null; disputeComment: DisputeComment | null;
  /** on-chain task bounties: the passing proof transaction */
  proof?: { task: Task; check: ProofCheck } | null;
}) {
  const { id, bounty, phase, disputed, prCheck, disputeComment, proof } = args;
  const [refundReason, setRefundReason] = useState<string>(REFUND_REASONS[0]);
  const [refundUrl, setRefundUrl] = useState("");
  const [built, setBuilt] = useState<BuiltVerdict | null>(null);
  const [decision, setDecision] = useState<"pay" | "refund" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolution = (basis: Hex): Hex =>
    disputed ? resolutionEvidenceHashOf(disputeComment!.commentId, basis) : basis;

  const buildDecision = async (kind: "pay" | "refund") => {
    setError(null); setDecision(kind);
    try {
      if (kind === "pay") {
        if (proof) {
          const ts = proof.check.blockTimestamp;
          if (ts === null) throw new Error("The proof transaction has no confirmed block yet.");
          const basis = onchainEvidenceHashOf(proof.task.type, proof.check.txHash, ts, bounty.payee);
          setBuilt(await buildVerdictFor({
            bountyId: id, bounty, phase, outcome: OUTCOME.PAY,
            evidenceHash: resolution(basis), mergedAt: ts,
          }));
          return;
        }
        if (!prCheck) throw new Error("Run the PR check first — its fields build the evidence hash.");
        const mergedAt = mergedAtSeconds(prCheck.pr);
        const basis = payEvidenceHashOf(prCheck.repo, prCheck.number,
          prCheck.pr.merge_commit_sha ?? "", mergedAt, prCheck.pr.user.login);
        setBuilt(await buildVerdictFor({
          bountyId: id, bounty, phase, outcome: OUTCOME.PAY,
          evidenceHash: resolution(basis), mergedAt,
        }));
      } else {
        setBuilt(await buildVerdictFor({
          bountyId: id, bounty, phase, outcome: OUTCOME.REFUND,
          evidenceHash: resolution(refundEvidenceHashOf(refundReason, refundUrl)),
        }));
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return { built, decision, error, refundReason, setRefundReason, refundUrl, setRefundUrl, buildDecision };
}
