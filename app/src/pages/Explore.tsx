import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useBounties, useIndex, useTotalLiabilities } from "../hooks/queries";
import {
  StatusChip, Countdown, Qor, Skeleton, EmptyState, ErrorState, AddressLink, STATE_NAMES,
} from "../components/ui";
import { PageBody, PageHeader } from "../components/Page";
import { statusStyle } from "../components/status";
import { explainError } from "../chain/errors";
import { isZeroAddress } from "../chain/address";
import { githubItemLabel, githubItemUrl } from "../github/parse";
import type { Bounty } from "../chain/client";
import type { BountyMeta } from "../chain/indexer";

type Filter = "all" | (typeof STATE_NAMES)[number];
type Sort = "newest" | "amount" | "deadline";
interface Row { id: bigint; bounty: Bounty; meta: BountyMeta | undefined }

const FILTERS: Filter[] = ["all", ...STATE_NAMES];
const SORTS: [Sort, string][] = [["newest", "Newest"], ["amount", "Amount"], ["deadline", "Deadline"]];
const total = (b: Bounty) => b.amount + b.challengeReward;

const SORTERS: Record<Sort, (a: Row, b: Row) => number> = {
  newest: (a, b) => (a.id < b.id ? 1 : -1),
  amount: (a, b) => (total(a.bounty) < total(b.bounty) ? 1 : -1),
  deadline: (a, b) => (a.bounty.deadline > b.bounty.deadline ? 1 : -1),
};

function WorkIcon({ kind }: { kind: number }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-gray" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      {kind === 1
        ? <><circle cx="4" cy="4" r="1.8" /><circle cx="4" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><path d="M4 6v4M12 10V7a2 2 0 00-2-2H8" /></>
        : <><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="1" fill="currentColor" /></>}
    </svg>
  );
}

function WorkLink({ meta }: { meta: BountyMeta | undefined }) {
  if (!meta) return <span className="text-gray">work reference unavailable</span>;
  return (
    <a className="inline-flex min-w-0 items-center gap-2 font-mono text-sm text-ink hover:text-deep"
      href={githubItemUrl(meta)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      <WorkIcon kind={meta.kind} />
      <span className="truncate">{githubItemLabel(meta)}</span>
    </a>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{children}</div>
    </div>
  );
}

function RowAccent({ state }: { state: number }) {
  return <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${statusStyle(state)?.bar ?? "bg-gray"}`} />;
}

function BountyTable({ rows }: { rows: Row[] }) {
  return (
    <table className="hidden w-full text-left text-sm md:table">
      <thead className="border-b border-ink/10 font-mono text-[10px] uppercase tracking-[0.18em] text-gray">
        <tr>
          <th className="px-4 py-3 font-medium">#</th><th className="px-4 py-3 font-medium">Work item</th>
          <th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Amount</th>
          <th className="px-4 py-3 font-medium">Deadline</th><th className="px-4 py-3 font-medium">Claimant</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-ink/5">
        {rows.map(({ id, bounty, meta }) => (
          <tr key={id.toString()} className="group relative hover:bg-paper">
            <td className="relative px-4 py-3 font-mono text-gray">
              <RowAccent state={bounty.state} />
              <Link to={`/bounty/${id}`} className="font-semibold text-ink after:absolute after:inset-0 hover:text-deep">#{id.toString()}</Link>
            </td>
            <td className="relative z-10 max-w-[18rem] px-4 py-3"><WorkLink meta={meta} />
              {meta?.workHashMismatch && <span className="ml-2 text-xs text-orange" title="On-chain workHash does not match the emitted metadata">⚠ hash mismatch</span>}
            </td>
            <td className="px-4 py-3"><StatusChip state={bounty.state} /></td>
            <td className="px-4 py-3 text-right font-mono"><Qor wei={total(bounty)} /></td>
            <td className="px-4 py-3 font-mono text-xs text-charcoal"><Countdown to={bounty.deadline} /></td>
            <td className="relative z-10 px-4 py-3 font-mono text-xs">
              {isZeroAddress(bounty.payee) ? <span className="text-gray">—</span> : <AddressLink address={bounty.payee} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BountyCards({ rows }: { rows: Row[] }) {
  return (
    <ul className="space-y-3 md:hidden">
      {rows.map(({ id, bounty, meta }) => (
        <li key={id.toString()} className="relative overflow-hidden rounded-xl border border-ink/10 bg-white p-4 pl-5">
          <RowAccent state={bounty.state} />
          <div className="flex items-center justify-between gap-3">
            <Link to={`/bounty/${id}`} className="font-mono text-sm font-semibold after:absolute after:inset-0">#{id.toString()}</Link>
            <StatusChip state={bounty.state} />
          </div>
          <div className="relative z-10 mt-3 min-w-0"><WorkLink meta={meta} /></div>
          <div className="mt-3 flex items-end justify-between gap-3 text-sm">
            <Qor wei={total(bounty)} className="font-mono text-base font-semibold" />
            <span className="font-mono text-xs text-gray">deadline <Countdown to={bounty.deadline} className="text-ink" /></span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Explore() {
  const index = useIndex();
  const ids = index.data?.bountyIds;
  const bounties = useBounties(ids);
  const liabilities = useTotalLiabilities();
  const [status, setStatus] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [q, setQ] = useState("");

  const all = useMemo<Row[]>(() => (bounties.data ?? []).flatMap(({ id, bounty }) =>
    bounty ? [{ id, bounty, meta: index.data?.metaById.get(id) }] : []), [bounties.data, index.data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const r of all) c[STATE_NAMES[r.bounty.state]!] = (c[STATE_NAMES[r.bounty.state]!] ?? 0) + 1;
    return c;
  }, [all]);

  const rows = useMemo(() => all
    .filter(({ bounty, meta }) => {
      if (status !== "all" && STATE_NAMES[bounty.state] !== status) return false;
      if (!q) return true;
      return !!meta?.ownerRepo.includes(q.toLowerCase()) || String(meta?.number ?? "").includes(q.trim());
    })
    .sort(SORTERS[sort]), [all, status, q, sort]);

  const loading = index.isPending || (ids !== undefined && ids.length > 0 && bounties.isPending);
  const error = index.error ?? bounties.error;

  return (
    <div>
      <PageHeader>
        <div>
          <h1 className="font-sans text-4xl font-semibold tracking-tight">Bounties</h1>
          <p className="mt-2 text-sm text-charcoal">GitHub issues funded in test QOR on diana.</p>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="bounties">{ids ? ids.length : "…"}</Stat>
            <Stat label="open">{loading ? "…" : counts.Open ?? 0}</Stat>
            <Stat label="paid">{loading ? "…" : counts.Paid ?? 0}</Stat>
            <Stat label="escrowed">{liabilities.data !== undefined ? <Qor wei={liabilities.data} /> : "…"}</Stat>
          </div>
        </div>
      </PageHeader>

      <PageBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button key={f} role="tab" aria-selected={status === f} onClick={() => setStatus(f)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition ${
                  status === f ? "bg-ink text-paper" : "border border-ink/15 bg-white text-charcoal hover:bg-ink/5"}`}>
                {f} <span className={status === f ? "text-paper/70" : "text-gray"}>{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="owner/repo or #" aria-label="Search bounties"
              className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 font-mono text-sm placeholder:text-gray" />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort bounties"
              className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-6">
          {loading && (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          )}
          {error && <ErrorState message={explainError(error)} onRetry={() => { void index.refetch(); void bounties.refetch(); }} />}
          {!loading && !error && rows.length === 0 && (
            <EmptyState title={ids && ids.length > 0 ? "Nothing matches those filters." : "No bounties yet."}>
              <p>The first stamp hasn't landed — payouts are test QOR, no monetary value.</p>
              <Link to="/create" className="mt-4 inline-block rounded-lg bg-deep px-5 py-2.5 text-sm font-medium text-paper hover:brightness-110">
                Fund a bounty
              </Link>
            </EmptyState>
          )}
          {!loading && !error && rows.length > 0 && (
            <>
              <div className="overflow-hidden rounded-xl border border-ink/10 bg-white md:block"><BountyTable rows={rows} /></div>
              <BountyCards rows={rows} />
            </>
          )}
        </div>
      </PageBody>
    </div>
  );
}
