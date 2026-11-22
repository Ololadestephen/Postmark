import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { META, CLAIMANT, makeBounty, renderApp } from "../fixtures";

const github = vi.hoisted(() => ({ item: {} as Record<string, unknown> }));
vi.mock("../../src/hooks/queries", () => ({ useGithubItem: () => github.item }));

import { ItemPreview, VerifierInput } from "../../src/wallet/createParts";
import { ClaimUnderReview, IdentityCard, PrCheckCard } from "../../src/wallet/review/ClaimChecks";
import { DecisionCard, SignCard } from "../../src/wallet/review/VerdictCards";
import { BundleCard } from "../../src/wallet/review/BundleCard";

const noop = () => {};
const asyncNoop = async () => {};

beforeEach(() => { github.item = { data: undefined, error: null, isPending: true }; });

describe("create form parts", () => {
  it("VerifierInput shows validation and key status", () => {
    const onChange = vi.fn();
    const { rerender } = render(<VerifierInput i={0} value="0xabc" onChange={onChange}
      live={undefined} checking={false} error="Invalid address." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid address.");
    fireEvent.change(screen.getByLabelText("Verifier 1"), { target: { value: "0xdef" } });
    expect(onChange).toHaveBeenCalledWith("0xdef");
    rerender(<VerifierInput i={0} value="0xabc" onChange={onChange} live={false} checking={false} />);
    expect(screen.getByText("no key")).toBeInTheDocument();
    rerender(<VerifierInput i={0} value="0xabc" onChange={onChange} live checking={false} />);
    expect(screen.getByText("PQ live")).toBeInTheDocument();
  });

  it("ItemPreview covers loading, failure, closed issues and merged pull requests", () => {
    const gref = { ownerRepo: "o/r", kind: 0 as const, number: 1 };
    const { unmount } = render(<ItemPreview gref={gref} />);
    expect(screen.getByText(/Fetching from GitHub/)).toBeInTheDocument();
    unmount();
    github.item = { data: undefined, error: new Error("x"), isPending: false };
    const failed = render(<ItemPreview gref={gref} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/check the URL/);
    failed.unmount();
    github.item = { data: { title: "T", state: "closed", user: { login: "u" } }, error: null, isPending: false };
    const closed = render(<ItemPreview gref={gref} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/issue is closed/);
    closed.unmount();
    github.item = { data: { title: "T", state: "closed", merged: true, user: { login: "u" } }, error: null, isPending: false };
    render(<ItemPreview gref={{ ...gref, kind: 1 }} />);
    expect(screen.getByText("merged")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/already merged/);
  });
});

describe("review cards", () => {
  const claimed = makeBounty({ state: 1, payee: CLAIMANT, claimRound: 1n, claimExpiresAt: 4_000_000_000n });

  it("ClaimUnderReview explains dispute outcomes only when disputed", () => {
    const { unmount } = renderApp(<ClaimUnderReview bounty={claimed} disputed={false} />);
    expect(screen.getByText("claim under review")).toBeInTheDocument();
    expect(screen.queryByText(/upholds/)).toBeNull();
    unmount();
    renderApp(<ClaimUnderReview bounty={claimed} disputed />);
    expect(screen.getByText("disputed claim")).toBeInTheDocument();
    expect(screen.getByText(/upholds/)).toBeInTheDocument();
  });

  it("IdentityCard shows match, mismatch, errors and the dispute comment", () => {
    const id = { login: "e2e-claimant", commentId: 11n, hash: "0x1" as `0x${string}`, url: "u", matches: true };
    const onScan = vi.fn();
    const { rerender } = render(<IdentityCard meta={META} disputed={false} status="done" error={null}
      identity={id} disputeComment={null} onScan={onScan} />);
    expect(screen.getByText(/identity matches/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Scan comments" }));
    expect(onScan).toHaveBeenCalled();
    rerender(<IdentityCard meta={META} disputed status="done" error="No claim line"
      identity={{ ...id, matches: false }} disputeComment={null} onScan={onScan} />);
    expect(screen.getByText(/identity mismatch/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("No claim line");
    expect(screen.getByText(/No comment re-hashes/)).toBeInTheDocument();
  });

  it("PrCheckCard lists checks, candidates and failed-check warnings", () => {
    const check = vi.fn(async () => {});
    const pr = {
      prUrl: "", setPrUrl: noop, error: null, busy: false, candidates: [2, 3], check,
      loadCandidates: asyncNoop, checkPastedUrl: noop,
      prCheck: { repo: "o/r", number: 2, pr: { user: { login: "dev" }, merged_at: null },
        checks: [{ label: "merged", ok: true }, { label: "same repository", ok: false }] },
    };
    render(<PrCheckCard meta={META} pr={pr as never} />);
    expect(screen.getByText(/✓ merged/)).toBeInTheDocument();
    expect(screen.getByText(/✗ same repository/)).toBeInTheDocument();
    expect(screen.getByText(/1 check failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "#3" }));
    expect(check).toHaveBeenCalledWith(META.ownerRepo, 3);
  });

  it("DecisionCard gates PAY and shows the built verdict", () => {
    const builder = { decision: "pay" as const, error: "oops", refundReason: "other", setRefundReason: noop,
      refundUrl: "", setRefundUrl: noop, buildDecision: vi.fn(async () => {}) };
    const built = { verdict: { payee: CLAIMANT, mergedAt: 1n, evidenceHash: "0xaa", nonce: 1n, claimRound: 1n,
      disputedVerdictHash: `0x${"0".repeat(64)}`, disputeEvidenceHash: `0x${"0".repeat(64)}` } };
    render(<DecisionCard disputed={false} canPay={false} canResolve scanDone builder={builder} built={built as never} />);
    expect(screen.getByRole("button", { name: "PAY" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "REFUND" }));
    expect(builder.buildDecision).toHaveBeenCalledWith("refund");
    expect(screen.getByRole("alert")).toHaveTextContent("oops");
    expect(screen.getByText(/outcome PAY/)).toBeInTheDocument();
  });

  it("SignCard asks for the pairing code unless QoreX signs", () => {
    const onSign = vi.fn();
    const { rerender } = render(<SignCard myVerifierIndex={1} usesQorex={false} signing={false}
      error="bad" signedIndex={1} onSign={onSign} />);
    expect(screen.getByText("You are verifier #2.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("8-char code")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign with the local signer" }));
    expect(onSign).toHaveBeenCalled();
    rerender(<SignCard myVerifierIndex={-1} usesQorex signing error={null} signedIndex={null} onSign={onSign} />);
    expect(screen.getByText("Advanced: use the local signer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Signing…" })).toBeDisabled();
    rerender(<SignCard myVerifierIndex={0} usesQorex signing={false} error={null} signedIndex={null} onSign={onSign} />);
    expect(screen.getByRole("button", { name: "Sign with QoreX" })).toBeEnabled();
    rerender(<SignCard myVerifierIndex={0} usesQorex mismatch="Your wallet and QoreX are on different accounts." signing={false} error={null} signedIndex={null} onSign={onSign} />);
    expect(screen.getByRole("button", { name: "Sign with QoreX" })).toBeDisabled();
  });

  it("BundleCard enables submit at two valid signatures", () => {
    const view = { bundle: { signatures: { 0: "0x1", 1: "0x2" } }, bundleJson: "{}",
      sigStatus: { 0: "valid", 1: "valid" } as never, validIndices: [0, 1], importText: "", setImportText: noop,
      importErr: "bad bundle", importBundle: asyncNoop, download: noop };
    const onSubmit = vi.fn();
    const onCopyComment = vi.fn();
    renderApp(<BundleCard bounty={claimed} disputed={false} bundleView={view} onSubmit={onSubmit} onCopy={noop} onCopyComment={onCopyComment}><p>tx</p></BundleCard>);
    fireEvent.click(screen.getByRole("button", { name: "Submit verdict (2/3 valid)" }));
    expect(onSubmit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copy as GitHub comment" }));
    expect(onCopyComment).toHaveBeenCalled();
    expect(screen.getByText(/Anyone can relay/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("bad bundle");
  });
});
