import { formatUnits } from "viem";
import { explorerTx } from "../chain/config";
import type { TxState } from "../hooks/useTxAction";
import { useQorex } from "./qorex";
import { WindowSteps } from "./WindowSteps";

function MaxFee({ state }: { state: TxState }) {
  if (state.maxFeeWei === undefined) return null;
  return (
    <p className="mt-2 font-mono text-[11px] text-gray">
      max fee ≈ {Number(formatUnits(state.maxFeeWei, 18)).toFixed(4)} QOR
      {state.gasLimit !== undefined && ` (gas ≤ ${state.gasLimit.toString()})`}
    </p>
  );
}

export function WindowGuide({ guide, onRetry }: { guide: NonNullable<TxState["guide"]>; onRetry?: (() => void) | undefined }) {
  const qorex = useQorex();
  const capQor = (Math.ceil(Number(guide.suggestedValueUqor) / 10_000) / 100).toString();
  return (
    <div className="mt-3 rounded-lg border border-orange/40 bg-orange/10 p-4 text-left text-sm">
      <p className="font-medium text-orange">Open an EVM access window in QoreX:</p>
      <WindowSteps qorAddress={qorex.qorAddress} capQor={capQor} sendsValue onRetry={onRetry} />
    </div>
  );
}

export function TxStatusPanel({ state, onRetry }: { state: TxState; onRetry?: (() => void) | undefined }) {
  if (state.phase === "idle") return null;
  return (
    <div className="mt-6 rounded-xl border border-ink/10 bg-white/70 p-4 text-sm" role="status">
      {state.phase === "blocked" && (
        <>
          <p className="text-orange">{state.blockReason}</p>
          {state.guide && <WindowGuide guide={state.guide} onRetry={onRetry} />}
        </>
      )}
      {state.phase === "checking" && <p className="text-gray">Checking chain, key and window…</p>}
      {state.phase === "simulating" && <p className="text-gray">Simulating on diana…</p>}
      {state.phase === "ready" && <p className="text-gray">Ready — confirm in the wallet.</p>}
      {state.phase === "wallet" && <p className="text-gray">Waiting for the wallet…</p>}
      {(state.phase === "ready" || state.phase === "wallet" || state.phase === "submitted") && <MaxFee state={state} />}
      {state.phase === "submitted" && (
        <p className="text-gray">Submitted.{" "}
          <a className="text-deep underline underline-offset-4" href={explorerTx(state.hash!)} target="_blank" rel="noreferrer">
            {state.hash!.slice(0, 14)}…
          </a>
        </p>
      )}
      {state.phase === "confirming" && <p className="text-gray">Confirming on diana…</p>}
      {state.phase === "confirmed" && (
        <p className="text-deep">Confirmed.{" "}
          <a className="text-deep underline underline-offset-4" href={explorerTx(state.hash!)} target="_blank" rel="noreferrer">
            {state.hash!.slice(0, 14)}…
          </a>
        </p>
      )}
      {state.phase === "failed" && <p role="alert" className="text-orange">{state.error}</p>}
      {state.error && state.phase === "ready" && <p className="text-orange">{state.error}</p>}
    </div>
  );
}
