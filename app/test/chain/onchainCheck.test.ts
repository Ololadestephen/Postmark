import { describe, it, expect } from "vitest";
import type { Hex } from "viem";
import {
  checkOnchainProof, claimedAtFor, proofCheckPassed, type OnchainReader, type ProofCtx,
} from "../../src/chain/onchainCheck";
import { functionSelector, type Task } from "../../src/github/task";

const PAYEE = "0x478F2A08a81be7CEa42bd34BD6900593fA56c4B6";
const TARGET = `0x${"ab".repeat(20)}` as Hex;
const DEPLOYED = `0x${"cd".repeat(20)}` as Hex;
const CODEHASH = `0x${"ee".repeat(32)}` as Hex;
const TX = `0x${"aa".repeat(32)}` as Hex;
const CTX: ProofCtx = { claimant: PAYEE, claimedAt: 100n, deadline: 1000n, now: 900n };

const CALL: Task = { type: "onchain-call", contract: TARGET };
const CALL_FN: Task = { type: "onchain-call", contract: TARGET, function: "register(bytes)" };
const DEPLOY: Task = { type: "onchain-deploy" };
const DEPLOY_H: Task = { type: "onchain-deploy", codehash: CODEHASH };

interface FakeChain {
  tx?: { from: string; to: string | null; input: Hex; blockNumber: bigint } | null;
  receipt?: { status: string; contractAddress: string | null; blockNumber: bigint } | null;
  ts?: bigint; codeHash?: Hex | null;
}
const reader = (f: FakeChain = {}): OnchainReader => ({
  getTransaction: async () => f.tx === undefined
    ? { from: PAYEE, to: TARGET, input: `${functionSelector("register(bytes)")}${"00".repeat(32)}` as Hex, blockNumber: 9n }
    : f.tx,
  getTransactionReceipt: async () => f.receipt === undefined
    ? { status: "success", contractAddress: null, blockNumber: 9n } : f.receipt,
  getBlockTimestamp: async () => f.ts ?? 500n,
  getCodeHash: async () => f.codeHash === undefined ? CODEHASH : f.codeHash,
});
const run = (task: Task, f: FakeChain = {}, ctx: ProofCtx = CTX) =>
  checkOnchainProof(task, { txHash: TX }, ctx, reader(f));
const failed = (items: { label: string; ok: boolean }[]) => items.filter((i) => !i.ok).map((i) => i.label);

describe("checkOnchainProof", () => {
  it("passes a call without a function", async () => {
    const r = await run(CALL);
    expect(proofCheckPassed(r)).toBe(true);
    expect(r.blockTimestamp).toBe(500n);
  });
  it("passes a call with a matching selector", async () => {
    expect(proofCheckPassed(await run(CALL_FN))).toBe(true);
  });
  it("passes a deploy without a codehash", async () => {
    const r = await run(DEPLOY, {
      tx: { from: PAYEE, to: null, input: "0x6000", blockNumber: 9n },
      receipt: { status: "success", contractAddress: DEPLOYED, blockNumber: 9n },
    });
    expect(proofCheckPassed(r)).toBe(true);
  });
  it("passes a deploy with a matching codehash", async () => {
    const r = await run(DEPLOY_H, {
      tx: { from: PAYEE, to: null, input: "0x6000", blockNumber: 9n },
      receipt: { status: "success", contractAddress: DEPLOYED, blockNumber: 9n },
    });
    expect(proofCheckPassed(r)).toBe(true);
  });
  it("fails on a missing transaction", async () => {
    const r = await run(CALL, { tx: null, receipt: null });
    expect(failed(r.items)).toEqual(["transaction found and confirmed"]);
    expect(r.blockTimestamp).toBeNull();
  });
  it("fails on a reverted transaction", async () => {
    expect(failed((await run(CALL, { receipt: { status: "reverted", contractAddress: null, blockNumber: 9n } })).items))
      .toContain("succeeded");
  });
  it("fails when the sender is not the claimant", async () => {
    const r = await run(CALL, { tx: { from: `0x${"99".repeat(20)}`, to: TARGET, input: "0x", blockNumber: 9n } });
    expect(failed(r.items)).toContain("sent by the claimant");
  });
  it("fails on the wrong contract", async () => {
    const r = await run(CALL, { tx: { from: PAYEE, to: `0x${"99".repeat(20)}`, input: "0x", blockNumber: 9n } });
    expect(failed(r.items)).toContain(`calls ${TARGET}`);
  });
  it("fails on the wrong selector", async () => {
    const r = await run(CALL_FN, { tx: { from: PAYEE, to: TARGET, input: "0xdeadbeef", blockNumber: 9n } });
    expect(failed(r.items)).toContain(`calls register(bytes)`);
  });
  it("rejects a factory deploy (to != null)", async () => {
    const r = await run(DEPLOY, {
      receipt: { status: "success", contractAddress: DEPLOYED, blockNumber: 9n },
    });
    expect(failed(r.items)).toContain("direct contract creation");
  });
  it("fails on the wrong codehash", async () => {
    const r = await run(DEPLOY_H, {
      tx: { from: PAYEE, to: null, input: "0x6000", blockNumber: 9n },
      receipt: { status: "success", contractAddress: DEPLOYED, blockNumber: 9n },
      codeHash: `0x${"ff".repeat(32)}` as Hex,
    });
    expect(failed(r.items)).toContain("deployed codehash matches");
  });
  it("fails before the claim and after the deadline", async () => {
    expect(failed((await run(CALL, { ts: 99n })).items)).toContain("after the claim");
    expect(failed((await run(CALL, { ts: 1001n })).items)).toContain("tx ≤ deadline");
    expect(failed((await run(CALL, { ts: 950n }, { ...CTX, now: 940n })).items)).toContain("tx ≤ now");
  });
});

describe("claimedAtFor", () => {
  const bounty = { claimExpiresAt: 500n, claimTimeout: 100n, claimRound: 2n };
  it("derives the claim time from the live claim", async () => {
    expect(await claimedAtFor(bounty, [], reader())).toBe(400n);
  });
  it("falls back to the latest Claimed event's block", async () => {
    const b = { ...bounty, claimExpiresAt: 0n };
    expect(await claimedAtFor(b, [
      { claimRound: 1n, blockNumber: 10n }, { claimRound: 2n, blockNumber: 20n },
    ], { getBlockTimestamp: async () => 777n })).toBe(777n);
    expect(await claimedAtFor(b, [{ claimRound: 1n, blockNumber: 10n }], reader())).toBeNull();
    expect(await claimedAtFor(b, [], reader())).toBeNull();
  });
});
