import { useState } from "react";
import { encodeFunctionData } from "viem";
import { PageBody, PageHeader } from "../components/Page";
import { Card, SectionLabel } from "../components/ui";
import { ESCROW_ADDRESS, NATIVE_CHAIN_ID, explorerTx } from "../chain/config";
import { postmarkEscrowAbi } from "../chain/abi";
import { tryQorToEvm } from "../chain/bech32";
import { assertQorexTestnet, useQorex } from "../wallet/qorex";

const btn = "rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-sm font-medium hover:bg-ink/5 disabled:opacity-50";
const primary = "rounded-lg bg-deep px-4 py-2 text-sm font-medium text-paper hover:brightness-110 disabled:opacity-50";

const GAS = { nextBountyId: 600_000, withdraw: 1_000_000 } as const;
/** The node charges the full gas limit at 0.1 uqor per gas. */
const maxFeeQor = (gas: number) => (gas / 10 / 1e6).toFixed(2);
const gasNote = (gas: number) => `gas limit ${gas.toLocaleString("en-US")}, max fee ≈ ${maxFeeQor(gas)} QOR`;

type Outcome = { ok: true; result: unknown; txHash?: string } | { ok: false; error: string };

/** Experiment: send a MsgCrossVMCall into the escrow through QoreX's native lane (no EVM window, no MetaMask). */
async function sendCrossVmCall(native: NonNullable<ReturnType<typeof useQorex>["native"]>, qor1: string, functionName: "nextBountyId" | "withdraw"): Promise<Outcome> {
  try {
    await assertQorexTestnet();
    const { crossvm, qorechainRegistry } = await import("@qorechain/sdk");
    const calldata = encodeFunctionData({ abi: postmarkEscrowAbi, functionName } as never);
    const payload = Uint8Array.from(calldata.slice(2).match(/../g)!.map((b) => parseInt(b, 16)));
    const msg = crossvm.crossVmCall({
      sender: qor1, sourceVm: "cosmwasm", targetVm: "evm", targetContract: ESCROW_ADDRESS.toLowerCase(),
      payload, funds: [], async: false,
    });
    const type = qorechainRegistry().lookupType(msg.typeUrl) as unknown as { encode: (v: unknown) => { finish: () => Uint8Array }; fromPartial: (v: unknown) => unknown } | undefined;
    if (!type) throw new Error(`${msg.typeUrl} is not in the QoreChain registry`);
    const value = type.encode(type.fromPartial(msg.value)).finish();
    const result = await native.signAndBroadcast({
      chainId: NATIVE_CHAIN_ID,
      messages: [{ typeUrl: "/qorechain.crossvm.v1.MsgCrossVMCall", value }],
      gasLimit: GAS[functionName],
    });
    return { ok: true, result, txHash: result.txHash };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function Result({ o }: { o: Outcome | null }) {
  if (!o) return null;
  return (
    <div className="mt-3 text-xs">
      <pre className={`overflow-x-auto whitespace-pre-wrap break-all rounded-lg p-3 font-mono ${o.ok ? "bg-ink text-paper" : "bg-salmon/40 text-ink"}`}>
        {o.ok ? JSON.stringify(o.result, null, 2) : o.error}
      </pre>
      {o.ok && o.txHash && (
        <a className="mt-2 inline-block text-deep underline underline-offset-4" href={explorerTx(o.txHash)} target="_blank" rel="noreferrer">
          View on the explorer
        </a>
      )}
    </div>
  );
}

export default function LabQorexNative() {
  const qorex = useQorex();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<Outcome | null>(null);
  const [withdraw, setWithdraw] = useState<Outcome | null>(null);
  const evm = tryQorToEvm(qorex.qorAddress);

  const connect = async () => {
    setBusy("connect"); setError(null);
    try { await assertQorexTestnet(); await qorex.connectAccount(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const run = async (name: "nextBountyId" | "withdraw", set: (o: Outcome) => void) => {
    if (!qorex.native || !qorex.qorAddress) return;
    setBusy(name);
    set(await sendCrossVmCall(qorex.native, qorex.qorAddress, name));
    setBusy(null);
  };

  return (
    <div>
      <PageHeader>
        <div>
          <h1 className="font-sans text-4xl font-semibold tracking-tight text-ink">QoreX native lane test</h1>
          <p className="mt-2 text-sm text-charcoal">Experiment: send a MsgCrossVMCall into the escrow from QoreX. Testnet only; each call costs a small fee.</p>
        </div>
      </PageHeader>
      <PageBody className="max-w-3xl space-y-4">
        <Card>
          <SectionLabel>1 · connect</SectionLabel>
          {qorex.qorAddress ? (
            <p className="mt-2 break-all text-sm">QoreX account <span className="font-mono">{qorex.qorAddress}</span>{evm && <> · EVM address <span className="font-mono">{evm}</span></>}</p>
          ) : (
            <button type="button" className={`mt-2 ${primary}`} disabled={!qorex.installed || busy === "connect"} onClick={connect}>Connect QoreX</button>
          )}
          {!qorex.installed && <p className="mt-2 text-xs text-gray">QoreX is not installed in this browser.</p>}
          {error && <p role="alert" className="mt-2 text-sm text-orange">{error}</p>}
        </Card>
        <Card>
          <SectionLabel>2 · test 1: read call</SectionLabel>
          <p className="mt-2 text-sm text-charcoal">Calls <span className="font-mono">nextBountyId()</span> on the production escrow, signed by your own account, with no EVM window.</p>
          <button type="button" className={`mt-3 ${primary}`} disabled={!qorex.qorAddress || busy !== null} onClick={() => void run("nextBountyId", setRead)}>
            Send test call via QoreX
          </button>
          <p className="mt-1 text-xs text-gray">{gasNote(GAS.nextBountyId)}</p>
          <Result o={read} />
        </Card>
        <Card>
          <SectionLabel>3 · test 2: withdraw</SectionLabel>
          <p className="mt-2 text-sm text-charcoal">Calls <span className="font-mono">withdraw()</span>. Only if you have credits.</p>
          <button type="button" className={`mt-3 ${btn}`} disabled={!qorex.qorAddress || busy !== null} onClick={() => void run("withdraw", setWithdraw)}>
            Send withdraw via QoreX
          </button>
          <p className="mt-1 text-xs text-gray">{gasNote(GAS.withdraw)}</p>
          <Result o={withdraw} />
        </Card>
      </PageBody>
    </div>
  );
}
