// The verifier's judgement, from claim to PAY / REFUND / abstain. Reads GitHub through an injected API
// and never guesses: any GitHub failure, ambiguity or missing evidence is an abstention.
import { zeroAddress, type Address, type Hex } from "viem";
import type { Bounty } from "../../app/src/chain/client";
import { findClaimComments, findDisputeComments, type GhComment } from "../../app/src/github/comments";
import { checkPull, closesIssue, mergedAtSeconds } from "../../app/src/github/prcheck";
import { githubItemUrl } from "../../app/src/github/parse";
import type { GhPull } from "../../app/src/github/client";
import {
  disputeEvidenceHashOf, identityHashOf, payEvidenceHashOf, refundEvidenceHashOf, resolutionEvidenceHashOf,
} from "../../app/src/formats/hashes";
import type { GhApi } from "./github";

export const STATE = { Open: 0, Claimed: 1, Pending: 2, Disputed: 3, Paid: 4, Refunded: 5 } as const;
export const PHASE_INITIAL = 0;
export const PHASE_DISPUTE = 1;

export interface WorkMeta { ownerRepo: string; kind: number; number: number }

export interface DecideInput {
  id: bigint;
  bounty: Pick<Bounty, "state" | "payee" | "payeeIdentityHash" | "deadline" | "disputeEvidenceHash">;
  meta: WorkMeta;
  escrow: Address;
  /** chain time, seconds */
  now: bigint;
  gh: GhApi;
}

export type Decision =
  | { kind: "pay"; phase: number; payee: Address; mergedAt: bigint; evidenceHash: Hex; summary: string }
  | { kind: "refund"; phase: number; reason: string; detailsUrl: string; evidenceHash: Hex; summary: string }
  | { kind: "abstain"; reason: string };

class GithubUnavailable extends Error {}

/** Wraps every GitHub call so a failure becomes an abstention. */
function guard(gh: GhApi): GhApi {
  const wrap = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
    try { return await fn(...a); }
    catch (e) { throw new GithubUnavailable(e instanceof Error ? e.message : String(e)); }
  };
  return {
    getIssue: wrap(gh.getIssue), getPull: wrap(gh.getPull), getComments: wrap(gh.getComments),
    linkedPrs: wrap(gh.linkedPrs), postComment: wrap(gh.postComment),
  };
}

type Abstain = Extract<Decision, { kind: "abstain" }>;
const abstain = (reason: string): Abstain => ({ kind: "abstain", reason });
const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function decide(input: DecideInput): Promise<Decision> {
  try { return await decideInner({ ...input, gh: guard(input.gh) }); }
  catch (e) {
    if (e instanceof GithubUnavailable) return abstain(`GitHub unavailable: ${e.message}`);
    throw e;
  }
}

interface Basis {
  kind: "pay" | "refund";
  evidenceHash: Hex; summary: string;
  payee?: Address; mergedAt?: bigint; reason?: string; detailsUrl?: string;
}

async function decideInner(i: DecideInput): Promise<Decision> {
  const { bounty: b, meta, now, gh } = i;
  const disputed = b.state === STATE.Disputed;
  if (b.state !== STATE.Claimed && !disputed) return abstain("nothing to judge in this state");
  if (!disputed && now > b.deadline) return abstain("submission closed (past the deadline)");
  if (b.payee === zeroAddress) return abstain("no claimant");

  const comments: GhComment[] = await gh.getComments(meta.ownerRepo, meta.number);
  const claim = findClaimComments(comments).find((c) =>
    c.chainId === 9800 && c.escrow === i.escrow.toLowerCase() && c.bountyId === Number(i.id)
    && c.claimant === b.payee.toLowerCase()
    && identityHashOf(c.githubLogin, b.payee, BigInt(c.commentId)) === b.payeeIdentityHash);
  if (!claim) return abstain("no claim comment matches the claimant's identity hash");

  let disputeCommentId = 0n;
  if (disputed) {
    const dc = findDisputeComments(comments).find((c) =>
      c.chainId === 9800 && c.escrow === i.escrow.toLowerCase() && c.bountyId === Number(i.id)
      && disputeEvidenceHashOf(c.githubLogin, BigInt(c.commentId)) === b.disputeEvidenceHash);
    if (!dc) return abstain("no dispute comment matches the dispute evidence hash");
    disputeCommentId = BigInt(dc.commentId);
  }

  const basis = await judge(i, claim.githubLogin);
  if (basis.kind === "abstain") return basis;
  const phase = disputed ? PHASE_DISPUTE : PHASE_INITIAL;
  const evidenceHash = disputed ? resolutionEvidenceHashOf(disputeCommentId, basis.evidenceHash) : basis.evidenceHash;
  return basis.kind === "pay"
    ? { kind: "pay", phase, payee: b.payee, mergedAt: basis.mergedAt!, evidenceHash, summary: basis.summary }
    : { kind: "refund", phase, reason: basis.reason!, detailsUrl: basis.detailsUrl!, evidenceHash, summary: basis.summary };
}

async function judge(i: DecideInput, login: string): Promise<Basis | Abstain> {
  const { meta, bounty: b, now, gh } = i;
  const candidates: { repo: string; number: number }[] = [];
  let issueState: { state: string; reason: string | null | undefined } | null = null;
  if (meta.kind === 1) {
    candidates.push({ repo: meta.ownerRepo, number: meta.number });
  } else {
    const [issue, linked] = await Promise.all([gh.getIssue(meta.ownerRepo, meta.number), gh.linkedPrs(meta.ownerRepo, meta.number)]);
    issueState = { state: issue.state, reason: issue.state_reason };
    for (const l of linked) {
      if (sameRepo(l.repo, meta.ownerRepo) && !candidates.some((c) => c.number === l.number)) candidates.push({ repo: meta.ownerRepo, number: l.number });
    }
  }

  const pulls: { pr: GhPull; n: number }[] = [];
  for (const c of candidates) pulls.push({ pr: await gh.getPull(c.repo, c.number), n: c.number });
  // a timeline cross-reference is only a mention: an issue bounty counts PRs that say Fixes/Closes/Resolves it
  if (meta.kind === 0) {
    for (let k = pulls.length - 1; k >= 0; k--) {
      if (!closesIssue(pulls[k]!.pr, meta.ownerRepo, Number(meta.number))) pulls.splice(k, 1);
    }
  }

  const qualifying = pulls.filter(({ pr }) =>
    checkPull(pr, { expectedRepo: meta.ownerRepo, prRepo: meta.ownerRepo, deadline: b.deadline, identityLogin: login,
      ...(meta.kind === 0 ? { closesIssue: { ownerRepo: meta.ownerRepo, number: Number(meta.number) } } : {}) })
      .every((item) => item.ok) && mergedAtSeconds(pr) <= now);
  if (qualifying.length > 1) return abstain("several qualifying PRs");
  if (qualifying.length === 1) {
    const { pr, n } = qualifying[0]!;
    const mergedAt = mergedAtSeconds(pr);
    return {
      kind: "pay", payee: b.payee, mergedAt,
      evidenceHash: payEvidenceHashOf(meta.ownerRepo, n, pr.merge_commit_sha ?? "", mergedAt, pr.user.login),
      summary: `PR #${n} merged by @${pr.user.login}`,
    };
  }

  const detailsUrl = githubItemUrl(meta);
  const refund = (reason: string, summary: string): Basis => ({
    kind: "refund", reason, detailsUrl, evidenceHash: refundEvidenceHashOf(reason, detailsUrl), summary,
  });
  if (meta.kind === 1) {
    const pr = pulls[0]!.pr;
    if (pr.state === "closed" && !pr.merged) return refund("not-merged", "PR closed without merging");
    if (pr.merged && pr.user.login.toLowerCase() !== login) return refund("ineligible", "PR merged by someone else");
    return abstain("no qualifying merged PR from the claimant yet");
  }
  if (issueState?.state === "closed" && issueState.reason === "not_planned") return refund("withdrawn", "issue closed as not planned");
  if (issueState?.state === "closed" && issueState.reason === "completed") {
    const merged = pulls.filter(({ pr }) => pr.merged);
    if (merged.length >= 1 && !merged.some(({ pr }) => pr.user.login.toLowerCase() === login)) {
      return refund("ineligible", "issue completed by a PR from someone else");
    }
  }
  return abstain("no merged PR from the claimant yet");
}
