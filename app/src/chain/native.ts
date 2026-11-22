import { encodeFunctionData, hexToBytes } from "viem";
import { postmarkEscrowAbi } from "./abi";
import { ESCROW_ADDRESS, REST } from "./config";
import { errorMessage, QOREX_MAINNET_TEXT, QOREX_MAINNET_TITLE } from "./errors";

/** Escrow calls QoreX can send natively. Funding and disputes carry QOR, which a MsgCrossVMCall cannot attach. */
export type NativeCall =
  | { functionName: "claim"; args: readonly [bigint, `0x${string}`, `0x${string}`] }
  | { functionName: "finalize"; args: readonly [bigint] }
  | { functionName: "withdraw"; args: readonly [] };

/**
 * Off unless built with VITE_QOREX_NATIVE=1: QoreX currently refuses MsgCrossVMCall ("QoreX cannot show
 * what /qorechain.crossvm.v1.MsgCrossVMCall does, so it will not sign it"). Switch on once it can display it.
 */
export const qorexNativeEnabled = () => import.meta.env.VITE_QOREX_NATIVE === "1";

export const QOREX_UNSUPPORTED_TEXT = "QoreX can't sign this transaction type yet. Use MetaMask instead.";

export const CROSS_VM_TYPE_URL = "/qorechain.crossvm.v1.MsgCrossVMCall";

/** QoreX's native fee: 0.1 uqor per gas (100,000 uqor for a 1,000,000 gas limit on diana). */
export const UQOR_PER_GAS = 0.1;
/** QoreX clamps the gas hint to this range. */
export const QOREX_MIN_GAS = 100_000;
export const QOREX_MAX_GAS = 5_000_000;
/**
 * Gas a QoreX tx spends beyond a signature-less simulation: its hybrid ML-DSA-87 layer.
 * Measured on diana: a cross-VM nextBountyId simulates at 225,942 and used 279,763.
 */
export const HYBRID_LAYER_GAS = 60_000;
/** Cross-VM calls get at least this multiplier (@qorechain/sdk WASM_GAS_MULTIPLIER_MIN). */
export const CROSS_VM_GAS_MULTIPLIER = 1.3;

/**
 * Gas limits used when no simulation is possible. withdraw is fixed: 474,649 used of 1,000,000
 * on diana (tx 7DAF956F…). finalize simulates at about 366k; claim carries a 4,627-byte signature
 * and an on-chain ML-DSA-87 verification.
 */
export const NATIVE_GAS: Record<NativeCall["functionName"], number> = {
  claim: 1_500_000,
  finalize: 650_000,
  withdraw: 1_000_000,
};

/** ABI calldata for the escrow call, as bytes for the MsgCrossVMCall payload. */
export function escrowPayload(call: NativeCall): Uint8Array {
  return hexToBytes(encodeFunctionData({ abi: postmarkEscrowAbi, ...call } as never));
}

type ProtoType = { encode: (v: unknown) => { finish: () => Uint8Array }; fromPartial: (v: unknown) => unknown };

/** A protobuf-encoded MsgCrossVMCall from `sender` (qor1) into the escrow; no funds attached. */
export async function crossVmMessage(sender: string, call: NativeCall, escrow: string = ESCROW_ADDRESS) {
  const { crossvm, qorechainRegistry } = await import("@qorechain/sdk");
  const msg = crossvm.crossVmCall({
    sender, sourceVm: "cosmwasm", targetVm: "evm", targetContract: escrow.toLowerCase(),
    payload: escrowPayload(call), funds: [], async: false,
  });
  const type = qorechainRegistry().lookupType(msg.typeUrl) as unknown as ProtoType | undefined;
  if (!type) throw new Error(`${msg.typeUrl} is not in the QoreChain registry`);
  return { typeUrl: CROSS_VM_TYPE_URL, value: type.encode(type.fromPartial(msg.value)).finish() };
}

/** Gas limit to send for a simulated cross-VM call, inside QoreX's clamp. */
export function nativeGasLimit(simulated: number): number {
  const gas = Math.ceil((simulated + HYBRID_LAYER_GAS) * CROSS_VM_GAS_MULTIPLIER);
  return Math.min(QOREX_MAX_GAS, Math.max(QOREX_MIN_GAS, gas));
}

/** Most QOR a gas limit can cost. */
export const nativeMaxFeeQor = (gas: number) => (gas * UQOR_PER_GAS) / 1e6;

// protobuf wire helpers for the simulate request (TxRaw / AuthInfo / SignerInfo)
const varint = (n: number | bigint) => {
  let v = BigInt(n); const out: number[] = [];
  while (v > 127n) { out.push(Number(v & 127n) | 128); v >>= 7n; }
  out.push(Number(v));
  return out;
};
const field = (no: number, bytes: Uint8Array | number[]) => [...varint((no << 3) | 2), ...varint(bytes.length), ...bytes];
const fieldInt = (no: number, n: number | bigint) => [...varint(no << 3), ...varint(n)];
const utf8 = (s: string) => [...new TextEncoder().encode(s)];
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Unsigned tx bytes the node can simulate: one message, the account's public key, sequence, zero fee. */
export function simulationTxBytes(msg: { typeUrl: string; value: Uint8Array },
  account: { pubKeyType: string; pubKey: Uint8Array; sequence: bigint }): Uint8Array {
  const body = field(1, [...field(1, utf8(msg.typeUrl)), ...field(2, msg.value)]);
  const pubKey = [...field(1, utf8(account.pubKeyType)), ...field(2, field(1, account.pubKey))];
  const modeDirect = field(1, fieldInt(1, 1));
  const signerInfo = [...field(1, pubKey), ...field(2, modeDirect), ...fieldInt(3, account.sequence)];
  const fee = fieldInt(2, QOREX_MAX_GAS);
  const authInfo = [...field(1, signerInfo), ...field(2, fee)];
  return Uint8Array.from([...field(1, body), ...field(2, authInfo), ...field(3, new Uint8Array(65))]);
}

export class NativeSimulationError extends Error {
  constructor(message: string) { super(message); this.name = "NativeSimulationError"; }
}

/**
 * Simulate the call on diana as `sender` and return the gas it used. Null when the account has
 * no public key on chain yet (it never sent a tx) or the node can't be asked; throws
 * NativeSimulationError when the escrow would reject the call.
 */
export async function simulateNativeGas(sender: string, msg: { typeUrl: string; value: Uint8Array },
  fetchFn: typeof fetch = fetch): Promise<number | null> {
  try {
    const res = await fetchFn(`${REST}/cosmos/auth/v1beta1/accounts/${sender}`);
    if (!res.ok) return null;
    const acct = (await res.json() as { account?: { pub_key?: { "@type": string; key: string }; sequence?: string } }).account;
    if (!acct?.pub_key?.key) return null;
    const tx = simulationTxBytes(msg, {
      pubKeyType: acct.pub_key["@type"], pubKey: unb64(acct.pub_key.key),
      sequence: BigInt(acct.sequence ?? "0"),
    });
    const sim = await fetchFn(`${REST}/cosmos/tx/v1beta1/simulate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx_bytes: b64(tx) }),
    });
    const out = await sim.json() as { gas_info?: { gas_used?: string }; message?: string };
    if (out.gas_info?.gas_used) return Number(out.gas_info.gas_used);
    if (out.message && /execution reverted|EVM contract execution failed/i.test(out.message)) {
      throw new NativeSimulationError("The escrow would reject this call right now, so nothing was sent.");
    }
    return null;
  } catch (e) {
    if (e instanceof NativeSimulationError) throw e;
    return null;
  }
}

const OUT_OF_GAS = /out of gas/i;
const QOREX_REJECTION = /QoreX: .*(rejected|denied|cancel)/i;

/** Plain-English failure for a QoreX native send: rejection, wrong network or out of gas. */
export function explainNativeFailure(err: unknown, gasLimit: number): { kind: "rejected" | "network" | "gas" | "unsupported" | "other"; text: string } {
  const text = errorMessage(err);
  if (/cannot (show|display) what|will not sign it|cannot display/i.test(text)) {
    return { kind: "unsupported", text: QOREX_UNSUPPORTED_TEXT };
  }
  if (/does not match the active network|qorechain-vladi|QoreX is on mainnet/i.test(text)) {
    return { kind: "network", text: `${QOREX_MAINNET_TITLE}. ${QOREX_MAINNET_TEXT}` };
  }
  if (QOREX_REJECTION.test(text) || /user rejected|user denied|request rejected/i.test(text)) {
    return { kind: "rejected", text: "You cancelled the request in QoreX. Nothing was sent." };
  }
  if (OUT_OF_GAS.test(text)) return outOfGas(gasLimit);
  return { kind: "other", text };
}

const outOfGas = (gasLimit: number) => ({ kind: "gas" as const,
  text: `The call ran out of gas at the ${gasLimit.toLocaleString("en-US")} limit. Only the fee was spent; try again and QoreX will use a higher limit.` });

/** A committed tx with a non-zero code: 11 is the SDK's out-of-gas code. */
export function explainNativeCode(code: number, gasLimit: number): string {
  if (code === 11) return outOfGas(gasLimit).text;
  return `The transaction failed on chain (code ${code}). The escrow rejected the call; nothing changed but the fee.`;
}
