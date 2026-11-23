import type { GhComment } from "../../app/src/github/comments";
import type { GhPull } from "../../app/src/github/client";

export interface BotIssue {
  number: number; state: string; state_reason?: string | null; html_url: string;
  body?: string | null;
  user: { login: string }; pull_request?: unknown;
}
export interface LinkedPr { repo: string; number: number }

/** The GitHub reads the verifier needs; faked in tests. Every method may throw (treated as "GitHub unavailable"). */
export interface GhApi {
  getIssue(repo: string, n: number): Promise<BotIssue>;
  getPull(repo: string, n: number): Promise<GhPull>;
  getComments(repo: string, n: number): Promise<GhComment[]>;
  linkedPrs(repo: string, n: number): Promise<LinkedPr[]>;
  postComment(repo: string, n: number, body: string): Promise<void>;
}

const API = "https://api.github.com";

/** Linked PRs from cross-referenced timeline events, keeping the repository of each PR. */
export function linkedPrsFromTimeline(events: { event: string; source?: { issue?: { pull_request?: { html_url?: string } } } }[]): LinkedPr[] {
  const seen = new Set<string>();
  const out: LinkedPr[] = [];
  for (const e of events) {
    const url = e.event === "cross-referenced" ? e.source?.issue?.pull_request?.html_url : undefined;
    const m = url?.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (!m) continue;
    const key = `${m[1]!.toLowerCase()}#${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ repo: m[1]!, number: Number(m[2]) });
  }
  return out;
}

export function createGithubApi(token: string | undefined, fetchImpl: typeof fetch = fetch): GhApi {
  const headers = {
    accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28",
    "user-agent": "postmark-verifier-bot", ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  async function get<T>(path: string): Promise<T> {
    const res = await fetchImpl(`${API}${path}`, { headers });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
    return res.json() as Promise<T>;
  }
  return {
    getIssue: (repo, n) => get<BotIssue>(`/repos/${repo}/issues/${n}`),
    getPull: (repo, n) => get<GhPull>(`/repos/${repo}/pulls/${n}`),
    async getComments(repo, n) {
      const out: GhComment[] = [];
      for (let page = 1; page <= 10; page++) {
        const batch = await get<GhComment[]>(`/repos/${repo}/issues/${n}/comments?per_page=100&page=${page}`);
        out.push(...batch);
        if (batch.length < 100) break;
      }
      return out;
    },
    async linkedPrs(repo, n) {
      return linkedPrsFromTimeline(await get(`/repos/${repo}/issues/${n}/timeline?per_page=100`));
    },
    async postComment(repo, n, body) {
      const res = await fetchImpl(`${API}/repos/${repo}/issues/${n}/comments`, {
        method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error(`GitHub ${res.status} posting a comment on ${repo}#${n}`);
    },
  };
}
