import { lazy, Suspense, useRef, useState } from "react";
import { requestWallet, useWalletWanted } from "./walletIntent";
import { prefetchWalletModule } from "../prefetch";

const ConnectWallet = lazy(() => import("../wallet/ConnectWallet"));
const BUTTON = "rounded-md bg-deep px-4 py-1.5 text-sm font-medium text-paper hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-deep disabled:opacity-50";

/** Renders the Connect button immediately, without wagmi. The wallet chunk loads when it is clicked
 * (or at once when a previous connection is remembered) and then opens the wallet picker. */
export function DeferredConnect() {
  const wanted = useWalletWanted();
  const [openOnLoad, setOpenOnLoad] = useState(false);
  const clicked = useRef(false);
  if (!wanted) {
    return (
      <button type="button" aria-haspopup="dialog" className={BUTTON}
        onPointerEnter={prefetchWalletModule} onFocus={prefetchWalletModule}
        onClick={() => { clicked.current = true; setOpenOnLoad(true); requestWallet(); }}>
        Connect wallet
      </button>
    );
  }
  return (
    <Suspense fallback={<button type="button" aria-haspopup="dialog" disabled className={BUTTON}>{clicked.current ? "Loading…" : "Connect wallet"}</button>}>
      <ConnectWallet openOnMount={openOnLoad} />
    </Suspense>
  );
}
