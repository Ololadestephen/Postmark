import { AddressLink, Card, Countdown, SectionLabel } from "../../components/ui";
import { githubItemLabel, githubItemUrl } from "../../github/parse";
import { explorerTx } from "../../chain/config";
import { briefHashOf, type Task } from "../../github/task";
import type { SubmissionComment } from "../../github/client";
import { submissionCheckItems } from "./useSubmissions";
import type { Bounty } from "../../chain/client";
import type { BountyMeta } from "../../chain/indexer";
import type { ClaimIdentity, DisputeComment } from "./useIdentityCheck";
import type { PrCheck } from "./usePrCheck";
import type { ProofCheck } from "./useProofCheck";
import { ACCENT_BTN, Alert, COMMENT_LINK, GHOST_BTN, TEXT_INPUT } from "./reviewUi";

export function ClaimUnderReview({ bounty, disputed }: { bounty: Bounty; disputed: boolean }) {
  return (
    <Card>
      <SectionLabel>{disputed ? "disputed claim" : "claim under review"}</SectionLabel>
      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4 font-mono text-sm">
        <div><div className="text-[10px] uppercase text-gray">claimant</div>
          <AddressLink address={bounty.payee} className="text-ink hover:text-deep" /></div>
        <div><div className="text-[10px] uppercase text-gray">round</div><span className="text-ink">{bounty.claimRound.toString()}</span></div>
        <div><div className="text-[10px] uppercase text-gray">{disputed ? "challenge ends" : "claim expires"}</div>
          <Countdown to={disputed ? bounty.challengeEndsAt : bounty.claimExpiresAt} /></div>
        <div><div className="text-[10px] uppercase text-gray">identity hash</div>
          <span className="text-ink">{bounty.payeeIdentityHash.slice(0, 18)}…</span></div>
      </div>
      {disputed && (
        <p className="mt-3 text-xs text-gray">
          The initial verdict ({bounty.initialOutcome === 0 ? "PAY" : "REFUND"}) is frozen.
          A DISPUTE verdict that changes the outcome <em>upholds</em> the dispute — the disputer
          gets bond + challenge reward. One that repeats it <em>rejects</em> the dispute — the bond
          goes to the payee (or funder if none) and the reward to the funder.
        </p>
      )}
    </Card>
  );
}

export function IdentityCard({ meta, disputed, status, error, identity, disputeComment, onScan }: {
  meta: BountyMeta; disputed: boolean; status: string; error: string | null;
  identity: ClaimIdentity | null; disputeComment: DisputeComment | null; onScan: () => void;
}) {
  return (
    <Card>
      <SectionLabel>identity check</SectionLabel>
      <p className="mt-2 text-sm text-gray">
        Scan <a className="text-deep underline underline-offset-4" href={githubItemUrl(meta)} target="_blank" rel="noreferrer">
          {githubItemLabel(meta)}</a> comments for
        the claimant's <code className="text-ink">postmark-claim v1</code> line
        {disputed && " and the disputer's postmark-dispute line"}.
      </p>
      <button type="button" onClick={onScan} disabled={status === "scanning"}
        className={`mt-3 ${ACCENT_BTN}`}>
        {status === "scanning" ? "Scanning…" : "Scan comments"}
      </button>
      {error && <Alert>{error}</Alert>}
      {identity && (
        <p className="mt-2 text-sm">
          {identity.matches
            ? <span className="text-deep">identity matches — @{identity.login}, comment {identity.commentId.toString()}</span>
            : <span className="text-orange">identity mismatch — recomputed hash ≠ stored payeeIdentityHash (@{identity.login})</span>}
          {" "}<a className={COMMENT_LINK} href={identity.url} target="_blank" rel="noreferrer">comment</a>
        </p>
      )}
      {disputed && status === "done" && (
        disputeComment
          ? <p className="mt-2 text-sm text-gray">dispute comment by @{disputeComment.login} ·{" "}
              <a className={COMMENT_LINK} href={disputeComment.url} target="_blank" rel="noreferrer">comment {disputeComment.commentId.toString()}</a></p>
          : <p className="mt-2 text-sm text-orange">No comment re-hashes to the stored disputeEvidenceHash — resolution evidence can't be built.</p>
      )}
    </Card>
  );
}

export function PrCheckCard({ meta, pr }: { meta: BountyMeta; pr: {
  prUrl: string; setPrUrl: (v: string) => void; prCheck: PrCheck | null; error: string | null;
  busy: boolean; candidates: number[] | null; check: (repo: string, n: number) => Promise<void>;
  loadCandidates: () => Promise<void>; checkPastedUrl: () => void;
} }) {
  const failed = pr.prCheck?.checks.filter((c) => !c.ok).length ?? 0;
  return (
    <Card>
      <SectionLabel>pull request check</SectionLabel>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void pr.loadCandidates()} disabled={pr.busy}
          className={`${GHOST_BTN} px-3 py-2 text-sm`}>
          {meta.kind === 1 ? "Check this PR" : "Find linked PRs"}
        </button>
        {meta.kind === 0 && (
          <span className="flex flex-wrap items-center gap-2 text-sm text-gray">
            or
            <input value={pr.prUrl} onChange={(e) => pr.setPrUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/9"
              className={`min-w-0 w-full sm:w-72 ${TEXT_INPUT}`} />
            <button type="button" onClick={pr.checkPastedUrl} disabled={pr.busy}
              className={`${GHOST_BTN} px-3 py-2 text-sm`}>check</button>
          </span>
        )}
      </div>
      {pr.candidates && meta.kind === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {pr.candidates.length === 0 && <p className="text-sm text-gray">No cross-referenced PRs — paste one.</p>}
          {pr.candidates.map((n) => (
            <button key={n} type="button" onClick={() => void pr.check(meta.ownerRepo, n)}
              className="rounded-full border border-ink/15 px-3 py-1 font-mono text-xs text-ink hover:border-salmon/50">
              #{n}
            </button>
          ))}
        </div>
      )}
      {pr.error && <Alert>{pr.error}</Alert>}
      {pr.prCheck && (
        <ul className="mt-3 space-y-1 text-sm">
          {pr.prCheck.checks.map((c) => (
            <li key={c.label} className={c.ok ? "text-deep" : "text-orange"}>
              {c.ok ? "✓" : "✗"} {c.label}
            </li>
          ))}
          <li className="text-gray font-mono text-xs pt-1">
            {pr.prCheck.repo}#{pr.prCheck.number} · by @{pr.prCheck.pr.user.login}
            {pr.prCheck.pr.merged_at && ` · merged ${new Date(pr.prCheck.pr.merged_at).toLocaleString()}`}
          </li>
        </ul>
      )}
      {failed > 0 && (
        <p className="mt-2 text-xs text-orange">{failed} check{failed > 1 ? "s" : ""} failed — warnings only; the verdict is your judgment.</p>
      )}
    </Card>
  );
}

export function ProofCheckCard({ task, proof }: { task: Task; proof: {
  txHash: string; setTxHash: (v: string) => void; result: ProofCheck | null;
  error: string | null; busy: boolean; check: () => Promise<void>;
} }) {
  const failed = proof.result?.checks.filter((c) => !c.ok).length ?? 0;
  return (
    <Card>
      <SectionLabel>proof transaction check</SectionLabel>
      <p className="mt-2 text-sm text-gray">
        Task: <span className="text-ink">{task.type}</span>
        {task.contract && <> · <span className="font-mono text-ink">{task.contract}</span></>}
        {task.function && <> · <code className="font-mono text-ink">{task.function}</code></>}
        {task.codehash && <> · codehash <span className="font-mono text-ink">{task.codehash.slice(0, 14)}…</span></>}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={proof.txHash} onChange={(e) => proof.setTxHash(e.target.value)}
          placeholder="0x… proof transaction hash"
          className={`min-w-0 w-full sm:w-96 ${TEXT_INPUT}`} />
        <button type="button" onClick={() => void proof.check()} disabled={proof.busy}
          className={`${GHOST_BTN} px-3 py-2 text-sm`}>
          {proof.busy ? "Checking…" : "Check"}
        </button>
      </div>
      {proof.error && <Alert>{proof.error}</Alert>}
      {proof.result && (
        <ul className="mt-3 space-y-1 text-sm">
          {proof.result.checks.map((c) => (
            <li key={c.label} className={c.ok ? "text-deep" : "text-orange"}>
              {c.ok ? "✓" : "✗"} {c.label}
            </li>
          ))}
          <li className="text-gray font-mono text-xs pt-1">
            <a className={COMMENT_LINK} href={explorerTx(proof.result.txHash)} target="_blank" rel="noreferrer">
              tx {proof.result.txHash.slice(0, 14)}…
            </a>
            {proof.result.blockTimestamp !== null && ` · block time ${new Date(Number(proof.result.blockTimestamp) * 1000).toLocaleString()}`}
          </li>
        </ul>
      )}
      {failed > 0 && (
        <p className="mt-2 text-xs text-orange">{failed} check{failed > 1 ? "s" : ""} failed — warnings only; the verdict is your judgment.</p>
      )}
    </Card>
  );
}

export function SubmissionsCard({ task, brief, scanned, login, itemUrl, subs, deadline, now }: {
  task: Task;
  /** the claim comment's brief hash (null until the identity scan runs) */
  brief: string | null;
  /** whether the identity scan finished and the login it found */
  scanned: boolean; login: string | null;
  itemUrl: string;
  subs: {
    submissions: SubmissionComment[] | null;
    selectedId: number | null; setSelectedId: (n: number) => void;
    claimedAt: bigint | null; error: string | null; busy: boolean; load: () => Promise<void>;
  };
  deadline: bigint; now: bigint;
}) {
  const briefItem = !scanned ? null
    : !brief ? { label: "the claim line has a task brief", ok: false, note: "the claim is not bound to this task — PAY stays off" }
    : { label: "claim brief matches the issue's task block", ok: brief === briefHashOf(task),
        note: "the brief changed after the claim" };
  const selected = subs.submissions?.find((s) => s.commentId === subs.selectedId) ?? null;
  return (
    <Card>
      <SectionLabel>submission check — human-judged task</SectionLabel>
      <p className="mt-2 text-sm text-gray">
        Task: <span className="text-ink">{task.type}</span>. The bots abstain on human-judged
        tasks — the verdict is your call, checked against the submission comments.
      </p>
      {briefItem && (
        <p className={`mt-2 text-sm ${briefItem.ok ? "text-deep" : "text-orange"}`}>
          {briefItem.ok ? "✓" : "✗"} {briefItem.label}{!briefItem.ok ? ` — ${briefItem.note}` : ""}
        </p>
      )}
      {!scanned && (
        <p className="mt-2 text-sm text-gray">Scan comments above first — submissions are matched to the claim comment's GitHub login.</p>
      )}
      {scanned && (
        <button type="button" onClick={() => void subs.load()} disabled={subs.busy}
          className={`mt-3 ${GHOST_BTN} px-3 py-2 text-sm`}>
          {subs.busy ? "Scanning…" : "Find submissions"}
        </button>
      )}
      {subs.error && <Alert>{subs.error}</Alert>}
      {subs.submissions && subs.submissions.length === 0 && (
        <p className="mt-2 text-sm text-gray">No postmark-submission lines from @{login ?? "the claimant"} on the issue.</p>
      )}
      {subs.submissions && subs.submissions.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {subs.submissions.map((s) => (
            <li key={s.commentId}>
              <label className="flex flex-wrap items-center gap-2 cursor-pointer">
                <input type="radio" name="submission" checked={subs.selectedId === s.commentId}
                  onChange={() => subs.setSelectedId(s.commentId)} />
                <a className="font-mono text-deep underline underline-offset-4" href={s.url} target="_blank" rel="noreferrer">
                  {s.url.length > 60 ? `${s.url.slice(0, 57)}…` : s.url}
                </a>
                <a className={COMMENT_LINK} href={`${itemUrl}#issuecomment-${s.commentId}`} target="_blank" rel="noreferrer">comment</a>
                <span className="text-gray">{new Date(Number(s.createdAt) * 1000).toLocaleString()}</span>
                {s.edited && <span className="rounded-full bg-mustard/50 px-2 py-0.5 text-[10px] text-ink">edited after posting</span>}
              </label>
              {subs.selectedId === s.commentId && (
                <ul className="mt-1 space-y-1 pl-6">
                  {submissionCheckItems(s, subs.claimedAt, deadline, now).map((c) => (
                    <li key={c.label} className={c.ok ? "text-deep" : "text-orange"}>
                      {c.ok ? "✓" : "✗"} {c.label}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {selected === null && subs.submissions && subs.submissions.length > 1 && (
        <p className="mt-2 text-xs text-gray">Pick the submission you're paying for.</p>
      )}
    </Card>
  );
}
