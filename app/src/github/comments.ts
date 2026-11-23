// Pure GitHub comment/timeline parsing, shared by the app and the verifier bot (no browser APIs).

export interface GhComment {
  id: number; user: { login: string }; body: string; created_at: string;
  updated_at?: string;
}
export interface GhTimelineEvent {
  event: string; source?: { issue?: { number: number; pull_request?: { html_url?: string } } };
  commit_id?: string | null;
}

/** PR numbers that cross-reference an issue in its timeline events. */
export function linkedPrNumbers(events: GhTimelineEvent[]): number[] {
  const prs = new Set<number>();
  for (const e of events) {
    if (e.event === "cross-referenced" && e.source?.issue?.pull_request) {
      const url = e.source.issue.pull_request.html_url ?? "";
      const m = url.match(/\/pull\/(\d+)/);
      if (m) prs.add(Number(m[1]));
    }
  }
  return [...prs];
}

const CLAIM_RE =
  /postmark-claim\s+v1\s+chain=(\d+)\s+escrow=(0x[0-9a-f]{40})\s+bounty=(\d+)\s+claimant=(0x[0-9a-f]{40})(?:\s+brief=(0x[0-9a-f]{64}))?/i;

export interface ClaimComment {
  commentId: number; githubLogin: string;
  chainId: number; escrow: string; bountyId: number; claimant: string;
  /** brief hash for on-chain task bounties; absent on ordinary claim lines */
  brief?: string;
}

const DISPUTE_RE =
  /postmark-dispute\s+v1\s+chain=(\d+)\s+escrow=(0x[0-9a-f]{40})\s+bounty=(\d+)/i;

export interface DisputeComment {
  commentId: number; githubLogin: string;
  chainId: number; escrow: string; bountyId: number;
}

/** Comments matching the SPEC dispute line. */
export function findDisputeComments(comments: GhComment[]): DisputeComment[] {
  const out: DisputeComment[] = [];
  for (const c of comments) {
    const m = c.body?.match(DISPUTE_RE);
    if (m) {
      out.push({
        commentId: c.id, githubLogin: c.user.login.toLowerCase(),
        chainId: Number(m[1]), escrow: m[2]!.toLowerCase(), bountyId: Number(m[3]),
      });
    }
  }
  return out;
}

/** Comments matching the SPEC identity line. */
export function findClaimComments(comments: GhComment[]): ClaimComment[] {
  const out: ClaimComment[] = [];
  for (const c of comments) {
    const m = c.body?.match(CLAIM_RE);
    if (m) {
      out.push({
        commentId: c.id, githubLogin: c.user.login.toLowerCase(),
        chainId: Number(m[1]), escrow: m[2]!.toLowerCase(),
        bountyId: Number(m[3]), claimant: m[4]!.toLowerCase(),
        ...(m[5] ? { brief: m[5].toLowerCase() } : {}),
      });
    }
  }
  return out;
}

const PROOF_RE = /postmark-proof\s+v1\s+tx=(0x[0-9a-f]{64})/gi;

export interface ProofComment {
  commentId: number; githubLogin: string; txHash: string;
}

/** Comments matching the SPEC on-chain proof line (every occurrence in a body counts). */
export function findProofComments(comments: GhComment[]): ProofComment[] {
  const out: ProofComment[] = [];
  for (const c of comments) {
    for (const m of c.body?.matchAll(PROOF_RE) ?? []) {
      out.push({ commentId: c.id, githubLogin: c.user.login.toLowerCase(), txHash: m[1]!.toLowerCase() });
    }
  }
  return out;
}

const SUBMISSION_RE = /^[^\n]*postmark-submission\s+v1\s+url=(https:\/\/\S+?)\s*$/im;

export interface SubmissionComment {
  commentId: number; githubLogin: string; url: string;
  /** comment creation time in seconds */
  createdAt: bigint;
  /** updated_at after created_at — the comment text may have changed since posting */
  edited: boolean;
}

/** Comments carrying the SPEC submission line (the first match in a body counts;
 * a report may follow the line in the same body for testing tasks). */
export function findSubmissionComments(comments: GhComment[]): SubmissionComment[] {
  const out: SubmissionComment[] = [];
  for (const c of comments) {
    const m = c.body?.match(SUBMISSION_RE);
    if (!m) continue;
    out.push({
      commentId: c.id, githubLogin: c.user.login.toLowerCase(), url: m[1]!,
      createdAt: BigInt(Math.floor(Date.parse(c.created_at) / 1000)),
      edited: !!c.updated_at && Date.parse(c.updated_at) > Date.parse(c.created_at),
    });
  }
  return out;
}
