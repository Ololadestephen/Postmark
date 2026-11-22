import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const m = vi.hoisted(() => ({
  signAndBroadcast: vi.fn(),
  toast: vi.fn(),
  network: "testnet" as "testnet" | "mainnet",
  linked: true,
}));
vi.mock("../../src/components/Toasts", () => ({ useToast: () => m.toast }));
vi.mock("../../src/wallet/qorex", () => ({
  useQorex: () => ({
    native: { capabilities: ["listAccounts", "signAndBroadcast"], signAndBroadcast: m.signAndBroadcast },
    qorAddress: m.linked ? "qor1g78j5z9gr0nuafpt6d9adyq9j0a9d39kcf9w77" : null,
    connectAccount: vi.fn(),
  }),
  assertQorexTestnet: async () => {
    if (m.network === "mainnet") throw new Error("QoreX is on mainnet. Switch QoreX to testnet");
  },
}));

import { NativeSend, NATIVE_VALUE_NOTE } from "../../src/wallet/NativeSend";

const renderSend = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("Send with QoreX", () => {
  beforeEach(() => { m.signAndBroadcast.mockReset(); m.network = "testnet"; m.linked = true; });
  afterEach(cleanup);

  it("shows the max fee, then sends the withdraw as a MsgCrossVMCall", async () => {
    m.signAndBroadcast.mockResolvedValue({ txHash: "ABCDEF0123456789AB", code: 0, height: 10, shield: "shielded" });
    const onConfirmed = vi.fn();
    renderSend(<NativeSend call={{ functionName: "withdraw", args: [] }} label="Withdraw with QoreX" onConfirmed={onConfirmed} />);
    expect(screen.getByText(new RegExp(NATIVE_VALUE_NOTE.slice(0, 40)))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Withdraw with QoreX" }));
    expect(await screen.findByText(/max fee ≈ 0\.10 QOR \(gas ≤ 1,000,000, fixed limit\)/)).toBeInTheDocument();
    expect(m.signAndBroadcast).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm in QoreX" }));
    expect(await screen.findByText(/Sent with QoreX and confirmed/)).toBeInTheDocument();
    const req = m.signAndBroadcast.mock.calls[0]![0];
    expect(req.chainId).toBe("qorechain-diana");
    expect(req.gasLimit).toBe(1_000_000);
    expect(req.messages[0].typeUrl).toBe("/qorechain.crossvm.v1.MsgCrossVMCall");
    expect(onConfirmed).toHaveBeenCalled();
  });

  it("says plainly when the user rejects in QoreX", async () => {
    m.signAndBroadcast.mockRejectedValue(new Error("QoreX: signature rejected"));
    renderSend(<NativeSend call={{ functionName: "withdraw", args: [] }} />);
    await userEvent.click(screen.getByRole("button", { name: "Send with QoreX" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm in QoreX" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You cancelled the request in QoreX. Nothing was sent.");
  });

  it("stops before the prompt on mainnet", async () => {
    m.network = "mainnet";
    renderSend(<NativeSend call={{ functionName: "withdraw", args: [] }} />);
    await userEvent.click(screen.getByRole("button", { name: "Send with QoreX" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm in QoreX" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/QoreX is on mainnet\. Switch QoreX to testnet/);
    expect(m.signAndBroadcast).not.toHaveBeenCalled();
  });

  it("explains out of gas and raises the limit on the retry", async () => {
    m.signAndBroadcast.mockResolvedValue({ txHash: "FEED", code: 11, shield: "shielded" });
    renderSend(<NativeSend call={{ functionName: "withdraw", args: [] }} />);
    await userEvent.click(screen.getByRole("button", { name: "Send with QoreX" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm in QoreX" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ran out of gas at the 1,000,000 limit/);
    await userEvent.click(screen.getByRole("button", { name: "Try again with QoreX" }));
    expect(await screen.findByText(/gas ≤ 1,500,000/)).toBeInTheDocument();
  });

  it("offers to link QoreX when no account is linked", () => {
    m.linked = false;
    renderSend(<NativeSend call={{ functionName: "withdraw", args: [] }} />);
    expect(screen.getByRole("button", { name: "Link QoreX to send without MetaMask" })).toBeInTheDocument();
  });
});
