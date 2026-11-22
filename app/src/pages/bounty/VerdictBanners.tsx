import { Suspense, lazy } from "react";
import { AddressLink, Card, Countdown, Qor, SectionLabel } from "../../components/ui";
import { isZeroAddress } from "../../chain/address";
import { nowSec } from "../../chain/time";
import type { Bounty } from "../../chain/client";
import type { BountyMeta } from "../../chain/indexer";
import { useWalletWanted } from "../../components/walletIntent";

const DisputePanel = lazy(() => import("../../wallet/DisputePanel"));
const PendingActions = lazy(() => import("../../wallet/PendingActions"));

const outcomeName = (b: Bounty) => (b.initialOutcome === 0 ? "PAY" : "REFUND");

export function PendingVerdict({ id, bounty: b, meta }: { id: bigint; bounty: Bounty; meta: BountyMeta | undefined }) {
  const closed = nowSec() >= b.challengeEndsAt;
  const wanted = useWalletWanted();
  return (
    <Card>
      <SectionLabel>verdict pending</SectionLabel>
      <p className="mt-2 text-sm text-gray">
        Initial verdict: <span className="text-ink">{outcomeName(b)}</span>
        {!isZeroAddress(b.payee) && (
          <> to <AddressLink address={b.payee} className="font-mono hover:text-deep" />
          {" "}· <Qor wei={b.amount} /></>)}
        {" "}— the payout is frozen until the challenge window closes.
      </p>
      <p className="mt-1 font-mono text-xs text-gray">
        challenge window <Countdown to={b.challengeEndsAt} />
      </p>
      {closed && (
        <p role="status" className="mt-4 rounded-lg bg-lime px-4 py-3 text-sm font-semibold text-ink">
          Challenge window closed — ready to finalize. Anyone can finalize this payout.
        </p>
      )}
      <Suspense fallback={null}>
        {meta && (wanted
          ? <PendingActions id={id} bounty={b} meta={meta} />
          : <div className="mt-4"><DisputePanel id={id} bounty={b} meta={meta} /></div>)}
      </Suspense>
    </Card>
  );
}

export function DisputedBanner({ bounty: b }: { bounty: Bounty }) {
  return (
    <Card tone="warn">
      <SectionLabel tone="warn">payout frozen — disputed</SectionLabel>
      <p className="mt-2 text-sm text-gray">
        <AddressLink address={b.disputer} className="font-mono hover:text-deep" />
        {" "}bonded <Qor wei={b.bondAmount} /> against the
        {" "}{outcomeName(b)} verdict. The winner also
        takes the <Qor wei={b.challengeReward} /> challenge reward.
      </p>
      <p className="mt-1 break-all font-mono text-xs text-gray">
        dispute evidence {b.disputeEvidenceHash.slice(0, 26)}…
      </p>
    </Card>
  );
}
