// Route and wallet chunks start downloading before they are needed: on link hover/focus and when the
// browser is idle after first paint. Importing a module never connects, calls or mounts any wallet.
export const routeLoaders = {
  "/explore": () => import("./pages/Explore"),
  "/bounty": () => import("./pages/BountyDetail"),
  "/create": () => import("./pages/Create"),
  "/me": () => import("./pages/Me"),
  "/signer": () => import("./pages/Signer"),
  "/start": () => import("./pages/Start"),
} as const;

const loadWalletModule = () => import("./wallet/ConnectWallet");
const started = new Set<string>();

/** Start loading the chunk behind a path; safe to call repeatedly. */
export function prefetchRoute(path: string) {
  const key = path.startsWith("/bounty") ? "/bounty" : path;
  const load = (routeLoaders as Record<string, () => Promise<unknown>>)[key];
  if (!load || started.has(key)) return;
  started.add(key);
  void load().catch(() => started.delete(key));
}

export function prefetchWalletModule() {
  if (started.has("wallet")) return;
  started.add("wallet");
  void loadWalletModule().catch(() => started.delete("wallet"));
}

const idle = (fn: () => void) =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1500);

/** After first paint: the likely next pages, then the wallet module, then the event index. */
export function warmUp(prefetchIndex: () => void) {
  idle(() => {
    prefetchIndex();
    for (const p of ["/explore", "/bounty", "/me", "/create", "/start"]) prefetchRoute(p);
    idle(prefetchWalletModule);
  });
}
