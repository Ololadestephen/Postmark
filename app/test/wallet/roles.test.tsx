import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CLAIMANT, FUNDER, META, VERIFIERS, makeBounty, ZERO_ADDR } from "../fixtures";

const m = vi.hoisted(() => ({
  address: undefined as string | undefined,
  task: null as { type: string; contract?: `0x${string}`; function?: string; codehash?: `0x${string}` } | null,
  taskPending: false, taskError: null as string | null,
  credits: [5n, 0n] as [bigint, bigint],
}));
vi.mock("../../src/chain/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  creditOf: vi.fn(async () => m.credits),
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: m.address, isConnected: !!m.address }) }));
vi.mock("../../src/wallet/WalletRoot", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../src/wallet/DisputePanel", () => ({ default: () => <p>dispute panel</p> }));

import { bountyRole } from "../../src/wallet/role";
import ClaimedNote from "../../src/wallet/ClaimedNote";
import { SubmissionHelper } from "../../src/wallet/SubmissionHelper";
import VerifierReviewLink from "../../src/wallet/VerifierReviewLink";
import PaidNote from "../../src/wallet/PaidNote";
import PendingActions from "../../src/wallet/PendingActions";

vi.mock("../../src/hooks/queries", () => ({
  useBountyTask: () => ({ task: m.task, invalid: null, pending: m.taskPending, error: m.taskError, refetch: () => {} }),
  useIndex: () => ({ data: undefined }),
}));
const view = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const claimed = makeBounty({ state: 1, payee: CLAIMANT, claimRound: 1n, claimExpiresAt: 4_000_000_000n });
beforeEach(() => { m.credits = [5n, 0n]; m.address = undefined; m.task = null; m.taskPending = false; m.taskError = null; });
afterEach(() => vi.unstubAllEnvs());

describe("bountyRole", () => {
  const b = makeBounty({ payee: CLAIMANT });
  it("classifies every role, with verifier indices", () => {
    expect(bountyRole(b, FUNDER)).toEqual({ role: "funder", verifierIndex: -1 });
    expect(bountyRole(b, VERIFIERS[2]!.toLowerCase())).toEqual({ role: "verifier", verifierIndex: 2 });
    expect(bountyRole(b, CLAIMANT)).toEqual({ role: "claimant", verifierIndex: -1 });
    expect(bountyRole(b, "0x0000000000000000000000000000000000000abc").role).toBe("visitor");
    expect(bountyRole(b, undefined).role).toBe("visitor");
  });
  it("does not treat the zero payee as a claimant, and ranks funder above verifier above claimant", () => {
    expect(bountyRole(makeBounty({ payee: ZERO_ADDR }), ZERO_ADDR).role).toBe("visitor");
    expect(bountyRole(makeBounty({ payee: FUNDER }), FUNDER).role).toBe("funder");
    expect(bountyRole(makeBounty({ payee: VERIFIERS[0] }), VERIFIERS[0]).role).toBe("verifier");
  });
});

describe("review link", () => {
  it("shows only to verifiers, with their index", () => {
    m.address = VERIFIERS[1];
    const { unmount } = view(<VerifierReviewLink id={7n} bounty={claimed} />);
    expect(screen.getByRole("link", { name: /You're verifier #2 on this bounty — open the review tool/ })).toHaveAttribute("href", "/bounty/7/review");
    unmount();
    for (const a of [FUNDER, CLAIMANT, undefined]) {
      m.address = a;
      const r = view(<VerifierReviewLink id={7n} bounty={claimed} />);
      expect(screen.queryByRole("link")).toBeNull();
      r.unmount();
    }
  });
  it("keeps a disputed wording variant", () => {
    m.address = VERIFIERS[0];
    view(<VerifierReviewLink id={7n} bounty={{ ...claimed, state: 3 }} />);
    expect(screen.getByRole("link")).toHaveTextContent(/disputed/);
  });
});

describe("claimed note", () => {
  const text = (addr: string | undefined) => {
    m.address = addr;
    const r = view(<ClaimedNote id={7n} bounty={claimed} meta={META} />);
    const t = r.container.textContent ?? "";
    r.unmount();
    return t;
  };
  it("is concrete for the claimant", () => {
    expect(text(CLAIMANT)).toMatch(new RegExp(`Fixes #${META.number}.*before the claim expires`));
  });
  it("tells the funder who claimed and that nothing is needed", () => {
    expect(text(FUNDER)).toMatch(/Claimed by 0x478F.*nothing for you to do unless the claim expires/);
  });
  it("tells a verifier to wait for the merge, and a visitor the generic text with the reopen hint", () => {
    expect(text(VERIFIERS[0])).toMatch(/you'll review once the PR is merged/);
    expect(text(VERIFIERS[0])).not.toMatch(/Reopen/);
    expect(text(undefined)).toMatch(/waiting on verifier verdicts/);
    expect(text(undefined)).toMatch(/Reopen/);
  });
  it("gives the claimant the proof instructions and helper on an on-chain task", () => {
    m.task = { type: "onchain-call", contract: `0x${"ab".repeat(20)}` };
    const t = text(CLAIMANT);
    expect(t).toMatch(/Send the call to/);
    expect(t).toMatch(/postmark-proof v1 tx=0x…/);
    expect(t).toMatch(/check your proof/);
  });
  it("shows the helper to nobody else and keeps PR copy for non-claimants", () => {
    m.task = { type: "onchain-call", contract: `0x${"ab".repeat(20)}` };
    for (const a of [FUNDER, VERIFIERS[0], undefined]) {
      const t = text(a);
      expect(t).not.toMatch(/check your proof/);
    }
    expect(text(FUNDER)).toMatch(/proof transaction lands/);
    expect(text(VERIFIERS[0])).toMatch(/proof transaction is posted/);
  });
  it("does not give the claimant PR instructions while the issue is loading or unreadable", () => {
    m.taskPending = true;
    expect(text(CLAIMANT)).toMatch(/Loading the issue brief/);
    m.taskPending = false;
    m.taskError = "rate limited";
    expect(text(CLAIMANT)).toMatch(/Couldn't read the issue brief/);
    expect(text(CLAIMANT)).not.toMatch(/Open a pull request/);
  });

  it("gives the claimant the submission instructions and helper on a human task, with the flag on", () => {
    vi.stubEnv("VITE_HUMAN_TASKS", "1");
    m.task = { type: "testing" };
    const t = text(CLAIMANT);
    expect(t).toMatch(/postmark-submission v1 url=…/);
    expect(t).toMatch(/put the report below the line in the same comment/);
    expect(t).toMatch(/build your submission line/);
  });
  it("keeps the report note off for url tasks and hides the helper when the flag is off or for other roles", () => {
    vi.stubEnv("VITE_HUMAN_TASKS", "1");
    m.task = { type: "url" };
    const t = text(CLAIMANT);
    expect(t).toMatch(/postmark-submission v1 url=…/);
    expect(t).not.toMatch(/put the report below/);
    vi.stubEnv("VITE_HUMAN_TASKS", "");
    expect(text(CLAIMANT)).not.toMatch(/build your submission line/);
    expect(text(CLAIMANT)).not.toMatch(/Open a pull request/);
    vi.stubEnv("VITE_HUMAN_TASKS", "1");
    for (const a of [FUNDER, VERIFIERS[0], undefined]) {
      expect(text(a)).not.toMatch(/build your submission line/);
      expect(text(a)).not.toMatch(/postmark-submission/);
    }
    expect(text(FUNDER)).toMatch(/submission lands/);
    expect(text(VERIFIERS[0])).toMatch(/review the claimant's submission/);
  });
});

describe("submission helper", () => {
  it("builds the canonical line from an https URL and validates it", () => {
    const r = view(<SubmissionHelper />);
    const input = screen.getByLabelText("Submission URL");
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "http://insecure.example.com" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/https/);
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "https://example.com/report.pdf" } });
    expect(screen.getByText("postmark-submission v1 url=https://example.com/report.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    r.unmount();
  });
});

describe("pending actions", () => {
  const pending = (outcome: number) => makeBounty({ state: 2, payee: CLAIMANT, initialOutcome: outcome, challengeEndsAt: 4_000_000_000n });
  const run = async (addr: string | undefined, outcome = 0) => {
    m.address = addr;
    const r = view(<PendingActions id={7n} bounty={pending(outcome)} meta={META} />);
    if (!(addr === VERIFIERS[0]) && !(addr === CLAIMANT && outcome === 0)) await waitFor(() => expect(r.container.textContent).toMatch(/dispute panel/));
    const t = r.container.textContent ?? "";
    r.unmount();
    return t;
  };
  it("hides the dispute panel from the payee on PAY and from verifiers", async () => {
    expect(await run(CLAIMANT)).toMatch(/You're the payee\. After the window closes and it's finalized, withdraw from your Dashboard/);
    expect(await run(CLAIMANT)).not.toMatch(/dispute panel/);
    expect(await run(VERIFIERS[0])).toBe("");
  });
  it("keeps the dispute panel for the funder, visitors, and a claimant whose claim was refunded", async () => {
    expect(await run(FUNDER)).toMatch(/dispute panel/);
    expect(await run(undefined)).toMatch(/dispute panel/);
    expect(await run(CLAIMANT, 1)).toMatch(/dispute panel/);
  });
});

describe("paid note", () => {
  it("links the claimant to the Dashboard", async () => {
    m.address = CLAIMANT;
    view(<PaidNote bounty={makeBounty({ state: 4, payee: CLAIMANT })} />);
    expect(await screen.findByRole("link", { name: /withdraw from your Dashboard/ })).toHaveAttribute("href", "/me");
  });
  it("drops the withdraw link once the claimant has nothing left", async () => {
    m.address = CLAIMANT;
    m.credits = [0n, 0n];
    view(<PaidNote bounty={makeBounty({ state: 4, payee: CLAIMANT })} />);
    expect(await screen.findByText(/You were paid and have withdrawn everything/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("shows nothing to others", () => {
    m.address = FUNDER;
    view(<PaidNote bounty={makeBounty({ state: 4, payee: CLAIMANT })} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
