import { Link } from "react-router";
import WalletRoot from "./WalletRoot";
import { useBountyRole } from "./role";
import type { Bounty } from "../chain/client";

function Body({ id, bounty }: { id: bigint; bounty: Bounty }) {
  const { role, verifierIndex } = useBountyRole(bounty);
  if (role !== "verifier") return null;
  return (
    <Link to={`/bounty/${id}/review`}
      className="block rounded-xl border border-ink/10 bg-mustard/40 p-4 text-sm font-medium text-ink hover:bg-mustard/60">
      {bounty.state === 3
        ? `You're verifier #${verifierIndex + 1} on this bounty — this verdict is disputed; open the review tool to build a resolution →`
        : `You're verifier #${verifierIndex + 1} on this bounty — open the review tool →`}
    </Link>
  );
}

export default function VerifierReviewLink(props: { id: bigint; bounty: Bounty }) {
  return <WalletRoot><Body {...props} /></WalletRoot>;
}
