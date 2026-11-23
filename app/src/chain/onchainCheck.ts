// The on-chain proof check for task bounties: a transaction by the claimant that
// calls a contract or deploys one. Shared by the verifier bot and the review tool;
// the chain reads are injected so tests fake them and any RPC failure propagates
// (callers abstain — a failure is never evidence for a REFUND).
import { keccak256, TransactionNotFoundError, TransactionReceiptNotFoundError, type Hex } from "viem";
import { httpClient } from "./client";
import { sameAddress } from "./address";
import type { Task } from "../github/task";
import { functionSelector } from "../github/task";
import type { EscrowLog } from "./indexer";

export interface ChainTx {
  from: string; to: string | null; input: Hex; blockNumber: bigint;
}
export interface ChainReceipt {
  status: string; contractAddress: string | null; blockNumber: bigint;
}
export interface OnchainReader {
  getTransaction(hash: Hex): Promise<ChainTx | null>;
  getTransactionReceipt(hash: Hex): Promise<ChainReceipt | null>;
  getBlockTimestamp(blockNumber: bigint): Promise<bigint>;
  /** keccak256 of the code at the address, or null when there is no code. */
  getCodeHash(address: string): Promise<Hex | null>;
}

export interface ProofCtx {
  claimant: `0x${string}`;
  /** when the claim was stamped (seconds); the proof must come after it */
  claimedAt: bigint;
  deadline: bigint;
  now: bigint;
}

export interface ProofCheckItem { label: string; ok: boolean; detail?: string }
export interface ProofCheck { items: ProofCheckItem[]; blockTimestamp: bigint | null }

/** Run every check for one proof transaction. Throws on RPC failure. */
export async function checkOnchainProof(
  task: Task, proof: { txHash: Hex }, ctx: ProofCtx, reader: OnchainReader,
): Promise<ProofCheck> {
  const hash = proof.txHash;
  const items: ProofCheckItem[] = [];
  const [tx, receipt] = await Promise.all([
    reader.getTransaction(hash), reader.getTransactionReceipt(hash)]);
  items.push({ label: "transaction found and confirmed", ok: !!tx && !!receipt });
  if (!tx || !receipt) return { items, blockTimestamp: null };

  items.push({ label: "succeeded", ok: receipt.status === "success" });
  items.push({ label: `sent by the claimant`, ok: sameAddress(tx.from, ctx.claimant), detail: tx.from });

  const ts = await reader.getBlockTimestamp(receipt.blockNumber);
  items.push({ label: "after the claim", ok: ts >= ctx.claimedAt });
  items.push({ label: "tx ≤ deadline", ok: ts <= ctx.deadline });
  items.push({ label: "tx ≤ now", ok: ts <= ctx.now });

  if (task.type === "onchain-call") {
    items.push({ label: `calls ${task.contract}`, ok: !!tx.to && sameAddress(tx.to, task.contract!) });
    if (task.function) {
      const selector = functionSelector(task.function);
      items.push({
        label: `calls ${task.function}`, detail: selector,
        ok: tx.input.toLowerCase().startsWith(selector.toLowerCase()),
      });
    }
  } else if (task.type === "onchain-deploy") {
    const direct = tx.to === null && !!receipt.contractAddress;
    items.push({ label: "direct contract creation", ok: direct });
    if (task.codehash !== undefined) {
      const codeHash = receipt.contractAddress ? await reader.getCodeHash(receipt.contractAddress) : null;
      items.push({
        label: "deployed codehash matches",
        ok: !!codeHash && codeHash.toLowerCase() === task.codehash.toLowerCase(),
      });
    }
  }
  return { items, blockTimestamp: ts };
}

export const proofCheckPassed = (c: ProofCheck) => c.items.every((i) => i.ok);

export interface PassingProof {
  txHash: Hex;
  /** the proof transaction's block timestamp */
  at: bigint;
  evidenceHash: Hex;
}

/** The winning proof among passing ones: the earliest block timestamp, then the
 * lowest tx hash. Proofs whose evidence hash is already used by another bounty
 * are skipped; null means every passing proof is taken. Shared by the bot and
 * the review tool so they cannot diverge. */
export function selectProof(proofs: PassingProof[], takenEvidence: string[]): PassingProof | null {
  const free = proofs.filter((p) =>
    !takenEvidence.some((h) => h.toLowerCase() === p.evidenceHash.toLowerCase()));
  if (free.length === 0) return null;
  return free.reduce((a, b) =>
    b.at < a.at || (b.at === a.at && b.txHash.toLowerCase() < a.txHash.toLowerCase()) ? b : a);
}

/** The claim time for a proof: from the bounty when the claim is live, else the
 * latest Claimed event's block (e.g. a frozen dispute). null when unknowable. */
export async function claimedAtFor(
  bounty: { claimExpiresAt: bigint; claimTimeout: bigint; claimRound: bigint },
  claimEvents: { claimRound: bigint; blockNumber: bigint }[],
  reader: Pick<OnchainReader, "getBlockTimestamp">,
): Promise<bigint | null> {
  if (bounty.claimExpiresAt !== 0n) return bounty.claimExpiresAt - bounty.claimTimeout;
  const rounds = claimEvents.filter((e) => e.claimRound === bounty.claimRound);
  if (rounds.length === 0) return null;
  const latest = rounds.reduce((a, b) => (a.blockNumber > b.blockNumber ? a : b));
  return reader.getBlockTimestamp(latest.blockNumber);
}

/** Claimed events for one bounty from an index's event list. */
export function claimEventsOf(events: EscrowLog[], bountyId: bigint): { claimRound: bigint; blockNumber: bigint }[] {
  return events
    .filter((e) => e.eventName === "Claimed"
      && (e.args as { bountyId: bigint }).bountyId === bountyId)
    .map((e) => ({
      claimRound: (e.args as { claimRound: bigint }).claimRound,
      blockNumber: e.blockNumber,
    }));
}

/** The diana JSON-RPC reader the app and bot inject. */
export const chainReader: OnchainReader = {
  async getTransaction(hash) {
    try {
      const tx = await httpClient.getTransaction({ hash });
      return tx ? { from: tx.from, to: tx.to ?? null, input: tx.input, blockNumber: tx.blockNumber } : null;
    } catch (e) {
      if (e instanceof TransactionNotFoundError) return null;
      throw e;
    }
  },
  async getTransactionReceipt(hash) {
    try {
      const r = await httpClient.getTransactionReceipt({ hash });
      return { status: r.status, contractAddress: r.contractAddress ?? null, blockNumber: r.blockNumber };
    } catch (e) {
      if (e instanceof TransactionReceiptNotFoundError) return null;
      throw e;
    }
  },
  async getBlockTimestamp(blockNumber) {
    return (await httpClient.getBlock({ blockNumber })).timestamp;
  },
  async getCodeHash(address) {
    const code = await httpClient.getCode({ address: address as `0x${string}` });
    return code && code !== "0x" ? keccak256(code) : null;
  },
};
