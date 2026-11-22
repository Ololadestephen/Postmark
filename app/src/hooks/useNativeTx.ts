import { useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { NATIVE_CHAIN_ID } from "../chain/config";
import {
  crossVmMessage, explainNativeCode, explainNativeFailure, NATIVE_GAS, nativeGasLimit,
  nativeMaxFeeQor, QOREX_MAX_GAS, simulateNativeGas, type NativeCall,
} from "../chain/native";
import { assertQorexTestnet, useQorex } from "../wallet/qorex";

export interface NativeTxState {
  phase: "idle" | "estimating" | "ready" | "wallet" | "confirmed" | "failed";
  gasLimit?: number | undefined;
  maxFeeQor?: number | undefined;
  /** True when the gas limit comes from simulating this exact call on diana. */
  measured?: boolean | undefined;
  txHash?: string | undefined;
  error?: string | undefined;
  errorKind?: "rejected" | "network" | "gas" | "unsupported" | "other";
}

type Prepared = { call: NativeCall; msg: { typeUrl: string; value: Uint8Array } };

/** Send an escrow call through QoreX's native lane (MsgCrossVMCall): estimate, show the max fee, then send. */
export function useNativeTx() {
  const qorex = useQorex();
  const qc = useQueryClient();
  const [state, setState] = useState<NativeTxState>({ phase: "idle" });
  const prepared = useRef<Prepared | null>(null);
  const bump = useRef(1);

  const prepare = async (call: NativeCall) => {
    if (!qorex.qorAddress) return;
    setState({ phase: "estimating" });
    try {
      const msg = await crossVmMessage(qorex.qorAddress, call);
      prepared.current = { call, msg };
      let gas = NATIVE_GAS[call.functionName];
      let measured = false;
      if (call.functionName !== "withdraw") {
        const simulated = await simulateNativeGas(qorex.qorAddress, msg);
        if (simulated !== null) { gas = nativeGasLimit(simulated); measured = true; }
      }
      gas = Math.min(QOREX_MAX_GAS, Math.ceil(gas * bump.current));
      setState({ phase: "ready", gasLimit: gas, maxFeeQor: nativeMaxFeeQor(gas), measured });
    } catch (e) {
      prepared.current = null;
      setState({ phase: "failed", error: e instanceof Error ? e.message : String(e), errorKind: "other" });
    }
  };

  const send = async (opts: { onConfirmed?: (() => void) | undefined; invalidates?: QueryKey[] | undefined } = {}) => {
    const p = prepared.current;
    const gasLimit = state.gasLimit;
    if (!p || !qorex.native || gasLimit === undefined) return;
    setState((s) => ({ ...s, phase: "wallet" }));
    try {
      await assertQorexTestnet();
      const r = await qorex.native.signAndBroadcast({ chainId: NATIVE_CHAIN_ID, messages: [p.msg], gasLimit });
      if (r.code !== 0) {
        if (r.code === 11) bump.current = Math.min(bump.current * 1.5, 4);
        setState({ phase: "failed", txHash: r.txHash, error: explainNativeCode(r.code, gasLimit), errorKind: r.code === 11 ? "gas" : "other" });
        return;
      }
      bump.current = 1;
      prepared.current = null;
      setState({ phase: "confirmed", txHash: r.txHash, gasLimit, maxFeeQor: state.maxFeeQor, measured: state.measured });
      for (const key of opts.invalidates ?? [["bounty"], ["index"], ["credits"]]) void qc.invalidateQueries({ queryKey: key });
      opts.onConfirmed?.();
    } catch (e) {
      const f = explainNativeFailure(e, gasLimit);
      if (f.kind === "gas") bump.current = Math.min(bump.current * 1.5, 4);
      setState({ phase: "failed", error: f.text, errorKind: f.kind });
    }
  };

  const cancel = () => { prepared.current = null; setState({ phase: "idle" }); };

  const available = !!qorex.native && !!qorex.qorAddress
    && (qorex.native.capabilities?.includes("signAndBroadcast") ?? false);
  const busy = state.phase === "estimating" || state.phase === "wallet";
  return { state, prepare, send, cancel, available, busy, qorAddress: qorex.qorAddress };
}
