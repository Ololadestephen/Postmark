import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CLAIMANT, FUNDER, META, VERIFIERS, makeBounty, renderApp } from "../fixtures";

const m = vi.hoisted(() => ({
  address: undefined as string | undefined,
  run: vi.fn(), toast: vi.fn(), busy: false, txState: { phase: "idle" } as Record<string, unknown>,
  credits: [0n, 0n] as [bigint, bigint],
  index: { data: undefined as unknown, isPending: false, error: null },
  bounties: { data: undefined as unknown, isPending: false, error: null },
  pqcLive: true as boolean | undefined,
  githubItem: { data: undefined as unknown, error: null as unknown, isPending: true },
  livePqcKey: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: m.address, isConnected: !!m.address }),
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()), useNavigate: () => m.navigate,
}));
vi.mock("../../src/wallet/WalletRoot", async () => (await import("../mocks")).walletRootModule);
vi.mock("../../src/hooks/useTxAction", () => ({
  useTxAction: () => ({ state: m.txState, run: m.run, busy: m.busy }),
}));
vi.mock("../../src/components/Toasts", () => ({ useToast: () => m.toast }));
vi.mock("../../src/chain/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/chain/client")>()),
  creditOf: vi.fn(async () => m.credits),
}));
vi.mock("../../src/hooks/queries", () => ({
  useSelfListed: () => ({ data: [], isError: false, isPending: false }),
  useIndex: () => m.index, useBounties: () => m.bounties,
  usePqcStatus: () => ({ data: m.pqcLive === undefined ? undefined : { live: m.pqcLive } }),
  useGithubItem: () => m.githubItem,
  useBountyTask: () => ({ task: null, invalid: null, pending: false }),
}));
vi.mock("../../src/wallet/Readiness", () => ({ ReadinessChecklist: () => null }));
vi.mock("../../src/chain/pqc", () => ({ livePqcKey: (...a: unknown[]) => m.livePqcKey(...a) }));

import MeInner from "../../src/wallet/MeInner";
import CreateInner from "../../src/wallet/CreateInner";
import TxActions from "../../src/wallet/TxActions";
import ClaimedNote from "../../src/wallet/ClaimedNote";
import FunderShare from "../../src/wallet/FunderShare";
import { TxStatusPanel } from "../../src/wallet/TxWidgets";

const withIndex = (rows: { id: bigint; bounty: ReturnType<typeof makeBounty> }[]) => {
  m.index = { data: { bountyIds: rows.map((r) => r.id), metaById: new Map(rows.map((r) => [r.id, META])) },
    isPending: false, error: null };
  m.bounties = { data: rows, isPending: false, error: null };
};

beforeEach(() => {
  Object.assign(m, {
    address: CLAIMANT, busy: false, txState: { phase: "idle" }, credits: [0n, 0n], pqcLive: true,
    githubItem: { data: { title: "Wire the funder flow" }, error: null, isPending: false },
  });
  m.index = { data: undefined, isPending: false, error: null };
  m.bounties = { data: undefined, isPending: false, error: null };
  vi.clearAllMocks();
});

describe("MeInner", () => {
  it("asks to connect a wallet when disconnected", () => {
    m.address = undefined;
    renderApp(<MeInner />);
    expect(screen.getByText(/Connect an EVM wallet/)).toBeInTheDocument();
  });

  it("shows empty states for every section", async () => {
    withIndex([]);
    renderApp(<MeInner />);
    expect(await screen.findByText("No credits yet.")).toBeInTheDocument();
    expect(screen.getByText(/haven't funded a bounty yet/)).toBeInTheDocument();
    expect(screen.getByText(/No claims yet/)).toBeInTheDocument();
    expect(screen.getByText(/not a verifier on any bounty/)).toBeInTheDocument();
  });

  it("lists funded, claimed and verifier bounties for the connected account", async () => {
    m.address = FUNDER;
    withIndex([
      { id: 1n, bounty: makeBounty() },
      { id: 2n, bounty: makeBounty({ funder: CLAIMANT, payee: FUNDER, state: 1, claimExpiresAt: 4_000_000_000n, claimRound: 2n }) },
      { id: 3n, bounty: makeBounty({ funder: CLAIMANT, verifiers: [FUNDER, VERIFIERS[1], VERIFIERS[2]], state: 3 }) },
    ]);
    renderApp(<MeInner />);
    expect(await screen.findByText("#1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Claims" }));
    expect(screen.getByText("round 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Verifying" }));
    expect(screen.getByRole("link", { name: "resolve dispute →" })).toHaveAttribute("href", "/bounty/3/review");
    expect(screen.getAllByText("Wire the funder flow").length).toBeGreaterThan(0);
  });

  it("lets the account withdraw posted credits", async () => {
    m.credits = [5n, 7n];
    withIndex([]);
    renderApp(<MeInner />);
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    expect(m.run).toHaveBeenCalledWith(expect.objectContaining({ functionName: "withdraw", args: [] }));
    expect(screen.getByText(/Payee-gated credit withdraws only while/)).toBeInTheDocument();
  });

  it("refreshes credits after a withdraw and locks the button until they change", async () => {
    m.credits = [5n, 7n];
    withIndex([]);
    renderApp(<MeInner />);
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
    const req = m.run.mock.calls.at(-1)![0] as { invalidates: unknown[][]; onConfirmed: () => void };
    expect(req.invalidates).toContainEqual(["credits", CLAIMANT]);
    act(() => req.onConfirmed());
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeDisabled();
  });

  it("warns when gated credit cannot be withdrawn without a live key", async () => {
    m.credits = [0n, 7n];
    m.pqcLive = false;
    withIndex([]);
    renderApp(<MeInner />);
    expect(await screen.findByText(/withdrawals will revert/)).toBeInTheDocument();
  });
});

describe("CreateInner", () => {
  const fill = (placeholder: string, value: string) =>
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

  it("shows field errors per field: URL only, then a blurred verifier, then a submit attempt", () => {
    m.address = undefined;
    renderApp(<CreateInner />);
    expect(screen.getByRole("heading", { name: "Fund an issue" })).toBeInTheDocument();
    expect(screen.getByText(/Connect an EVM wallet to continue/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    fill("https://github.com/owner/repo/issues/42", "https://github.com/acme/widgets/issues/7");
    expect(screen.queryByText(/Required/)).toBeNull();

    fireEvent.blur(screen.getByPlaceholderText("Verifier 1 — 0x… or qor1…"));
    expect(screen.getAllByText(/Required — three verifier addresses/).length).toBeGreaterThan(0);
  });

  it("reveals every relevant error after a submit attempt on a pristine form", async () => {
    m.address = FUNDER;
    renderApp(<CreateInner />);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Create bounty/ }));
    expect(await screen.findByText("Enter a github.com issue or PR URL.")).toBeInTheDocument();
    expect(screen.getByText(/Verifier 1: Required — three verifier addresses/)).toBeInTheDocument();
    expect(m.run).not.toHaveBeenCalled();
  });

  it("rejects non-GitHub URLs and previews real ones", () => {
    renderApp(<CreateInner />);
    fill("https://github.com/owner/repo/issues/42", "https://example.com/x");
    expect(screen.getByText("Not a github.com issue or PR URL.")).toBeInTheDocument();
    fill("https://github.com/owner/repo/issues/42", "https://github.com/postmark-e2e/sandbox/issues/1");
    expect(screen.getByText("Wire the funder flow")).toBeInTheDocument();
  });

  it("shows the amount to lock and the preview from the form values without a wallet", () => {
    m.address = undefined;
    renderApp(<CreateInner />);
    expect(screen.getAllByText("0.55 QOR")[0]).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Bounty card preview" })).toHaveTextContent("0.55 QOR");
    fill("https://github.com/owner/repo/issues/42", "https://github.com/acme/widgets/issues/7");
    expect(screen.getByRole("group", { name: "Bounty card preview" })).toHaveTextContent("acme/widgets#7");
  });

  it("recomputes reward and bond from the amount until they are edited", () => {
    m.address = undefined;
    renderApp(<CreateInner />);
    const reward = () => (screen.getByLabelText(/Challenge reward/) as HTMLInputElement).value;
    const bond = () => (screen.getByLabelText(/Dispute bond/) as HTMLInputElement).value;
    expect([reward(), bond()]).toEqual(["0.05", "0.1"]);
    fireEvent.click(screen.getByRole("button", { name: "1 QOR" }));
    expect([reward(), bond()]).toEqual(["0.1", "0.2"]);
    fireEvent.change(screen.getByLabelText(/Challenge reward/), { target: { value: "0.3" } });
    fireEvent.click(screen.getByRole("button", { name: "0.1 QOR" }));
    expect([reward(), bond()]).toEqual(["0.3", "0.02"]);
  });

  it("offers deadline presets, defaulting to one week", () => {
    m.address = undefined;
    renderApp(<CreateInner />);
    expect(screen.getByRole("button", { name: "1 week" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "1 month" }));
    expect(screen.getByRole("button", { name: "1 month" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Pick a date" }));
    expect(screen.getByLabelText(/^Deadline \(/)).toBeInTheDocument();
  });

  it("creates the bounty with the entered terms once connected", async () => {
    m.livePqcKey.mockImplementation(async (a: string) => `0x${a.slice(2, 6)}` as `0x${string}`);
    renderApp(<CreateInner />);
    fill("https://github.com/owner/repo/issues/42", "https://github.com/postmark-e2e/sandbox/issues/1");
    VERIFIERS.forEach((v, i) => fill(`Verifier ${i + 1} — 0x… or qor1…`, v));
    fireEvent.click(await screen.findByRole("button", { name: /Create bounty/ }));
    await waitFor(() => expect(m.run).toHaveBeenCalled());
    const call = m.run.mock.calls[0]![0];
    expect(call.functionName).toBe("createBounty");
    expect(call.value).toBe(550_000_000_000_000_000n);
    expect(call.args[1]).toBe("postmark-e2e/sandbox");
  });

  it("refuses verifiers that share one PQ key", async () => {
    m.livePqcKey.mockResolvedValue("0xsame");
    renderApp(<CreateInner />);
    fill("https://github.com/owner/repo/issues/42", "https://github.com/postmark-e2e/sandbox/issues/1");
    VERIFIERS.forEach((v, i) => fill(`Verifier ${i + 1} — 0x… or qor1…`, v));
    fireEvent.click(await screen.findByRole("button", { name: /Create bounty/ }));
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringMatching(/share the same PQ key/) })));
    expect(m.run).not.toHaveBeenCalled();
  });

  it("refuses a verifier without a live key", async () => {
    m.livePqcKey.mockResolvedValueOnce("0xaa").mockResolvedValueOnce(null).mockResolvedValueOnce("0xcc");
    renderApp(<CreateInner />);
    fill("https://github.com/owner/repo/issues/42", "https://github.com/postmark-e2e/sandbox/issues/1");
    VERIFIERS.forEach((v, i) => fill(`Verifier ${i + 1} — 0x… or qor1…`, v));
    fireEvent.click(await screen.findByRole("button", { name: /Create bounty/ }));
    await waitFor(() => expect(m.toast).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringMatching(/no live ML-DSA-87 key/) })));
  });

  it("switches claim-timeout presets and accepts a custom value", () => {
    renderApp(<CreateInner />);
    fireEvent.click(screen.getByRole("button", { name: "7 d" }));
    fireEvent.click(screen.getByRole("button", { name: "custom" }));
    expect(screen.getByText(/hours \(1–168\)/)).toBeInTheDocument();
  });
});

describe("TxActions", () => {
  it("offers a refund to the funder after the deadline", () => {
    m.address = FUNDER;
    render(<TxActions id={7n} bounty={makeBounty({ deadline: 1n })} />);
    fireEvent.click(screen.getByRole("button", { name: "Refund expired bounty" }));
    expect(m.run).toHaveBeenCalledWith(expect.objectContaining({ functionName: "refundExpired", args: [7n] }));
  });

  it("offers reopen for an expired claim to anyone", () => {
    render(<TxActions id={7n} bounty={makeBounty({ state: 1, claimExpiresAt: 5n, payee: CLAIMANT })} />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen expired claim" }));
    expect(m.run).toHaveBeenCalledWith(expect.objectContaining({ functionName: "reopen" }));
  });

  it("renders nothing when no action applies or when disconnected", () => {
    const { container, unmount } = render(<TxActions id={7n} bounty={makeBounty()} />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    m.address = undefined;
    const second = render(<TxActions id={7n} bounty={makeBounty({ deadline: 1n })} />);
    expect(second.container).toBeEmptyDOMElement();
  });
});

describe("small wallet notes", () => {
  it("ClaimedNote speaks to the claimant and to everyone else", () => {
    const b = makeBounty({ state: 1, payee: CLAIMANT, claimRound: 1n, claimExpiresAt: 4_000_000_000n });
    const { unmount } = render(<ClaimedNote bounty={b} />);
    expect(screen.getByText("your claim is live")).toBeInTheDocument();
    unmount();
    m.address = FUNDER;
    render(<ClaimedNote bounty={b} />);
    expect(screen.getByText("claimed")).toBeInTheDocument();
  });

  it("FunderShare is visible only to the funder and copies the link", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    m.address = FUNDER;
    const { unmount } = render(<FunderShare bounty={makeBounty({ challengeEndsAt: 4_000_000_000n })} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
    await waitFor(() => expect(m.toast).toHaveBeenCalled());
    expect(write).toHaveBeenCalled();
    unmount();
    m.address = CLAIMANT;
    const other = render(<FunderShare bounty={makeBounty()} />);
    expect(other.container).toBeEmptyDOMElement();
  });
});

describe("TxStatusPanel", () => {
  it("renders nothing while idle", () => {
    const { container } = render(<TxStatusPanel state={{ phase: "idle" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains a blocked transaction with the window guide", () => {
    renderApp(<TxStatusPanel state={{ phase: "blocked", blockReason: "No open EVM window.",
      guide: { target: "0xabc", suggestedTxs: 3, suggestedValueUqor: "1000" } }} />);
    expect(screen.getByText("No open EVM window.")).toBeInTheDocument();
    expect(screen.getByText(/Open an EVM access window/)).toBeInTheDocument();
    expect(screen.getByText(/MetaMask on QoreChain/)).toBeInTheDocument();
  });

  it("walks through the in-flight and terminal phases", () => {
    const hash = `0x${"ab".repeat(32)}` as const;
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ phase: "checking" }, /Checking chain/],
      [{ phase: "simulating" }, /Simulating/],
      [{ phase: "wallet", maxFeeWei: 10n ** 16n, gasLimit: 100n }, /max fee ≈ 0.0100 QOR/],
      [{ phase: "submitted", hash }, /Submitted/],
      [{ phase: "confirming", hash }, /Confirming/],
      [{ phase: "confirmed", hash }, /Confirmed/],
      [{ phase: "failed", error: "reverted" }, /reverted/],
      [{ phase: "ready", error: "Rejected in the wallet" }, /Rejected/],
    ];
    for (const [state, text] of cases) {
      const { unmount } = render(<TxStatusPanel state={state as never} />);
      expect(screen.getByRole("status")).toHaveTextContent(text);
      unmount();
    }
  });
});
