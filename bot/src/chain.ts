import {
  createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { diana, EVM_RPC } from "../../app/src/chain/config";
import { postmarkEscrowAbi } from "../../app/src/chain/abi";
import { decodeLogs, indexEvents } from "../../app/src/chain/indexer";
import type { Bounty } from "../../app/src/chain/client";
import type { VerdictFields } from "../../app/src/formats/messages";

export const publicClient: PublicClient = createPublicClient({ chain: diana, transport: http(EVM_RPC, { timeout: 20_000 }) });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** getLogs over [from, to], shrinking the range on RPC limits (same approach as the app's indexer). */
export async function getLogsChunked(escrow: Address, from: bigint, to: bigint) {
  const out = [];
  let chunk = 50_000n;
  let start = from;
  while (start <= to) {
    const end = start + chunk - 1n > to ? to : start + chunk - 1n;
    try {
      out.push(...await publicClient.getLogs({ address: escrow, fromBlock: start, toBlock: end }));
      start = end + 1n;
      await sleep(60);
    } catch (e) {
      if (chunk > 500n) { chunk /= 5n; continue; }
      await sleep(1500);
      out.push(...await publicClient.getLogs({ address: escrow, fromBlock: start, toBlock: end }));
      start = end + 1n;
    }
  }
  return out;
}

export async function loadIndex(escrow: Address, deployBlock: bigint) {
  const head = await publicClient.getBlockNumber();
  return indexEvents(decodeLogs(await getLogsChunked(escrow, deployBlock, head)), head);
}

export const readBounty = (escrow: Address, id: bigint): Promise<Bounty> =>
  publicClient.readContract({ address: escrow, abi: postmarkEscrowAbi, functionName: "getBounty", args: [id] });

export const readNextId = (escrow: Address): Promise<bigint> =>
  publicClient.readContract({ address: escrow, abi: postmarkEscrowAbi, functionName: "nextBountyId" });

export async function chainNow(): Promise<bigint> {
  return (await publicClient.getBlock()).timestamp;
}

/** The contract's own message for a verdict (the bot refuses to sign if its local build differs). */
export async function chainVerdictMessage(escrow: Address, v: VerdictFields): Promise<Hex> {
  return publicClient.readContract({
    address: escrow, abi: postmarkEscrowAbi, functionName: "verdictMessage",
    args: [{ bountyId: v.bountyId, phase: v.phase, outcome: v.outcome, payee: v.payee, mergedAt: v.mergedAt,
      evidenceHash: v.evidenceHash, nonce: v.nonce, claimRound: v.claimRound }],
  }) as Promise<Hex>;
}

export type Action =
  | { kind: "submitVerdict" | "resolveDispute"; id: bigint; verdict: VerdictFields; indices: number[]; signatures: Hex[] }
  | { kind: "finalize"; id: bigint };

const struct = (v: VerdictFields) => ({
  bountyId: v.bountyId, phase: v.phase, outcome: v.outcome, payee: v.payee, mergedAt: v.mergedAt,
  evidenceHash: v.evidenceHash, nonce: v.nonce, claimRound: v.claimRound,
});

export function request(escrow: Address, a: Action) {
  return a.kind === "finalize"
    ? { address: escrow, abi: postmarkEscrowAbi, functionName: "finalize", args: [a.id] } as const
    : { address: escrow, abi: postmarkEscrowAbi, functionName: a.kind,
        args: [struct(a.verdict), a.indices, a.signatures] } as const;
}

/** Simulates from the bot's address; returns null when it would succeed, else the reason. */
export async function simulate(escrow: Address, account: Address, a: Action): Promise<string | null> {
  try {
    await publicClient.simulateContract({ ...request(escrow, a), account } as never);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.split("\n")[0]! : String(e);
  }
}

const FALLBACK_GAS: Record<Action["kind"], bigint> = { submitVerdict: 2_500_000n, resolveDispute: 2_500_000n, finalize: 300_000n };

export async function gasLimitFor(escrow: Address, account: Address, a: Action): Promise<bigint> {
  try {
    const est = await publicClient.estimateContractGas({ ...request(escrow, a), account } as never);
    return (est * 125n) / 100n + 1n;
  } catch { return FALLBACK_GAS[a.kind]; }
}

export function walletFor(key: Hex) {
  const account = privateKeyToAccount(key);
  return { account, wallet: createWalletClient({ account, chain: diana, transport: http(EVM_RPC, { timeout: 20_000 }) }) };
}
