import type { Page, Route } from "@playwright/test";
import { E2E_ESCROW } from "./accounts.ts";

const SANDBOX = "https://github.com/postmark-e2e/sandbox";
const PAGE_SIZE = 100;
const FIXTURE_CLAIM_COMMENT_ID = 987654321;
const DISPUTE_COMMENT_ID_BASE = 900_000_001;

type Comment = { id: number; user: { login: string }; body: string; created_at: string };

/** Synthesized comments for the demo: every bounty id gets the exact claim
 * line from e2e-claimant and the exact dispute line from e2e-disputer, with
 * stable distinct comment ids, so every scan works in stub mode. */
export function synthComments(escrow: string, claimant: string, upToId: bigint) {
  const out: Comment[] = [];
  const t0 = Math.floor(Date.now() / 1000) - 3600;
  for (let id = 1n; id <= upToId; id++) {
    const at = (t0 + Number(id)) * 1000;
    // claim lines reuse the fixture comment id the live claims were made with:
    // payeeIdentityHash commits to (login, claimant, commentId)
    out.push({ id: FIXTURE_CLAIM_COMMENT_ID, user: { login: "e2e-claimant" },
      body: `postmark-claim v1 chain=9800 escrow=${escrow.toLowerCase()} bounty=${id} claimant=${claimant.toLowerCase()}`,
      created_at: new Date(at).toISOString() });
    out.push({ id: DISPUTE_COMMENT_ID_BASE + Number(id) * 2, user: { login: "e2e-disputer" },
      body: `postmark-dispute v1 chain=9800 escrow=${escrow.toLowerCase()} bounty=${id}`,
      created_at: new Date(at + 500).toISOString() });
  }
  return out;
}

const json = (route: Route, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({ status: 200, headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body) });

/** One page of comments, with a Link header while more remain — like the real API. */
function commentsPage(route: Route, url: string, all: unknown[]) {
  const page = Math.max(1, Number(new URL(url).searchParams.get("page") ?? "1"));
  const headers: Record<string, string> = {};
  if (all.length > page * PAGE_SIZE) {
    headers.link = `<${url.replace(/page=\d+/, `page=${page + 1}`)}>; rel="next"`;
  }
  return json(route, all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), headers);
}

/** Github API fixtures for postmark-e2e/sandbox#1 (+ pull/2 + timeline).
 * `mergedAt` pins the default PR's merged_at (same PAY evidence in every
 * window). `synthesize` replaces the comments fixture with per-bounty claim +
 * dispute lines, paginated 100/page like the real API. */
export async function mockGithub(page: Page, opts: {
  comments?: unknown[]; pull?: unknown; timeline?: unknown[];
  mergedAt?: string; issueBody?: string;
  synthesize?: { claimant: string; upToId: bigint };
} = {}) {
  const issue = {
    number: 1, title: "Postmark sandbox: wire the funder flow", state: "open",
    html_url: `${SANDBOX}/issues/1`, user: { login: "octocat" }, labels: [{ name: "bounty" }], comments: 0,
    ...(opts.issueBody !== undefined ? { body: opts.issueBody } : {}),
  };
  const pull = opts.pull ?? {
    number: 2, title: "wire the funder flow", state: "closed", merged: true,
    merged_at: opts.mergedAt ?? new Date().toISOString(), merge_commit_sha: "f".repeat(40), body: "Fixes #1",
    user: { login: "e2e-claimant" }, html_url: `${SANDBOX}/pull/2`,
  };
  const comments = opts.synthesize
    ? [...synthComments(E2E_ESCROW, opts.synthesize.claimant, opts.synthesize.upToId), ...(opts.comments ?? [])]
    : (opts.comments ?? []);
  const timeline = opts.timeline ?? [{
    event: "cross-referenced",
    source: { issue: { number: 2, pull_request: { html_url: `${SANDBOX}/pull/2` } } },
  }];
  await page.route("https://api.github.com/**", (route) => {
    const u = route.request().url();
    if (u.includes("/issues/1/comments")) return commentsPage(route, u, comments);
    if (u.includes("/issues/1/timeline")) return json(route, timeline);
    if (u.includes("/pulls/2")) return json(route, pull);
    if (u.includes("/issues/1")) return json(route, issue);
    return json(route, []);
  });
}
