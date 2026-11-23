import { useState } from "react";
import type { Hex } from "viem";
import { getAllComments, findClaimComments, findDisputeComments } from "../../github/client";
import { githubItemUrl } from "../../github/parse";
import { identityHashOf, disputeEvidenceHashOf } from "../../formats/hashes";
import { ESCROW_ADDRESS } from "../../chain/config";
import { errorMessage } from "../../chain/errors";
import type { Bounty } from "../../chain/client";
import type { BountyMeta } from "../../chain/indexer";

export interface ClaimIdentity {
  login: string; commentId: bigint; hash: Hex; url: string; matches: boolean;
  /** brief hash on the claim line, for on-chain task bounties */
  brief?: string;
}
export interface DisputeComment { commentId: bigint; login: string; url: string }

/** Scan the GitHub item for the claimant's claim line (and, when disputed, the dispute comment). */
export function useIdentityCheck(id: bigint, bounty: Bounty, meta: BountyMeta, disputed: boolean) {
  const [status, setStatus] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<ClaimIdentity | null>(null);
  const [disputeComment, setDisputeComment] = useState<DisputeComment | null>(null);

  const scan = async () => {
    setStatus("scanning"); setError(null);
    const itemUrl = githubItemUrl(meta);
    const escrow = ESCROW_ADDRESS.toLowerCase();
    try {
      const comments = await getAllComments(meta.ownerRepo, Number(meta.number));
      if (disputed) {
        // locate the comment that produced the stored disputeEvidenceHash
        for (const c of findDisputeComments(comments)) {
          if (c.escrow === escrow && c.bountyId === Number(id)
              && disputeEvidenceHashOf(c.githubLogin, BigInt(c.commentId)) === bounty.disputeEvidenceHash) {
            setDisputeComment({ commentId: BigInt(c.commentId), login: c.githubLogin,
              url: `${itemUrl}#issuecomment-${c.commentId}` });
          }
        }
      }
      const hits = findClaimComments(comments).filter((c) =>
        c.claimant === bounty.payee.toLowerCase() && c.bountyId === Number(id) && c.escrow === escrow);
      if (hits.length === 0) {
        setIdentity(null);
        setError("No claim line from this claimant on the item.");
      } else {
        const c = hits[0]!;
        const hash = identityHashOf(c.githubLogin, bounty.payee, BigInt(c.commentId));
        setIdentity({ login: c.githubLogin, commentId: BigInt(c.commentId), hash,
          url: `${itemUrl}#issuecomment-${c.commentId}`,
          matches: hash === bounty.payeeIdentityHash,
          ...(c.brief ? { brief: c.brief } : {}) });
      }
      setStatus("done");
    } catch (e) {
      setError(errorMessage(e, "GitHub lookup failed."));
      setStatus("error");
    }
  };

  return { status, error, identity, disputeComment, scan };
}
