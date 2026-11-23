import { useQuery } from "@tanstack/react-query";
import { getBounty, httpClient, escrow, nextBountyId, totalLiabilities } from "../chain/client";
import { fetchIndex, type IndexerState } from "../chain/indexer";
import { pqcKeyStatus, type PqcStatus } from "../chain/pqc";
import { fetchEvmWindow } from "../chain/window";
import { getAllComments, getIssue, getPull, type GhIssue, type GhPull } from "../github/client";
import { parseTaskBlock, type Task } from "../github/task";
import type { BountyMeta } from "../chain/indexer";
import { VERIFIER_REGISTRY } from "../chain/config";
import { VERIFIERS } from "../data/verifiers";
import type { Listing } from "../formats/verifierListing";
import type { WorkItem } from "../github/parse";

/** Verifiers who listed themselves on the registry issue; signatures checked against live keys. */
export async function fetchSelfListed(): Promise<Listing[]> {
  const [{ collectListings }, { mldsa87 }, comments] = await Promise.all([
    import("../formats/verifierListing"), import("@qorechain/pqc"),
    getAllComments(VERIFIER_REGISTRY.ownerRepo, VERIFIER_REGISTRY.issue),
  ]);
  return collectListings(comments, {
    liveKey: async (a) => { const s = await pqcKeyStatus(a); return s.live ? s.pubkey : null; },
    verify: (k, m, s) => mldsa87.verify(k, m, s),
    curated: new Set(VERIFIERS.map((v) => v.address.toLowerCase())),
  });
}

export const useSelfListed = () => useQuery<Listing[]>({
  queryKey: ["selfListed"], queryFn: fetchSelfListed,
  staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false,
});

export const useIndex = () => useQuery<IndexerState>({
  queryKey: ["index"], queryFn: fetchIndex,
  staleTime: 30_000, refetchOnWindowFocus: false,
});

export const useBounty = (id: bigint | undefined) => useQuery({
  queryKey: ["bounty", id?.toString()],
  queryFn: () => getBounty(id!),
  enabled: id !== undefined,
  staleTime: 10_000,
});

export const useNextBountyId = () => useQuery({
  queryKey: ["nextBountyId"], queryFn: nextBountyId, staleTime: 15_000,
});

export const useTotalLiabilities = () => useQuery({
  queryKey: ["totalLiabilities"], queryFn: totalLiabilities, staleTime: 15_000,
});

export const usePqcStatus = (account: `0x${string}` | undefined) => useQuery<PqcStatus>({
  queryKey: ["pqc", account],
  queryFn: () => pqcKeyStatus(account!),
  enabled: !!account,
  staleTime: 60_000, retry: 1,
});

export const useEvmWindow = (addr: string | undefined | null) => useQuery({
  queryKey: ["evmWindow", addr],
  queryFn: () => fetchEvmWindow(addr!),
  enabled: !!addr,
  staleTime: 15_000, retry: 1,
});
/** One multicall getBounty over every indexed id. */
export const useBounties = (ids: bigint[] | undefined) => useQuery({
  queryKey: ["bounties", ids?.map(String).join(",")],
  enabled: !!ids,
  queryFn: async () => {
    // diana has no multicall3 contract — plain parallel reads
    const res = await Promise.allSettled(ids!.map((id) =>
      httpClient.readContract({
        ...escrow, functionName: "getBounty", args: [id],
      })));
    return res.map((r, i) => ({
      id: ids![i]!,
      bounty: r.status === "fulfilled" ? r.value : null,
    }));
  },
  staleTime: 10_000,
});

/** The GitHub issue or pull request a bounty (or a form field) points at. */
export const useGithubItem = (w: WorkItem, opts: {
  staleTime?: number; enabled?: boolean; retry?: boolean | ((count: number, err: unknown) => boolean);
} = {}) => useQuery<GhIssue | GhPull>({
  queryKey: ["gh", w.kind === 1 ? "pull" : "issue", w.ownerRepo, Number(w.number)],
  queryFn: () => (w.kind === 1
    ? getPull(w.ownerRepo, Number(w.number)) : getIssue(w.ownerRepo, Number(w.number))),
  staleTime: opts.staleTime ?? 5 * 60_000,
  enabled: opts.enabled ?? true,
  retry: opts.retry ?? false,
});

export interface BountyTaskInfo {
  /** the parsed task block, or null for an ordinary code bounty */
  task: Task | null;
  /** set when the issue carries a malformed task block */
  invalid: string | null;
  pending: boolean;
}

const EMPTY_ITEM = { ownerRepo: "", kind: 0, number: 0 } as const;

/** The task block in an issue's body (issue bounties only; PR bounties are always code). */
export function useBountyTask(meta: BountyMeta | undefined): BountyTaskInfo {
  const issue = useGithubItem(meta ?? EMPTY_ITEM, { enabled: !!meta && meta.kind === 0 });
  if (!meta || meta.kind !== 0) return { task: null, invalid: null, pending: false };
  if (issue.isPending) return { task: null, invalid: null, pending: true };
  if (issue.error || !issue.data) return { task: null, invalid: null, pending: false };
  const parsed = parseTaskBlock((issue.data as GhIssue).body ?? null);
  if (!parsed) return { task: null, invalid: null, pending: false };
  if ("error" in parsed) return { task: null, invalid: parsed.error, pending: false };
  return { task: parsed.task, invalid: null, pending: false };
}

/** Latest block number, polled lightly; an error marks the network degraded. */
export const useBlockNumber = () => useQuery({
  queryKey: ["blockNumber"], queryFn: () => httpClient.getBlockNumber(),
  refetchInterval: 15_000, staleTime: 10_000, retry: false,
});
