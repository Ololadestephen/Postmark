import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { newQueryClient, CLAIMANT } from "../fixtures";

const m = vi.hoisted(() => ({
  account: { address: undefined as string | undefined, isConnected: false },
  chainId: 9800, switchChainAsync: vi.fn(), writeContractAsync: vi.fn(),
  estimate: vi.fn(), simulate: vi.fn(), receipt: vi.fn(),
  pqcLive: true, window: { live: true, remainingTxs: 5, remainingValue: 10n ** 12n,
    allowedTargets: [] as string[], remainingBlocks: 50 } as unknown,
  preflight: vi.fn(), toast: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => m.account, useChainId: () => m.chainId,
  useSwitchChain: () => ({ switchChainAsync: m.switchChainAsync }),
  useWriteContract: () => ({ writeContractAsync: m.writeContractAsync }),
  usePublicClient: () => ({ waitForTransactionReceipt: m.receipt }),
}));
vi.mock("../../src/chain/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/chain/client")>()),
  httpClient: { estimateContractGas: m.estimate, simulateContract: m.simulate, waitForTransactionReceipt: m.receipt },
}));
vi.mock("../../src/components/Toasts", () => ({ useToast: () => m.toast }));
vi.mock("../../src/chain/pqc", () => ({ pqcKeyStatus: async () => ({ live: m.pqcLive }) }));
vi.mock("../../src/chain/window", () => ({ fetchEvmWindow: async () => m.window }));
vi.mock("../../src/chain/preflight", () => ({ preflightTx: (...a: unknown[]) => m.preflight(...a) }));

import { useTxAction } from "../../src/hooks/useTxAction";

const wrapper = ({ children }: { children: ReactNode }) =>
  <QueryClientProvider client={newQueryClient()}>{children}</QueryClientProvider>;
const HASH = `0x${"ab".repeat(32)}` as const;
const req = { functionName: "finalize", args: [7n] as readonly unknown[] };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(m, { chainId: 9800, pqcLive: true });
  m.account = { address: CLAIMANT, isConnected: true };
  m.estimate.mockResolvedValue(100_000n);
  m.simulate.mockResolvedValue({});
  m.preflight.mockReturnValue({ ok: true });
  m.writeContractAsync.mockResolvedValue(HASH);
  m.receipt.mockResolvedValue({ status: "success" });
});

describe("useTxAction", () => {
  it("runs a transaction to confirmation with a padded gas estimate", async () => {
    const onConfirmed = vi.fn();
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run({ ...req, onConfirmed }));
    expect(result.current.state).toMatchObject({ phase: "confirmed", hash: HASH });
    expect(m.writeContractAsync.mock.calls[0]![0].gas).toBe(125_001n);
    expect(onConfirmed).toHaveBeenCalledWith(HASH);
    expect(result.current.busy).toBe(false);
  });

  it("blocks when no wallet is connected", async () => {
    m.account = { address: undefined, isConnected: false };
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run(req));
    expect(result.current.state).toMatchObject({ phase: "blocked", blockReason: expect.stringMatching(/Connect an EVM wallet/) });
    expect(m.writeContractAsync).not.toHaveBeenCalled();
  });

  it("switches chain, and blocks if the wallet refuses", async () => {
    m.chainId = 1;
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run(req));
    expect(m.switchChainAsync).toHaveBeenCalledWith({ chainId: 9800 });
    m.switchChainAsync.mockRejectedValue(new Error("no"));
    await act(() => result.current.run(req));
    expect(result.current.state.blockReason).toMatch(/Switch the wallet/);
  });

  it("stops at the preflight verdict with its guide", async () => {
    m.preflight.mockReturnValue({ ok: false, reason: "No open EVM window.", guide: { target: "0x1", suggestedTxs: 1, suggestedValueUqor: "1" } });
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run(req));
    expect(result.current.state).toMatchObject({ phase: "blocked", blockReason: "No open EVM window." });
    expect(m.writeContractAsync).not.toHaveBeenCalled();
  });

  it("retries the last request after the window is opened", async () => {
    m.preflight.mockReturnValueOnce({ ok: false, reason: "No open EVM window.", guide: { target: "0x1", suggestedTxs: 1, suggestedValueUqor: "1" } });
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run(req));
    expect(result.current.state.phase).toBe("blocked");
    await act(async () => { result.current.retry(); await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current.state).toMatchObject({ phase: "confirmed", hash: HASH });
    expect(m.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(m.writeContractAsync.mock.calls[0]![0]).toMatchObject({ functionName: "finalize", args: [7n] });
  });

  it("decodes the revert when gas estimation fails and the simulation reverts", async () => {
    m.estimate.mockRejectedValue(new Error("estimate failed"));
    m.simulate.mockRejectedValue(new Error("execution reverted"));
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run(req));
    expect(result.current.state).toMatchObject({ phase: "failed", error: "execution reverted" });
  });

  it("falls back to a fixed gas limit when only the estimate fails", async () => {
    m.estimate.mockRejectedValue(new Error("estimate failed"));
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run(req));
    expect(m.writeContractAsync.mock.calls[0]![0].gas).toBe(300_000n);
    expect(result.current.state.phase).toBe("confirmed");
  });

  it("treats a wallet rejection as nothing sent", async () => {
    m.writeContractAsync.mockRejectedValue(new Error("User rejected the request."));
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run(req));
    expect(result.current.state).toMatchObject({ phase: "ready", error: expect.stringMatching(/nothing was sent/) });
  });

  it("reports on-chain reverts and unconfirmed transactions", async () => {
    m.receipt.mockResolvedValueOnce({ status: "reverted" });
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run(req));
    expect(result.current.state).toMatchObject({ phase: "failed", error: "The transaction reverted on chain." });
    m.receipt.mockRejectedValueOnce(new Error("timeout"));
    await act(() => result.current.run(req));
    expect(result.current.state.error).toMatch(/Still unconfirmed/);
  });

  it("can be reset to idle", async () => {
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run(req));
    act(() => result.current.reset());
    expect(result.current.state.phase).toBe("idle");
  });

  it("raises exactly one friendly error toast when a transaction fails", async () => {
    m.writeContractAsync.mockRejectedValue(new Error("RPC exploded"));
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run(req));
    expect(result.current.state.phase).toBe("failed");
    expect(m.toast).toHaveBeenCalledTimes(1);
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({
      kind: "error", title: "Transaction didn't go through", text: expect.stringContaining("RPC exploded") }));
  });

  it("treats a wallet rejection as a friendly cancel, not an error", async () => {
    m.writeContractAsync.mockRejectedValue(Object.assign(new Error("User rejected the request."), { code: 4001 }));
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run(req));
    expect(result.current.state.phase).toBe("ready");
    expect(m.toast).toHaveBeenCalledTimes(1);
    expect(m.toast).toHaveBeenCalledWith({ kind: "info", title: "Cancelled", text: "You cancelled the request in your wallet." });
  });

  it("raises one toast when the transaction reverts on chain", async () => {
    m.receipt.mockResolvedValue({ status: "reverted" });
    const { result } = renderHook(() => useTxAction(), { wrapper });
    await act(() => result.current.run(req));
    expect(m.toast).toHaveBeenCalledTimes(1);
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: "error" }));
  });
});
