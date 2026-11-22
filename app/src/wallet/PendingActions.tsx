import { lazy, Suspense } from "react";
import WalletRoot from "./WalletRoot";
import { useBountyRole } from "./role";
import type { Bounty } from "../chain/client";
import type { BountyMeta } from "../chain/indexer";

const DisputePanel = lazy(() => import("./DisputePanel"));

function Body({ id, bounty, meta }: { id: bigint; bounty: Bounty; meta: BountyMeta }) {
  const { role } = useBountyRole(bounty);
  const pay = bounty.initialOutcome === 0;
  if (role === "claimant" && pay) {
    return <p className="mt-4 text-sm text-charcoal">You're the payee. After the window closes and it's finalized, withdraw from your Dashboard.</p>;
  }
  if (role === "verifier") return null;
  return <div className="mt-4"><Suspense fallback={null}><DisputePanel id={id} bounty={bounty} meta={meta} /></Suspense></div>;
}

export default function PendingActions(props: { id: bigint; bounty: Bounty; meta: BountyMeta }) {
  return <WalletRoot><Body {...props} /></WalletRoot>;
}
