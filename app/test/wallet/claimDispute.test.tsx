import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CLAIMANT, FUNDER, META, VERIFIERS, makeBounty } from "../fixtures";
import { ESCROW_ADDRESS } from "../../src/chain/config";
import { claimLine, disputeLine } from "../../src/formats/lines";

const m = vi.hoisted(() => ({
  address: undefined as string | undefined,
  run: vi.fn(), toast: vi.fn(),
  comments: [] as unknown[],
  commentsError: null as Error | null,
  signerAddress: "", signerLive: true, signature: "0xabcd", verifyOk: true, keyLive: true,
  myKeyLive: true as boolean | undefined,
}));

vi.mock("wagmi", () => ({ useAccount: () => ({ address: m.address, isConnected: !!m.address }) }));
vi.mock("../../src/wallet/WalletRoot", async () => (await import("../mocks")).walletRootModule);
vi.mock("../../src/hooks/useTxAction", () => ({
  useTxAction: () => ({ state: { phase: "idle" }, run: m.run, busy: false }),
}));
vi.mock("../../src/components/Toasts", () => ({ useToast: () => m.toast }));
vi.mock("../../src/wallet/Readiness", () => ({ ReadinessChecklist: () => null }));
vi.mock("../../src/wallet/useEnableTransactions", () => ({ useEnableTransactions: () => ({ run: vi.fn(), busy: false }) }));
vi.mock("../../src/wallet/qorex", () => ({ useQorex: () => ({ canSignArbitrary: false, qorAddress: null, native: null }) }));
vi.mock("../../src/hooks/queries", () => ({
  usePqcStatus: () => ({ data: m.myKeyLive === undefined ? undefined : { live: m.myKeyLive } }),
}));
vi.mock("../../src/github/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/github/client")>()),
  getAllComments: vi.fn(async () => {
    if (m.commentsError) throw m.commentsError;
    return m.comments;
  }),
}));
vi.mock("../../src/chain/localSigner", () => ({
  signerStatus: vi.fn(async () => ({ address: m.signerAddress, live: m.signerLive })),
  pairingCode: () => "abcd1234", setPairingCode: vi.fn(), signerPort: () => 47321, setSignerPort: vi.fn(),
  SignerError: class extends Error { constructor(public status: number, msg: string) { super(msg); } },
}));
vi.mock("../../src/wallet/pqSigner", () => ({
  pickSigner: () => ({ id: "local", sign: async () => m.signature }),
}));
vi.mock("../../src/chain/pqc", () => ({
  pqcKeyStatus: async () => ({ live: m.keyLive, pubkey: "0x00" }),
}));
vi.mock("@qorechain/pqc", () => ({ mldsa87: { verify: () => m.verifyOk } }));
vi.mock("../../src/formats/messages", () => ({ claimMessage: () => "0x01" }));

import ClaimPanel from "../../src/wallet/ClaimPanel";
import DisputePanel from "../../src/wallet/DisputePanel";

const comment = (id: number, login: string, body: string) =>
  ({ id, user: { login }, body, created_at: "2026-11-18T10:00:00Z" });
const claimComment = (id: number, bounty: bigint, who: `0x${string}` = CLAIMANT) =>
  comment(id, "e2e-claimant", claimLine(bounty, who, ESCROW_ADDRESS));

beforeEach(() => {
  Object.assign(m, {
    address: CLAIMANT, comments: [], commentsError: null, signerAddress: CLAIMANT,
    signerLive: true, signature: "0xabcd", verifyOk: true, keyLive: true, myKeyLive: true,
  });
  vi.clearAllMocks();
});

describe("ClaimPanel gating", () => {
  const bounty = makeBounty();
  it("renders nothing without a connected account", () => {
    m.address = undefined;
    const { container } = render(<ClaimPanel id={7n} bounty={bounty} meta={META} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("refuses funders and verifiers", () => {
    m.address = FUNDER;
    const { unmount } = render(<ClaimPanel id={7n} bounty={bounty} meta={META} />);
    expect(screen.getByText(/cannot claim their own bounty/)).toBeInTheDocument();
    unmount();
    m.address = VERIFIERS[0];
    render(<ClaimPanel id={7n} bounty={bounty} meta={META} />);
    expect(screen.getByText(/cannot claim their own bounty/)).toBeInTheDocument();
  });

  it("closes after the deadline and when the claim window no longer fits", () => {
    const { unmount } = render(<ClaimPanel id={7n} bounty={makeBounty({ deadline: 1n })} meta={META} />);
    expect(screen.getByText(/deadline has passed/)).toBeInTheDocument();
    unmount();
    const soon = BigInt(Math.floor(Date.now() / 1000)) + 600n;
    render(<ClaimPanel id={7n} bounty={makeBounty({ deadline: soon, claimTimeout: 3600n })} meta={META} />);
    expect(screen.getByText(/no longer fits before the deadline/)).toBeInTheDocument();
  });
});

describe("ClaimPanel flow", () => {
  const open = makeBounty();

  it("shows the exact claim line to post", () => {
    render(<ClaimPanel id={7n} bounty={open} meta={META} />);
    expect(screen.getByText(claimLine(7n, CLAIMANT, ESCROW_ADDRESS))).toBeInTheDocument();
  });

  it("reports when no claim comment exists yet", async () => {
    render(<ClaimPanel id={7n} bounty={open} meta={META} />);
    fireEvent.click(screen.getByRole("button", { name: /find my comment/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No claim line from your address/);
  });

  it("surfaces a GitHub failure", async () => {
    m.commentsError = new Error("rate limited");
    render(<ClaimPanel id={7n} bounty={open} meta={META} />);
    fireEvent.click(screen.getByRole("button", { name: /find my comment/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("rate limited");
  });

  it("finds the claim, signs it locally and sends the claim transaction", async () => {
    m.comments = [claimComment(11, 7n), claimComment(12, 7n)];
    render(<ClaimPanel id={7n} bounty={open} meta={META} />);
    fireEvent.click(screen.getByRole("button", { name: /find my comment/ }));
    expect(await screen.findByText(/Found the claim line by @e2e-claimant \(comment 11\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 later claim line ignored/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign the claim" }));
    fireEvent.click(await screen.findByRole("button", { name: "Claim bounty" }));
    expect(m.run).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "claim", args: [7n, expect.stringMatching(/^0x[0-9a-f]{64}$/), "0xabcd"] }));
  });

  it("ignores claim lines for another bounty or another claimant", async () => {
    m.comments = [claimComment(11, 8n), claimComment(12, 7n, FUNDER)];
    render(<ClaimPanel id={7n} bounty={open} meta={META} />);
    fireEvent.click(screen.getByRole("button", { name: /find my comment/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No claim line/);
  });

  async function reachSignStep() {
    m.comments = [claimComment(11, 7n)];
    render(<ClaimPanel id={7n} bounty={open} meta={META} />);
    fireEvent.click(screen.getByRole("button", { name: /find my comment/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign the claim" }));
  }

  it("refuses a signer holding another account", async () => {
    m.signerAddress = FUNDER;
    await reachSignStep();
    expect(await screen.findByRole("alert")).toHaveTextContent(/local signer holds/);
  });

  it("refuses a signer whose key is not live", async () => {
    m.signerLive = false;
    await reachSignStep();
    expect(await screen.findByRole("alert")).toHaveTextContent(/key is not live/);
  });

  it("refuses a signature that fails local verification", async () => {
    m.verifyOk = false;
    await reachSignStep();
    expect(await screen.findByRole("alert")).toHaveTextContent(/failed local ML-DSA-87 verification/);
  });

  it("warns next to the claim line that a key-less account names the wrong claimant", () => {
    m.myKeyLive = false;
    render(<ClaimPanel id={7n} bounty={open} meta={META} />);
    expect(screen.getByText(/will name the wrong claimant/)).toBeInTheDocument();
    expect(screen.getAllByText("How to fix").length).toBeGreaterThan(0);
  });

  it("warns and blocks signing when the account has no live PQ key", async () => {
    m.comments = [claimComment(11, 7n)];
    m.myKeyLive = false;
    render(<ClaimPanel id={7n} bounty={open} meta={META} />);
    fireEvent.click(screen.getByRole("button", { name: /find my comment/ }));
    expect(await screen.findByText(/no live ML-DSA-87 key/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign the claim" })).toBeDisabled();
  });
});

describe("DisputePanel", () => {
  const pending = makeBounty({ state: 2, payee: CLAIMANT, challengeEndsAt: 4_000_000_000n });
  const disputeComment = (id: number, login: string, bounty = 7n) =>
    comment(id, login, disputeLine(bounty, ESCROW_ADDRESS));

  it("shows the dispute line and the bond", () => {
    render(<DisputePanel id={7n} bounty={pending} meta={META} />);
    expect(screen.getByText(disputeLine(7n, ESCROW_ADDRESS))).toBeInTheDocument();
    expect(screen.getByText(/dispute this verdict/)).toBeInTheDocument();
  });

  it("renders nothing once the challenge window has closed", () => {
    const { container } = render(<DisputePanel id={7n} bounty={makeBounty({ state: 2, challengeEndsAt: 1n })} meta={META} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("needs a login before scanning", () => {
    render(<DisputePanel id={7n} bounty={pending} meta={META} />);
    expect(screen.getByRole("button", { name: /find my comment/ })).toBeDisabled();
  });

  it("reports a missing dispute comment, then bonds once it is found", async () => {
    render(<DisputePanel id={7n} bounty={pending} meta={META} />);
    fireEvent.change(screen.getByPlaceholderText("your GitHub login"), { target: { value: "E2E-Disputer" } });
    fireEvent.click(screen.getByRole("button", { name: /find my comment/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No dispute line from @E2E-Disputer");

    m.comments = [disputeComment(50, "e2e-disputer", 8n), disputeComment(51, "e2e-disputer")];
    fireEvent.click(screen.getByRole("button", { name: /find my comment/ }));
    expect(await screen.findByText(/Found the dispute line \(comment 51\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Bond dispute/ }));
    expect(m.run).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "dispute", value: pending.bondAmount,
      args: [7n, expect.stringMatching(/^0x[0-9a-f]{64}$/)] }));
  });

  it("surfaces a GitHub failure", async () => {
    m.commentsError = new Error("offline");
    render(<DisputePanel id={7n} bounty={pending} meta={META} />);
    fireEvent.change(screen.getByPlaceholderText("your GitHub login"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /find my comment/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("offline"));
  });
});
