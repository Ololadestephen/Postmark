import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { DeferredConnect } from "./Deferred";
import { useFeedStatus } from "../chain/IndexerProvider";
import { useBlockNumber } from "../hooks/queries";
import { explorerBlock } from "../chain/config";
import { Logo } from "./Logo";
import { prefetchRoute } from "../prefetch";
import { ShinyBar } from "./motion";
import { PixelBand } from "./PixelBand";

const NAV = [
  { to: "/explore", label: "Explore" },
  { to: "/create", label: "Create" },
  { to: "/me", label: "Dashboard" },
  { to: "/start", label: "Get started" },
  { to: "/signer", label: "Signing" },
];

/** diana network pill: latest block and whether the RPC and event feed are healthy. */
export function NetworkPill({ className = "" }: { className?: string }) {
  const feed = useFeedStatus();
  const block = useBlockNumber();
  const degraded = block.isError || feed === "polling";
  const dot = block.isError ? "bg-salmon" : degraded ? "bg-orange" : "bg-leaf";
  const label = block.isError ? "degraded" : feed === "polling" ? "polling" : feed === "live" ? "live" : "connecting";
  return (
    <span className={`items-center gap-2 rounded-full border border-ink/15 bg-white px-3 py-1 font-mono text-[11px] text-charcoal ${className}`}
      title={`Chain feed: ${label}`}>
      <span className={`size-2 rounded-full ${dot} ${label === "live" ? "animate-pulse" : ""}`} aria-hidden />
      <span>diana</span>
      {block.data !== undefined && (
        <a className="text-gray hover:text-ink" href={explorerBlock(block.data)} target="_blank" rel="noreferrer">
          #{block.data.toString()}
        </a>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

const desktopLink = ({ isActive }: { isActive: boolean }) =>
  `relative px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? "text-ink after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-deep"
      : "text-gray hover:text-ink"}`;

const sheetLink = ({ isActive }: { isActive: boolean }) =>
  `block rounded-lg px-3 py-3 text-base font-medium ${isActive ? "bg-ink text-paper" : "text-ink hover:bg-ink/5"}`;

export function Shell({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const onLanding = useLocation().pathname === "/";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <div className="bg-ink px-4 py-1.5 text-center font-mono text-[11px] text-paper/80">
        <ShinyBar text="Live on QoreChain diana testnet · test QOR, no monetary value" />
      </div>
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/95 backdrop-blur">
        <div data-container="nav" className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2">
              <Logo size={28} />
              <span className="text-xl font-semibold tracking-tight">Postmark</span>
            </Link>
            <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={desktopLink}
                  onMouseEnter={() => prefetchRoute(n.to)} onFocus={() => prefetchRoute(n.to)}>{n.label}</NavLink>
              ))}
            </nav>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <NetworkPill className="hidden lg:inline-flex" />
            <DeferredConnect />
            <button className="rounded-md p-2 text-ink hover:bg-ink/5 md:hidden"
              aria-label="Menu" aria-expanded={open} aria-controls="mobile-sheet" onClick={() => setOpen(!open)}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
              </svg>
            </button>
          </div>
        </div>
        {open && (
          <nav id="mobile-sheet" aria-label="Mobile" className="border-t border-ink/10 bg-paper px-4 pb-5 pt-3 md:hidden">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={sheetLink} onClick={() => setOpen(false)}>{n.label}</NavLink>
            ))}
            <NetworkPill className="mt-3 inline-flex" />
          </nav>
        )}
      </header>
      <main className="w-full flex-1 pb-[env(safe-area-inset-bottom)]">
        {children ?? <Outlet />}
      </main>
      {!onLanding && <AppFooter />}
    </div>
  );
}

const FOOTER_LINKS = [
  { title: "App", links: [["Explore", "/explore"], ["Create", "/create"], ["Dashboard", "/me"], ["Get started", "/start"], ["Signing", "/signer"]] },
];

function AppFooter() {
  return (
    <footer className="on-dark mt-12 bg-ink text-paper">
      <PixelBand className="h-2" stripeHeight={6} />
      <div data-container="footer" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:flex-row sm:justify-between">
        <div className="max-w-xs">
          <div className="flex items-center gap-2">
            <Logo size={22} />
            <span className="font-semibold tracking-tight">Postmark</span>
          </div>
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-paper/60">
            Postmark — diana testnet. Payouts are in test QOR with no monetary value.
          </p>
        </div>
        <div className="flex gap-12">
          {FOOTER_LINKS.map((col) => (
            <div key={col.title}>
              <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-paper/50">{col.title}</h2>
              <ul className="mt-3 space-y-2 text-sm text-paper/80">
                {col.links.map(([label, to]) => (
                  <li key={to}><Link className="hover:text-paper" to={to!}>{label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-paper/50">Protocol</h2>
            <ul className="mt-3 space-y-2 text-sm text-paper/80">
              <li><a className="hover:text-paper" href="https://dashboard.qorechain.io/explorer" target="_blank" rel="noreferrer">diana explorer</a></li>
              <li><Link className="hover:text-paper" to="/signer">Signing help</Link></li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
