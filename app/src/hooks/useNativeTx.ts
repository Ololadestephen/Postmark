import { useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { NATIVE_CHAIN_ID } from "../chain/config";
import { accountMismatchMessage } from "../wallet/signerPreference";
import {
  crossVmMessage, waitForNativeTx, explainNativeCode, explainNativeFailure, NATIVE_GAS, nativeGasLimit,
  nativeMaxFeeQor, QOREX_MAX_GAS, simulateNativeGas, type NativeCall,
} from "../chain/native";
import { assertQorexTestnet, useQorex } from "../wallet/qorex";

export interface NativeTxState {
  phase: "idle" | "estimating" | "ready" | "wallet" | "submitted" | "unconfirmed" | "confirmed" | "failed";
  gasLimit?: number | undefined;
  maxFeeQor?: number | undefined;
  /** True when the gas limit comes from simulating this exact call on diana. */
  measured?: boolean | undefined;
  txHash?: string | undefined;
  error?: string | undefined;
  errorKind?: "rejected" | "network" | "gas" | "unsupported" | "account" | "other";
}

type Prepared = { call: NativeCall; msg: { typeUrl: string; value: Uint8Array }; sender: string; expected?: string | undefined };

/** Send an escrow call through QoreX's native lane (MsgCrossVMCall): estimate, show the max fee, then send. */
export function useNativeTx() {
  const qorex = useQorex();
  const qc = useQueryClient();
  const [state, setState] = useState<NativeTxState>({ phase: "idle" });
  const prepared = useRef<Prepared | null>(null);
  const bump = useRef(1);

  /** The QoreX account must be the account the page acts for (the Dashboard's, the claim signer's). */
  const accountProblem = (expected: string | undefined) =>
    expected ? accountMismatchMessage(qorex.qorAddress, expected) : null;

  const prepare = async (call: NativeCall, expectedSender?: string) => {
    if (!qorex.qorAddress) return;
    const mismatch = accountProblem(expectedSender);
    if (mismatch) { prepared.current = null; setState({ phase: "failed", error: mismatch, errorKind: "account" }); return; }
    setState({ phase: "estimating" });
    try {
      const msg = await crossVmMessage(qorex.qorAddress, call);
      prepared.current = { call, msg, sender: qorex.qorAddress, expected: expectedSender };
      let gas = NATIVE_GAS[call.functionName];
      let measured = false;
      const simulated = await simulateNativeGas(qorex.qorAddress, msg);
      if (simulated !== null && call.functionName !== "withdraw") { gas = nativeGasLimit(simulated); measured = true; }
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
    const mismatch = p.sender !== qorex.qorAddress
      ? "QoreX switched accounts since the fee was shown. Nothing was sent; start again."
      : accountProblem(p.expected);
    if (mismatch) { prepared.current = null; setState({ phase: "failed", error: mismatch, errorKind: "account" }); return; }
    const kept = { gasLimit, maxFeeQor: state.maxFeeQor, measured: state.measured };
    const failCode = (code: number, txHash: string) => {
      if (code === 11) bump.current = Math.min(bump.current * 1.5, 4);
      setState({ phase: "failed", txHash, error: explainNativeCode(code, gasLimit), errorKind: code === 11 ? "gas" : "other" });
    };
    const confirm = (txHash: string) => {
      bump.current = 1;
      setState({ phase: "confirmed", txHash, ...kept });
      for (const key of opts.invalidates ?? [["bounty"], ["index"], ["credits"]]) void qc.invalidateQueries({ queryKey: key });
      opts.onConfirmed?.();
    };
    setState((s) => ({ ...s, phase: "wallet" }));
    try {
      await assertQorexTestnet();
      const r = await qorex.native.signAndBroadcast({ chainId: NATIVE_CHAIN_ID, messages: [p.msg], gasLimit });
      if (r.code !== 0) { failCode(r.code, r.txHash); return; }
      prepared.current = null;
      if (r.height !== undefined && r.height > 0) { confirm(r.txHash); return; }
      setState({ phase: "submitted", txHash: r.txHash, ...kept });
      const receipt = await waitForNativeTx(r.txHash);
      if (receipt.status === "pending") setState({ phase: "unconfirmed", txHash: r.txHash, ...kept });
      else if (receipt.code !== 0) failCode(receipt.code, r.txHash);
      else confirm(r.txHash);
    } catch (e) {
      const f = explainNativeFailure(e, gasLimit);
      if (f.kind === "gas") bump.current = Math.min(bump.current * 1.5, 4);
      setState({ phase: "failed", error: f.text, errorKind: f.kind });
    }
  };

  const cancel = () => { prepared.current = null; setState({ phase: "idle" }); };

  const available = !!qorex.native && !!qorex.qorAddress
    && (qorex.native.capabilities?.includes("signAndBroadcast") ?? false);
  const busy = state.phase === "estimating" || state.phase === "wallet" || state.phase === "submitted";
  return { state, prepare, send, cancel, available, busy, qorAddress: qorex.qorAddress };
}
