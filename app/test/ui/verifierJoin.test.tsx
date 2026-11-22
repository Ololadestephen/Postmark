import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { evmToQor } from "../../src/chain/bech32";

const ADDR = "0xA46B8DC7593eDEe0f31b6F7fD1362e855Ad50693";
const m = vi.hoisted(() => ({
  connectAccount: vi.fn(), sign: vi.fn(), toast: vi.fn(), live: true,
  state: { installed: true, native: {}, qorAddress: null as string | null },
}));
vi.mock("../../src/wallet/qorex", () => ({
  useQorex: () => ({ ...m.state, eip1193: null, accounts: [], evmCanSend: false, canSignArbitrary: true, connectAccount: m.connectAccount }),
}));
vi.mock("../../src/wallet/pqSigner", () => ({ signVerifierListing: m.sign }));
vi.mock("../../src/components/Toasts", () => ({ useToast: () => m.toast }));
vi.mock("../../src/hooks/queries", () => ({
  usePqcStatus: () => ({ data: { live: m.live }, isPending: false }),
  fetchSelfListed: vi.fn(),
}));
vi.mock("../../src/github/client", () => ({ getAllComments: vi.fn().mockResolvedValue([]) }));

import VerifierJoin from "../../src/pages/VerifierJoin";

const view = () => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><VerifierJoin /></MemoryRouter></QueryClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  m.live = true;
  m.state = { installed: true, native: {}, qorAddress: null };
  m.sign.mockResolvedValue(`0x${"ab".repeat(4627)}`);
});

describe("verifier sign-up page", () => {
  it("makes no QoreX call until the user clicks", () => {
    view();
    expect(m.connectAccount).not.toHaveBeenCalled();
    expect(m.sign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Connect QoreX" }));
    expect(m.connectAccount).toHaveBeenCalledTimes(1);
  });

  it("signs for the derived address and shows the comment with a registry link", async () => {
    m.state = { installed: true, native: {}, qorAddress: evmToQor(ADDR) };
    view();
    const signBtn = screen.getByRole("button", { name: "Sign with QoreX" });
    expect(signBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("GitHub username"), { target: { value: "bad name" } });
    expect(screen.getByText("That is not a valid GitHub username.")).toBeInTheDocument();
    expect(signBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("GitHub username"), { target: { value: "octocat" } });
    fireEvent.click(signBtn);
    await waitFor(() => expect(screen.getByText(/postmark-verifier v1/)).toBeInTheDocument());
    expect(m.sign).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Open the registry issue" }))
      .toHaveAttribute("href", "https://github.com/Ololadestephen/Postmark/issues/6#new_comment_field");
    expect(screen.getByText(/To leave the list, delete your comment/)).toBeInTheDocument();
  });

  it("explains how to get a live key and blocks signing when it is not live", () => {
    m.live = false;
    m.state = { installed: true, native: {}, qorAddress: evmToQor(ADDR) };
    view();
    expect(screen.getByRole("link", { name: "Open the faucet" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("GitHub username"), { target: { value: "octocat" } });
    expect(screen.getByRole("button", { name: "Sign with QoreX" })).toBeDisabled();
  });
});
