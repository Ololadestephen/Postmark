// The verifier tool: check the claim, check the PR, build a verdict, sign it
// through a PqSigner, merge bundles and relay the quorum — all against chain
// truth (nonce, claimRound, dispute hashes are never user input).
import { Link } from "react-router";
import { useAccount } from "wagmi";
import { AddressLink, Card, SectionLabel } from "../components/ui";
import { useBountyRole } from "./role";
import WalletRoot from "./WalletRoot";
import { useTxAction } from "../hooks/useTxAction";
import { useToast } from "../components/Toasts";
import { qorexFailureToast } from "../chain/errors";
import { TxStatusPanel } from "./TxWidgets";
import { PHASE } from "../chain/verdict";
import { sameAddress } from "../chain/address";
import { useQorex } from "./qorex";
import { formatVerdictComment } from "../formats/verdictComment";
import { usePrefersLocalSigner } from "./signerPreference";
import { useIdentityCheck } from "./review/useIdentityCheck";
import { usePrCheck } from "./review/usePrCheck";
import { useProofCheck } from "./review/useProofCheck";
import { useVerdictBuilder } from "./review/useVerdictBuilder";
import { useVerdictBundle } from "./review/useVerdictBundle";
import { useVerdictSigning } from "./review/useVerdictSigning";
import { useBountyTask } from "../hooks/queries";
import { ClaimUnderReview, IdentityCard, PrCheckCard, ProofCheckCard } from "./review/ClaimChecks";
import { DecisionCard, SignCard } from "./review/VerdictCards";
import { BundleCard } from "./review/BundleCard";
import type { Bounty } from "../chain/client";
import type { BountyMeta } from "../chain/indexer";

function ReviewTool({ id, bounty, meta }: { id: bigint; bounty: Bounty; meta: BountyMeta }) {
  const { address } = useAccount();
  const qorex = useQorex();
  const preferLocal = usePrefersLocalSigner();
  const tx = useTxAction();
  const toast = useToast();

  const disputed = bounty.state === 3;
  const phase = disputed ? PHASE.DISPUTE : PHASE.INITIAL;

  const identity = useIdentityCheck(id, bounty, meta, disputed);
  const pr = usePrCheck(meta, bounty, identity.identity?.login ?? null);
  const taskInfo = useBountyTask(meta);
  const onchainTask = taskInfo.task && (taskInfo.task.type === "onchain-call" || taskInfo.task.type === "onchain-deploy")
    ? taskInfo.task : null;
  // the claim bound a brief but the issue no longer parses to a task
  const briefOrphaned = !taskInfo.pending && !taskInfo.error && !taskInfo.task && !!identity.identity?.brief;
  const proof = useProofCheck(id, bounty, onchainTask);
  const builder = useVerdictBuilder({
    id, bounty, phase, disputed, prCheck: pr.prCheck, disputeComment: identity.disputeComment,
    proof: onchainTask && proof.result ? { task: onchainTask, check: proof.result } : null,
  });
  const bundle = useVerdictBundle(id, bounty, phase, builder.built);
  const signing = useVerdictSigning(bounty, builder.built, bundle.recordSignature);

  const myVerifierIndex = bounty.verifiers.findIndex((v) => sameAddress(v, address));
  const canResolve = !disputed || identity.disputeComment !== null;

  const submit = () => {
    const v = builder.built?.verdict;
    if (!bundle.bundle || !v) return;
    tx.run({
      functionName: disputed ? "resolveDispute" : "submitVerdict",
      args: [{
        bountyId: v.bountyId, phase: v.phase, outcome: v.outcome, payee: v.payee,
        mergedAt: v.mergedAt, evidenceHash: v.evidenceHash, nonce: v.nonce, claimRound: v.claimRound,
      }, bundle.validIndices, bundle.validIndices.map((i) => bundle.bundle!.signatures[i]!)],
      onConfirmed: () => {
        toast({ kind: "success", title: disputed ? "Dispute resolved" : "Verdict stamped", text: disputed ? "Dispute resolved on chain." : "Verdict stamped on chain." });
        bundle.persist(null);
      },
      invalidates: [["bounty", id.toString()], ["index"], ["bounties"], ["nextBountyId"]],
    });
  };

  return (
    <div className="space-y-6">
      <ClaimUnderReview bounty={bounty} disputed={disputed} />
      <IdentityCard meta={meta} disputed={disputed} status={identity.status} error={identity.error}
        identity={identity.identity} disputeComment={identity.disputeComment} onScan={() => void identity.scan()} />
      {onchainTask ? <ProofCheckCard task={onchainTask} proof={proof} />
        : taskInfo.invalid || briefOrphaned ? (
          <Card>
            <SectionLabel>task block</SectionLabel>
            <p className="mt-2 text-sm text-orange">
              {taskInfo.invalid
                ? <>The issue's task block is invalid — {taskInfo.invalid}. The bots will abstain; there is no PR check to run.</>
                : <>The claim line carries a task brief but the issue has no task block now — the block was removed after the claim. The bots will abstain; there is no PR check to run.</>}
            </p>
          </Card>
        ) : <PrCheckCard meta={meta} pr={pr} />}
      <DecisionCard disputed={disputed}
        canPay={(onchainTask ? !!proof.result && proof.result.blockTimestamp !== null : !!pr.prCheck) && canResolve} canResolve={canResolve}
        scanDone={identity.status === "done"} builder={builder} built={builder.built} />
      {builder.built && (
        <SignCard myVerifierIndex={myVerifierIndex}
          usesQorex={!preferLocal && qorex.canSignArbitrary} checkFirst={!preferLocal && qorex.canSignArbitrary && !qorex.qorAddress}
          signing={signing.signing} error={signing.error} signedIndex={signing.signedIndex}
          onSign={() => (!preferLocal && qorex.canSignArbitrary && !qorex.qorAddress ? void qorex.connectAccount().catch((e) => toast(qorexFailureToast(e, { title: "Couldn't reach QoreX" }))) : void signing.sign())} />
      )}
      {builder.built && (
        <BundleCard bounty={bounty} disputed={disputed} bundleView={bundle} onSubmit={submit}
          onCopyComment={() => {
            const b = bundle.bundle;
            const i = signing.signedIndex;
            if (!b || i === null || !b.signatures[i]) {
              toast({ kind: "warning", title: "Sign first", text: "Sign the verdict with your own key, then copy it as a comment." });
              return;
            }
            void navigator.clipboard.writeText(formatVerdictComment(b, { signerIndex: i, signer: bounty.verifiers[i]!, kind: "human" }));
            toast({ kind: "success", title: "Copied", text: "Verdict comment copied — post it on the GitHub issue or PR." });
          }}
          onCopy={() => { void navigator.clipboard.writeText(bundle.bundleJson); toast({ kind: "success", title: "Copied", text: "Bundle copied." }); }}>
          <TxStatusPanel state={tx.state} onRetry={tx.retry} />
        </BundleCard>
      )}
    </div>
  );
}

function ReviewGate(props: { id: bigint; bounty: Bounty; meta: BountyMeta }) {
  const { address } = useAccount();
  const { role } = useBountyRole(props.bounty);
  if (!address) {
    return (
      <Card>
        <SectionLabel>verifiers only</SectionLabel>
        <p className="mt-2 text-sm text-charcoal">Connect a wallet to open the review tool. Only this bounty's three verifiers sign verdicts here.</p>
        <button type="button" onClick={() => document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click()}
          className="mt-3 rounded-lg bg-deep px-4 py-2 text-sm font-medium text-paper hover:brightness-110">
          Connect wallet
        </button>
      </Card>
    );
  }
  if (role !== "verifier") {
    return (
      <Card>
        <SectionLabel>verifiers only</SectionLabel>
        <p className="mt-2 text-sm text-charcoal">Only this bounty's three verifiers sign verdicts here.</p>
        <ul className="mt-2 space-y-1">
          {props.bounty.verifiers.map((v) => (
            <li key={v}><AddressLink address={v} className="font-mono text-xs hover:text-deep" /></li>))}
        </ul>
        <Link to={`/bounty/${props.id}`} className="mt-3 inline-block text-sm text-deep underline underline-offset-4">← back to the bounty</Link>
      </Card>
    );
  }
  return <ReviewTool {...props} />;
}

export default function ReviewPanel(props: { id: bigint; bounty: Bounty; meta: BountyMeta }) {
  return <WalletRoot><ReviewGate {...props} /></WalletRoot>;
}
