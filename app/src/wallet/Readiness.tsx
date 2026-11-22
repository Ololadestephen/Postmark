import { useState, type ReactNode } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { QOREX_DOWNLOAD_URLS } from "@qorechain/qorex-types";
import { httpClient } from "../chain/client";
import { ESCROW_ADDRESS } from "../chain/config";
import { evmToQor } from "../chain/bech32";
import { preflightTx } from "../chain/preflight";
import type { EvmWindow } from "../chain/window";
import { useEvmWindow, usePqcStatus } from "../hooks/queries";
import { Card, SectionLabel } from "../components/ui";
import { useQorex, useQorexNetwork } from "./qorex";
import { useToast } from "../components/Toasts";
import { QOREX_MAINNET_TEXT, qorexFailureToast } from "../chain/errors";
import { accountMismatchMessage } from "./signerPreference";
import { AccountFix } from "./AccountFix";
import { WindowSteps } from "./WindowSteps";

import { FAUCET_URL } from "../data/links";
export { FAUCET_URL };

export type RowStatus = "ok" | "todo" | "wait";
export type RowAction =
  | { kind: "connect" } | { kind: "switch" } | { kind: "checkQorex" }
  | { kind: "link"; href: string; label: string };
export interface ReadinessRow { id: string; label: string; status: RowStatus; hint?: string | undefined; action?: RowAction; help?: "accounts" | "window" }

export interface ReadinessInput {
  connected: boolean;
  chainId: number | undefined;
  qorexInstalled: boolean;
  qorAddress: string | null;
  account: string | undefined;
  pqcLive: boolean | undefined;
  window: EvmWindow | undefined;
  neededWei: bigint;
  balanceWei: bigint | undefined;
  /** QoreX's active network, read after the account is linked */
  qorexNetwork?: "testnet" | "mainnet" | "unknown" | undefined;
}

const FEE_MARGIN_WEI = 10n ** 16n; // 0.01 QOR for gas

/** The "Before you fund" rows: each with a status and one fix. Pure, so every state is unit-tested. */
export function readinessRows(i: ReadinessInput): ReadinessRow[] {
  const mismatch = i.connected ? accountMismatchMessage(i.qorAddress, i.account) : null;
  const rows: ReadinessRow[] = [];
  rows.push(i.connected
    ? { id: "wallet", label: "Wallet connected", status: "ok" }
    : { id: "wallet", label: "Connect your wallet", status: "todo", action: { kind: "connect" } });
  rows.push(!i.connected ? { id: "chain", label: "On QoreChain diana", status: "wait" }
    : i.chainId === 9800 ? { id: "chain", label: "On QoreChain diana", status: "ok" }
    : { id: "chain", label: "On QoreChain diana", status: "todo", hint: "Your wallet is on another network.", action: { kind: "switch" } });
  rows.push(!i.qorexInstalled
    ? { id: "qorex", label: "Same account as QoreX", status: "todo", hint: "Install QoreX to sign with your post-quantum key.",
        action: { kind: "link", href: QOREX_DOWNLOAD_URLS.chrome, label: "Get QoreX" } }
    : mismatch ? { id: "qorex", label: "Same account as QoreX", status: "todo", hint: mismatch, help: "accounts" }
    : !i.qorAddress ? { id: "qorex", label: "Same account as QoreX", status: "todo", hint: "QoreX hasn't been asked yet.", action: { kind: "checkQorex" } }
    : { id: "qorex", label: "Same account as QoreX", status: "ok" });
  if (i.qorAddress && i.qorexNetwork && i.qorexNetwork !== "unknown") {
    rows.push(i.qorexNetwork === "testnet"
      ? { id: "qorexNet", label: "QoreX on testnet", status: "ok" }
      : { id: "qorexNet", label: "QoreX on testnet", status: "todo", hint: QOREX_MAINNET_TEXT });
  }
  rows.push(i.pqcLive === true ? { id: "pqc", label: "Post-quantum key registered", status: "ok" }
    : i.pqcLive === false ? { id: "pqc", label: "Post-quantum key registered", status: "todo",
        hint: "Make one send in QoreX to register it.", action: { kind: "link", href: "/start", label: "How" } }
    : { id: "pqc", label: "Post-quantum key registered", status: "wait" });
  const pre = i.connected ? preflightTx({
    connected: true, chainId: 9800, pqcLive: undefined, window: i.window,
    valueWei: i.neededWei, maxFeeWei: FEE_MARGIN_WEI, escrow: ESCROW_ADDRESS }) : null;
  rows.push(!i.connected ? { id: "window", label: "Transactions enabled", status: "wait" }
    : pre?.ok ? { id: "window", label: "Transactions enabled", status: "ok" }
    : { id: "window", label: "Transactions enabled", status: "todo", hint: pre?.ok === false ? pre.reason : undefined,
        help: "window" });
  rows.push(i.balanceWei === undefined ? { id: "balance", label: "Enough test QOR", status: "wait" }
    : i.balanceWei >= i.neededWei + FEE_MARGIN_WEI ? { id: "balance", label: "Enough test QOR", status: "ok" }
    : { id: "balance", label: "Enough test QOR", status: "todo", hint: "Get free test QOR from the faucet.",
        action: { kind: "link", href: FAUCET_URL, label: "Open faucet" } });
  return rows;
}

const ICON: Record<RowStatus, ReactNode> = {
  ok: <span className="grid size-5 place-items-center rounded-full bg-deep text-[11px] text-paper" aria-hidden>✓</span>,
  todo: <span className="grid size-5 place-items-center rounded-full bg-salmon text-[11px] font-bold text-ink" aria-hidden>!</span>,
  wait: <span className="grid size-5 place-items-center rounded-full bg-ink/10 text-[11px] text-gray" aria-hidden>…</span>,
};
const STATUS_TEXT: Record<RowStatus, string> = { ok: "ready", todo: "needs attention", wait: "waiting" };

export function ReadinessChecklist({ neededWei, title = "Before you fund", compact = false }: {
  neededWei: bigint; title?: string;
  /** one-line summary, only failing rows, passing ones behind a "show all" toggle */
  compact?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const qorex = useQorex();
  const toast = useToast();
  const qorexNet = useQorexNetwork(!!qorex.qorAddress);
  const pqc = usePqcStatus(address);
  const win = useEvmWindow(address ? evmToQor(address) : undefined);
  const balance = useQuery({
    queryKey: ["balance", address], enabled: !!address, staleTime: 15_000,
    queryFn: () => httpClient.getBalance({ address: address! }),
  });
  const rows = readinessRows({
    connected: isConnected, chainId: isConnected ? chainId : undefined,
    qorexInstalled: qorex.installed, qorAddress: qorex.qorAddress, account: address, qorexNetwork: qorexNet,
    pqcLive: isConnected ? pqc.data?.live : undefined, window: win.data, neededWei, balanceWei: balance.data,
  });
  const run = (a: RowAction) => {
    if (a.kind === "connect") document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click();
    else if (a.kind === "switch") switchChain({ chainId: 9800 });
    else if (a.kind === "checkQorex") void qorex.connectAccount().catch((e) => toast(qorexFailureToast(e, { title: "Couldn't reach QoreX" })));
  };
  const btn = "shrink-0 rounded-md border border-ink/20 bg-white px-2.5 py-1 text-xs font-medium hover:bg-ink/5";
  const ready = rows.filter((r) => r.status === "ok").length;
  const shown = compact && !showAll ? rows.filter((r) => r.status !== "ok") : rows;
  const list = (
    <ul className="mt-3 space-y-2.5">
      {shown.map((r) => (
        <li key={r.id} className="flex items-start gap-2.5">
          <span className="mt-0.5">{ICON[r.status]}</span>
          <div className="min-w-0 grow">
            <p className="text-sm font-medium leading-tight">{r.label} <span className="sr-only">— {STATUS_TEXT[r.status]}</span></p>
            {r.status === "todo" && r.hint && <p className="mt-0.5 text-xs text-charcoal">{r.hint}</p>}
            {r.status === "todo" && r.help === "accounts" && <AccountFix />}
            {r.status === "todo" && r.help === "window" && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs font-medium text-deep">How to open</summary>
                <WindowSteps qorAddress={qorex.qorAddress} sendsValue={neededWei > 0n}
                  capQor={neededWei > 0n ? String(Math.ceil(Number(neededWei) / 1e18 + 1)) : undefined} />
              </details>
            )}
          </div>
          {r.status === "todo" && r.action && (
            r.action.kind === "link"
              ? <a className={btn} href={r.action.href} target={r.action.href.startsWith("/") ? undefined : "_blank"} rel="noreferrer">{r.action.label}</a>
              : <button type="button" className={btn} onClick={() => run(r.action!)}>
                  {r.action.kind === "connect" ? "Connect" : r.action.kind === "switch" ? "Switch" : "Check with QoreX"}
                </button>
          )}
        </li>
      ))}
    </ul>
  );
  if (compact) {
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">{title}: <span className="font-mono">{ready} of {rows.length} ready</span></p>
          {ready > 0 && (
            <button type="button" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}
              className="text-xs text-deep underline underline-offset-4">{showAll ? "hide ready items" : "show all"}</button>
          )}
        </div>
        {shown.length > 0 && list}
      </div>
    );
  }
  return (
    <Card>
      <SectionLabel>{title}</SectionLabel>
      {list}
    </Card>
  );
}
