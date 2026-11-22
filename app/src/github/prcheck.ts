// Pure PR checklist — the verifier sees warnings, not blocks.
import type { GhPull } from "./client";

export interface PrCheckItem { label: string; ok: boolean }

export function mergedAtSeconds(pr: GhPull): bigint {
  return pr.merged_at ? BigInt(Math.floor(new Date(pr.merged_at).getTime() / 1000)) : 0n;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the title or body uses a GitHub closing keyword on exactly this issue; a mere mention does not count. */
export function closesIssue(pr: { title: string; body: string | null }, ownerRepo: string, n: number): boolean {
  const repo = escapeRe(ownerRepo);
  const ref = `(?:#${n}|${repo}#${n}|https://github\\.com/${repo}/issues/${n})(?![0-9A-Za-z_])`;
  const re = new RegExp(`(?<![A-Za-z0-9_])(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\\s*:?\\s+${ref}`, "i");
  return re.test(pr.title) || re.test(pr.body ?? "");
}

export function checkPull(pr: GhPull, opts: {
  expectedRepo: string; prRepo: string; deadline: bigint; identityLogin: string | null;
  closesIssue?: { ownerRepo: string; number: number };
}): PrCheckItem[] {
  const mergedAt = mergedAtSeconds(pr);
  const items: PrCheckItem[] = [
    { label: "merged", ok: !!pr.merged && mergedAt > 0n },
    { label: "merged_at ≤ deadline", ok: mergedAt > 0n && mergedAt <= opts.deadline },
    { label: `PR author == identity login${opts.identityLogin ? ` (@${opts.identityLogin})` : ""}`,
      ok: opts.identityLogin !== null && pr.user.login.toLowerCase() === opts.identityLogin },
    { label: "same repository",
      ok: opts.prRepo.toLowerCase() === opts.expectedRepo.toLowerCase() },
    { label: "merge_commit_sha present", ok: !!pr.merge_commit_sha },
  ];
  if (opts.closesIssue) {
    const { ownerRepo, number } = opts.closesIssue;
    items.push({ label: `PR says Fixes #${number}`, ok: closesIssue(pr, ownerRepo, number) });
  }
  return items;
}
