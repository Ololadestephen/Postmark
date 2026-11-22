import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { useBountyRoute } from "../hooks/useBountyRoute";
import { useGithubItem } from "../hooks/queries";
import { StatusChip, Skeleton, ErrorState, EmptyState, Qor } from "../components/ui";
import { explainError } from "../chain/errors";
import { PageBody, PageHeader } from "../components/Page";
import { ClaimIntro } from "./bounty/ClaimIntro";
import { requestWallet, useWalletWanted } from "../components/walletIntent";
import { nowSec } from "../chain/time";
import { Card, SectionLabel } from "../components/ui";
import { githubItemLabel } from "../github/parse";
import { GithubCard } from "./bounty/GithubCard";
import { BountyFacts } from "./bounty/BountyFacts";
import { PendingVerdict, DisputedBanner } from "./bounty/VerdictBanners";
import { Ruling, eventsFor } from "./bounty/Ruling";
import { Timeline } from "./bounty/Timeline";
import { Lifecycle } from "./bounty/Lifecycle";
import { AmountBreakdown, Deadlines, Verifiers } from "./bounty/Sidebar";
import type { Bounty } from "../chain/client";
import type { BountyMeta } from "../chain/indexer";

const TxActions = lazy(() => import("../wallet/TxActions"));
const ClaimPanel = lazy(() => import("../wallet/ClaimPanel"));
const ClaimedNote = lazy(() => import("../wallet/ClaimedNote"));
const FunderShare = lazy(() => import("../wallet/FunderShare"));
const VerifierReviewLink = lazy(() => import("../wallet/VerifierReviewLink"));
const PaidNote = lazy(() => import("../wallet/PaidNote"));

/** Static stand-in for the action panels: no wallet code loads until the visitor asks for it. */
function WalletPrompt({ bounty: b }: { bounty: Bounty }) {
  const now = nowSec();
  const text = b.state === STATE.Open && now < b.deadline ? null
    : b.state === STATE.Pending && now >= b.challengeEndsAt
      ? "Challenge window closed — ready to finalize. Connect a wallet to finalize this payout; anyone can."
    : b.state === STATE.Open || b.state === STATE.Claimed || b.state === STATE.Pending
      ? "Connect a wallet to see the actions available to you." : null;
  if (!text) return null;
  return (
    <Card tone="accent">
      <SectionLabel tone="accent">actions</SectionLabel>
      <p className="mt-3 text-sm text-charcoal">{text}</p>
      <button type="button" onClick={() => { requestWallet(); document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click(); }}
        className="mt-3 rounded-lg bg-deep px-4 py-2 text-sm font-medium text-paper hover:brightness-110">
        Connect wallet
      </button>
    </Card>
  );
}

const STATE = { Open: 0, Claimed: 1, Pending: 2, Disputed: 3, Paid: 4, Refunded: 5 } as const;

/** Work title: the GitHub title once loaded, otherwise owner/repo#n. */
function WorkTitle({ meta }: { meta: BountyMeta | undefined }) {
  const item = useGithubItem(meta ?? { ownerRepo: "", kind: 0, number: 0 }, { retry: false, enabled: !!meta });
  if (!meta) return <p className="mt-1 text-xl text-gray">Work reference unavailable</p>;
  return (
    <p className="mt-1 text-xl font-medium tracking-tight text-charcoal">
      {item.data?.title ?? githubItemLabel(meta)}
    </p>
  );
}

function Header({ id, bounty: b, meta }: { id: bigint; bounty: Bounty; meta: BountyMeta | undefined }) {
  return (
    <PageHeader>
      <div>
        <Link to="/explore" className="text-sm text-charcoal hover:text-ink">← all bounties</Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-sans text-3xl font-semibold tracking-tight text-ink">
                Bounty <span className="font-mono text-deep">#{id.toString()}</span>
              </h1>
              <StatusChip state={b.state} />
            </div>
            <WorkTitle meta={meta} />
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray">total locked</div>
            <Qor wei={b.amount + b.challengeReward} className="text-3xl font-semibold tabular-nums tracking-tight" />
          </div>
        </div>
        <div className="mt-6"><Lifecycle state={b.state} /></div>
      </div>
    </PageHeader>
  );
}

export default function BountyDetail() {
  const wanted = useWalletWanted();
  const { id, bounty, index, meta, notFound, loading } = useBountyRoute();

  if (id === undefined) {
    return <EmptyState title="Bad bounty id."><Link className="text-deep underline" to="/explore">Back to explore</Link></EmptyState>;
  }
  const b = bounty.data;
  const events = eventsFor(index.data?.events, id);
  const showDetail = !!b && !notFound;

  return (
    <div>
      {showDetail && <Header id={id} bounty={b} meta={meta} />}
      <PageBody>
        {!showDetail && <Link to="/explore" className="text-sm text-gray hover:text-ink">← all bounties</Link>}
        {loading && <Skeleton className="mt-6 h-64" />}
        {bounty.error && <div className="mt-6"><ErrorState message={explainError(bounty.error)} onRetry={() => void bounty.refetch()} /></div>}
        {notFound && !bounty.isPending && (
          <div className="mt-6"><EmptyState title={`Bounty #${id} doesn't exist.`}>
            <p>Nothing was ever stamped with that id on diana.</p>
          </EmptyState></div>
        )}
        {showDetail && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
            <div data-slot="verdict" className="order-1 min-w-0 space-y-6 empty:hidden lg:order-none lg:col-start-1 lg:row-start-1">
              {wanted && <Suspense fallback={null}><FunderShare bounty={b} /></Suspense>}
              {meta?.workHashMismatch && (
                <div role="alert" className="rounded-lg border border-salmon bg-salmon/25 p-3 font-mono text-xs text-ink">
                  Warning: emitted work metadata does not re-hash to the on-chain workHash. Do not trust this bounty.
                </div>
              )}
              {b.state === STATE.Claimed && (
                wanted ? <Suspense fallback={null}><ClaimedNote bounty={b} meta={meta} /></Suspense> : null
              )}
              {wanted && (b.state === STATE.Claimed || b.state === STATE.Disputed) && (
                <Suspense fallback={null}><VerifierReviewLink id={id} bounty={b} /></Suspense>
              )}
              {wanted && b.state === STATE.Paid && <Suspense fallback={null}><PaidNote bounty={b} /></Suspense>}
              {b.state === STATE.Pending && <PendingVerdict id={id} bounty={b} meta={meta} />}
              {b.state === STATE.Disputed && <DisputedBanner bounty={b} />}
              {(b.state === STATE.Paid || b.state === STATE.Refunded) && <Ruling state={b.state} events={events} />}
            </div>

            {/* below lg the aside is transparent so its two groups order into the main flow; from lg it is one sticky column */}
            <aside aria-label="Bounty summary"
              className="contents lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:block lg:min-w-0 lg:space-y-4 lg:sticky lg:top-24 lg:self-start">
              <div data-slot="actions" className="order-2 min-w-0 space-y-4 empty:hidden lg:order-none">
                {wanted
                  ? <Suspense fallback={null}><TxActions id={id} bounty={b} /></Suspense>
                  : <WalletPrompt bounty={b} />}
              </div>
              <div data-slot="facts" className="order-4 min-w-0 space-y-4 lg:order-none">
                <AmountBreakdown bounty={b} />
                <Deadlines bounty={b} />
                <Verifiers bounty={b} />
              </div>
            </aside>

            <div data-slot="story" className="order-3 min-w-0 space-y-6 lg:order-none lg:col-start-1 lg:row-start-2">
              {meta && <GithubCard ownerRepo={meta.ownerRepo} kind={meta.kind} number={meta.number} />}
              <Timeline events={events} />
              {b.state === STATE.Open && meta && (
                wanted
                  ? <Suspense fallback={null}><ClaimPanel id={id} bounty={b} meta={meta} /></Suspense>
                  : nowSec() < b.deadline && <ClaimIntro />
              )}
              <details className="rounded-xl border border-ink/10 bg-white p-5">
                <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.18em] text-gray">all fields</summary>
                <div className="mt-4"><BountyFacts bounty={b} /></div>
              </details>
            </div>
          </div>
        )}
      </PageBody>
    </div>
  );
}
