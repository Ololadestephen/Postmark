import { describe, it, expect, vi, afterEach } from "vitest";
import { getAllComments, findClaimComments, findProofComments } from "../../src/github/client";

const ESCROW = "0xae80681e92b63efea78cb742dd612ecc940b896a";
const CLAIMANT = "0x478f2a08a81be7cea42bd34bd6900593fa56c4b6";
const line = (bounty = 7) =>
  `postmark-claim v1 chain=9800 escrow=${ESCROW} bounty=${bounty} claimant=${CLAIMANT}`;

const comment = (id: number, login: string, body: string) =>
  ({ id, user: { login }, body, html_url: `https://x/${id}`, created_at: "2026-01-01T00:00:00Z" });

const pages = (p1: unknown[], p2: unknown[]) => vi.fn(async (url: string) => {
  const body = url.includes("page=2") ? p2 : p1;
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "content-type": "application/json" },
  });
}) as unknown as typeof fetch;

describe("comment scan pagination", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches page 2 when page 1 is full; ignores wrong-login lines", async () => {
    const repo = "pag-test/repo";
    const p1 = Array.from({ length: 100 }, (_, i) =>
      comment(i + 1, "someone-else", line())); // right line, wrong login
    const p2 = [comment(555, "e2e-claimant", `done\n${line()}`)];
    vi.stubGlobal("fetch", pages(p1, p2));

    const all = await getAllComments(repo, 1);
    expect(all).toHaveLength(101);
    expect(fetch).toHaveBeenCalledTimes(2);

    const hits = findClaimComments(all)
      .filter((c) => c.githubLogin === "e2e-claimant" && c.bountyId === 7);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.commentId).toBe(555);
  });

  it("stops after a short page", async () => {
    const repo = "short-test/repo";
    vi.stubGlobal("fetch", pages([comment(1, "e2e-claimant", line())], []));
    const all = await getAllComments(repo, 2);
    expect(all).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("claim brief and proof lines", () => {
  it("captures an optional brief hash on the claim line", () => {
    const brief = `0x${"ab".repeat(32)}`;
    const withBrief = findClaimComments([comment(9, "claimer", `${line()} brief=${brief.toUpperCase()}`)]);
    expect(withBrief).toHaveLength(1);
    expect(withBrief[0]!.brief).toBe(brief);
    const without = findClaimComments([comment(9, "claimer", line())]);
    expect(without[0]!.brief).toBeUndefined();
  });

  it("finds proof lines and lowercases login and hash", () => {
    const tx = `0x${"cd".repeat(32)}`;
    const hits = findProofComments([
      comment(1, "Claimer", `done\npostmark-proof v1 tx=${tx.toUpperCase()}`),
      comment(2, "other", "no proof"),
      comment(3, "claimer", `postmark-proof v1 tx=${`0x${"ef".repeat(32)}`} and postmark-proof v1 tx=${tx}`),
    ]);
    expect(hits.map((h) => h.txHash)).toEqual([tx, `0x${"ef".repeat(32)}`, tx]);
    expect(hits[0]).toMatchObject({ commentId: 1, githubLogin: "claimer" });
  });
});
