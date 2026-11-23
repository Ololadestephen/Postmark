import { describe, it, expect } from "vitest";
import {
  workHashOf, identityHashOf, payEvidenceHashOf, refundEvidenceHashOf,
  disputeEvidenceHashOf, resolutionEvidenceHashOf, submissionEvidenceHashOf,
} from "../../src/formats/hashes";
import { claimMessage, verdictMessage, CLAIM_TYPEHASH, VERDICT_TYPEHASH } from "../../src/formats/messages";
import { keccak256, stringToBytes, stringToHex, concatHex, encodeAbiParameters } from "viem";

// Vectors produced by `cast abi-encode … | xargs cast keccak`:
const V = {
  // cast abi-encode "f(string,string,uint8,uint256)" "github" "acme/widgets" 0 42
  work: "0x527626824701be80595a0c890ec5756744f6bde53f7f6876c64ba101dce7f1d5",
  // cast abi-encode "f(string,string,address,uint256)" "postmark-identity-v1" "octocat" 0x478f…c4b6 12345
  identity: "0x79475837a323888e787d418785840c32d91b5f998809269840d584b8808bc654",
  // cast abi-encode "f(string,string,uint256,string,uint64,string)" "postmark-evidence-v1" "acme/widgets" 42 abc123…abcd 1700000000 octocat
  pay: "0xc92ed230d9f31e3d06245c7d49a6d11a2c9d9ef275f1a988b239c7759cc54117",
  // cast abi-encode "f(string,string,string)" "postmark-refund-v1" "not-merged" "https://example.com/why"
  refund: "0x77b2dceb90b434b1d30f97bd54646d9e5bf4c872a1b14489f93d6dc6a909525a",
  // cast abi-encode "f(string,string,uint256)" "postmark-dispute-v1" "octocat" 777
  dispute: "0xe28c383115cf52251c84f5f32af6d94ebfa237875987b0c70abed7dd4ec43791",
  // cast abi-encode "f(string,uint256,bytes32)" "postmark-resolution-v1" 777 0x1111…1111
  resolution: "0x0b9acc3af1d4fb3092dfa5c4c9e2faafe20cbb6986130350744ad9fa27eb78d5",
  // cast abi-encode "f(string,string,uint256,string,string,uint64)" "postmark-submission-v1" "testing" 12345 "octocat" "https://example.com/report" 1700000000
  submission: "0xbf3dde40440e6050edf25a76254ff4da36b7c4207b9513a4b40e91dae6e07513",
} as const;

describe("off-chain hashes (SPEC Off-chain formats)", () => {
  it("workHash matches cast", () => {
    expect(workHashOf("acme/widgets", 0, 42)).toBe(V.work);
    expect(workHashOf("acme/widgets", 0, 42n)).toBe(V.work);
  });
  it("identityHash matches cast", () => {
    expect(identityHashOf("octocat", "0x478f2a08a81be7cea42bd34bd6900593fa56c4b6", 12345n))
      .toBe(V.identity);
  });
  it("payEvidenceHash matches cast", () => {
    expect(payEvidenceHashOf("acme/widgets", 42,
      "abc123def456abc123def456abc123def456abcd", 1700000000, "octocat"))
      .toBe(V.pay);
  });
  it("refundEvidenceHash matches cast", () => {
    expect(refundEvidenceHashOf("not-merged", "https://example.com/why")).toBe(V.refund);
  });
  it("disputeEvidenceHash matches cast", () => {
    expect(disputeEvidenceHashOf("octocat", 777n)).toBe(V.dispute);
  });
  it("resolutionEvidenceHash matches cast", () => {
    expect(resolutionEvidenceHashOf(777n,
      "0x1111111111111111111111111111111111111111111111111111111111111111"))
      .toBe(V.resolution);
  });
  it("submissionEvidenceHash matches cast", () => {
    expect(submissionEvidenceHashOf("testing", 12345n, "octocat", "https://example.com/report", 1700000000))
      .toBe(V.submission);
    // login normalises to lowercase like the other evidence hashes
    expect(submissionEvidenceHashOf("testing", 12345, "OctoCat", "https://example.com/report", 1700000000n))
      .toBe(V.submission);
  });
});

describe("typehashes and message builders", () => {
  it("typehash constants equal keccak of the SPEC literals", () => {
    expect(CLAIM_TYPEHASH).toBe(keccak256(stringToBytes(
      "ClaimV1(uint256 chainId,address escrow,uint256 bountyId,address claimant,bytes32 identityHash,uint256 claimRound)")));
    expect(VERDICT_TYPEHASH).toBe(keccak256(stringToBytes(
      "PostmarkEscrowVerdictV1(uint256 chainId,address escrow,uint256 bountyId,uint8 phase,uint8 outcome,address payee,uint64 mergedAt,bytes32 evidenceHash,uint256 nonce,uint256 claimRound,bytes32 disputedVerdictHash,bytes32 disputeEvidenceHash)")));
  });
  it("claimMessage is prefix || abi.encode(typehash, chain, escrow, …)", () => {
    const escrow = "0xb781E296FB35ccd2497589526114373bA0bff79b";
    const msg = claimMessage(7n, "0x478f2a08a81be7cea42bd34bd6900593fa56c4b6", V.identity, 2n, 9800, escrow);
    const expected = concatHex([
      stringToHex("qorechain-msg-v1|qorechain-diana|"),
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "address" },
          { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }],
        [CLAIM_TYPEHASH, 9800n, escrow, 7n,
          "0x478f2a08a81be7cea42bd34bd6900593fa56c4b6", V.identity, 2n]),
    ]);
    expect(msg).toBe(expected);
    expect(msg.startsWith("0x" + Buffer.from("qorechain-msg-v1|qorechain-diana|").toString("hex")))
      .toBe(true);
  });
  it("verdictMessage is prefix || the 13-word abi.encode", () => {
    const escrow = "0xb781E296FB35ccd2497589526114373bA0bff79b";
    const v = {
      bountyId: 3n, phase: 1, outcome: 0,
      payee: "0x478f2a08a81be7cea42bd34bd6900593fa56c4b6" as `0x${string}`,
      mergedAt: 1700000000n, evidenceHash: V.pay as `0x${string}`,
      nonce: 1n, claimRound: 2n,
      disputedVerdictHash: V.dispute as `0x${string}`,
      disputeEvidenceHash: V.resolution as `0x${string}`,
    };
    const msg = verdictMessage(v, 9800, escrow);
    expect(msg.startsWith("0x" + Buffer.from("qorechain-msg-v1|qorechain-diana|").toString("hex")))
      .toBe(true);
    expect((msg.length - 2 - 2 * "qorechain-msg-v1|qorechain-diana|".length) / 2)
      .toBe(13 * 32);
  });
});
