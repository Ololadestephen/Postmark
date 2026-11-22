import { useEffect } from "react";
import { WagmiContext } from "wagmi";
import { reconnect } from "wagmi/actions";
import { wagmiConfig } from "./wagmi";

const RECENT_KEY = "wagmi.recentConnectorId";
let attempted = false;

/**
 * Silent reconnect, once per page load: only the remembered connector, and only through its non-prompting
 * path (wagmi's reconnect asks `eth_accounts`, never `eth_requestAccounts`). wagmi's own reconnect-on-mount
 * is off because it probes every discovered wallet, QoreX included. If the remembered wallet is not
 * authorised any more, the memory is cleared so the next load doesn't retry.
 */
async function silentReconnect() {
  if (attempted) return;
  attempted = true;
  let id: string | null = null;
  try { id = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "null") as string | null; } catch { id = null; }
  if (!id) return;
  for (let tries = 0; tries < 3; tries++) {
    const connector = wagmiConfig.connectors.find((c) => c.id === id);
    if (connector) {
      const connected = await reconnect(wagmiConfig, { connectors: [connector] }).catch(() => []);
      if (connected.length === 0) { try { localStorage.removeItem(RECENT_KEY); } catch { /* storage blocked */ } }
      return;
    }
    await new Promise((r) => setTimeout(r, 300)); // EIP-6963 announcements can arrive after mount
  }
}

/** Mounts the wagmi context for a lazily loaded subtree. Multiple roots share the same config store, so
 * state stays consistent across chunks. This is `WagmiContext.Provider` rather than `WagmiProvider`: that
 * component's Hydrate step resets every live connection when reconnect-on-mount is off, which logged a
 * connected user out whenever they navigated to a page with its own root (Dashboard, Create). */
export default function WalletRoot({ children }: { children: React.ReactNode }) {
  useEffect(() => { void silentReconnect(); }, []);
  return <WagmiContext.Provider value={wagmiConfig}>{children}</WagmiContext.Provider>;
}
