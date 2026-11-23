// The verifier's judgement, from claim to PAY / REFUND / abstain. Reads GitHub through an injected API
// and never guesses: any GitHub failure, ambiguity or missing evidence is an abstention.
import { zeroAddress, type Address, type Hex } from "viem";
import type { Bounty } from "../../app/src/chain/client";
import {
  findClaimComments, findDisputeComments, findProofComments, type ClaimComment, type GhComment,
} from "../../app/src/github/comments";
import { checkPull, closesIssue, mergedAtSeconds } from "../../app/src/github/prcheck";
import { githubItemUrl } from "../../app/src/github/parse";
import { briefHashOf, parseTaskBlock, type Task } from "../../app/src/github/task";
import {
  checkOnchainProof, claimedAtFor, proofCheckPassed, selectProof,
  type OnchainReader, type PassingProof,
} from "../../app/src/chain/onchainCheck";
import type { GhPull } from "../../app/src/github/client";
import {
  disputeEvidenceHashOf, identityHashOf, onchainEvidenceHashOf, payEvidenceHashOf,
  refundEvidenceHashOf, resolutionEvidenceHashOf,
} from "../../app/src/formats/hashes";
import type { GhApi } from "./github";

export const STATE = { Open: 0, Claimed: 1, Pending: 2, Disputed: 3, Paid: 4, Refunded: 5 } as const;
export const PHASE_INITIAL = 0;
export const PHASE_DISPUTE = 1;

export interface WorkMeta { ownerRepo: string; kind: number; number: number }

export interface DecideInput {
  id: bigint;
  bounty: Pick<Bounty, "state" | "payee" | "payeeIdentityHash" | "deadline" | "disputeEvidenceHash"
    | "claimExpiresAt" | "claimTimeout" | "claimRound">;
  meta: WorkMeta;
  escrow: Address;
  /** chain time, seconds */
  now: bigint;
  gh: GhApi;
  /** diana reads for on-chain task proofs; only needed for task bounties */
  reader?: OnchainReader;
  /** initialEvidenceHash of every other bounty on the escrow (proof reuse guard) */
  takenEvidence?: Hex[];
  /** Claimed events for this bounty (claim time when claimExpiresAt is cleared, e.g. Disputed) */
  claimEvents?: { claimRound: bigint; blockNumber: bigint }[];
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

  const basis = await judge(i, claim, comments);
  if (basis.kind === "abstain") return basis;
  const phase = disputed ? PHASE_DISPUTE : PHASE_INITIAL;
  const evidenceHash = disputed ? resolutionEvidenceHashOf(disputeCommentId, basis.evidenceHash) : basis.evidenceHash;
  return basis.kind === "pay"
    ? { kind: "pay", phase, payee: b.payee, mergedAt: basis.mergedAt!, evidenceHash, summary: basis.summary }
    : { kind: "refund", phase, reason: basis.reason!, detailsUrl: basis.detailsUrl!, evidenceHash, summary: basis.summary };
}

async function judge(i: DecideInput, claim: ClaimComment, comments: GhComment[]): Promise<Basis | Abstain> {
  const { meta, bounty: b, now, gh } = i;
  const login = claim.githubLogin;
  const candidates: { repo: string; number: number }[] = [];
  let issueState: { state: string; reason: string | null | undefined } | null = null;
  if (meta.kind === 1) {
    candidates.push({ repo: meta.ownerRepo, number: meta.number });
  } else {
    const issue = await gh.getIssue(meta.ownerRepo, meta.number);
    issueState = { state: issue.state, reason: issue.state_reason };
    const parsed = parseTaskBlock(issue.body ?? null);
    if (parsed && "error" in parsed) return abstain(`invalid task block: ${parsed.error}`);
    if (parsed?.task) {
      if (parsed.task.type === "testing" || parsed.task.type === "url") {
        return abstain(`human-judged task type: ${parsed.task.type}`);
      }
      return judgeOnchain(i, claim, comments, parsed.task, issueState);
    }
    // the claim bound a brief but the issue no longer carries a block
    if (claim.brief) return abstain("the task block was removed after the claim");
    // no task block: an ordinary code bounty, judged by merged pull requests
    const linked = await gh.linkedPrs(meta.ownerRepo, meta.number);
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

/** On-chain task bounties: the claimant's own proof transaction is the work. */
async function judgeOnchain(i: DecideInput, claim: ClaimComment, comments: GhComment[],
  task: Task, issueState: { state: string; reason: string | null | undefined } | null,
): Promise<Basis | Abstain> {
  const { bounty: b, now, meta } = i;
  if (!claim.brief) return abstain("the claim line has no brief hash");
  if (claim.brief !== briefHashOf(task)) return abstain("the task brief changed after the claim");
  if (!i.reader) return abstain("no chain reader configured");
  let claimedAt: bigint | null;
  try {
    claimedAt = await claimedAtFor(b, i.claimEvents ?? [], i.reader);
  } catch (e) {
    return abstain(`chain read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (claimedAt === null) return abstain("cannot tell when the claim was stamped");

  const txHashes: Hex[] = [];
  for (const p of findProofComments(comments)) {
    if (p.githubLogin === claim.githubLogin && !txHashes.includes(p.txHash as Hex)) {
      txHashes.push(p.txHash as Hex);
    }
  }

  const passing: PassingProof[] = [];
  for (const txHash of txHashes) {
    let check;
    try {
      check = await checkOnchainProof(task, { txHash },
        { claimant: b.payee, claimedAt, deadline: b.deadline, now }, i.reader);
    } catch (e) {
      return abstain(`chain read failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (proofCheckPassed(check) && check.blockTimestamp !== null) {
      passing.push({ txHash, at: check.blockTimestamp,
        evidenceHash: onchainEvidenceHashOf(task.type, txHash, check.blockTimestamp, b.payee) });
    }
  }

  if (passing.length === 0) {
    if (issueState?.state === "closed" && issueState.reason === "not_planned") {
      const detailsUrl = githubItemUrl(meta);
      return {
        kind: "refund", reason: "withdrawn", detailsUrl,
        evidenceHash: refundEvidenceHashOf("withdrawn", detailsUrl),
        summary: "issue closed as not planned",
      };
    }
    return abstain("no passing proof transaction yet");
  }
  const chosen = selectProof(passing, i.takenEvidence ?? []);
  if (!chosen) return abstain("every passing proof was already used for another bounty");
  return {
    kind: "pay", payee: b.payee, mergedAt: chosen.at, evidenceHash: chosen.evidenceHash,
    summary: `proof tx ${chosen.txHash.slice(0, 12)}… (${task.type})`,
  };
}
