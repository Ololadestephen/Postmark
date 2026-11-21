import {
  parseEventLogs, type Log, type ParseEventLogsReturnType,
} from "viem";
import { httpClient } from "./client";
import { ESCROW_ADDRESS, DEPLOY_BLOCK } from "./config";
import { postmarkEscrowAbi } from "./abi";
import { workHashOf } from "../formats/hashes";

export type EscrowLog = ParseEventLogsReturnType<typeof postmarkEscrowAbi>[number] & {
  blockNumber: bigint; transactionHash: `0x${string}`; logIndex: number;
};

export interface BountyMeta {
  ownerRepo: string;
  kind: number;
  number: bigint;
  workHash: `0x${string}`;
  /** true when the emitted metadata does not hash back to the stored hash */
  workHashMismatch: boolean;
}

export interface IndexerState {
  events: EscrowLog[];
  metaById: Map<bigint, BountyMeta>;
  bountyIds: bigint[];
  lastBlock: bigint;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Largest block range the RPC has accepted so far; it refuses 50k-block scans, so start where it works. */
let knownChunk = 10_000n;
const CONCURRENCY = 4;

async function getRange(escrow: `0x${string}`, from: bigint, to: bigint): Promise<Log[]> {
  try {
    return await httpClient.getLogs({ address: escrow, fromBlock: from, toBlock: to });
  } catch (e) {
    const size = to - from + 1n;
    if (size > 500n) { // halve the range and remember what the node accepts
      knownChunk = size / 2n > 500n ? size / 2n : 500n;
      const mid = from + size / 2n;
      return [...await getRange(escrow, from, mid - 1n), ...await getRange(escrow, mid, to)];
    }
    await sleep(1500); // one retry at the minimum chunk before giving up
    return httpClient.getLogs({ address: escrow, fromBlock: from, toBlock: to });
  }
}

/** getLogs over [fromBlock,toBlock] in chunks fetched a few at a time, halving the range on RPC limits. */
export async function getLogsChunked(fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
  const ranges: [bigint, bigint][] = [];
  for (let s = fromBlock; s <= toBlock; s += knownChunk) {
    ranges.push([s, s + knownChunk - 1n > toBlock ? toBlock : s + knownChunk - 1n]);
  }
  const results: Log[][] = new Array(ranges.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ranges.length) }, async () => {
    while (next < ranges.length) {
      const i = next++;
      results[i] = await getRange(ESCROW_ADDRESS, ranges[i]![0], ranges[i]![1]);
    }
  }));
  return results.flat();
}

/** Decode raw logs into typed escrow events, sorted canonically. */
export function decodeLogs(logs: Log[]): EscrowLog[] {
  return parseEventLogs({ abi: postmarkEscrowAbi, logs })
    .filter((l) => l.blockNumber != null && l.transactionHash != null) as EscrowLog[];
}

/** Fold a set of decoded events into the index state. */
export function indexEvents(events: EscrowLog[], toBlock: bigint): IndexerState {
  const metaById = new Map<bigint, BountyMeta>();
  const bountyIds: bigint[] = [];
  for (const e of events) {
    if (e.eventName === "BountyCreated") {
      const id = (e.args as { bountyId: bigint }).bountyId;
      if (!bountyIds.includes(id)) bountyIds.push(id);
    }
    if (e.eventName === "BountyWork") {
      const a = e.args as {
        bountyId: bigint; workHash: `0x${string}`;
        ownerRepo: string; kind: number; number: bigint;
      };
      const recomputed = workHashOf(a.ownerRepo, a.kind, a.number);
      metaById.set(a.bountyId, {
        ownerRepo: a.ownerRepo, kind: Number(a.kind), number: a.number,
        workHash: a.workHash, workHashMismatch: recomputed !== a.workHash,
      });
    }
  }
  return { events, metaById, bountyIds, lastBlock: toBlock };
}

const CACHE_KEY = `pm-index:${ESCROW_ADDRESS.toLowerCase()}`;
const REORG_OVERLAP = 20n;
const tagBig = (_k: string, v: unknown) => (typeof v === "bigint" ? { $b: v.toString() } : v);
const untagBig = (_k: string, v: unknown) =>
  (v && typeof v === "object" && "$b" in (v as object) ? BigInt((v as { $b: string }).$b) : v);
const logId = (l: Log) => `${l.transactionHash}:${l.logIndex}`;

function loadCached(): { head: bigint; logs: Log[] } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw, untagBig) as { head: bigint; logs: Log[] } : null;
  } catch { return null; }
}

/** The event history: the first visit scans from the deploy block; later visits scan only what is new
 * (with a small reorg overlap) on top of the copy kept in localStorage. */
export async function fetchIndex(): Promise<IndexerState> {
  const head = await httpClient.getBlockNumber();
  const cached = loadCached();
  const from = cached ? (cached.head > REORG_OVERLAP ? cached.head - REORG_OVERLAP : 0n) + 1n : DEPLOY_BLOCK;
  const fresh = from <= head ? await getLogsChunked(from < DEPLOY_BLOCK ? DEPLOY_BLOCK : from, head) : [];
  const byId = new Map<string, Log>();
  for (const l of [...(cached?.logs ?? []), ...fresh]) byId.set(logId(l), l);
  const logs = [...byId.values()];
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ head, logs }, tagBig)); } catch { /* storage full or blocked */ }
  return indexEvents(decodeLogs(logs), head);
}
