import WalletRoot from "./WalletRoot";
import { Countdown, SectionLabel, shortAddr } from "../components/ui";
import { useBountyRole } from "./role";
import type { Bounty } from "../chain/client";
import type { BountyMeta } from "../chain/indexer";

function Note({ bounty, meta }: { bounty: Bounty; meta?: BountyMeta | undefined }) {
  const { role } = useBountyRole(bounty);
  const issue = meta ? `Fixes #${meta.number.toString()}` : "Fixes #<issue number>";
  const label = role === "claimant" ? "your claim is live" : "claimed";
  return (
    <div className="rounded-xl border border-leaf/50 bg-leaf/10 p-5">
      <SectionLabel tone="accent">{label}</SectionLabel>
      <p className="mt-2 text-sm text-gray">
        {role === "claimant" ? (
          <>Your claim is stamped on chain. Open a pull request whose description says <code className="font-mono text-ink">{issue}</code> before the claim expires; the verifiers review it once it is merged.</>
        ) : role === "funder" ? (
          <>Claimed by <span className="font-mono text-ink">{shortAddr(bounty.payee)}</span>. The verifiers check once the claimant's PR is merged; nothing for you to do unless the claim expires.</>
        ) : role === "verifier" ? (
          "Claimed — you'll review once the PR is merged."
        ) : (
          "This bounty is claimed and waiting on verifier verdicts."
        )}
      </p>
      <p className="mt-2 font-mono text-xs text-gray">
        claim expires in <Countdown to={bounty.claimExpiresAt} /> · round {bounty.claimRound.toString()}
      </p>
      {(role === "claimant" || role === "visitor") && (
        <p className="mt-2 text-xs text-gray">
          {role === "claimant"
            ? "If the claim lapses before a verdict, anyone can reopen the bounty and someone else may claim."
            : "Claim expired? Anyone can call Reopen to free the bounty for a new claim."}
        </p>
      )}
    </div>
  );
}

export default function ClaimedNote(props: { bounty: Bounty; meta?: BountyMeta | undefined }) {
  return <WalletRoot><Note {...props} /></WalletRoot>;
}
