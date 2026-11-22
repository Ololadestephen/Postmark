import { zeroAddress, type Address } from "viem";
import type { GhApi, BotIssue, LinkedPr } from "../src/github";
import type { GhPull } from "../../app/src/github/client";
import type { GhComment } from "../../app/src/github/comments";
import { identityHashOf, disputeEvidenceHashOf } from "../../app/src/formats/hashes";

export const ESCROW = "0x13De819fE37133d19287aAFE1991a921F84b9F45" as Address;
export const PAYEE = "0x478F2A08a81be7CEa42bd34BD6900593fA56c4B6" as Address;
export const REPO = "acme/widgets";
export const DEADLINE = 2_000_000_000n;
export const NOW = 1_900_000_000n;
export const SHA = "a".repeat(40);
export const MERGED_AT = "2030-01-01T00:00:00Z";
export const COMMENT_ID = 555;

export const claimBody = (id = 7, claimant: string = PAYEE, chain = 9800, escrow: string = ESCROW) =>
  `postmark-claim v1 chain=${chain} escrow=${escrow.toLowerCase()} bounty=${id} claimant=${claimant.toLowerCase()}`;
export const comment = (id: number, login: string, body: string): GhComment =>
  ({ id, user: { login }, body, created_at: "2026-01-01T00:00:00Z" });

export const pull = (over: Partial<GhPull> = {}): GhPull => ({
  number: 1, title: "fix", state: "closed", merged: true, merged_at: "2030-01-01T00:00:00Z".replace("2030", "2030"),
  merge_commit_sha: SHA, body: "Fixes #7", user: { login: "contributor" }, html_url: `https://github.com/${REPO}/pull/1`, ...over,
});
const sec = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000));

/** merged_at that is before DEADLINE and NOW for the default fixtures */
export const GOOD_MERGED_AT = new Date(Number(NOW - 1000n) * 1000).toISOString();
export const goodPull = (over: Partial<GhPull> = {}) => pull({ merged_at: GOOD_MERGED_AT, ...over });
export { sec };

export const bountyFor = (over: Record<string, unknown> = {}) => ({
  state: 1, payee: PAYEE, deadline: DEADLINE,
  payeeIdentityHash: identityHashOf("contributor", PAYEE, BigInt(COMMENT_ID)),
  disputeEvidenceHash: `0x${"0".repeat(64)}` as `0x${string}`, ...over,
});

export interface FakeGh {
  issue?: Partial<BotIssue>; pulls?: Record<string, GhPull>; linked?: LinkedPr[];
  comments?: GhComment[]; fail?: boolean;
}
export function fakeGh(f: FakeGh = {}): GhApi {
  const boom = () => { if (f.fail) throw new Error("rate limited"); };
  return {
    async getIssue(_r, n) { boom(); return { number: n, state: "open", html_url: "", user: { login: "x" }, ...f.issue }; },
    async getPull(r, n) { boom(); const p = f.pulls?.[`${r}#${n}`]; if (!p) throw new Error("404"); return p; },
    async getComments() { boom(); return f.comments ?? [comment(COMMENT_ID, "contributor", claimBody())]; },
    async linkedPrs() { boom(); return f.linked ?? []; },
    async postComment() { boom(); },
  };
}
export const disputeComment = (id: number, login: string, bounty = 7) =>
  comment(id, login, `postmark-dispute v1 chain=9800 escrow=${ESCROW.toLowerCase()} bounty=${bounty}`);
export { zeroAddress, disputeEvidenceHashOf };
