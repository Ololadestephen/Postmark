import { useEffect, useRef } from "react";
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from "wagmi";
import { useQorex } from "./qorex";
import { useEvmWindow, usePqcStatus } from "../hooks/queries";
import { tryQorToEvm } from "../chain/bech32";
import WalletRoot from "./WalletRoot";
import { diana } from "../chain/config";
import { shortAddr } from "../components/ui";
import { useToast } from "../components/Toasts";
import { CANCELLED_MESSAGE, isUserRejection } from "../chain/errors";

function ConnectButtonInner({ openOnMount }: { openOnMount: boolean }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error, reset } = useConnect();
  const picker = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (openOnMount && !picker.current?.open) picker.current?.showModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toast = useToast();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const qorex = useQorex();
  const qorEvm = tryQorToEvm(qorex.qorAddress);
  const evmAddr = isConnected ? address : qorEvm;
  const pqc = usePqcStatus(evmAddr);
  const win = useEvmWindow(qorex.qorAddress);

  if (!isConnected) {
    return (
      <>
        <button type="button" aria-haspopup="dialog" disabled={isPending}
          onClick={() => { reset(); picker.current?.showModal(); }}
          className="rounded-md bg-deep px-4 py-1.5 text-sm font-medium text-paper hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-deep disabled:opacity-50">
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
        <dialog ref={picker} aria-labelledby="wallet-picker-title"
          className="fixed inset-0 m-auto max-h-[80dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl border border-ink/10 bg-paper p-5 text-ink shadow-xl backdrop:bg-ink/35">
          <div className="flex items-center justify-between gap-3">
            <h2 id="wallet-picker-title" className="text-lg font-semibold tracking-tight">Choose a wallet</h2>
            <button type="button" onClick={() => picker.current?.close()}
              className="rounded-md border border-ink/15 px-2.5 py-1 text-sm text-gray hover:bg-ink/5">Close</button>
          </div>
          {connectors.length === 0 ? (
            <p className="mt-4 text-sm text-gray">
              No EVM wallet detected. Install or enable a browser wallet, then reopen this dialog.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {connectors.map((c) => (
                <li key={c.uid}>
                  <button type="button" disabled={isPending}
                    onClick={() => connect({ connector: c, chainId: diana.id },
                      { onSuccess: () => picker.current?.close(),
                        onError: (e) => { try { localStorage.removeItem("wagmi.recentConnectorId"); } catch { /* storage blocked */ }
                          toast(isUserRejection(e)
                          ? { kind: "info", title: "Cancelled", text: CANCELLED_MESSAGE }
                          : { kind: "error", title: "Couldn't connect", text: `Couldn't connect to ${c.name}. Try again or pick another wallet.` }); } })}
                    className="w-full break-words rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-left text-sm font-medium hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-deep disabled:opacity-50">
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {qorex.installed && (
            <p className="mt-4 text-xs text-gray">
              QoreX is detected{qorex.qorAddress ? ` (${qorex.qorAddress.slice(0, 10)}…)` : ""} and
              is used for identity only. It cannot send EVM transactions yet, so pick an EVM wallet above.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-orange">
              Couldn't connect. Check that the wallet is unlocked and try again.
            </p>
          )}
        </dialog>
      </>
    );
  }

  const wrongChain = chainId !== diana.id;
  return (
    <div className="flex items-center gap-2">
      {wrongChain && (
        <button onClick={() => switchChain({ chainId: diana.id })}
          className="rounded-lg border border-salmon px-3 py-1 text-xs font-medium text-deep hover:bg-salmon/10">
          Switch to diana (9800)
        </button>
      )}
      {!wrongChain && win.data && !win.data.live && (
        <span className="hidden rounded-full border border-orange/40 px-2.5 py-1 text-xs text-orange md:inline"
          title="No open EVM access window. To send transactions, open one in QoreX (the MetaMask on QoreChain card).">
          No EVM window
        </span>
      )}
      {pqc.data && (
        <span className={`hidden rounded-full border px-2.5 py-1 text-xs md:inline ${
          pqc.data.live ? "border-leaf/50 text-deep" : "border-gray/50 text-gray"}`}
          title={pqc.data.live ? "Live ML-DSA-87 key registered" : "No live ML-DSA-87 key"}>
          {pqc.data.live ? "PQ key" : "no PQ key"}
        </span>
      )}
      <button onClick={() => disconnect()}
        className="rounded-lg border border-ink/25 px-3 py-1.5 font-mono text-xs text-ink hover:bg-ink/5"
        title={address}>
        {shortAddr(address)}
      </button>
    </div>
  );
}

/** Lazy boundary: wagmi + connector code stays out of the initial bundle. */
export default function ConnectWallet({ openOnMount = false }: { openOnMount?: boolean }) {
  return <WalletRoot><ConnectButtonInner openOnMount={openOnMount} /></WalletRoot>;
}
