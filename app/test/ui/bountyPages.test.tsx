import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { CLAIMANT, FUNDER, META, makeBounty, renderApp } from "../fixtures";

const route = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const github = vi.hoisted(() => ({ item: {} as Record<string, unknown> }));

vi.mock("../../src/hooks/useBountyRoute", () => ({ useBountyRoute: () => route.current }));
vi.mock("../../src/hooks/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/hooks/queries")>()),
  usePqcStatus: () => ({ data: { live: true }, isPending: false, error: null }),
  useGithubItem: () => github.item,
}));
vi.mock("../../src/github/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/github/client")>()),
  getLinkedPrs: vi.fn().mockResolvedValue([2]),
  getPull: vi.fn().mockResolvedValue({
    number: 2, html_url: "https://github.com/postmark-e2e/sandbox/pull/2",
    merged: true, merged_at: "2026-11-18T10:00:00Z", user: { login: "e2e-claimant" } }),
}));
vi.mock("../../src/wallet/TxActions", () => ({ default: () => <p>tx actions</p> }));
vi.mock("../../src/wallet/ClaimPanel", () => ({ default: () => <p>claim panel</p> }));
vi.mock("../../src/wallet/ClaimedNote", () => ({ default: () => <p>claimed note</p> }));
vi.mock("../../src/wallet/FunderShare", () => ({ default: () => <p>funder share</p> }));
vi.mock("../../src/wallet/DisputePanel", () => ({ default: () => <p>dispute panel</p> }));
vi.mock("../../src/wallet/VerifierReviewLink", () => ({ default: () => <p>verifier review link</p> }));
vi.mock("../../src/wallet/PendingActions", () => ({ default: () => <p>pending actions</p> }));
vi.mock("../../src/wallet/ReviewPanel", () => ({ default: () => <p>review panel</p> }));

import BountyDetail from "../../src/pages/BountyDetail";
import { requestWallet, resetWalletIntent } from "../../src/components/walletIntent";
import Review from "../../src/pages/Review";
import { BountyFacts } from "../../src/pages/bounty/BountyFacts";
import { GithubCard } from "../../src/pages/bounty/GithubCard";
import { Ruling, eventsFor } from "../../src/pages/bounty/Ruling";
import { Timeline } from "../../src/pages/bounty/Timeline";
import { DisputedBanner, PendingVerdict } from "../../src/pages/bounty/VerdictBanners";
import type { EscrowLog } from "../../src/chain/indexer";

const query = (data: unknown, extra: Record<string, unknown> = {}) =>
  ({ data, isPending: false, error: null, refetch: vi.fn(), ...extra });

function setRoute(bounty: ReturnType<typeof makeBounty> | undefined, extra: Record<string, unknown> = {}) {
  route.current = {
    id: 7n, bounty: query(bounty), index: query({ events: [], metaById: new Map() }),
    meta: META, notFound: false, loading: false, ...extra,
  };
}

const event = (eventName: string, args: Record<string, unknown>, block = 100n): EscrowLog =>
  ({ eventName, args, blockNumber: block, transactionHash: `0x${"cd".repeat(32)}`, logIndex: 0 }) as unknown as EscrowLog;

beforeEach(() => {
  resetWalletIntent();
  github.item = { data: undefined, error: null, isPending: true };
});

describe("BountyDetail by state", () => {
  it("rejects a malformed id", () => {
    route.current = { id: undefined };
    renderApp(<BountyDetail />);
    expect(screen.getByText("Bad bounty id.")).toBeInTheDocument();
  });

  it("says when the bounty does not exist", () => {
    route.current = { id: 99n, bounty: query(undefined), index: query(undefined), notFound: true, loading: false };
    renderApp(<BountyDetail />);
    expect(screen.getByText("Bounty #99 doesn't exist.")).toBeInTheDocument();
  });

  it("shows an error with retry when the chain read fails", () => {
    route.current = { id: 7n, bounty: query(undefined, { error: new Error("rpc down") }),
      index: query(undefined), notFound: false, loading: false };
    renderApp(<BountyDetail />);
    expect(screen.getByRole("alert")).toHaveTextContent("rpc down");
  });

  it("loads no wallet panels until the visitor asks for a wallet", async () => {
    resetWalletIntent();
    setRoute(makeBounty({ state: 0 }));
    renderApp(<BountyDetail />);
    expect(screen.getByRole("button", { name: "Connect wallet to claim" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").some((li) => li.textContent?.includes("Post your claim line"))).toBe(true);
    expect(screen.queryByText("claim panel")).toBeNull();
    expect(screen.queryByText("tx actions")).toBeNull();
    act(() => requestWallet());
    expect(await screen.findByText("claim panel")).toBeInTheDocument();
  });

  it("renders the claim card right after the Timeline with all three steps visible", async () => {
    resetWalletIntent();
    setRoute(makeBounty({ state: 0 }));
    renderApp(<BountyDetail />);
    const card = screen.getByTestId("claim-card");
    const timeline = screen.getByRole("heading", { name: /timeline/i }).closest("div")!.parentElement!;
    expect(timeline.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.previousElementSibling?.contains(screen.getByRole("heading", { name: /timeline/i }))
      || card.previousElementSibling?.textContent?.toLowerCase().includes("timeline")).toBe(true);
    for (const t of ["Post your claim line", "Find my comment", "Sign with QoreX and claim"]) {
      expect(card).toHaveTextContent(t);
    }
  });

  it("Open: offers the claim panel, no review link", async () => {
    requestWallet();
    setRoute(makeBounty({ state: 0 }));
    renderApp(<BountyDetail />);
    expect(screen.getByRole("heading", { name: /Bounty #7/ })).toBeInTheDocument();
    expect(await screen.findByText("claim panel")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /review tool/ })).toBeNull();
    expect(screen.getAllByText("Open").length).toBeGreaterThan(0);
  });

  it("Claimed: shows the note and the review link", async () => {
    requestWallet();
    setRoute(makeBounty({ state: 1, payee: CLAIMANT, claimRound: 1n, claimExpiresAt: 4_000_000_000n }));
    renderApp(<BountyDetail />);
    expect(await screen.findByText("claimed note")).toBeInTheDocument();
    expect(await screen.findByText("verifier review link")).toBeInTheDocument();
  });

  it("Claimed: nobody sees the review link until a wallet is wanted", () => {
    setRoute(makeBounty({ state: 1, payee: CLAIMANT, claimRound: 1n, claimExpiresAt: 4_000_000_000n }));
    renderApp(<BountyDetail />);
    expect(screen.queryByText("verifier review link")).toBeNull();
    expect(screen.queryByRole("link", { name: /review tool/ })).toBeNull();
  });

  it("Pending with a wallet: the role-aware actions replace the plain dispute panel", async () => {
    requestWallet();
    setRoute(makeBounty({ state: 2, payee: CLAIMANT, challengeEndsAt: 4_000_000_000n }));
    renderApp(<BountyDetail />);
    expect(await screen.findByText("pending actions")).toBeInTheDocument();
    expect(screen.queryByText("dispute panel")).toBeNull();
  });

  it("Pending: shows the frozen verdict and the dispute panel", async () => {
    setRoute(makeBounty({ state: 2, payee: CLAIMANT, challengeEndsAt: 4_000_000_000n }));
    renderApp(<BountyDetail />);
    expect(screen.getByText("verdict pending")).toBeInTheDocument();
    expect(await screen.findByText("dispute panel")).toBeInTheDocument();
  });

  it("Disputed: shows the frozen-payout banner and the verifier link once a wallet is wanted", async () => {
    requestWallet();
    setRoute(makeBounty({ state: 3, payee: CLAIMANT, disputer: FUNDER }));
    renderApp(<BountyDetail />);
    expect(screen.getByText("payout frozen — disputed")).toBeInTheDocument();
    expect(await screen.findByText("verifier review link")).toBeInTheDocument();
  });

  it("Paid: shows the ruling with its credits and the timeline", () => {
    const events = [
      event("Credited", { bountyId: 7n, account: CLAIMANT, amount: 5n, payeeGated: true }),
      event("Settled", { bountyId: 7n }),
    ];
    setRoute(makeBounty({ state: 4, payee: CLAIMANT }), { index: query({ events, metaById: new Map() }) });
    renderApp(<BountyDetail />);
    expect(screen.getByText("ruling")).toBeInTheDocument();
    expect(screen.getByText(/unchallenged verdict finalized/)).toBeInTheDocument();
    expect(screen.getByText("Credit posted")).toBeInTheDocument();
  });

  it("warns when the emitted work does not match the on-chain hash", () => {
    setRoute(makeBounty(), { meta: { ...META, workHashMismatch: true } });
    renderApp(<BountyDetail />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Do not trust this bounty/);
  });
});

describe("Review page", () => {
  it("shows the review header with the work item", async () => {
    setRoute(makeBounty({ state: 1, payee: CLAIMANT }));
    renderApp(<Review />);
    expect(screen.getByRole("heading", { name: /Review #7/ })).toBeInTheDocument();
    expect(screen.getByText("postmark-e2e/sandbox#1")).toBeInTheDocument();
    expect(await screen.findByText("review panel")).toBeInTheDocument();
  });

  it("handles a bad id and a missing bounty", () => {
    route.current = { id: undefined };
    const { unmount } = renderApp(<Review />);
    expect(screen.getByText("Bad bounty id.")).toBeInTheDocument();
    unmount();
    route.current = { id: 9n, bounty: query(undefined), notFound: true, loading: false, meta: undefined };
    renderApp(<Review />);
    expect(screen.getByText("Bounty #9 doesn't exist.")).toBeInTheDocument();
  });
});

describe("BountyFacts", () => {
  it("hides claim-only fields on an Open bounty and shows them once claimed", () => {
    const { unmount } = renderApp(<BountyFacts bounty={makeBounty()} />);
    expect(screen.queryByText("claimant / payee")).toBeNull();
    expect(screen.queryByText("disputer")).toBeNull();
    expect(screen.getByText("claim timeout").nextSibling).toHaveTextContent("24h");
    unmount();
    renderApp(<BountyFacts bounty={makeBounty({
      state: 3, payee: CLAIMANT, disputer: FUNDER, claimExpiresAt: 5n, challengeEndsAt: 6n,
      payeeIdentityHash: `0x${"11".repeat(32)}`, initialMergedAt: 1_700_000_000n,
      pendingVerdictHash: `0x${"22".repeat(32)}` })} />);
    for (const label of ["claimant / payee", "disputer", "claim expires", "challenge ends", "identity hash"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("initial verdict").nextSibling).toHaveTextContent(/PAY · merged/);
  });

  it("labels a REFUND initial verdict", () => {
    renderApp(<BountyFacts bounty={makeBounty({ initialOutcome: 1 })} />);
    expect(screen.getByText("initial verdict").nextSibling).toHaveTextContent("REFUND");
  });
});

describe("Ruling and Timeline", () => {
  it("reports an upheld dispute", () => {
    const events = [event("DisputeResolved", { bountyId: 7n, upheld: true })];
    renderApp(<Ruling state={5} events={events} />);
    expect(screen.getByText(/Refunded/)).toBeInTheDocument();
    expect(screen.getByText("upheld")).toBeInTheDocument();
  });

  it("reports a rejected dispute", () => {
    renderApp(<Ruling state={4} events={[event("DisputeResolved", { bountyId: 7n, upheld: false })]} />);
    expect(screen.getByText("rejected")).toBeInTheDocument();
  });

  it("filters events to one bounty", () => {
    const events = [event("Claimed", { bountyId: 1n }), event("Claimed", { bountyId: 2n })];
    expect(eventsFor(events, 2n)).toHaveLength(1);
    expect(eventsFor(undefined, 2n)).toEqual([]);
  });

  it("lists timeline events with explorer links", () => {
    renderApp(<Timeline events={[event("BountyCreated", { bountyId: 7n }, 55n), event("Mystery", { bountyId: 7n })]} />);
    expect(screen.getByText("Bounty created and funded")).toBeInTheDocument();
    expect(screen.getByText("Mystery")).toBeInTheDocument();
    expect(screen.getByText("block 55")).toBeInTheDocument();
    expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", expect.stringContaining("/tx/0xcdcd"));
  });
});

describe("verdict banners", () => {
  it("PendingVerdict names the outcome and payee", () => {
    renderApp(<PendingVerdict id={7n} meta={META}
      bounty={makeBounty({ state: 2, payee: CLAIMANT, challengeEndsAt: 4_000_000_000n })} />);
    expect(screen.getByText("PAY")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "0x478F…c4B6" })).toBeInTheDocument();
  });

  it("DisputedBanner names the disputer and the verdict they challenged", () => {
    renderApp(<DisputedBanner bounty={makeBounty({ state: 3, initialOutcome: 1, disputer: FUNDER })} />);
    expect(screen.getByRole("link", { name: "0x4Fe9…73bD" })).toBeInTheDocument();
    expect(screen.getByText(/against the\s+REFUND verdict/)).toBeInTheDocument();
  });
});

describe("GithubCard", () => {
  const item = { ownerRepo: META.ownerRepo, kind: 0, number: 1n };

  it("shows a skeleton while loading", () => {
    const { container } = renderApp(<GithubCard {...item} />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("falls back to a link when GitHub fails", () => {
    github.item = { data: undefined, error: new Error("403"), isPending: false };
    renderApp(<GithubCard {...item} />);
    expect(screen.getByText(/GitHub unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open on GitHub" }))
      .toHaveAttribute("href", "https://github.com/postmark-e2e/sandbox/issues/1");
  });

  it("renders the issue and its linked pull request", async () => {
    github.item = {
      data: { title: "Wire the funder flow", state: "open", html_url: "https://github.com/x/y/issues/1",
        user: { login: "octocat" }, labels: [{ name: "bounty" }] },
      error: null, isPending: false };
    renderApp(<GithubCard {...item} />);
    expect(screen.getByRole("link", { name: "Wire the funder flow" })).toBeInTheDocument();
    expect(screen.getByText("bounty")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/linked PR/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "#2" })).toBeInTheDocument();
  });

  it("shows merge status for a pull request", () => {
    github.item = {
      data: { title: "Fix", state: "closed", html_url: "https://github.com/x/y/pull/3", merged: true,
        merged_at: "2026-11-18T10:00:00Z", merge_commit_sha: "f".repeat(40), user: { login: "dev" } },
      error: null, isPending: false };
    renderApp(<GithubCard {...item} kind={1} number={3n} />);
    expect(screen.getByText(/merged/)).toBeInTheDocument();
    expect(screen.getByText(/ffffffffff/)).toBeInTheDocument();
  });
});

