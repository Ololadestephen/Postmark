import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CLAIMANT, FUNDER, META, VERIFIERS, makeBounty } from "../fixtures";

const m = vi.hoisted(() => ({ address: undefined as string | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: m.address, isConnected: !!m.address }) }));
vi.mock("../../src/wallet/WalletRoot", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../src/wallet/review/useIdentityCheck", () => ({ useIdentityCheck: () => ({ status: "idle", error: null, identity: null, disputeComment: null, scan: vi.fn() }) }));
vi.mock("../../src/wallet/review/usePrCheck", () => ({ usePrCheck: () => ({ prCheck: null }) }));
vi.mock("../../src/wallet/review/useVerdictBuilder", () => ({ useVerdictBuilder: () => ({ built: null }) }));
vi.mock("../../src/wallet/review/useVerdictBundle", () => ({ useVerdictBundle: () => ({ recordSignature: vi.fn() }) }));
vi.mock("../../src/wallet/review/useVerdictSigning", () => ({ useVerdictSigning: () => ({ sign: vi.fn() }) }));
vi.mock("../../src/wallet/review/ClaimChecks", () => ({
  ClaimUnderReview: () => <p>review tool</p>, IdentityCard: () => null, PrCheckCard: () => null }));
vi.mock("../../src/wallet/review/VerdictCards", () => ({ DecisionCard: () => null, SignCard: () => null }));
vi.mock("../../src/wallet/review/BundleCard", () => ({ BundleCard: () => null }));
vi.mock("../../src/hooks/queries", () => ({
  useBountyTask: () => ({ task: null, invalid: null, pending: false }),
  useIndex: () => ({ data: undefined }),
}));
vi.mock("../../src/hooks/useTxAction", () => ({ useTxAction: () => ({ run: vi.fn(), state: { phase: "idle" } }) }));
vi.mock("../../src/wallet/qorex", () => ({ useQorex: () => ({ canSignArbitrary: false, qorAddress: null }) }));

import ReviewPanel from "../../src/wallet/ReviewPanel";

const bounty = makeBounty({ state: 1, payee: CLAIMANT });
const view = () => render(<MemoryRouter><ReviewPanel id={7n} bounty={bounty} meta={META} /></MemoryRouter>);
beforeEach(() => { m.address = undefined; });

describe("review page gate", () => {
  it("shows the tool to a verifier", () => {
    m.address = VERIFIERS[2];
    view();
    expect(screen.getByText("review tool")).toBeInTheDocument();
  });
  it("shows the verifier list and a way back to anyone else who is connected", () => {
    for (const a of [FUNDER, CLAIMANT]) {
      m.address = a;
      const r = view();
      expect(screen.getByText("Only this bounty's three verifiers sign verdicts here.")).toBeInTheDocument();
      expect(screen.queryByText("review tool")).toBeNull();
      expect(screen.getByRole("link", { name: /back to the bounty/ })).toHaveAttribute("href", "/bounty/7");
      expect(r.container.textContent).toContain(VERIFIERS[0]!.slice(0, 6));
      r.unmount();
    }
  });
  it("asks for a wallet when not connected", () => {
    view();
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.queryByText("review tool")).toBeNull();
  });
});
