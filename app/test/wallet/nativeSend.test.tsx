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
import { NATIVE_RECEIPT_POLL } from "../../src/chain/native";
import { qorToEvm } from "../../src/chain/bech32";

const QOREX_EVM = qorToEvm("qor1g78j5z9gr0nuafpt6d9adyq9j0a9d39kcf9w77");
const receipt = vi.hoisted(() => ({ body: null as unknown }));

const renderSend = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("Send with QoreX", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_QOREX_NATIVE", "1");
    NATIVE_RECEIPT_POLL.attempts = 2; NATIVE_RECEIPT_POLL.intervalMs = 1;
    receipt.body = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/cosmos/tx/v1beta1/txs/") && receipt.body
      ? { ok: true, json: async () => receipt.body } : { ok: false, json: async () => ({}) })); m.signAndBroadcast.mockReset(); m.network = "testnet"; m.linked = true; });
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const confirmWithdraw = async (props: Partial<React.ComponentProps<typeof NativeSend>> = {}) => {
    renderSend(<NativeSend call={{ functionName: "withdraw", args: [] }} {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Send with QoreX" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm in QoreX" }));
  };

  it("refuses when QoreX is on a different account than the page", async () => {
    renderSend(<NativeSend call={{ functionName: "withdraw", args: [] }} sender="0x0000000000000000000000000000000000000001" />);
    await userEvent.click(screen.getByRole("button", { name: "Send with QoreX" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/different accounts/);
    expect(screen.queryByRole("button", { name: "Confirm in QoreX" })).toBeNull();
    expect(m.signAndBroadcast).not.toHaveBeenCalled();
  });

  it("sends when QoreX is on the page's account", async () => {
    m.signAndBroadcast.mockResolvedValue({ txHash: "AB", code: 0, height: 3, shield: "shielded" });
    await confirmWithdraw({ sender: QOREX_EVM });
    expect(await screen.findByText(/Sent with QoreX and confirmed/)).toBeInTheDocument();
  });

  it("waits for the receipt when QoreX returns no height, and reports its failure", async () => {
    m.signAndBroadcast.mockResolvedValue({ txHash: "CAFE", code: 0, shield: "shielded" });
    receipt.body = { tx_response: { code: 5, height: "100" } };
    const onConfirmed = vi.fn();
    await confirmWithdraw({ onConfirmed });
    expect(await screen.findByRole("alert")).toHaveTextContent(/code 5/);
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("confirms once the receipt is included with code 0", async () => {
    m.signAndBroadcast.mockResolvedValue({ txHash: "CAFE", code: 0, shield: "shielded" });
    receipt.body = { tx_response: { code: 0, height: "100" } };
    const onConfirmed = vi.fn();
    await confirmWithdraw({ onConfirmed });
    expect(await screen.findByText(/Sent with QoreX and confirmed/)).toBeInTheDocument();
    expect(onConfirmed).toHaveBeenCalled();
  });

  it("says unconfirmed when the receipt never shows up", async () => {
    m.signAndBroadcast.mockResolvedValue({ txHash: "CAFE", code: 0, shield: "shielded" });
    const onConfirmed = vi.fn();
    await confirmWithdraw({ onConfirmed });
    expect(await screen.findByRole("status")).toHaveTextContent(/hasn't confirmed it yet/);
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("is hidden unless the build sets VITE_QOREX_NATIVE=1", () => {
    vi.stubEnv("VITE_QOREX_NATIVE", "");
    const { container } = renderSend(<NativeSend call={{ functionName: "withdraw", args: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says QoreX can't sign the message type yet when QoreX refuses it", async () => {
    m.signAndBroadcast.mockRejectedValue(new Error("QoreX cannot show what /qorechain.crossvm.v1.MsgCrossVMCall does, so it will not sign it."));
    renderSend(<NativeSend call={{ functionName: "withdraw", args: [] }} />);
    await userEvent.click(screen.getByRole("button", { name: "Send with QoreX" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm in QoreX" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("QoreX can't sign this transaction type yet. Use MetaMask instead.");
  });

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
