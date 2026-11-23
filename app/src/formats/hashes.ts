import { encodeAbiParameters, keccak256, type Hex } from "viem";

// keccak256(abi.encode(...)) — every domain hash from SPEC "Off-chain formats".

/** keccak256(abi.encode("github", ownerRepo, uint8 kind, uint256 number)) */
export function workHashOf(ownerRepo: string, kind: number, number: bigint | number): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "uint8" }, { type: "uint256" }],
    ["github", ownerRepo, kind, BigInt(number)]));
}

/** keccak256(abi.encode("postmark-identity-v1", githubLogin, claimant, commentId)) */
export function identityHashOf(githubLogin: string, claimant: `0x${string}`, commentId: bigint): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "address" }, { type: "uint256" }],
    ["postmark-identity-v1", githubLogin.toLowerCase(), claimant, commentId]));
}

/** PAY evidence hash. mergeCommitSha: 40-hex lowercase, mergedAt = GitHub merged_at seconds. */
export function payEvidenceHashOf(
  ownerRepo: string, prNumber: bigint | number,
  mergeCommitSha: string, mergedAt: bigint | number, prAuthorLogin: string,
): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "uint256" }, { type: "string" },
      { type: "uint64" }, { type: "string" }],
    ["postmark-evidence-v1", ownerRepo.toLowerCase(), BigInt(prNumber),
      mergeCommitSha.toLowerCase(), BigInt(mergedAt), prAuthorLogin.toLowerCase()]));
}

/** PAY evidence for on-chain task bounties: the proof transaction. mergedAt = its block timestamp. */
export function onchainEvidenceHashOf(
  type: string, txHash: Hex, blockTimestamp: bigint | number, claimant: `0x${string}`,
): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "bytes32" },
      { type: "uint64" }, { type: "address" }],
    ["postmark-onchain-v1", type, txHash, BigInt(blockTimestamp), claimant]));
}

export const REFUND_REASONS = ["not-merged", "ineligible", "identity-mismatch", "withdrawn", "other"] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/** REFUND evidence hash. */
export function refundEvidenceHashOf(reasonCode: string, detailsUrl: string): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "string" }],
    ["postmark-refund-v1", reasonCode, detailsUrl]));
}

/** Dispute evidence hash. */
export function disputeEvidenceHashOf(githubLogin: string, commentId: bigint): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "uint256" }],
    ["postmark-dispute-v1", githubLogin.toLowerCase(), commentId]));
}

/** Resolution evidence hash over a PAY/REFUND basis hash. */
export function resolutionEvidenceHashOf(disputeCommentId: bigint, basisHash: Hex): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "bytes32" }],
    ["postmark-resolution-v1", disputeCommentId, basisHash]));
}
