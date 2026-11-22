import { describe, it, expect } from "vitest";
import { decide, type DecideInput } from "../src/decide";
import {
  ESCROW, PAYEE, REPO, NOW, SHA, COMMENT_ID, GOOD_MERGED_AT, bountyFor, claimBody, comment, disputeComment,
  disputeEvidenceHashOf, fakeGh, goodPull, pull, sec, type FakeGh,
} from "./fixtures";
import { payEvidenceHashOf, refundEvidenceHashOf, resolutionEvidenceHashOf, identityHashOf } from "../../app/src/formats/hashes";

const run = (gh: FakeGh, over: Partial<DecideInput> = {}, meta = { ownerRepo: REPO, kind: 0, number: 7 }) =>
  decide({ id: 7n, bounty: bountyFor(), meta, escrow: ESCROW, now: NOW, gh: fakeGh(gh), ...over });
const reason = (d: Awaited<ReturnType<typeof run>>) => (d.kind === "abstain" ? d.reason : "");
const linked1 = [{ repo: REPO, number: 1 }];
const pulls = (p = goodPull()) => ({ [`${REPO}#1`]: p });

describe("decide: PAY", () => {
  it("pays when the claim comment and one merged PR by the claimant check out", async () => {
    const d = await run({ linked: linked1, pulls: pulls() });
    expect(d).toMatchObject({ kind: "pay", phase: 0, payee: PAYEE, mergedAt: sec(GOOD_MERGED_AT) });
    if (d.kind === "pay") expect(d.evidenceHash).toBe(payEvidenceHashOf(REPO, 1, SHA, sec(GOOD_MERGED_AT), "contributor"));
  });
  it("uses the bounty's own PR for kind-1 work", async () => {
    const d = await run({ pulls: { [`${REPO}#7`]: goodPull({ number: 7 }) } }, {}, { ownerRepo: REPO, kind: 1, number: 7 });
    expect(d.kind).toBe("pay");
  });
});

describe("decide: abstain", () => {
  it("without a matching claim comment", async () => {
    expect(reason(await run({ comments: [comment(1, "contributor", "hello")], linked: linked1, pulls: pulls() }))).toMatch(/no claim comment/);
  });
  it("when the identity hash does not match", async () => {
    const d = await run({ linked: linked1, pulls: pulls() }, { bounty: bountyFor({ payeeIdentityHash: identityHashOf("other", PAYEE, BigInt(COMMENT_ID)) }) });
    expect(reason(d)).toMatch(/identity hash/);
  });
  it("ignores claim comments for another bounty, chain, escrow or claimant", async () => {
    for (const body of [claimBody(8), claimBody(7, PAYEE, 1), claimBody(7, "0x" + "1".repeat(40)), claimBody(7, PAYEE, 9800, "0x" + "2".repeat(40))]) {
      expect(reason(await run({ comments: [comment(COMMENT_ID, "contributor", body)], linked: linked1, pulls: pulls() }))).toMatch(/no claim comment/);
    }
  });
  it("on any GitHub error", async () => {
    expect(reason(await run({ fail: true }))).toMatch(/^GitHub unavailable: rate limited/);
  });
  it("with no linked PR and an open issue", async () => {
    expect(reason(await run({}))).toMatch(/no merged PR/);
  });
  it("with an unmerged PR and an open issue", async () => {
    expect(reason(await run({ linked: linked1, pulls: pulls(pull({ state: "open", merged: false, merged_at: null })) }))).toMatch(/no merged PR/);
  });
  it("with a PR by someone else while the issue is open", async () => {
    expect(reason(await run({ linked: linked1, pulls: pulls(goodPull({ user: { login: "stranger" } })) }))).toMatch(/no merged PR/);
  });
  it("without a merge commit sha", async () => {
    expect(reason(await run({ linked: linked1, pulls: pulls(goodPull({ merge_commit_sha: null })) }))).toMatch(/no merged PR/);
  });
  it("ignores a PR from another repository", async () => {
    const d = await run({ linked: [{ repo: "evil/fork", number: 1 }], pulls: { "evil/fork#1": goodPull() } });
    expect(d.kind).toBe("abstain");
  });
  it("with several qualifying PRs", async () => {
    const d = await run({ linked: [...linked1, { repo: REPO, number: 2 }], pulls: { ...pulls(), [`${REPO}#2`]: goodPull({ number: 2 }) } });
    expect(reason(d)).toMatch(/several qualifying/);
  });
  it("after the deadline", async () => {
    expect(reason(await run({ linked: linked1, pulls: pulls() }, { now: 2_000_000_001n }))).toMatch(/submission closed/);
  });
});

describe("decide: REFUND", () => {
  it("refunds a kind-1 PR that was closed without merging", async () => {
    const d = await run({ pulls: { [`${REPO}#7`]: pull({ number: 7, merged: false, merged_at: null, merge_commit_sha: null }) } }, {}, { ownerRepo: REPO, kind: 1, number: 7 });
    const url = `https://github.com/${REPO}/pull/7`;
    expect(d).toMatchObject({ kind: "refund", reason: "not-merged", detailsUrl: url });
    if (d.kind === "refund") expect(d.evidenceHash).toBe(refundEvidenceHashOf("not-merged", url));
  });
  it("refunds a kind-1 PR merged by someone else as ineligible", async () => {
    const d = await run({ pulls: { [`${REPO}#7`]: goodPull({ number: 7, user: { login: "stranger" } }) } }, {}, { ownerRepo: REPO, kind: 1, number: 7 });
    expect(d).toMatchObject({ kind: "refund", reason: "ineligible" });
  });
  it("refunds a kind-0 issue closed as not planned", async () => {
    const d = await run({ issue: { state: "closed", state_reason: "not_planned" } });
    expect(d).toMatchObject({ kind: "refund", reason: "withdrawn", detailsUrl: `https://github.com/${REPO}/issues/7` });
  });
  it("a merged PR by the claimant that only mentions the issue (Fixes another issue) is not the work", async () => {
    const d = await run({ linked: linked1, pulls: pulls(goodPull({ body: "Fixes #8" })) });
    expect(d.kind).toBe("abstain");
    expect(reason(d)).toMatch(/no merged PR from the claimant yet/);
  });
  it("pays once the same PR says it fixes this issue", async () => {
    expect((await run({ linked: linked1, pulls: pulls(goodPull({ body: "Fixes #7" })) })).kind).toBe("pay");
    expect((await run({ linked: linked1, pulls: pulls(goodPull({ body: null, title: "Closes #7: export" })) })).kind).toBe("pay");
  });
  it("does not refund a completed issue when another author's PR merely mentions it", async () => {
    const d = await run({ issue: { state: "closed", state_reason: "completed" }, linked: linked1,
      pulls: pulls(goodPull({ user: { login: "stranger" }, body: "related to #7" })) });
    expect(d.kind).toBe("abstain");
  });
  it("refunds a completed issue whose merged PR is by someone else", async () => {
    const d = await run({ issue: { state: "closed", state_reason: "completed" }, linked: linked1, pulls: pulls(goodPull({ user: { login: "stranger" } })) });
    expect(d).toMatchObject({ kind: "refund", reason: "ineligible" });
  });
  it("abstains on a completed issue with no merged PR", async () => {
    expect((await run({ issue: { state: "closed", state_reason: "completed" } })).kind).toBe("abstain");
  });
});

describe("decide: DISPUTE", () => {
  const disputed = (login = "disputer", id = 900) => ({
    bounty: bountyFor({ state: 3, disputeEvidenceHash: disputeEvidenceHashOf(login, BigInt(id)) }),
  });
  const base = { linked: linked1, pulls: pulls() };
  it("abstains without a matching dispute comment", async () => {
    const d = await run({ ...base, comments: [comment(COMMENT_ID, "contributor", claimBody())] }, disputed());
    expect(reason(d)).toMatch(/no dispute comment/);
  });
  it("re-checks the basis and wraps the evidence in a resolution hash", async () => {
    const comments = [comment(COMMENT_ID, "contributor", claimBody()), disputeComment(900, "disputer")];
    const d = await run({ ...base, comments }, disputed());
    expect(d).toMatchObject({ kind: "pay", phase: 1 });
    if (d.kind === "pay") {
      expect(d.evidenceHash).toBe(resolutionEvidenceHashOf(900n, payEvidenceHashOf(REPO, 1, SHA, sec(GOOD_MERGED_AT), "contributor")));
    }
  });
  it("is not blocked by a past deadline (the contract only checks the PR's merge time)", async () => {
    const comments = [comment(COMMENT_ID, "contributor", claimBody()), disputeComment(900, "disputer")];
    const d = await run({ ...base, comments }, { ...disputed(), now: 2_000_000_001n });
    expect(d.kind).toBe("pay");
  });
});
