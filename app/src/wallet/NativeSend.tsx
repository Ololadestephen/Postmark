import type { QueryKey } from "@tanstack/react-query";
import { explorerTx } from "../chain/config";
import type { NativeCall } from "../chain/native";
import { qorexFailureToast } from "../chain/errors";
import { useNativeTx } from "../hooks/useNativeTx";
import { useToast } from "../components/Toasts";
import { useQorex } from "./qorex";

export const NATIVE_VALUE_NOTE =
  "Funding a bounty and posting a dispute bond still go through MetaMask: a QoreX native call can't attach QOR.";

const btn = "rounded-lg border border-deep/40 px-4 py-2 text-sm font-medium text-deep hover:bg-deep/5 disabled:cursor-not-allowed disabled:opacity-40";

/** "Send with QoreX": the same escrow call as a MsgCrossVMCall through QoreX, no MetaMask or EVM window. */
export function NativeSend({ call, label = "Send with QoreX", onConfirmed, invalidates, disabled, tone = "light" }: {
  call: NativeCall | null;
  label?: string;
  onConfirmed?: () => void;
  invalidates?: QueryKey[];
  disabled?: boolean;
  tone?: "light" | "dark";
}) {
  const qorex = useQorex();
  if (!qorex.native?.capabilities?.includes("signAndBroadcast")) return null;
  return <NativeSendInner {...{ call, label, onConfirmed, invalidates, disabled, tone }} />;
}

function NativeSendInner({ call, label, onConfirmed, invalidates, disabled, tone }: {
  call: NativeCall | null; label: string; onConfirmed?: (() => void) | undefined; invalidates?: QueryKey[] | undefined;
  disabled?: boolean | undefined; tone: "light" | "dark";
}) {
  const qorex = useQorex();
  const native = useNativeTx();
  const toast = useToast();
  const { state } = native;
  const muted = tone === "dark" ? "text-paper/70" : "text-gray";
  const link = (hash: string) => (
    <a className="underline underline-offset-4" href={explorerTx(hash)} target="_blank" rel="noreferrer">{hash.slice(0, 14)}…</a>
  );

  if (!native.available) {
    return (
      <div className="mt-3" data-testid="native-send">
        <button type="button" className={btn}
          onClick={() => void qorex.connectAccount().catch((e) => toast(qorexFailureToast(e, { title: "Couldn't reach QoreX" })))}>
          Link QoreX to send without MetaMask
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 text-sm" data-testid="native-send">
      {(state.phase === "idle" || state.phase === "confirmed" || state.phase === "failed") && (
        <button type="button" className={btn} disabled={disabled || !call}
          onClick={() => call && void native.prepare(call)}>
          {state.phase === "failed" ? "Try again with QoreX" : label}
        </button>
      )}
      {state.phase === "estimating" && <p className={muted}>Measuring gas on diana…</p>}
      {(state.phase === "ready" || state.phase === "wallet") && (
        <div className="rounded-lg border border-ink/10 bg-white/80 p-3 text-ink">
          <p className="font-mono text-xs">
            max fee ≈ {state.maxFeeQor!.toFixed(2)} QOR (gas ≤ {state.gasLimit!.toLocaleString("en-US")},{" "}
            {state.measured ? "measured for this call" : "fixed limit"})
          </p>
          {state.phase === "ready" ? (
            <div className="mt-2 flex gap-2">
              <button type="button" className="rounded-lg bg-deep px-4 py-2 text-sm font-medium text-paper hover:brightness-110"
                onClick={() => void native.send({ onConfirmed, invalidates })}>Confirm in QoreX</button>
              <button type="button" className="px-3 py-2 text-sm text-gray hover:text-ink" onClick={native.cancel}>Cancel</button>
            </div>
          ) : <p className="mt-2 text-gray">Waiting for QoreX…</p>}
        </div>
      )}
      {state.phase === "confirmed" && state.txHash && (
        <p className={`mt-2 ${tone === "dark" ? "text-lime" : "text-deep"}`}>Sent with QoreX and confirmed. {link(state.txHash)}</p>
      )}
      {state.phase === "failed" && (
        <p role="alert" className="mt-2 text-orange">
          {state.error}
          {state.txHash && <> {link(state.txHash)}</>}
        </p>
      )}
      <p className={`mt-2 text-xs ${muted}`}>
        Sends a MsgCrossVMCall from {native.qorAddress?.slice(0, 12)}…: no MetaMask, no EVM window. {NATIVE_VALUE_NOTE}
      </p>
    </div>
  );
}
