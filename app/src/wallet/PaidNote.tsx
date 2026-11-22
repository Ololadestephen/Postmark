import { Link } from "react-router";
import WalletRoot from "./WalletRoot";
import { useBountyRole } from "./role";
import type { Bounty } from "../chain/client";

function Body({ bounty }: { bounty: Bounty }) {
  const { role } = useBountyRole(bounty);
  if (role !== "claimant" || bounty.state !== 4) return null;
  return (
    <Link to="/me" className="block rounded-xl border border-leaf/50 bg-leaf/10 p-4 text-sm font-medium text-ink hover:bg-leaf/20">
      You were paid — withdraw from your Dashboard →
    </Link>
  );
}

export default function PaidNote(props: { bounty: Bounty }) {
  return <WalletRoot><Body {...props} /></WalletRoot>;
}
