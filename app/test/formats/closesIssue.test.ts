import { describe, it, expect } from "vitest";
import { checkPull, closesIssue } from "../../src/github/prcheck";
import type { GhPull } from "../../src/github/client";

const R = "Ololadestephen/Postmark";
const pr = (body: string | null, title = "work") => ({ title, body });

describe("closesIssue", () => {
  it("accepts closing keywords on exactly this issue", () => {
    for (const b of ["Fixes #2", "fixes: #2", "Closes ololadestephen/Postmark#2", "Resolves https://github.com/Ololadestephen/Postmark/issues/2",
      "closed #2", "RESOLVED  #2.", "Summary\n\nfix #2\nmore"]) expect(closesIssue(pr(b), R, 2), b).toBe(true);
  });
  it("accepts a keyword in the title", () => {
    expect(closesIssue(pr(null, "Fixes #2: CSV export"), R, 2)).toBe(true);
  });
  it("rejects mentions, other numbers and other repos", () => {
    for (const b of ["Fixes #20", "Fixes #2x", "see #2", "bounty #2", "Fixes other/repo#2", "prefixes #2", "Fixes https://github.com/other/repo/issues/2", ""]) {
      expect(closesIssue(pr(b), R, 2), b).toBe(false);
    }
    expect(closesIssue(pr(null), R, 2)).toBe(false);
  });
});

describe("checkPull closes-issue item", () => {
  const base: GhPull = { number: 9, title: "t", state: "closed", merged: true, merged_at: "2026-01-01T00:00:00Z",
    merge_commit_sha: "a".repeat(40), body: "Fixes #8", user: { login: "x" }, html_url: "" };
  const opts = { expectedRepo: R, prRepo: R, deadline: 2_000_000_000n, identityLogin: "x" };
  it("is added for issue bounties and reflects the PR text", () => {
    const bad = checkPull(base, { ...opts, closesIssue: { ownerRepo: R, number: 2 } }).find((i) => i.label === "PR says Fixes #2");
    expect(bad).toEqual({ label: "PR says Fixes #2", ok: false });
    const good = checkPull({ ...base, body: "Fixes #2" }, { ...opts, closesIssue: { ownerRepo: R, number: 2 } }).find((i) => i.label === "PR says Fixes #2");
    expect(good?.ok).toBe(true);
  });
  it("is absent for PR bounties", () => {
    expect(checkPull(base, opts).some((i) => /Fixes/.test(i.label))).toBe(false);
  });
});
