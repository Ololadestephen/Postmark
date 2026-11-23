import WalletRoot from "./WalletRoot";
import { Countdown, SectionLabel, shortAddr } from "../components/ui";
import { useBountyRole } from "./role";
import { useBountyTask } from "../hooks/queries";
import { ProofHelper } from "./ProofHelper";
import type { Bounty } from "../chain/client";
import type { BountyMeta } from "../chain/indexer";

const onchainType = (t: string | undefined) => t === "onchain-call" || t === "onchain-deploy";

function Note({ id, bounty, meta }: { id?: bigint | undefined; bounty: Bounty; meta?: BountyMeta | undefined }) {
  const { role } = useBountyRole(bounty);
  const info = useBountyTask(meta);
  const task = info.task && onchainType(info.task.type) ? info.task : null;
  const issue = meta ? `Fixes #${meta.number.toString()}` : "Fixes #<issue number>";
  const label = role === "claimant" ? "your claim is live" : "claimed";
  return (
    <div className="rounded-xl border border-leaf/50 bg-leaf/10 p-5">
      <SectionLabel tone="accent">{label}</SectionLabel>
      <p className="mt-2 text-sm text-gray">
        {role === "claimant" ? (
          task ? (
            task.type === "onchain-call"
              ? <>Your claim is stamped on chain. Send the call to <span className="font-mono text-ink">{task.contract}{task.function ? ` · ${task.function}` : ""}</span> from <span className="font-mono text-ink">{shortAddr(bounty.payee)}</span>, then post <code className="font-mono text-ink">postmark-proof v1 tx=0x…</code> on the issue before the claim expires.</>
              : <>Your claim is stamped on chain. Deploy the contract from <span className="font-mono text-ink">{shortAddr(bounty.payee)}</span>, then post <code className="font-mono text-ink">postmark-proof v1 tx=0x…</code> on the issue before the claim expires.</>
          ) : (
            <>Your claim is stamped on chain. Open a pull request whose description says <code className="font-mono text-ink">{issue}</code> before the claim expires; the verifiers review it once it is merged.</>
          )
        ) : role === "funder" ? (
          <>Claimed by <span className="font-mono text-ink">{shortAddr(bounty.payee)}</span>. The verifiers check once the claimant's {task ? "proof transaction lands" : "PR is merged"}; nothing for you to do unless the claim expires.</>
        ) : role === "verifier" ? (
          task ? "Claimed — you'll review once the proof transaction is posted."
            : "Claimed — you'll review once the PR is merged."
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
      {role === "claimant" && task && id !== undefined && <ProofHelper id={id} bounty={bounty} task={task} />}
    </div>
  );
}

export default function ClaimedNote(props: { id?: bigint | undefined; bounty: Bounty; meta?: BountyMeta | undefined }) {
  return <WalletRoot><Note {...props} /></WalletRoot>;
}
