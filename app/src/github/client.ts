import {
  linkedPrNumbers, type GhComment, type GhTimelineEvent,
} from "./comments";
// GitHub REST client with ETag conditional caching (localStorage, bounded),
// rate-limit awareness, and an optional session-only personal token.

export interface CachedResponse<T> { data: T; etag: string; url: string; at?: number; }

/** Issue, PR and timeline reads are served from the local cache for this long without any request:
 * an unauthenticated 304 still counts against GitHub's 60/hour limit. Comment scans always revalidate. */
export const FRESH_MS = 5 * 60_000;

const CACHE_PREFIX = "pm-gh:";
const CACHE_LIMIT = 200;
const TOKEN_KEY = "pm-gh-token";

export class GithubRateLimitError extends Error {
  resetAt: Date;
  constructor(resetAt: Date) {
    super(`GitHub API rate limit reached. Try again after ${resetAt.toLocaleTimeString()}.`);
    this.name = "GithubRateLimitError";
    this.resetAt = resetAt;
  }
}

export function setGithubToken(token: string | null) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}
export function githubToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

function cacheGet<T>(url: string): CachedResponse<T> | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + url);
    return raw ? JSON.parse(raw) as CachedResponse<T> : null;
  } catch { return null; }
}
function cacheSet<T>(url: string, data: T, etag: string) {
  try {
    // evict oldest when bound is hit
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX));
    if (keys.length >= CACHE_LIMIT) {
      for (const k of keys.slice(0, keys.length - CACHE_LIMIT + 1)) localStorage.removeItem(k);
    }
    localStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ data, etag, url, at: Date.now() }));
  } catch { /* storage full/blocked — keep going */ }
}

async function ghFetch<T>(url: string, maxAgeMs = 0): Promise<T> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  const token = githubToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const cached = cacheGet<T>(url);
  if (cached && maxAgeMs > 0 && cached.at !== undefined && Date.now() - cached.at < maxAgeMs) return cached.data;
  if (cached) headers["if-none-match"] = cached.etag;

  const res = await fetch(url, { headers });
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  if (res.status === 304 && cached) { cacheSet(url, cached.data, cached.etag); return cached.data; }
  if (res.status === 403 || res.status === 429) {
    if (remaining === "0" || res.status === 429) {
      throw new GithubRateLimitError(
        reset ? new Date(Number(reset) * 1000) : new Date(Date.now() + 3600_000));
    }
    throw new Error(`GitHub API error ${res.status}`);
  }
  if (res.status === 404) throw new Error("Not found on GitHub");
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  const data = (await res.json()) as T;
  const etag = res.headers.get("etag");
  if (etag) cacheSet(url, data, etag);
  return data;
}

export {
  findClaimComments, findDisputeComments, linkedPrNumbers,
  type ClaimComment, type DisputeComment, type GhComment, type GhTimelineEvent,
} from "./comments";

const API = "https://api.github.com";

export interface GhIssue {
  number: number; title: string; state: string; html_url: string;
  user: { login: string }; labels: { name: string }[];
  created_at: string; pull_request?: unknown;
}
export interface GhPull {
  number: number; title: string; state: string; merged: boolean;
  merged_at: string | null; merge_commit_sha: string | null; body: string | null;
  user: { login: string }; html_url: string;
}
export const getIssue = (ownerRepo: string, n: number) =>
  ghFetch<GhIssue>(`${API}/repos/${ownerRepo}/issues/${n}`, FRESH_MS);
export const getPull = (ownerRepo: string, n: number) =>
  ghFetch<GhPull>(`${API}/repos/${ownerRepo}/pulls/${n}`, FRESH_MS);

/** Issue timeline events (cross-referenced PRs surface here). */
export async function getLinkedPrs(ownerRepo: string, issueNumber: number) {
  const events = await ghFetch<GhTimelineEvent[]>(
    `${API}/repos/${ownerRepo}/issues/${issueNumber}/timeline?per_page=100`, FRESH_MS);
  return linkedPrNumbers(events);
}

export async function getAllComments(ownerRepo: string, n: number) {
  const out: GhComment[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await ghFetch<GhComment[]>(
      `${API}/repos/${ownerRepo}/issues/${n}/comments?per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

