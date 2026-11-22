import { Card, SectionLabel } from "../../components/ui";
import { REFUND_REASONS } from "../../formats/hashes";
import { AdvancedSigner } from "../AdvancedSigner";
import type { BuiltVerdict } from "../../chain/verdict";
import { AccountFix } from "../AccountFix";
import { ACCENT_BTN, Alert, GHOST_BTN, SOLID_BTN, TEXT_INPUT } from "./reviewUi";

export function DecisionCard({ disputed, canPay, canResolve, scanDone, builder, built }: {
  disputed: boolean; canPay: boolean; canResolve: boolean; scanDone: boolean;
  builder: {
    decision: "pay" | "refund" | null; error: string | null;
    refundReason: string; setRefundReason: (v: string) => void;
    refundUrl: string; setRefundUrl: (v: string) => void;
    buildDecision: (k: "pay" | "refund") => Promise<void>;
  };
  built: BuiltVerdict | null;
}) {
  return (
    <Card>
      <SectionLabel>{disputed ? "resolution verdict" : "verdict"}</SectionLabel>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void builder.buildDecision("pay")} disabled={!canPay}
          className={`${SOLID_BTN} px-4 py-2 text-sm`}>
          {disputed ? "Resolve PAY" : "PAY"}
        </button>
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <select value={builder.refundReason} onChange={(e) => builder.setRefundReason(e.target.value)}
            className="rounded-lg border border-ink/10 bg-paper px-2 py-2 font-mono text-xs text-ink">
            {REFUND_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input value={builder.refundUrl} onChange={(e) => builder.setRefundUrl(e.target.value)} placeholder="details URL (optional)"
            className={`min-w-0 w-full sm:w-56 ${TEXT_INPUT}`} />
          <button type="button" onClick={() => void builder.buildDecision("refund")} disabled={!canResolve}
            className={`${GHOST_BTN} px-4 py-2 text-sm`}>
            {disputed ? "Resolve REFUND" : "REFUND"}
          </button>
        </span>
      </div>
      {disputed && !canResolve && !scanDone && (
        <p className="mt-2 text-xs text-gray">Scan comments first — the dispute comment id feeds the resolution evidence.</p>
      )}
      {builder.error && <Alert>{builder.error}</Alert>}
      {built && (
        <div className="mt-3 rounded-lg border border-ink/10 bg-paper p-3 font-mono text-xs text-gray break-all">
          <div>phase {disputed ? "DISPUTE" : "INITIAL"} · outcome {builder.decision === "pay" ? "PAY" : "REFUND"}</div>
          <div>payee {built.verdict.payee} · mergedAt {built.verdict.mergedAt.toString()}</div>
          <div className="break-all">evidenceHash {built.verdict.evidenceHash}</div>
          <div>nonce {built.verdict.nonce.toString()} · claimRound {built.verdict.claimRound.toString()}</div>
          {disputed && <div className="break-all">binds dispute {built.verdict.disputedVerdictHash.slice(0, 18)}… + {built.verdict.disputeEvidenceHash.slice(0, 18)}…</div>}
          <div className="text-deep">message matches escrow.verdictMessage</div>
        </div>
      )}
    </Card>
  );
}

export function SignCard({ myVerifierIndex, usesQorex, checkFirst = false, mismatch = null, signing, error, signedIndex, onSign }: {
  myVerifierIndex: number; usesQorex: boolean; checkFirst?: boolean; mismatch?: string | null; signing: boolean;
  error: string | null; signedIndex: number | null; onSign: () => void;
}) {
  return (
    <Card tone="accent">
      <SectionLabel tone="accent">sign the verdict</SectionLabel>
      {myVerifierIndex >= 0 && (
        <p className="mt-2 text-xs text-gray">You are verifier #{myVerifierIndex + 1}.</p>
      )}
      {mismatch && <><Alert>{mismatch}</Alert><AccountFix /></>}
      <AdvancedSigner showPort>
        <p>The signer's address must be one of this bounty's verifiers.</p>
      </AdvancedSigner>
      <button type="button" onClick={onSign} disabled={signing || !!mismatch} className={`mt-3 ${ACCENT_BTN}`}>
        {signing ? "Signing…" : checkFirst ? "Check with QoreX" : usesQorex ? "Sign with QoreX" : "Sign with the local signer"}
      </button>
      {error && <Alert>{error}</Alert>}
      {signedIndex !== null && (
        <p className="mt-2 text-sm text-deep">Signature #{signedIndex} verified locally against the live key.</p>
      )}
    </Card>
  );
}
