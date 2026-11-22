import { useState } from "react";
import { getPull, getLinkedPrs, type GhPull } from "../../github/client";
import { parseGithubUrl } from "../../github/parse";
import { checkPull, type PrCheckItem } from "../../github/prcheck";
import { errorMessage } from "../../chain/errors";
import type { Bounty } from "../../chain/client";
import type { BountyMeta } from "../../chain/indexer";

export interface PrCheck {
  pr: GhPull; repo: string; number: number;
  checks: PrCheckItem[];
}

/** Look up a pull request (linked, pasted, or the item itself) and run the merge checks on it. */
export function usePrCheck(meta: BountyMeta, bounty: Bounty, identityLogin: string | null) {
  const [prUrl, setPrUrl] = useState("");
  const [prCheck, setPrCheck] = useState<PrCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<number[] | null>(null);

  const check = async (repo: string, prNumber: number) => {
    setBusy(true); setError(null);
    try {
      const pr = await getPull(repo, prNumber);
      const checks = checkPull(pr, {
        expectedRepo: meta.ownerRepo, prRepo: repo, deadline: bounty.deadline, identityLogin,
        ...(meta.kind === 0 ? { closesIssue: { ownerRepo: meta.ownerRepo, number: Number(meta.number) } } : {}) });
      setPrCheck({ pr, repo, number: prNumber, checks });
    } catch (e) {
      setPrCheck(null);
      setError(errorMessage(e, "PR lookup failed."));
    } finally { setBusy(false); }
  };

  const loadCandidates = async () => {
    setBusy(true); setError(null);
    try {
      if (meta.kind === 1) {
        setCandidates([Number(meta.number)]);
        await check(meta.ownerRepo, Number(meta.number));
      } else {
        setCandidates(await getLinkedPrs(meta.ownerRepo, Number(meta.number)));
      }
    } catch (e) {
      setError(errorMessage(e, "Timeline lookup failed."));
    } finally { setBusy(false); }
  };

  const checkPastedUrl = () => {
    const p = parseGithubUrl(prUrl);
    if (!p || p.kind !== 1) { setError("Paste a GitHub pull-request URL."); return; }
    void check(p.ownerRepo, p.number);
  };

  return { prUrl, setPrUrl, prCheck, error, busy, candidates, check, loadCandidates, checkPastedUrl };
}
