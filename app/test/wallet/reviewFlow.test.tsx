import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { CLAIMANT, META, VERIFIERS, makeBounty } from "../fixtures";
import { ESCROW_ADDRESS } from "../../src/chain/config";
import { claimLine, disputeLine } from "../../src/formats/lines";
import { identityHashOf, disputeEvidenceHashOf, onchainEvidenceHashOf } from "../../src/formats/hashes";
import type { BuiltVerdict } from "../../src/chain/verdict";

const m = vi.hoisted(() => ({
  address: undefined as string | undefined,
  run: vi.fn(), toast: vi.fn(),
  comments: [] as unknown[], commentsError: null as Error | null,
  pull: null as unknown, linked: [2] as number[], pullError: null as Error | null,
  signerAddress: "", signerLive: true, keyLive: true, verifyOk: true,
  signature: "0xabcd" as `0x${string}`, buildError: null as Error | null,
  task: null as { type: string; contract?: `0x${string}`; function?: string; codehash?: `0x${string}` } | null,
  proof: null as { items: { label: string; ok: boolean }[]; blockTimestamp: bigint | null } | null,
  proofError: null as Error | null,
}));

vi.mock("wagmi", () => ({ useAccount: () => ({ address: m.address, isConnected: !!m.address }) }));
vi.mock("../../src/wallet/WalletRoot", async () => (await import("../mocks")).walletRootModule);
vi.mock("../../src/hooks/useTxAction", () => ({
  useTxAction: () => ({ state: { phase: "idle" }, run: m.run, busy: false }),
}));
vi.mock("../../src/components/Toasts", () => ({ useToast: () => m.toast }));
vi.mock("../../src/wallet/qorex", () => ({ useQorex: () => ({ canSignArbitrary: false, qorAddress: null, native: null }) }));
vi.mock("../../src/github/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/github/client")>()),
  getAllComments: vi.fn(async () => { if (m.commentsError) throw m.commentsError; return m.comments; }),
  getPull: vi.fn(async () => { if (m.pullError) throw m.pullError; return m.pull; }),
  getLinkedPrs: vi.fn(async () => m.linked),
}));
vi.mock("../../src/chain/localSigner", () => ({
  signerStatus: vi.fn(async () => ({ address: m.signerAddress, live: m.signerLive })),
  pairingCode: () => "abcd1234", setPairingCode: vi.fn(), signerPort: () => 47322, setSignerPort: vi.fn(),
  SignerError: class extends Error { constructor(public status: number, msg: string) { super(msg); } },
}));
vi.mock("../../src/wallet/pqSigner", () => ({
  pickSigner: () => ({ id: "local", signVerdict: async () => m.signature }),
}));
vi.mock("../../src/chain/pqc", () => ({ pqcKeyStatus: async () => ({ live: m.keyLive, pubkey: "0x00" }) }));
vi.mock("@qorechain/pqc", () => ({ mldsa87: { verify: () => m.verifyOk } }));
vi.mock("../../src/hooks/queries", () => ({
  useBountyTask: () => ({ task: m.task, invalid: null, pending: false }),
  useIndex: () => ({ data: undefined }),
  useBounties: () => ({ data: [] }),
}));
vi.mock("../../src/chain/onchainCheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/chain/onchainCheck")>()),
  checkOnchainProof: vi.fn(async () => {
    if (m.proofError) throw m.proofError;
    return m.proof ?? { items: [], blockTimestamp: null };
  }),
  claimedAtFor: vi.fn(async () => 3_900_000_000n),
}));
vi.mock("../../src/chain/verdict", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/chain/verdict")>();
  return {
    ...real,
    buildVerdictFor: vi.fn(async (input) => {
      if (m.buildError) throw m.buildError;
      const verdict = real.assembleVerdict(input);
      return { verdict, message: `0x${"cd".repeat(20)}`, chainMessage: `0x${"cd".repeat(20)}` } as BuiltVerdict;
    }),
  };
});

import ReviewPanel from "../../src/wallet/ReviewPanel";
import { useIdentityCheck } from "../../src/wallet/review/useIdentityCheck";
import { usePrCheck } from "../../src/wallet/review/usePrCheck";
import { useVerdictBuilder } from "../../src/wallet/review/useVerdictBuilder";
import { useVerdictBundle } from "../../src/wallet/review/useVerdictBundle";
import { useVerdictSigning } from "../../src/wallet/review/useVerdictSigning";
import { PHASE } from "../../src/chain/verdict";

const IDENTITY_HASH = identityHashOf("e2e-claimant", CLAIMANT, 11n);
const claimed = makeBounty({ state: 1, payee: CLAIMANT, claimRound: 1n, nonce: 1n,
  payeeIdentityHash: IDENTITY_HASH, claimExpiresAt: 4_000_000_000n, deadline: 4_000_000_000n });
const disputeHash = disputeEvidenceHashOf("e2e-disputer", 50n);
const disputed = makeBounty({ ...claimed, state: 3, disputeEvidenceHash: disputeHash,
  pendingVerdictHash: `0x${"77".repeat(32)}`, challengeEndsAt: 4_000_000_000n });

const comment = (id: number, login: string, body: string) =>
  ({ id, user: { login }, body, created_at: "2026-11-18T10:00:00Z" });
const goodComments = () => [
  comment(11, "e2e-claimant", claimLine(7n, CLAIMANT, ESCROW_ADDRESS)),
  comment(50, "e2e-disputer", disputeLine(7n, ESCROW_ADDRESS)),
];
const mergedPull = (over: Record<string, unknown> = {}) => ({
  number: 2, title: "fix", state: "closed", merged: true, merged_at: "2026-11-18T10:00:00Z",
  merge_commit_sha: "f".repeat(40), body: "Fixes #1", user: { login: "e2e-claimant" }, html_url: "", ...over });

beforeEach(() => {
  Object.assign(m, {
    address: VERIFIERS[0], comments: goodComments(), commentsError: null, pull: mergedPull(), linked: [2],
    pullError: null, signerAddress: VERIFIERS[0], signerLive: true, keyLive: true, verifyOk: true,
    signature: "0xabcd", buildError: null, task: null, proof: null, proofError: null,
  });
  localStorage.clear();
  vi.clearAllMocks();
});

describe("useIdentityCheck", () => {
  it("matches the claimant's claim line to the stored identity hash", async () => {
    const { result } = renderHook(() => useIdentityCheck(7n, claimed, META, false));
    await act(() => result.current.scan());
    expect(result.current.status).toBe("done");
    expect(result.current.identity).toMatchObject({ login: "e2e-claimant", commentId: 11n, matches: true });
  });

  it("flags a hash mismatch", async () => {
    const { result } = renderHook(() => useIdentityCheck(7n, { ...claimed, payeeIdentityHash: `0x${"01".repeat(32)}` }, META, false));
    await act(() => result.current.scan());
    expect(result.current.identity?.matches).toBe(false);
  });

  it("reports a missing claim line and GitHub failures", async () => {
    m.comments = [];
    const { result } = renderHook(() => useIdentityCheck(7n, claimed, META, false));
    await act(() => result.current.scan());
    expect(result.current.error).toMatch(/No claim line/);
    m.commentsError = new Error("rate limited");
    await act(() => result.current.scan());
    expect(result.current).toMatchObject({ status: "error", error: "rate limited" });
  });

  it("finds the dispute comment that produced the stored evidence hash", async () => {
    const { result } = renderHook(() => useIdentityCheck(7n, disputed, META, true));
    await act(() => result.current.scan());
    expect(result.current.disputeComment).toMatchObject({ commentId: 50n, login: "e2e-disputer" });
  });
});

describe("usePrCheck", () => {
  const hook = (kind = 0) => renderHook(() => usePrCheck({ ...META, kind }, claimed, "e2e-claimant"));

  it("loads linked PRs for an issue and checks one", async () => {
    const { result } = hook();
    await act(() => result.current.loadCandidates());
    expect(result.current.candidates).toEqual([2]);
    await act(() => result.current.check(META.ownerRepo, 2));
    expect(result.current.prCheck?.checks.every((c) => c.ok)).toBe(true);
  });

  it("shows the Fixes check for issue bounties only, and flags a mere mention", async () => {
    const issue = hook();
    await act(() => issue.result.current.check(META.ownerRepo, 2));
    expect(issue.result.current.prCheck?.checks.map((c) => c.label)).toContain("PR says Fixes #1");
    const pull = hook(1);
    await act(() => pull.result.current.loadCandidates());
    expect(pull.result.current.prCheck?.checks.some((c) => /Fixes/.test(c.label))).toBe(false);
  });

  it("checks the item itself when it is a pull request", async () => {
    const { result } = hook(1);
    await act(() => result.current.loadCandidates());
    expect(result.current.prCheck).not.toBeNull();
  });

  it("validates a pasted URL", async () => {
    const { result } = hook();
    act(() => result.current.setPrUrl("https://example.com"));
    act(() => result.current.checkPastedUrl());
    expect(result.current.error).toMatch(/Paste a GitHub pull-request URL/);
    act(() => result.current.setPrUrl("https://github.com/postmark-e2e/sandbox/pull/2"));
    await act(async () => result.current.checkPastedUrl());
    await waitFor(() => expect(result.current.prCheck?.number).toBe(2));
  });

  it("clears the check and reports lookup failures", async () => {
    const { result } = hook();
    m.pullError = new Error("not found");
    await act(() => result.current.check(META.ownerRepo, 2));
    expect(result.current).toMatchObject({ prCheck: null, error: "not found" });
  });
});

describe("useVerdictBuilder", () => {
  const prCheck = { pr: mergedPull(), repo: META.ownerRepo, number: 2, checks: [] } as never;
  const build = (over: Partial<Parameters<typeof useVerdictBuilder>[0]> = {}) =>
    renderHook(() => useVerdictBuilder({ id: 7n, bounty: claimed, phase: PHASE.INITIAL, disputed: false,
      prCheck, disputeComment: null, ...over }));

  it("builds a PAY verdict from the PR evidence", async () => {
    const { result } = build();
    await act(() => result.current.buildDecision("pay"));
    expect(result.current.decision).toBe("pay");
    expect(result.current.built?.verdict).toMatchObject({ outcome: 0, payee: CLAIMANT, bountyId: 7n });
  });

  it("builds a REFUND verdict with zeroed payee", async () => {
    const { result } = build({ prCheck: null });
    act(() => { result.current.setRefundReason("withdrawn"); result.current.setRefundUrl("https://x"); });
    await act(() => result.current.buildDecision("refund"));
    expect(result.current.built?.verdict).toMatchObject({ outcome: 1, mergedAt: 0n });
  });

  it("needs the PR check before PAY", async () => {
    const { result } = build({ prCheck: null });
    await act(() => result.current.buildDecision("pay"));
    expect(result.current.error).toMatch(/Run the PR check first/);
    expect(result.current.built).toBeNull();
  });

  it("wraps the resolution evidence for a dispute", async () => {
    const { result } = build({ disputed: true, phase: PHASE.DISPUTE, bounty: disputed,
      disputeComment: { commentId: 50n, login: "e2e-disputer", url: "" } });
    await act(() => result.current.buildDecision("pay"));
    expect(result.current.built?.verdict.phase).toBe(1);
  });

  it("reports builder failures", async () => {
    m.buildError = new Error("drift");
    const { result } = build();
    await act(() => result.current.buildDecision("pay"));
    expect(result.current.error).toBe("drift");
  });
});

const sig = (b: string) => `0x${b.repeat(4627)}` as `0x${string}`;

const BUILT = (nonce = 1n): BuiltVerdict => ({
  verdict: { bountyId: 7n, phase: 0, outcome: 0, payee: CLAIMANT, mergedAt: 1n, evidenceHash: `0x${"22".repeat(32)}`,
    nonce, claimRound: 1n, disputedVerdictHash: `0x${"00".repeat(32)}`, disputeEvidenceHash: `0x${"00".repeat(32)}` },
  message: "0xabcdef", chainMessage: "0xabcdef",
}) as BuiltVerdict;

describe("useVerdictBundle", () => {
  it("records a signature, verifies it against the live key and persists the bundle", async () => {
    const { result } = renderHook(() => useVerdictBundle(7n, claimed, 0, BUILT()));
    act(() => result.current.recordSignature(0, sig("12")));
    await waitFor(() => expect(result.current.validIndices).toEqual([0]));
    expect(result.current.bundle?.signatures[0]).toBe(sig("12"));
    expect(localStorage.length).toBe(1);
    expect(result.current.bundleJson).toContain('"format"');
  });

  it("marks a bad signature invalid and a lapsed key not live", async () => {
    m.verifyOk = false;
    const { result } = renderHook(() => useVerdictBundle(7n, claimed, 0, BUILT()));
    act(() => result.current.recordSignature(1, sig("12")));
    await waitFor(() => expect(result.current.sigStatus[1]).toBe("invalid"));
    m.keyLive = false;
    act(() => result.current.recordSignature(2, sig("56")));
    await waitFor(() => expect(result.current.sigStatus[2]).toBe("key not live"));
    expect(result.current.validIndices).toEqual([]);
  });

  it("imports and merges another verifier's bundle", async () => {
    const a = renderHook(() => useVerdictBundle(7n, claimed, 0, BUILT()));
    act(() => a.result.current.recordSignature(0, sig("12")));
    const exported = a.result.current.bundleJson;
    localStorage.clear();
    const b = renderHook(() => useVerdictBundle(7n, claimed, 0, BUILT()));
    act(() => b.result.current.recordSignature(1, sig("56")));
    act(() => b.result.current.setImportText(exported));
    await act(() => b.result.current.importBundle());
    await waitFor(() => expect(b.result.current.validIndices).toEqual([0, 1]));
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringMatching(/Bundle merged/) }));
  });

  it("rejects imports that do not match the built verdict", async () => {
    const a = renderHook(() => useVerdictBundle(7n, claimed, 0, BUILT()));
    act(() => a.result.current.recordSignature(0, sig("12")));
    const exported = a.result.current.bundleJson;
    const other = renderHook(() => useVerdictBundle(7n, claimed, 0, BUILT(2n)));
    act(() => other.result.current.setImportText(exported));
    await act(() => other.result.current.importBundle());
    expect(other.result.current.importErr).toMatch(/verdict fields differ|different message/);
    const none = renderHook(() => useVerdictBundle(8n, claimed, 0, null));
    await act(() => none.result.current.importBundle());
    expect(none.result.current.importErr).toMatch(/Build a decision first/);
  });

  it("clears the stored bundle", () => {
    const { result } = renderHook(() => useVerdictBundle(7n, claimed, 0, BUILT()));
    act(() => result.current.recordSignature(0, sig("12")));
    act(() => result.current.persist(null));
    expect(result.current.bundle).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

describe("useVerdictSigning", () => {
  it("signs as the verifier whose key the local signer holds", async () => {
    const onSigned = vi.fn();
    const built = BUILT();
    const { result } = renderHook(() => useVerdictSigning(claimed, built, onSigned));
    await act(() => result.current.sign());
    expect(onSigned).toHaveBeenCalledWith(0, "0xabcd");
    expect(result.current.signedIndex).toBe(0);
  });

  it.each([
    ["a signer that is not a verifier", { signerAddress: CLAIMANT }, /not a verifier on this bounty/],
    ["a signer with no live key", { signerLive: false }, /signer's key is not live/],
    ["a verifier whose registered key lapsed", { keyLive: false }, /key is not live on diana/],
    ["a signature that fails verification", { verifyOk: false }, /failed local ML-DSA-87 verification/],
  ])("refuses %s", async (_name, patch, message) => {
    Object.assign(m, patch);
    const onSigned = vi.fn();
    const { result } = renderHook(() => useVerdictSigning(claimed, BUILT(), onSigned));
    await act(() => result.current.sign());
    expect(result.current.error).toMatch(message);
    expect(onSigned).not.toHaveBeenCalled();
  });

  it("does nothing before a verdict is built", async () => {
    const { result } = renderHook(() => useVerdictSigning(claimed, null, vi.fn()));
    await act(() => result.current.sign());
    expect(result.current.signing).toBe(false);
  });
});

describe("ReviewPanel", () => {
  it("walks identity check, PR check, decision and signature to a submittable bundle", async () => {
    render(<ReviewPanel id={7n} bounty={claimed} meta={META} />);
    expect(screen.getByText("claim under review")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Scan comments" }));
    expect(await screen.findByText(/identity matches — @e2e-claimant/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Find linked PRs" }));
    fireEvent.click(await screen.findByRole("button", { name: "#2" }));
    expect(await screen.findByText(/merge_commit_sha present/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "PAY" }));
    expect(await screen.findByText(/message matches escrow.verdictMessage/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign with the local signer" }));
    expect(await screen.findByText(/Signature #0 verified locally/)).toBeInTheDocument();
    expect(await screen.findByText("valid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit verdict \(1\/3 valid\)/ })).toBeDisabled();
  });

  it("explains the dispute rules and requires the dispute comment", () => {
    render(<ReviewPanel id={7n} bounty={disputed} meta={META} />);
    expect(screen.getByText("disputed claim")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve PAY" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resolve REFUND" })).toBeDisabled();
    expect(screen.getByText(/Scan comments first/)).toBeInTheDocument();
  });

  it("builds a REFUND without a PR check", async () => {
    render(<ReviewPanel id={7n} bounty={claimed} meta={META} />);
    fireEvent.click(screen.getByRole("button", { name: "REFUND" }));
    expect(await screen.findByText(/outcome REFUND/)).toBeInTheDocument();
  });

  it("checks the proof transaction on an on-chain task and builds a PAY verdict", async () => {
    m.task = { type: "onchain-call", contract: `0x${"ab".repeat(20)}` };
    m.proof = { items: [{ label: "succeeded", ok: true }], blockTimestamp: 1_800_000_000n };
    const tx = `0x${"aa".repeat(32)}` as `0x${string}`;
    render(<ReviewPanel id={7n} bounty={claimed} meta={META} />);
    expect(screen.getByText("proof transaction check")).toBeInTheDocument();
    expect(screen.queryByText("pull request check")).toBeNull();
    expect(screen.getByRole("button", { name: "PAY" })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/proof transaction hash/), { target: { value: tx } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText(/block time/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "PAY" }));
    const evidence = onchainEvidenceHashOf("onchain-call", tx, 1_800_000_000n, CLAIMANT);
    expect((await screen.findByText(/evidenceHash/)).textContent).toContain(evidence);
    expect((await screen.findByText(/mergedAt/)).textContent).toContain("1800000000");
  });

  it("warns instead of the PR check when the task block was removed after the claim", async () => {
    m.comments = [comment(11, "e2e-claimant",
      claimLine(7n, CLAIMANT, ESCROW_ADDRESS, `0x${"aa".repeat(32)}` as `0x${string}`))];
    render(<ReviewPanel id={7n} bounty={claimed} meta={META} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan comments" }));
    expect(await screen.findByText(/removed after the claim/)).toBeInTheDocument();
    expect(screen.queryByText("pull request check")).toBeNull();
  });
});
