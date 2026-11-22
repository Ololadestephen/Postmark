import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { QOREX_DOWNLOAD_URLS } from "@qorechain/qorex-types";
import { PageBody, PageHeader } from "../components/Page";
import { Card, SectionLabel, shortAddr } from "../components/ui";
import { useToast } from "../components/Toasts";
import { tryQorToEvm } from "../chain/bech32";
import { VERIFIER_REGISTRY } from "../chain/config";
import { FAUCET_URL } from "../data/links";
import { VERIFIERS } from "../data/verifiers";
import { fetchSelfListed, usePqcStatus } from "../hooks/queries";
import { useQorex } from "../wallet/qorex";
import { formatListingComment, isGithubLogin, listingMessage, type ListingProblem } from "../formats/verifierListing";
import { getAllComments } from "../github/client";

const btn = "rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-sm font-medium hover:bg-ink/5 disabled:opacity-50";
const primary = "rounded-lg bg-deep px-4 py-2 text-sm font-medium text-paper hover:brightness-110 disabled:opacity-50";
const ext = { target: "_blank", rel: "noreferrer" } as const;
const REGISTRY_URL = `https://github.com/${VERIFIER_REGISTRY.ownerRepo}/issues/${VERIFIER_REGISTRY.issue}`;

const PROBLEM_TEXT: Record<ListingProblem | "none", string> = {
  none: "Not found yet. Post the comment, then check again.",
  "login-mismatch": "Found a line, but the comment author is not the GitHub username in it.",
  "key-not-live": "Found your line, but your post-quantum key is not live yet. Make one send in QoreX.",
  "bad-signature": "Found your line, but the signature does not verify for this address, username and deployment.",
  malformed: "Found a comment, but the line is not in the expected format.",
  curated: "This address is already on the curated list.",
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-ink/10 bg-white p-4">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs text-gray">{n}</span>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
      </div>
      <div className="mt-2 text-sm text-charcoal">{children}</div>
    </li>
  );
}

export default function VerifierJoin() {
  const qorex = useQorex();
  const toast = useToast();
  const qc = useQueryClient();
  const address = tryQorToEvm(qorex.qorAddress) as `0x${string}` | null;
  const status = usePqcStatus(address ?? undefined);
  const [login, setLogin] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"connect" | "sign" | "check" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const loginOk = isGithubLogin(login.trim());
  const keyLive = status.data?.live === true;
  const curated = address ? VERIFIERS.some((v) => v.address.toLowerCase() === address.toLowerCase()) : false;

  const fail = (title: string, e: unknown) =>
    toast({ kind: "error", title, text: e instanceof Error ? e.message : String(e) });

  const connect = async () => {
    setBusy("connect");
    try { await qorex.connectAccount(); } catch (e) { fail("Couldn't connect QoreX", e); } finally { setBusy(null); }
  };

  const sign = async () => {
    if (!address || !qorex.native || !qorex.qorAddress) return;
    setBusy("sign");
    try {
      const { signVerifierListing } = await import("../wallet/pqSigner");
      const sig = await signVerifierListing(qorex.native, qorex.qorAddress, listingMessage(address, login.trim()));
      setComment(formatListingComment(address, login.trim(), sig));
    } catch (e) { fail("Signing failed", e); } finally { setBusy(null); }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(comment);
    toast({ kind: "success", title: "Copied", text: "Paste it as a comment on the registry issue." });
  };

  const check = async () => {
    if (!address) return;
    setBusy("check");
    setResult(null);
    try {
      const [{ checkListing }, { mldsa87 }, { pqcKeyStatus }, comments] = await Promise.all([
        import("../formats/verifierListing"), import("@qorechain/pqc"), import("../chain/pqc"),
        getAllComments(VERIFIER_REGISTRY.ownerRepo, VERIFIER_REGISTRY.issue),
      ]);
      const mine = comments.filter((c) => c.body.toLowerCase().includes(address.toLowerCase())).reverse();
      let problem: ListingProblem | "none" = "none";
      let listed = false;
      for (const c of mine) {
        const r = await checkListing(c, {
          liveKey: async (a) => { const s = await pqcKeyStatus(a); return s.live ? s.pubkey : null; },
          verify: (k, m, s) => mldsa87.verify(k, m, s), curated: new Set(VERIFIERS.map((v) => v.address.toLowerCase())),
        });
        if (typeof r !== "string") { listed = true; break; }
        problem = r;
        break;
      }
      setResult(listed ? "listed" : PROBLEM_TEXT[problem]);
      if (listed) void qc.fetchQuery({ queryKey: ["selfListed"], queryFn: fetchSelfListed, staleTime: 0 }).catch(() => undefined);
    } catch (e) { fail("Couldn't check GitHub", e); } finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader>
        <div>
          <h1 className="font-sans text-4xl font-semibold tracking-tight text-ink">Become a verifier</h1>
          <p className="mt-2 text-sm text-charcoal">List yourself with one signed comment. No approval needed.</p>
        </div>
      </PageHeader>
      <PageBody className="max-w-3xl">
        <Card tone="plain" className="mb-6">
          <SectionLabel>What this means</SectionLabel>
          <p className="mt-2 text-sm text-charcoal">
            Self-listing proves you control a post-quantum key; funders choose whom to trust. You only review bounties
            whose funder picked you: next to the two bots that means signing when they disagree or a payout is disputed;
            with fewer bots, you review each claim.
          </p>
        </Card>
        <ol className="space-y-3">
          <Step n={1} title="Connect QoreX">
            {!qorex.installed ? (
              <div className="flex flex-wrap gap-2">
                <a className={primary} href={QOREX_DOWNLOAD_URLS.chrome} {...ext}>QoreX for Chrome</a>
                <a className={btn} href={QOREX_DOWNLOAD_URLS.firefox} {...ext}>Firefox</a>
                <a className={btn} href={QOREX_DOWNLOAD_URLS.safari} {...ext}>Safari</a>
              </div>
            ) : address ? (
              <p>Connected as <span className="font-mono">{shortAddr(address)}</span>. No EVM wallet needed.</p>
            ) : (
              <button type="button" className={primary} disabled={busy === "connect"} onClick={connect}>Connect QoreX</button>
            )}
          </Step>
          <Step n={2} title="Check your post-quantum key">
            {!address ? <p className="text-gray">Connect QoreX first.</p>
              : status.isPending ? <p className="text-gray">Checking…</p>
              : keyLive ? <p>Your key is live.</p>
              : (
                <div>
                  <p>Your key is not live yet. Get test QOR from the faucet and make one send in QoreX; that registers it.</p>
                  <a className={`${btn} mt-2 inline-block`} href={FAUCET_URL} {...ext}>Open the faucet</a>
                </div>
              )}
            {curated && <p className="mt-2 text-gray">This address is already on the curated list.</p>}
          </Step>
          <Step n={3} title="Your GitHub username">
            <input aria-label="GitHub username" value={login} onChange={(e) => setLogin(e.target.value)}
              placeholder="octocat" className="w-full max-w-xs rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm" />
            {login.trim() !== "" && !loginOk && <p className="mt-1 text-xs text-salmon">That is not a valid GitHub username.</p>}
            <p className="mt-1 text-xs text-gray">You must post the comment from this account; reposted lines from other accounts are ignored.</p>
          </Step>
          <Step n={4} title="Sign with QoreX">
            <button type="button" className={primary} disabled={!address || !keyLive || !loginOk || busy === "sign"} onClick={sign}>
              Sign with QoreX
            </button>
            {comment && (
              <div className="mt-3">
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-ink p-3 font-mono text-[11px] text-paper">{comment}</pre>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={primary} onClick={copy}>Copy comment</button>
                  <a className={btn} href={`${REGISTRY_URL}#new_comment_field`} {...ext}>Open the registry issue</a>
                </div>
              </div>
            )}
          </Step>
          <Step n={5} title="Check my listing">
            <button type="button" className={btn} disabled={!address || busy === "check"} onClick={check}>Check my listing</button>
            {result && (
              <p role="status" className="mt-2">
                {result === "listed" ? "You're listed. Funders will see you under self-listed verifiers." : result}
              </p>
            )}
          </Step>
        </ol>
        <p className="mt-6 text-sm text-gray">
          To leave the list, delete your comment. Back to <Link className="text-deep underline underline-offset-4" to="/start">Get started</Link>.
        </p>
      </PageBody>
    </div>
  );
}
