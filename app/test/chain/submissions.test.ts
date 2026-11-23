import { describe, it, expect } from "vitest";
import { findSubmissionComments } from "../../src/github/client";

const comment = (id: number, login: string, body: string, created = "2026-01-01T00:00:00Z", updated?: string) =>
  ({ id, user: { login }, body, html_url: `https://x/${id}`, created_at: created, ...(updated ? { updated_at: updated } : {}) });

const LINE = "postmark-submission v1 url=https://example.com/report.pdf";

describe("findSubmissionComments", () => {
  it("parses a submission line and keeps the seconds timestamp", () => {
    const [s] = findSubmissionComments([comment(9, "OctoCat", LINE)]);
    expect(s).toMatchObject({
      commentId: 9, githubLogin: "octocat",
      url: "https://example.com/report.pdf", edited: false,
    });
    expect(s!.createdAt).toBe(1_767_225_600n);
  });

  it("lets a report follow the line in the same body and takes only the first line", () => {
    const body = `${LINE}\n\n## Test report\nEverything passes.\npostmark-submission v1 url=https://example.com/other`;
    const [s] = findSubmissionComments([comment(1, "alice", body)]);
    expect(s!.url).toBe("https://example.com/report.pdf");
  });

  it("finds several submissions across comments", () => {
    const out = findSubmissionComments([
      comment(1, "alice", LINE),
      comment(2, "alice", "no line here"),
      comment(3, "alice", "postmark-submission v1 url=https://example.com/second"),
    ]);
    expect(out.map((s) => s.url)).toEqual(["https://example.com/report.pdf", "https://example.com/second"]);
  });

  it("flags a comment edited after posting", () => {
    const edited = findSubmissionComments([
      comment(1, "alice", LINE, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")]);
    expect(edited[0]!.edited).toBe(true);
    const untouched = findSubmissionComments([
      comment(1, "alice", LINE, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")]);
    expect(untouched[0]!.edited).toBe(false);
  });

  it("rejects non-https URLs, whitespace, and malformed lines", () => {
    const bad = [
      "postmark-submission v1 url=http://example.com/x",
      "postmark-submission v1 url=https://example.com/has space",
      "postmark-submission v1 url=https://example.com/x and more",
      "postmark-submission v1 url=example.com/noscheme",
      "postmark-submission v1",
      "postmark-submission v2 url=https://example.com/x",
      "postmark-submission url=https://example.com/x",
    ];
    for (const body of bad) {
      expect(findSubmissionComments([comment(1, "alice", body)])).toEqual([]);
    }
  });

  it("ignores nonmatching comments", () => {
    expect(findSubmissionComments([
      comment(1, "alice", "postmark-claim v1 chain=9800 escrow=0xabc bounty=1 claimant=0xdef"),
      comment(2, "bob", `see ${LINE}`) // embedded mid-sentence still counts — it is the first matching line
    ]).map((s) => s.commentId)).toEqual([2]);
  });
});
