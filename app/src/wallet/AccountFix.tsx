/** Collapsible fix for "wallet and QoreX are on different accounts" (coin-118 vs coin-60 key). */
export function AccountFix() {
  return (
    <details className="mt-1 text-xs text-charcoal">
      <summary className="cursor-pointer font-medium text-deep">How to fix</summary>
      <ol className="mt-1 list-decimal space-y-1 pl-4">
        <li>In QoreX open <em>Your accounts</em>, choose <em>Add an Ethereum account (coin 60)</em>, and select it.</li>
        <li>Import the same QoreX recovery phrase into MetaMask (a testing phrase only), so both show the same 0x address on chain 9800.</li>
        <li>Fund that account from the faucet and make one send in QoreX to register its post-quantum key.</li>
      </ol>
      <p className="mt-1 text-gray">QoreX's default account is a different key and cannot sign for an EVM address. The coin-60 account has its own address.</p>
    </details>
  );
}
