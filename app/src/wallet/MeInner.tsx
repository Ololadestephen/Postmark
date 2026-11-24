import { Suspense, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { creditOf, type Bounty } from "../chain/client";
import { githubItemLabel } from "../github/parse";
import { useIndex, useBounties, useGithubItem, usePqcStatus } from "../hooks/queries";
import { PageBody, PageHeader } from "../components/Page";
import { AnonDashboard } from "../pages/AnonDashboard";
import { StatusChip, Qor, Countdown, shortAddr, Skeleton } from "../components/ui";
import { useTxAction } from "../hooks/useTxAction";
import { useToast } from "../components/Toasts";
import { TxStatusPanel } from "./TxWidgets";
import { NativeSend } from "./NativeSend";
import TxActions from "./TxActions";
import { sameAddress } from "../chain/address";
import { nowSec } from "../chain/time";
import type { BountyMeta } from "../chain/indexer";

function Credits() {
  const { address } = useAccount();
  const credits = useQuery({
    queryKey: ["credits", address],
    queryFn: () => creditOf(address!),
    enabled: !!address, staleTime: 15_000,
  });
  const pqc = usePqcStatus(address);
  const tx = useTxAction();
  const toast = useToast();
  const [withdrawnFrom, setWithdrawnFrom] = useState<bigint | null>(null);
  const total = credits.data ? credits.data[0] + credits.data[1] : 0n;
  if (withdrawnFrom !== null && credits.data && total === 0n) setWithdrawnFrom(null);
  const done = () => { setWithdrawnFrom(total); toast({ kind: "success", title: "Withdrawn", text: "The QOR is on its way to your wallet." }); };
  if (!address) return null;
  if (credits.isPending) return <Skeleton className="h-28" />;
  const [ungated, gated] = credits.data ?? [0n, 0n];
  const withdrawn = withdrawnFrom !== null && withdrawnFrom === total;
  if (withdrawn && credits.isFetching) return <Skeleton className="h-28" />;
  if (ungated === 0n && gated === 0n) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-white p-6">
        <p className="text-sm text-gray">No credits yet.</p>
        <p className="mt-1 text-xs text-gray">Payouts, refunds and dispute winnings appear here once a bounty settles.</p>
      </div>
    );
  }
  return (
    <section aria-label="Withdrawable balance" className="rounded-2xl bg-ink p-6 text-paper">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper/60">withdrawable</div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <Qor wei={ungated + gated} className="text-4xl font-semibold tabular-nums tracking-tight" />
        <button disabled={tx.busy || withdrawn}
          onClick={() => void tx.run({ functionName: "withdraw", args: [], invalidates: [["credits", address]], onConfirmed: done })}
          className="rounded-lg bg-lime px-6 py-2.5 text-sm font-semibold text-ink hover:brightness-95 disabled:opacity-40">
          Withdraw
        </button>
      </div>
      <NativeSend tone="dark" call={{ functionName: "withdraw", args: [] }} sender={address} label="Withdraw with QoreX" disabled={tx.busy || withdrawn}
        invalidates={[["credits", address]]} onConfirmed={done} />
      <dl className="mt-4 flex gap-8 border-t border-paper/10 pt-4 text-sm">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/60">ungated</dt>
          <dd className="mt-1 font-mono"><Qor wei={ungated} /></dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/60">payee-gated</dt>
          <dd className="mt-1 font-mono"><Qor wei={gated} /></dd>
        </div>
      </dl>
      {gated > 0n && (
        <p className="mt-3 text-xs text-paper/70">
          Payee-gated credit withdraws only while your ML-DSA-87 key is live.
          {pqc.data && !pqc.data.live && " Yours is not registered — withdrawals will revert."}
        </p>
      )}
      <TxStatusPanel state={tx.state} onRetry={tx.retry} />
    </section>
  );
}

function WorkRef({ meta }: { meta: BountyMeta }) {
  const q = useGithubItem(meta);
  return (
    <div className="min-w-0">
      <span className="font-mono text-xs text-gray">{githubItemLabel(meta)}</span>
      {q.data?.title && <p className="truncate text-sm text-ink">{q.data.title}</p>}
    </div>
  );
}

type Row = { id: bigint; bounty: Bounty };

/** Bounties matching `pick`, rendered as linked rows; `aside` is the right-hand column. */
function BountyList({ pick, empty, skeleton, aside, extra }: {
  pick: (b: Bounty, me: string) => boolean;
  empty: ReactNode;
  skeleton: string;
  aside: (row: Row) => ReactNode;
  extra?: (row: Row) => ReactNode;
}) {
  const { address } = useAccount();
  const index = useIndex();
  const bounties = useBounties(index.data?.bountyIds);
  if (!address) return null;
  if (index.isPending || bounties.isPending) return <Skeleton className={skeleton} />;
  const mine: Row[] = [];
  for (const { id, bounty } of bounties.data ?? []) {
    if (bounty && pick(bounty, address)) mine.push({ id, bounty });
  }
  if (mine.length === 0) return <p className="text-sm text-gray">{empty}</p>;
  return (
    <ul className="space-y-3">
      {mine.map((row) => {
        const meta = index.data?.metaById.get(row.id);
        return (
          <li key={row.id.toString()} className="rounded-xl border border-ink/10 bg-white/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link to={`/bounty/${row.id}`} className="group flex min-w-0 items-center gap-3">
                <span className="font-mono text-deep group-hover:underline">#{row.id.toString()}</span>
                <StatusChip state={row.bounty.state} />
                {meta && <WorkRef meta={meta} />}
              </Link>
              {aside(row)}
            </div>
            {extra?.(row)}
          </li>
        );
      })}
    </ul>
  );
}

function FundedBounties() {
  return (
    <BountyList skeleton="h-40"
      pick={(b, me) => sameAddress(b.funder, me)}
      empty={<>You haven't funded a bounty yet. <Link className="text-deep underline" to="/create">Fund one.</Link></>}
      aside={({ bounty }) => (
        <div className="flex items-center gap-4 text-sm text-gray">
          <Qor wei={bounty.amount} />
          <span className="font-mono text-xs">deadline <Countdown to={bounty.deadline} /></span>
        </div>
      )}
      extra={({ id, bounty }) => (
        <Suspense fallback={null}>
          <TxActions id={id} bounty={bounty} />
        </Suspense>
      )} />
  );
}

function MyClaims() {
  return (
    <BountyList skeleton="h-28"
      pick={(b, me) => sameAddress(b.payee, me)}
      empty="No claims yet — claim a bounty from its page."
      aside={({ bounty }) => {
        const active = bounty.state === 1 && bounty.claimExpiresAt > nowSec();
        return (
          <div className="text-right font-mono text-xs text-gray">
            <div>{active ? "expires" : "claim"} <Countdown to={bounty.claimExpiresAt} /></div>
            <div className="text-gray">round {bounty.claimRound.toString()}</div>
          </div>
        );
      }} />
  );
}

const verifierAction = (state: number) =>
  state === 1 ? "review claim" : state === 3 ? "resolve dispute"
  : state === 2 ? "verdict pending" : null;

function VerifierBounties() {
  return (
    <BountyList skeleton="h-28"
      pick={(b, me) => b.verifiers.some((v) => sameAddress(v, me))}
      empty="You're not a verifier on any bounty."
      aside={({ id, bounty }) => {
        const action = verifierAction(bounty.state);
        return (
          <div className="flex items-center gap-4 text-sm">
            {action
              ? <Link to={`/bounty/${id}/review`} className="text-deep underline underline-offset-4">{action} →</Link>
              : <span className="font-mono text-xs text-gray">nothing due</span>}
          </div>
        );
      }} />
  );
}

const TABS = [
  { id: "funded", label: "Funded", Panel: FundedBounties },
  { id: "claims", label: "Claims", Panel: MyClaims },
  { id: "verifying", label: "Verifying", Panel: VerifierBounties },
] as const;

function useMyCounts(address: string) {
  const index = useIndex();
  const bounties = useBounties(index.data?.bountyIds);
  const rows = (bounties.data ?? []).flatMap((r) => (r.bounty ? [r.bounty] : []));
  return {
    funded: rows.filter((b) => sameAddress(b.funder, address)).length,
    claims: rows.filter((b) => sameAddress(b.payee, address)).length,
    verifying: rows.filter((b) => b.verifiers.some((v) => sameAddress(v, address))).length,
  };
}

export default function MeInner() {
  const { address, isConnected } = useAccount();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("funded");
  if (!isConnected || !address) {
    return <AnonDashboard />;
  }
  return <Dashboard address={address} tab={tab} setTab={setTab} />;
}

function Dashboard({ address, tab, setTab }: {
  address: `0x${string}`; tab: (typeof TABS)[number]["id"]; setTab: (t: (typeof TABS)[number]["id"]) => void;
}) {
  const counts = useMyCounts(address);
  const tiles: [string, number][] = [["funded", counts.funded], ["claims", counts.claims], ["verifying", counts.verifying]];
  return (
    <div>
      <PageHeader>
        <h1 className="font-sans text-4xl font-semibold tracking-tight text-ink">My bounties</h1>
        <p className="mt-1 font-mono text-sm text-charcoal">{shortAddr(address)}</p>
      </PageHeader>
      <PageBody className="space-y-6">
        <Credits />
        <div className="grid grid-cols-3 gap-3">
          {tiles.map(([label, n]) => (
            <div key={label} className="rounded-xl border border-ink/10 bg-white px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray">{label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{n}</div>
            </div>
          ))}
        </div>
        <div>
          <div role="tablist" aria-label="My bounties" className="flex gap-1 border-b border-ink/10">
            {TABS.map((t) => (
              <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${
                  tab === t.id ? "border-deep text-ink" : "border-transparent text-gray hover:text-ink"}`}>
                {t.label}
              </button>
            ))}
          </div>
          {TABS.map(({ id, Panel }) => (
            <div key={id} role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={tab !== id} className="pt-5">
              <Panel />
            </div>
          ))}
        </div>
      </PageBody>
    </div>
  );
}
