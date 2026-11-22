import { useQueryClient } from "@tanstack/react-query";

/** How to open an EVM access window in QoreX; one shared copy for every place a window is needed. */
export function WindowSteps({ qorAddress, capQor, sendsValue = false }: {
  qorAddress?: string | null | undefined; capQor?: string | undefined; sendsValue?: boolean;
}) {
  const qc = useQueryClient();
  return (
    <div className="mt-2 text-xs text-charcoal">
      <ol className="list-decimal space-y-1 pl-4">
        <li>Open QoreX on the same account{qorAddress ? <> (<span className="break-all font-mono">{qorAddress}</span>)</> : ""}.</li>
        <li>Tap the <strong>MetaMask on QoreChain</strong> card (the 0x mark) on the main popup or Home. In the phone app it is also under Settings, Security, EVM access window.</li>
        <li>Set <strong>Blocks</strong> to 1000 (about 20 minutes), <strong>Max transactions</strong> to 5, and <strong>Spending cap</strong> to {capQor ?? "1"} QOR.</li>
        <li>Confirm, then come back and retry here.</li>
      </ol>
      <p className="mt-2 text-gray">The cap counts each transaction's maximum fee, not only the QOR it sends.
        {sendsValue && " It must cover the amount you send plus fees."} Open the window before clicking the action; opening it advances the account nonce.</p>
      <button type="button" onClick={() => void qc.invalidateQueries({ queryKey: ["evmWindow"] })}
        className="mt-2 rounded-md border border-ink/20 bg-white px-2.5 py-1 text-xs font-medium hover:bg-ink/5">
        I opened it — check again
      </button>
    </div>
  );
}
