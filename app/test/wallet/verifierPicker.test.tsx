import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);
import { VERIFIERS, becomeVerifierUrl, BECOME_VERIFIER_URL } from "../../src/data/verifiers";
import { CLAIMANT } from "../fixtures";

const m = vi.hoisted(() => ({
  live: {} as Record<string, boolean | undefined>, toast: vi.fn(),
  listed: { data: [] as { address: string; login: string; commentId: number }[], isError: false, isPending: false },
}));
vi.mock("../../src/hooks/queries", () => ({
  useSelfListed: () => m.listed,
  usePqcStatus: (a: string) => ({ data: m.live[a] === undefined ? undefined : { live: m.live[a] } }),
}));
vi.mock("../../src/components/Toasts", () => ({ useToast: () => m.toast }));

import {
  VerifierPicker, toggleVerifier, pickForMe, inviteMessage, MAX_VERIFIERS,
} from "../../src/wallet/VerifierPicker";

const [A, B, C] = VERIFIERS.map((v) => v.address);

function Harness({ connected = CLAIMANT as string | undefined }) {
  const [slots, setSlots] = useState(["", "", ""]);
  return (
    <>
      <VerifierPicker slots={slots} onChange={setSlots} connected={connected} />
      <output data-testid="slots">{slots.join(",")}</output>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.live = { [A!]: true, [B!]: true, [C!]: true };
  m.listed = { data: [], isError: false, isPending: false };
});

describe("verifier list", () => {
  it("lists the Postmark bot and the human tie-breaker, with who runs them", () => {
    expect(VERIFIERS.map((v) => [v.name, v.kind])).toEqual([
      ["Postmark verifier bot", "bot"], ["Postmark public verifier bot", "bot"], ["Ololade (human tie-breaker)", "human"]]);
    expect(VERIFIERS[0]!.address).toBe("0xA46B8DC7593eDEe0f31b6F7fD1362e855Ad50693");
    expect(VERIFIERS[1]!.address).toBe("0x4EaBC36D47dE61ECF41DBcFCeFffa8dDA9b5b023");
    expect(VERIFIERS[2]!.address.toLowerCase()).toBe("0x25174bd3a98cd833acaf288d94f4cc324227e99d");
    expect(VERIFIERS.every((v) => v.runner.includes("@Ololadestephen"))).toBe(true);
  });
  it("prefills the address field of the issue form", () => {
    expect(becomeVerifierUrl()).toBe(BECOME_VERIFIER_URL);
    expect(becomeVerifierUrl("0xabc")).toBe(`${BECOME_VERIFIER_URL}&address=0xabc`);
    expect(BECOME_VERIFIER_URL).toContain("template=become-a-verifier.yml");
  });
});

describe("picker helpers", () => {
  it("toggles into the first empty slot and out again", () => {
    expect(toggleVerifier(["", "", ""], "0xA")).toEqual(["0xA", "", ""]);
    expect(toggleVerifier(["0xA", "", ""], "0xB")).toEqual(["0xA", "0xB", ""]);
    expect(toggleVerifier(["0xA", "0xB", ""], "0xa")).toEqual(["", "0xB", ""]);
  });
  it("never adds a fourth", () => {
    const full = ["0xA", "0xB", "0xC"];
    expect(toggleVerifier(full, "0xD")).toBe(full);
    expect(MAX_VERIFIERS).toBe(3);
  });
  it("picks live verifiers and excludes the connected account", () => {
    const c = [{ address: "0x1", live: true }, { address: "0x2", live: false }, { address: "0x3", live: undefined },
      { address: "0x4", live: true }, { address: "0x5", live: true }, { address: "0x6", live: true }];
    expect(pickForMe(c, "0x4")).toEqual(["0x1", "0x5", "0x6"]);
    expect(pickForMe(c.slice(0, 3), undefined)).toEqual(["0x1"]);
  });
  it("explains how to become a verifier in the invite", () => {
    const text = inviteMessage("https://example.test/form");
    expect(text).toMatch(/QoreX/);
    expect(text).toMatch(/one send/);
    expect(text).toContain("https://example.test/form");
  });
});

describe("self-listed verifiers", () => {
  const SELF = "0x1111111111111111111111111111111111111111";
  it("shows self-listed entries as a separate, not-vetted section and lets them be picked", () => {
    m.listed.data = [{ address: SELF, login: "octocat", commentId: 1 }];
    m.live[SELF] = true;
    render(<Harness />);
    expect(screen.getByText("Self-listed verifiers (not vetted)")).toBeInTheDocument();
    expect(screen.getByText("Self-listed · not vetted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "github.com/octocat" })).toHaveAttribute("href", "https://github.com/octocat");
    fireEvent.click(screen.getByRole("button", { name: "@octocat" }));
    expect(screen.getByTestId("slots")).toHaveTextContent(SELF);
  });
  it("Pick 3 for me ignores self-listed entries", () => {
    m.listed.data = [{ address: SELF, login: "octocat", commentId: 1 }];
    m.live[SELF] = true;
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Pick 3 for me" }));
    expect(screen.getByTestId("slots")).not.toHaveTextContent(SELF);
  });
  it("shows a quiet note when the list can't load", () => {
    m.listed = { data: [], isError: true, isPending: false };
    render(<Harness />);
    expect(screen.getByText("Couldn't load self-listed verifiers right now.")).toBeInTheDocument();
  });
});

describe("VerifierPicker", () => {
  it("shows Bot and Human badges with the runner line", () => {
    render(<Harness />);
    expect(screen.getAllByText("Bot")).toHaveLength(2);
    expect(screen.getByText("Human")).toBeInTheDocument();
    expect(screen.getByText(/scheduled GitHub Action in a private repo/)).toBeInTheDocument();
    expect(screen.getByText(/scheduled GitHub Action in the public Postmark repo/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "run your own verifier" })).toHaveAttribute("href", expect.stringContaining("#run-your-own-verifier"));
  });

  it("toggles cards with aria-pressed", () => {
    render(<Harness />);
    const card = (n: RegExp) => screen.getByRole("button", { name: n });
    fireEvent.click(card(/^Postmark verifier bot/));
    expect(card(/^Postmark verifier bot/)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(card(/^Postmark verifier bot/));
    expect(card(/^Postmark verifier bot/)).toHaveAttribute("aria-pressed", "false");
  });

  it("Pick 3 for me fills all three slots from the curated list with no typing", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Pick 3 for me" }));
    expect(screen.getByTestId("slots")).toHaveTextContent(`${A},${B},${C}`);
    expect(screen.queryByText(/slot left|slots left/)).toBeNull();
  });

  it("Pick 3 for me skips the connected account and prompts for the open slot", () => {
    render(<Harness connected={B} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick 3 for me" }));
    expect(screen.getByTestId("slots")).toHaveTextContent(`${A},${C},`);
    expect(screen.getByText(/1 slot left: add your repo's verifier bot or another person/)).toBeInTheDocument();
  });

  it("warns when no listed verifier is live", () => {
    m.live = { [A!]: false, [B!]: false, [C!]: false };
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Pick 3 for me" }));
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: "warning" }));
    expect(screen.getByTestId("slots")).toHaveTextContent(",,");
  });

  it("copies the invite and links the in-app sign-up page", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Ask a friend to verify" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("QoreX"));
    expect(screen.getByRole("link", { name: "Become a verifier" }))
      .toHaveAttribute("href", "/verifiers/join");
  });
});
