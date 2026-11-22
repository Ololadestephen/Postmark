import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { QOREX_DOWNLOAD_URLS } from "@qorechain/qorex-types";
import { renderApp } from "../fixtures";
import Start from "../../src/pages/Start";

describe("Get started page", () => {
  it("has Fund, Claim and Verify tabs with numbered steps", () => {
    renderApp(<Start />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Fund", "Claim", "Verify"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Fund" }).querySelectorAll("li")).toHaveLength(9);
    expect(screen.getAllByText(/Add an Ethereum account \(coin 60\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Switch to testnet \(diana\)/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Verify" }));
    expect(screen.getByRole("tab", { name: "Verify" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Verify" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Become a verifier" }))
      .toHaveAttribute("href", "/verifiers/join");
  });

  it("links the QoreX downloads and the faucet, and is honest about the same-account requirement", () => {
    renderApp(<Start />);
    expect(screen.getAllByRole("link", { name: "QoreX for Chrome" })[0]).toHaveAttribute("href", QOREX_DOWNLOAD_URLS.chrome);
    expect(screen.getByRole("link", { name: "Open the faucet" })).toHaveAttribute("href", expect.stringContaining("qorechain.io"));
    expect(screen.getByText(/must hold the same account as QoreX/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Create" })).toHaveAttribute("href", "/create");
  });

  it("the Connect button opens the header wallet picker", () => {
    renderApp(<><button aria-haspopup="dialog" onClick={() => { (window as unknown as { hit: boolean }).hit = true; }}>Connect wallet</button><Start /></>);
    const [, startConnect] = screen.getAllByRole("button", { name: "Connect wallet" });
    fireEvent.click(startConnect!);
    expect((window as unknown as { hit?: boolean }).hit).toBe(true);
    vi.restoreAllMocks();
  });
});
