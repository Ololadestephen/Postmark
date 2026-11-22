import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CLAIMANT, FUNDER, META, VERIFIERS, makeBounty, ZERO_ADDR } from "../fixtures";

const m = vi.hoisted(() => ({ address: undefined as string | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: m.address, isConnected: !!m.address }) }));
vi.mock("../../src/wallet/WalletRoot", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../src/wallet/DisputePanel", () => ({ default: () => <p>dispute panel</p> }));

import { bountyRole } from "../../src/wallet/role";
import ClaimedNote from "../../src/wallet/ClaimedNote";
import VerifierReviewLink from "../../src/wallet/VerifierReviewLink";
import PaidNote from "../../src/wallet/PaidNote";
import PendingActions from "../../src/wallet/PendingActions";

const view = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
const claimed = makeBounty({ state: 1, payee: CLAIMANT, claimRound: 1n, claimExpiresAt: 4_000_000_000n });
beforeEach(() => { m.address = undefined; });

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
    expect(screen.getByRole("link", { name: /You're verifier #1 on this bounty — open the review tool/ })).toHaveAttribute("href", "/bounty/7/review");
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
    const r = view(<ClaimedNote bounty={claimed} meta={META} />);
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
  it("links the claimant to the Dashboard", () => {
    m.address = CLAIMANT;
    view(<PaidNote bounty={makeBounty({ state: 4, payee: CLAIMANT })} />);
    expect(screen.getByRole("link", { name: /Withdraw from your Dashboard|withdraw from your Dashboard/ })).toHaveAttribute("href", "/me");
  });
  it("shows nothing to others", () => {
    m.address = FUNDER;
    view(<PaidNote bounty={makeBounty({ state: 4, payee: CLAIMANT })} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
