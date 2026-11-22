import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { requestWallet, resetWalletIntent } from "../../src/components/walletIntent";
import { renderApp } from "../fixtures";

vi.mock("../../src/chain/IndexerProvider", async () => (await import("../mocks")).indexerModule("live"));
vi.mock("../../src/wallet/ConnectWallet", () => ({ default: () => <button>Connect wallet</button> }));
vi.mock("../../src/wallet/MeInner", () => ({ default: () => <p>me inner</p> }));
vi.mock("../../src/wallet/WalletRoot", async () => (await import("../mocks")).walletRootModule);
vi.mock("../../src/wallet/CreateInner", () => ({ default: () => <p>create inner</p> }));
vi.mock("../../src/pages/Explore", () => ({ default: () => <p>explore page</p> }));

import App from "../../src/App";
import Landing from "../../src/pages/Landing";
import Me from "../../src/pages/Me";
import Create from "../../src/pages/Create";
import { ESCROW_ADDRESS } from "../../src/chain/config";

vi.mock("motion/react", async (orig) => ({ ...(await orig<typeof import("motion/react")>()), useReducedMotion: () => true }));

describe("Landing", () => {
  it("states the pitch and links to the app", () => {
    renderApp(<Landing />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Bounties that pay when the work is verified.");
    expect(screen.getAllByRole("link", { name: "Fund a bounty" })[0]).toHaveAttribute("href", "/create");
    expect(screen.getByRole("link", { name: "Browse bounties" })).toHaveAttribute("href", "/explore");
  });

  it("labels the product view as an example and never claims real money", () => {
    renderApp(<Landing />);
    expect(screen.getByText(/Example · bounty detail/)).toBeInTheDocument();
    expect(screen.getAllByText(/no monetary value/i).length).toBeGreaterThan(0);
  });

  it("proves the claims with the production contract address and the FAQ", () => {
    renderApp(<Landing />);
    expect(screen.getByRole("link", { name: ESCROW_ADDRESS })).toBeInTheDocument();
    expect(screen.getByText("Is this real money?")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "P" && /126 Foundry tests/.test(el.textContent ?? ""))).toBeInTheDocument();
  });
});

describe("pages", () => {
  it("Me shows the not-connected Dashboard without the wallet chunk until a wallet is wanted", async () => {
    resetWalletIntent();
    render(<MemoryRouter><Me /></MemoryRouter>);
    expect(screen.getByText(/Connect an EVM wallet to see your funded bounties/)).toBeInTheDocument();
    expect(screen.queryByText("me inner")).toBeNull();
    act(() => requestWallet());
    expect(await screen.findByText("me inner")).toBeInTheDocument();
  });

  it("Create loads the form lazily", async () => {
    render(<MemoryRouter><Create /></MemoryRouter>);
    expect(await screen.findByText("create inner")).toBeInTheDocument();
  });
});

describe("App routing", () => {
  const at = (path: string) => render(
    <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

  it("renders the landing page at /", () => {
    at("/");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Bounties that pay/);
  });

  it("lazy-loads Explore", async () => {
    at("/explore");
    expect(await screen.findByText("explore page")).toBeInTheDocument();
  });

  it("falls back to the not-found page", () => {
    at("/no/such/page");
    expect(screen.getByRole("heading", { name: /never arrived/i })).toBeInTheDocument();
  });
});
