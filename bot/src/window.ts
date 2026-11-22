// One scoped EVM authorisation window per run, opened and closed in-process with the SDK
// (ported from scripts/window.mjs; no profile files).
import {
  EthNativeSigner, classifyEvmWindowRejection, closeEvmWindowMsg, openEvmWindowMsg, unifiedAccountFromSeed,
} from "@qorechain/sdk";
import type { Address, Hex } from "viem";
import { hexToBytes } from "viem";

const RPC = process.env.QORE_RPC || "https://rpc-testnet.qore.host";
const REST = process.env.QORE_REST || "https://api-testnet.qore.host";
const CHAIN_ID = "qorechain-diana";
const FEE = { amount: [{ denom: "uqor", amount: "60000" }], gas: "600000" };
export const FEE_CAP_WEI = 112_500_000_000n;
const UQOR_DIVISOR = 1_000_000_000_000n;
export const WINDOW_BLOCKS = 300n;

interface BroadcastResult { code: number; transactionHash: string; height: bigint; gasUsed: bigint; gasWanted: bigint; rawLog: string }

async function tmBroadcast(tx: Uint8Array): Promise<BroadcastResult> {
  const res = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "broadcast_tx_commit",
      params: { tx: Buffer.from(tx).toString("base64") } }),
  });
  const j = await res.json() as { error?: unknown; result: Record<string, any> };
  if (j.error) throw new Error(`rpc: ${JSON.stringify(j.error)}`);
  const r = j.result;
  const check = r.check_tx?.code ?? 0;
  const del = r.deliver_tx?.code ?? 0;
  return {
    code: del !== 0 ? del : check, transactionHash: r.hash, height: BigInt(r.height || 0),
    gasUsed: BigInt(r.deliver_tx?.gas_used || 0), gasWanted: BigInt(r.deliver_tx?.gas_wanted || 0),
    rawLog: r.deliver_tx?.log || r.check_tx?.log || "",
  };
}

async function accountSeq(cosmos: string) {
  const j = await (await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${cosmos}`)).json() as { account?: any };
  let a = j.account;
  while (a?.base_account) a = a.base_account;
  if (!a || a.account_number === undefined) throw new Error(`cannot read account ${cosmos}`);
  return { accountNumber: BigInt(a.account_number), sequence: BigInt(a.sequence) };
}

const BASE_FEE_WEI = 100_000_000_000n;

/** Gas and fee fields for every bot transaction: the fee cap the window was sized with, never viem's own. */
export const txOptions = (gas: bigint) => ({
  gas, maxFeePerGas: FEE_CAP_WEI, maxPriorityFeePerGas: FEE_CAP_WEI - BASE_FEE_WEI,
});

/** uqor cap for a window that will send these gas limits (value is always 0 for verifier actions). */
export function windowMaxValueUqor(gasLimits: bigint[]): string {
  const fees = gasLimits.reduce((s, g) => s + g * FEE_CAP_WEI, 0n);
  return (fees / UQOR_DIVISOR + 1_000n).toString();
}

export interface WindowSession { close(): Promise<void> }

export async function openWindow(
  key: Hex, pqcRecoveryCode: string, escrow: Address, gasLimits: bigint[],
): Promise<WindowSession> {
  const account = unifiedAccountFromSeed(hexToBytes(key), { recoveryCode: pqcRecoveryCode });
  const signer = new EthNativeSigner(account, { rest: REST });
  const send = async (messages: unknown[]) => {
    const seq = await accountSeq(account.cosmos);
    const res = await signer.signAndBroadcast({ broadcastTx: tmBroadcast } as never, {
      chainId: CHAIN_ID, ...seq, fee: FEE, messages: messages as never });
    if (res.code !== 0) {
      throw new Error(`window tx failed code=${res.code} reason=${classifyEvmWindowRejection(new Error(res.rawLog || ""))}`);
    }
  };
  await send([openEvmWindowMsg({
    sender: account.cosmos, blocks: WINDOW_BLOCKS, maxTxs: BigInt(gasLimits.length + 1),
    maxValue: windowMaxValueUqor(gasLimits), allowedTargets: [escrow],
  })]);
  return { close: () => send([closeEvmWindowMsg(account.cosmos)]) };
}
