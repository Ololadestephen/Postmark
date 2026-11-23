import { useState } from "react";
import {
  chainReader, claimEventsOf, claimedAtFor,
} from "../../chain/onchainCheck";
import { getAllComments, findSubmissionComments, type SubmissionComment } from "../../github/client";
import { useIndex } from "../../hooks/queries";
import { errorMessage } from "../../chain/errors";
import type { Bounty } from "../../chain/client";
import type { BountyMeta } from "../../chain/indexer";

/** The claimant's submission comments on a testing/url task bounty — scanned on
 * demand, filtered to the claim comment's GitHub login. */
export function useSubmissions(id: bigint, bounty: Bounty, meta: BountyMeta, claimLogin: string | null) {
  const index = useIndex();
  const [submissions, setSubmissions] = useState<SubmissionComment[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [claimedAt, setClaimedAt] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true); setError(null);
    try {
      const ca = await claimedAtFor(
        bounty, claimEventsOf(index.data?.events ?? [], id), chainReader);
      setClaimedAt(ca);
      const comments = await getAllComments(meta.ownerRepo, Number(meta.number));
      const subs = findSubmissionComments(comments)
        .filter((s) => claimLogin !== null && s.githubLogin === claimLogin);
      setSubmissions(subs);
      if (subs.length === 1) setSelectedId(subs[0]!.commentId);
    } catch (e) {
      setError(errorMessage(e, "Lookup failed."));
    } finally { setBusy(false); }
  };

  const selected = submissions?.find((s) => s.commentId === selectedId) ?? null;
  return { submissions, selectedId, setSelectedId, selected, claimedAt, error, busy, load };
}

/** Per-submission timing checks (shared by the card's display and the PAY gate). */
export function submissionCheckItems(
  s: SubmissionComment, claimedAt: bigint | null, deadline: bigint, now: bigint,
): { label: string; ok: boolean }[] {
  return [
    { label: "posted after the claim", ok: claimedAt !== null && s.createdAt >= claimedAt },
    { label: "posted by the deadline", ok: s.createdAt <= deadline },
    { label: "posted in the past", ok: s.createdAt <= now },
  ];
}

export const submissionPayable = (
  s: SubmissionComment, claimedAt: bigint | null, deadline: bigint, now: bigint,
) => submissionCheckItems(s, claimedAt, deadline, now).every((i) => i.ok);
