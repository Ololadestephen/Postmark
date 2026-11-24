import { Link } from "react-router";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import WalletRoot from "./WalletRoot";
import { useBountyRole } from "./role";
import { creditOf, type Bounty } from "../chain/client";

function Body({ bounty }: { bounty: Bounty }) {
  const { address } = useAccount();
  const { role } = useBountyRole(bounty);
  const paid = role === "claimant" && bounty.state === 4;
  const credits = useQuery({
    queryKey: ["credits", address],
    queryFn: () => creditOf(address!),
    enabled: paid && !!address, staleTime: 15_000,
  });
  if (!paid || !credits.data) return null;
  if (credits.data[0] + credits.data[1] === 0n) {
    return <p className="rounded-xl border border-ink/10 bg-white p-4 text-sm text-charcoal">You were paid and have withdrawn everything.</p>;
  }
  return (
    <Link to="/me" className="block rounded-xl border border-leaf/50 bg-leaf/10 p-4 text-sm font-medium text-ink hover:bg-leaf/20">
      You were paid — withdraw from your Dashboard →
    </Link>
  );
}

export default function PaidNote(props: { bounty: Bounty }) {
  return <WalletRoot><Body {...props} /></WalletRoot>;
}
