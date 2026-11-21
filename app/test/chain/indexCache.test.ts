import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.hoisted(() => ({ head: 10_000_000n, getLogs: vi.fn(), getBlockNumber: vi.fn() }));
vi.mock("../../src/chain/client", () => ({
  httpClient: { getBlockNumber: () => rpc.getBlockNumber(), getLogs: (a: unknown) => rpc.getLogs(a) },
}));
import { fetchIndex, getLogsChunked } from "../../src/chain/indexer";
import { DEPLOY_BLOCK } from "../../src/chain/config";

beforeEach(() => {
  localStorage.clear();
  rpc.getLogs.mockReset().mockResolvedValue([]);
  rpc.getBlockNumber.mockReset().mockResolvedValue(DEPLOY_BLOCK + 25_000n);
});

describe("index cache", () => {
  it("scans from the deploy block once, then only the new blocks", async () => {
    await fetchIndex();
    const first = rpc.getLogs.mock.calls.length;
    expect(first).toBeGreaterThanOrEqual(3); // 25k blocks in 10k chunks
    expect(rpc.getLogs.mock.calls[0]![0].fromBlock).toBe(DEPLOY_BLOCK);

    rpc.getBlockNumber.mockResolvedValue(DEPLOY_BLOCK + 25_100n);
    rpc.getLogs.mockClear();
    const state = await fetchIndex();
    expect(rpc.getLogs).toHaveBeenCalledTimes(1);
    const { fromBlock, toBlock } = rpc.getLogs.mock.calls[0]![0];
    expect(fromBlock).toBe(DEPLOY_BLOCK + 25_000n - 20n + 1n);
    expect(toBlock).toBe(DEPLOY_BLOCK + 25_100n);
    expect(state.lastBlock).toBe(DEPLOY_BLOCK + 25_100n);
  });

  it("fetches chunks concurrently and keeps them in order", async () => {
    let inFlight = 0, peak = 0;
    rpc.getLogs.mockImplementation(async (a: { fromBlock: bigint }) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return [{ n: a.fromBlock }];
    });
    const out = await getLogsChunked(0n, 80_000n) as unknown as { n: bigint }[];
    expect(peak).toBeGreaterThan(1);
    expect(out.map((l) => l.n)).toEqual([...out.map((l) => l.n)].sort((a, b) => (a < b ? -1 : 1)));
  });
});
