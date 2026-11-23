import { appendFileSync } from "node:fs";
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";
import { pqcKeyFromRecoveryCode, pqcSign, qoreAddresses } from "@qorechain/sdk";
import { mldsa87 } from "@qorechain/pqc";
import { pqcKeyStatus } from "../../app/src/chain/pqc";
import { assembleVerdict } from "../../app/src/chain/verdictCore";
import { verdictMessage } from "../../app/src/formats/messages";
import { BUNDLE_FORMAT, type VerdictBundle } from "../../app/src/formats/verdictBundle";
import { formatVerdictComment, parseVerdictComments, type ParsedVerdictComment } from "../../app/src/formats/verdictComment";
import type { BotConfig } from "./config";
import type { Bounty } from "../../app/src/chain/client";
import { STATE, decide, PHASE_DISPUTE, PHASE_INITIAL, type Decision } from "./decide";
import { selectQuorum, type OwnVerdict } from "./quorum";
import type { GhApi } from "./github";
import {
  chainNow, chainVerdictMessage, gasLimitFor, loadIndex, publicClient, readBounty, readNextId, simulate, walletFor,
  request, type Action,
} from "./chain";
import { chainReader, claimEventsOf } from "../../app/src/chain/onchainCheck";
import { openWindow, txOptions } from "./window";
import { mergeVerdictComments, postingTarget, readTargets } from "./boards";

export interface Row { id: string; state: string; decision: string; action: string }
export interface RunResult { exitCode: number; rows: Row[] }

const STATE_NAMES = ["Open", "Claimed", "Pending", "Disputed", "Paid", "Refunded"];
const verifyPq = (pub: Hex, message: Hex, sig: Hex) => mldsa87.verify(hexToBytes(pub), hexToBytes(message), hexToBytes(sig));

export async function run(cfg: BotConfig, gh: GhApi, log: (line: string) => void = console.log): Promise<RunResult> {
  if (!cfg.verifierKey || !cfg.pqcRecoveryCode) {
    log("verifier not configured (POSTMARK_VERIFIER_KEY / POSTMARK_VERIFIER_PQC missing); nothing to do");
    return { exitCode: 0, rows: [] };
  }
  const { account, wallet } = walletFor(cfg.verifierKey);
  const me = account.address as Address;
  const cosmos = qoreAddresses({ evm: me }).cosmos;
  const keypair = pqcKeyFromRecoveryCode(cfg.pqcRecoveryCode, cosmos);
  const live = await pqcKeyStatus(me);
  if (!live.live || live.pubkey.toLowerCase() !== bytesToHex(keypair.publicKey).toLowerCase()) {
    log(`refusing to run: the derived ML-DSA-87 key is not the live registered key of ${me}`);
    return { exitCode: 1, rows: [] };
  }
  log(`verifier ${me}${cfg.dryRun ? " (dry run)" : ""} on ${cfg.escrow}`);

  const next = await readNextId(cfg.escrow);
  const now = await chainNow();
  const all: { id: bigint; bounty: Bounty }[] = [];
  const mine: { id: bigint; bounty: Bounty }[] = [];
  for (let id = 1n; id < next; id++) {
    const bounty = await readBounty(cfg.escrow, id);
    all.push({ id, bounty });
    if (bounty.verifiers.some((v) => v.toLowerCase() === me.toLowerCase())) mine.push({ id, bounty });
  }
  if (mine.length === 0) {
    log(`no bounties name ${me} as a verifier (checked ${next - 1n})`);
    return { exitCode: 0, rows: [] };
  }
  const index = await loadIndex(cfg.escrow, cfg.deployBlock);
  const metaById = index.metaById;

  const rows: Row[] = [];
  const actions: Action[] = [];
  for (const { id, bounty } of mine) {
    const stateName = STATE_NAMES[bounty.state] ?? String(bounty.state);
    const row: Row = { id: `#${id}`, state: stateName, decision: "-", action: "-" };
    rows.push(row);
    try {
      if (bounty.state === STATE.Pending) {
        if (now >= bounty.challengeEndsAt) { actions.push({ kind: "finalize", id }); row.decision = "challenge window closed"; row.action = "finalize"; }
        else row.decision = "challenge window open";
        continue;
      }
      if (bounty.state !== STATE.Claimed && bounty.state !== STATE.Disputed) { row.decision = "nothing to do"; continue; }
      const m = metaById.get(id);
      if (!m) { row.decision = "abstain: no BountyWork event"; continue; }
      const meta = { ownerRepo: m.ownerRepo, kind: m.kind, number: Number(m.number) };
      const phase = bounty.state === STATE.Disputed ? PHASE_DISPUTE : PHASE_INITIAL;

      const work = { repo: meta.ownerRepo, number: meta.number };
      const lists: ParsedVerdictComment[][] = [];
      let commentsOk = true;
      const targets = readTargets(work, cfg.boards);
      for (const [i, t] of targets.entries()) {
        try { lists.push(parseVerdictComments(await gh.getComments(t.repo, t.number))); }
        catch { if (i === 0) commentsOk = false; } // a board that can't be read only means fewer candidates
      }
      const parsed = mergeVerdictComments(lists);

      const decision: Decision = await decide({
        id, bounty, meta, escrow: cfg.escrow, now, gh, reader: chainReader,
        takenEvidence: all.filter((o) => o.id !== id).map((o) => o.bounty.initialEvidenceHash),
        claimEvents: claimEventsOf(index.events, id),
      });
      let own: OwnVerdict | null = null;
      if (decision.kind === "abstain") {
        row.decision = `abstain: ${decision.reason}`;
      } else {
        const verdict = assembleVerdict({
          bountyId: id, bounty, phase, outcome: decision.kind === "pay" ? 0 : 1, evidenceHash: decision.evidenceHash,
          ...(decision.kind === "pay" ? { payee: decision.payee, mergedAt: decision.mergedAt } : {}),
        });
        const message = verdictMessage(verdict, 9800, cfg.escrow);
        if ((await chainVerdictMessage(cfg.escrow, verdict)) !== message) {
          row.decision = "abstain: local verdict message differs from the contract's";
        } else {
          const signature = `0x${Buffer.from(pqcSign(keypair.secretKey, hexToBytes(message))).toString("hex")}` as Hex;
          const index = bounty.verifiers.findIndex((v) => v.toLowerCase() === me.toLowerCase());
          own = { index, verdict, message, signature };
          row.decision = `${decision.kind.toUpperCase()} (${decision.summary})`;
          await maybePost(cfg, gh, work, parsed, own, me, commentsOk, log, row);
        }
      }

      const keys = await Promise.all(bounty.verifiers.map(async (v) => {
        try { const s = await pqcKeyStatus(v); return s.live ? s.pubkey : null; } catch { return null; }
      }));
      const q = await selectQuorum({ id, bounty, phase, escrow: cfg.escrow, own, comments: parsed, keys, humans: cfg.humans, verify: verifyPq });
      if (q.ok) {
        actions.push({ kind: phase === PHASE_DISPUTE ? "resolveDispute" : "submitVerdict", id,
          verdict: q.quorum.verdict, indices: q.quorum.indices, signatures: q.quorum.signatures });
        row.action = `relay quorum (signers ${q.quorum.indices.join(",")})`;
      } else if (row.action === "-") {
        row.action = `no relay: ${q.reason}`;
      }
    } catch (e) {
      row.decision = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const runnable: { a: Action; gas: bigint; row: Row }[] = [];
  for (const a of actions) {
    const row = rows.find((r) => r.id === `#${a.id}`)!;
    const why = await simulate(cfg.escrow, me, a);
    if (why) { row.action = `skipped (would revert: ${why})`; log(`#${a.id} ${a.kind} would revert: ${why}`); continue; }
    runnable.push({ a, gas: await gasLimitFor(cfg.escrow, me, a), row });
  }

  if (runnable.length > 0 && cfg.dryRun) {
    for (const r of runnable) { r.row.action = `dry run: would ${r.a.kind}`; }
  } else if (runnable.length > 0) {
    const session = await openWindow(cfg.verifierKey, cfg.pqcRecoveryCode, cfg.escrow, runnable.map((r) => r.gas));
    try {
      for (const r of runnable) {
        const hash = await wallet.writeContract({ ...request(cfg.escrow, r.a), ...txOptions(r.gas) } as never);
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        r.row.action = `${r.a.kind} ${receipt.status === "success" ? "ok" : "REVERTED"} ${hash}`;
        log(`#${r.a.id} ${r.row.action}`);
      }
    } finally {
      await session.close().catch((e) => log(`could not close the EVM window: ${e instanceof Error ? e.message : e}`));
    }
  }

  for (const r of rows) log(`${r.id} [${r.state}] ${r.decision} | ${r.action}`);
  writeSummary(rows);
  return { exitCode: 0, rows };
}

async function maybePost(
  cfg: BotConfig, gh: GhApi, work: { repo: string; number: number }, existing: ParsedVerdictComment[],
  own: OwnVerdict, me: Address, commentsOk: boolean, log: (l: string) => void, row: Row,
) {
  if (!cfg.postComments || cfg.dryRun) return;
  if (!commentsOk) return;
  const dup = existing.some((c) => c.bundle.message === own.message && String(own.index) in c.bundle.signatures);
  if (dup) return;
  const bundle: VerdictBundle = {
    format: BUNDLE_FORMAT, chainId: 9800, nativeChainId: "qorechain-diana", escrow: cfg.escrow,
    verdict: own.verdict, message: own.message, signatures: { [own.index]: own.signature },
  };
  const target = postingTarget(work, cfg.boards, cfg.githubRepository);
  if (!target) { log(`not posting: no verdict board in ${cfg.githubRepository ?? "this run's repository"} for ${work.repo}`); return; }
  try {
    await gh.postComment(target.repo, target.number, formatVerdictComment(bundle, { signerIndex: own.index, signer: me, kind: "bot" }));
    row.decision += ` · comment posted on ${target.repo}#${target.number}`;
  } catch (e) { log(`could not post the verdict comment: ${e instanceof Error ? e.message : e}`); }
}

function writeSummary(rows: Row[]) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path || rows.length === 0) return;
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const table = ["| Bounty | State | Decision | Action |", "|---|---|---|---|",
    ...rows.map((r) => `| ${r.id} | ${r.state} | ${esc(r.decision)} | ${esc(r.action)} |`)].join("\n");
  appendFileSync(path, `### Postmark verifier\n\n${table}\n`);
}
