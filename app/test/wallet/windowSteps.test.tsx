import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WindowSteps } from "../../src/wallet/WindowSteps";
import { qorexFailureToast } from "../../src/chain/errors";

describe("WindowSteps", () => {
  it("lists the QoreX steps and refetches the window on check again", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    render(<QueryClientProvider client={qc}><WindowSteps qorAddress="qor1abc" capQor="2" sendsValue /></QueryClientProvider>);
    expect(screen.getByText("qor1abc")).toBeInTheDocument();
    expect(screen.getByText(/MetaMask on QoreChain/)).toBeInTheDocument();
    expect(screen.getByText(/Settings, Security, EVM access window/)).toBeInTheDocument();
    expect(screen.getByText(/to 1000 \(about 20 minutes\)/)).toBeInTheDocument();
    expect(screen.getByText(/must cover the amount you send plus fees/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I opened it — check again" }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["evmWindow"] });
  });
  it("maps QoreX's refusal to open a window to a warning", () => {
    const t = qorexFailureToast(new Error("QoreX: /qorechain.pqc.v1.MsgOpenEVMWindow is managed by the wallet itself, not by a website"), { title: "x" });
    expect(t).toMatchObject({ kind: "warning", title: "Open the window in QoreX" });
  });
});
