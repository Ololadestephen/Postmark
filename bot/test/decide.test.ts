import { describe, it, expect } from "vitest";
import { decide, type DecideInput } from "../src/decide";
import {
  ESCROW, PAYEE, REPO, NOW, SHA, COMMENT_ID, GOOD_MERGED_AT, bountyFor, claimBody, comment, disputeComment,
  disputeEvidenceHashOf, fakeGh, goodPull, proofBody, pull, sec, type FakeGh,
} from "./fixtures";
import {
  onchainEvidenceHashOf, payEvidenceHashOf, refundEvidenceHashOf, resolutionEvidenceHashOf, identityHashOf,
} from "../../app/src/formats/hashes";
import { briefHashOf, functionSelector, type Task } from "../../app/src/github/task";
import type { OnchainReader } from "../../app/src/chain/onchainCheck";
import type { Hex } from "viem";

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

describe("decide: on-chain task bounties", () => {
  const TARGET = `0x${"ab".repeat(20)}` as Hex;
  const DEPLOYED = `0x${"cd".repeat(20)}`;
  const CODEHASH = `0x${"ee".repeat(32)}` as Hex;
  const TX = `0x${"aa".repeat(32)}` as Hex;
  const TX2 = `0x${"bb".repeat(32)}` as Hex;
  const AT = NOW - 100n;
  const CLAIMED_AT = NOW + 1000n - 86_400n; // claimExpiresAt − claimTimeout from bountyFor

  const callTask: Task = { type: "onchain-call", contract: TARGET, function: "register(bytes)" };
  const deployTask: Task = { type: "onchain-deploy", codehash: CODEHASH };
  const block = (inner: string) => `\`\`\`postmark-task\n${inner}\n\`\`\``;
  const taskIssue = (inner: string) => ({ body: `do the thing\n${block(inner)}\n` });

  interface FakeChain {
    tx?: { from: string; to: string | null; input: Hex; blockNumber: bigint } | null;
    receipt?: { status: string; contractAddress: string | null; blockNumber: bigint } | null;
    ts?: bigint; codeHash?: Hex | null; fail?: boolean;
  }
  const fakeReader = (f: FakeChain = {}): OnchainReader => {
    const boom = () => { if (f.fail) throw new Error("rpc down"); };
    return {
      async getTransaction() {
        boom();
        return f.tx === undefined
          ? { from: PAYEE, to: TARGET, input: `${functionSelector("register(bytes)")}${"00".repeat(32)}` as Hex, blockNumber: 9n }
          : f.tx;
      },
      async getTransactionReceipt() {
        boom();
        return f.receipt === undefined ? { status: "success", contractAddress: null, blockNumber: 9n } : f.receipt;
      },
      async getBlockTimestamp() { boom(); return f.ts ?? AT; },
      async getCodeHash() { boom(); return f.codeHash === undefined ? CODEHASH : f.codeHash; },
    };
  };

  const taskRun = (gh: FakeGh, task: Task, chain: FakeChain = {}, over: Partial<DecideInput> = {}) =>
    run({
      issue: taskIssue(`type: ${task.type}${task.contract ? `\ncontract: ${task.contract}` : ""}${task.function ? `\nfunction: ${task.function}` : ""}${task.codehash ? `\ncodehash: ${task.codehash}` : ""}`),
      comments: [
        comment(COMMENT_ID, "contributor", claimBody(7, PAYEE, 9800, ESCROW, briefHashOf(task))),
        comment(600, "contributor", proofBody(TX)),
      ],
      ...gh,
    }, { reader: fakeReader(chain), ...over });

  it("pays when the proof transaction calls the contract", async () => {
    const d = await taskRun({}, callTask);
    expect(d).toMatchObject({ kind: "pay", payee: PAYEE, mergedAt: AT });
    if (d.kind === "pay") expect(d.evidenceHash).toBe(onchainEvidenceHashOf("onchain-call", TX, AT, PAYEE));
  });
  it("pays a deploy task when the codehash matches", async () => {
    const d = await taskRun({}, deployTask, {
      tx: { from: PAYEE, to: null, input: "0x6000", blockNumber: 9n },
      receipt: { status: "success", contractAddress: DEPLOYED, blockNumber: 9n },
    });
    expect(d.kind).toBe("pay");
    if (d.kind === "pay") expect(d.evidenceHash).toBe(onchainEvidenceHashOf("onchain-deploy", TX, AT, PAYEE));
  });
  it("pays on a re-read: the same proof passes identically", async () => {
    const d = await taskRun({ comments: [
      comment(COMMENT_ID, "contributor", claimBody(7, PAYEE, 9800, ESCROW, briefHashOf(callTask))),
      comment(600, "contributor", `see below\n${proofBody(TX)}\n${proofBody(TX)}`),
    ] }, callTask);
    expect(d.kind).toBe("pay");
  });
  it("abstains when the claim line has no brief", async () => {
    const d = await taskRun({ comments: [
      comment(COMMENT_ID, "contributor", claimBody()),
      comment(600, "contributor", proofBody(TX)),
    ] }, callTask);
    expect(reason(d)).toMatch(/no brief/);
  });
  it("abstains when the brief changed after the claim", async () => {
    const other = briefHashOf({ type: "onchain-call", contract: `0x${"99".repeat(20)}` });
    const d = await taskRun({ comments: [
      comment(COMMENT_ID, "contributor", claimBody(7, PAYEE, 9800, ESCROW, other)),
      comment(600, "contributor", proofBody(TX)),
    ] }, callTask);
    expect(reason(d)).toMatch(/brief changed/);
  });
  it("abstains when the proof comes from another GitHub login", async () => {
    const d = await taskRun({ comments: [
      comment(COMMENT_ID, "contributor", claimBody(7, PAYEE, 9800, ESCROW, briefHashOf(callTask))),
      comment(600, "impostor", proofBody(TX)),
    ] }, callTask);
    expect(reason(d)).toMatch(/no passing proof/);
  });
  it("abstains when two proofs pass", async () => {
    const d = await taskRun({ comments: [
      comment(COMMENT_ID, "contributor", claimBody(7, PAYEE, 9800, ESCROW, briefHashOf(callTask))),
      comment(600, "contributor", `${proofBody(TX)}\n${proofBody(TX2)}`),
    ] }, callTask);
    expect(reason(d)).toMatch(/several passing/);
  });
  it("abstains when the proof is already used by another bounty", async () => {
    const d = await taskRun({}, callTask, {}, { takenEvidence: [onchainEvidenceHashOf("onchain-call", TX, AT, PAYEE)] });
    expect(reason(d)).toMatch(/already used/);
  });
  it("abstains on an RPC failure", async () => {
    const d = await taskRun({}, callTask, { fail: true });
    expect(reason(d)).toMatch(/chain read failed/);
  });
  it("abstains when no transaction is found", async () => {
    const d = await taskRun({}, callTask, { tx: null, receipt: null });
    expect(reason(d)).toMatch(/no passing proof/);
  });
  it("abstains on a transaction before the claim or past the deadline", async () => {
    expect(reason(await taskRun({}, callTask, { ts: CLAIMED_AT - 1n }))).toMatch(/no passing proof/);
    expect(reason(await taskRun({}, callTask, { ts: 2_000_000_001n }))).toMatch(/no passing proof/);
  });
  it("abstains for a human-judged task type", async () => {
    const d = await taskRun({}, { type: "testing" } as Task);
    expect(reason(d)).toMatch(/human-judged task type: testing/);
  });
  it("abstains on an invalid task block", async () => {
    const d = await run({ issue: { body: block("type: onchain-call\ncontract: 0xzz") } });
    expect(reason(d)).toMatch(/invalid task block/);
  });
  it("still refunds a withdrawn task bounty", async () => {
    const d = await run({
      issue: { body: block("type: onchain-deploy"), state: "closed", state_reason: "not_planned" },
      comments: [comment(COMMENT_ID, "contributor", claimBody(7, PAYEE, 9800, ESCROW, briefHashOf({ type: "onchain-deploy" })))],
    }, { reader: fakeReader() });
    expect(d).toMatchObject({ kind: "refund", reason: "withdrawn" });
  });
});
