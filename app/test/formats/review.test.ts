import { describe, it, expect } from "vitest";
import { checkPull, mergedAtSeconds } from "../../src/github/prcheck";
import { findDisputeComments, type GhPull, type GhComment } from "../../src/github/client";
import { disputeEvidenceHashOf, resolutionEvidenceHashOf, payEvidenceHashOf } from "../../src/formats/hashes";
import { assembleVerdict, PHASE, OUTCOME, verdictPayloadHash } from "../../src/chain/verdict";
import { verdictMessage } from "../../src/formats/messages";
import { encodeAbiParameters, keccak256 } from "viem";

const CLAIMANT = "0x478f2a08a81be7cea42bd34bd6900593fa56c4b6" as const;
const ESCROW = "0xae80681e92b63efea78cb742dd612ecc940b896a" as const;

const pr = (over: Partial<GhPull>): GhPull => ({
  number: 7, title: "fix", state: "closed", merged: true,
  merged_at: "2026-01-01T00:00:00Z", merge_commit_sha: "a".repeat(40), body: null,
  user: { login: "e2e-claimant" }, html_url: "", ...over,
});

describe("PR checklist", () => {
  const opts = { expectedRepo: "acme/widgets", prRepo: "acme/widgets",
    deadline: BigInt(Math.floor(new Date("2026-01-02").getTime() / 1000)),
    identityLogin: "e2e-claimant" };

  it("passes a fully valid merged PR", () => {
    const checks = checkPull(pr({}), opts);
    expect(checks.every((c) => c.ok)).toBe(true);
  });
  it("flags an unmerged PR", () => {
    expect(checkPull(pr({ merged: false, merged_at: null }), opts)
      .find((c) => c.label === "merged")!.ok).toBe(false);
  });
  it("flags a merge after the deadline", () => {
    expect(checkPull(pr({ merged_at: "2026-01-03T00:00:00Z" }), opts)
      .find((c) => c.label.startsWith("merged_at"))!.ok).toBe(false);
  });
  it("flags the wrong author", () => {
    expect(checkPull(pr({ user: { login: "someone-else" } }), opts)
      .find((c) => c.label.startsWith("PR author"))!.ok).toBe(false);
  });
  it("flags a PR in another repo", () => {
    expect(checkPull(pr({}), { ...opts, prRepo: "acme/other" })
      .find((c) => c.label === "same repository")!.ok).toBe(false);
  });
  it("mergedAtSeconds parses GitHub merged_at", () => {
    expect(mergedAtSeconds(pr({}))).toBe(1767225600n);
    expect(mergedAtSeconds(pr({ merged_at: null }))).toBe(0n);
  });
});

describe("comment scans", () => {
  const comments: GhComment[] = [
    { id: 1, user: { login: "alice" }, body: "unrelated", created_at: "" },
    { id: 2, user: { login: "mallory" },
      body: `postmark-dispute v1 chain=9800 escrow=${ESCROW} bounty=5`, created_at: "" },
    { id: 3, user: { login: "disputeguy" },
      body: `reasons\npostmark-dispute v1 chain=9800 escrow=${ESCROW} bounty=5`, created_at: "" },
    { id: 4, user: { login: "disputeguy" },
      body: `postmark-dispute v1 chain=9800 escrow=${ESCROW} bounty=6`, created_at: "" },
  ];
  it("finds dispute lines and filters by login + bounty", () => {
    const hits = findDisputeComments(comments).filter(
      (c) => c.githubLogin === "disputeguy" && c.bountyId === 5);
    expect(hits.map((h) => h.commentId)).toEqual([3]);
  });
  it("ignores a dispute line from the wrong login", () => {
    const hits = findDisputeComments(comments).filter((c) => c.githubLogin === "alice");
    expect(hits).toEqual([]);
  });
});

describe("dispute + resolution evidence", () => {
  it("disputeEvidenceHashOf matches the SPEC encoding", () => {
    expect(disputeEvidenceHashOf("disputeguy", 3n)).toBe(
      keccak256(encodeAbiParameters(
        [{ type: "string" }, { type: "string" }, { type: "uint256" }],
        ["postmark-dispute-v1", "disputeguy", 3n])));
  });
  it("resolutionEvidenceHashOf wraps a basis hash", () => {
    const basis = payEvidenceHashOf("acme/widgets", 7, "a".repeat(40), 1767225600n, "e2e-claimant");
    expect(resolutionEvidenceHashOf(3n, basis)).toBe(
      keccak256(encodeAbiParameters(
        [{ type: "string" }, { type: "uint256" }, { type: "bytes32" }],
        ["postmark-resolution-v1", 3n, basis])));
  });
});

describe("verdict assembly", () => {
  const bounty = {
    payee: CLAIMANT as `0x${string}`, nonce: 0n, claimRound: 1n,
    pendingVerdictHash: keccak256("0x1234"),
    disputeEvidenceHash: keccak256("0xabcd"),
  };
  const ev = "0x" + "22".repeat(32) as `0x${string}`;

  it("INITIAL PAY: frozen claimant, mergedAt, zero dispute fields", () => {
    const v = assembleVerdict({ bountyId: 5n, bounty, phase: PHASE.INITIAL,
      outcome: OUTCOME.PAY, evidenceHash: ev, mergedAt: 1767225600n });
    expect(v.payee).toBe(CLAIMANT);
    expect(v.mergedAt).toBe(1767225600n);
    expect(v.disputedVerdictHash).toBe("0x" + "0".repeat(64));
    expect(v.disputeEvidenceHash).toBe("0x" + "0".repeat(64));
    expect(v.nonce).toBe(0n); expect(v.claimRound).toBe(1n);
  });
  it("INITIAL REFUND: zero payee and mergedAt", () => {
    const v = assembleVerdict({ bountyId: 5n, bounty, phase: PHASE.INITIAL,
      outcome: OUTCOME.REFUND, evidenceHash: ev, mergedAt: 99n, payee: CLAIMANT });
    expect(v.payee).toBe("0x0000000000000000000000000000000000000000");
    expect(v.mergedAt).toBe(0n);
  });
  it("DISPUTE binds the stored pendingVerdictHash and disputeEvidenceHash", () => {
    const v = assembleVerdict({ bountyId: 5n, bounty, phase: PHASE.DISPUTE,
      outcome: OUTCOME.PAY, evidenceHash: ev, mergedAt: 1767225600n });
    expect(v.disputedVerdictHash).toBe(bounty.pendingVerdictHash);
    expect(v.disputeEvidenceHash).toBe(bounty.disputeEvidenceHash);
    // and the message differs from the INITIAL message with the same fields
    const v0 = assembleVerdict({ bountyId: 5n, bounty, phase: PHASE.INITIAL,
      outcome: OUTCOME.PAY, evidenceHash: ev, mergedAt: 1767225600n });
    expect(verdictMessage(v)).not.toBe(verdictMessage(v0));
    expect(verdictPayloadHash(v)).not.toBe(verdictPayloadHash(v0));
  });
});
