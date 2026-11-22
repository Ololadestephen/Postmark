import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { QOREX_DOWNLOAD_URLS } from "@qorechain/qorex-types";
import { PageBody, PageHeader } from "../components/Page";
import { JOIN_VERIFIER_PATH } from "../data/verifiers";

import { FAUCET_URL } from "../data/links";
const TABS = [
  { id: "fund", label: "Fund" },
  { id: "claim", label: "Claim" },
  { id: "verify", label: "Verify" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const btn = "inline-block rounded-lg border border-ink/20 bg-white px-3 py-1.5 text-sm font-medium hover:bg-ink/5";
const primary = "inline-block rounded-lg bg-deep px-3 py-1.5 text-sm font-medium text-paper hover:brightness-110";
const ext = { target: "_blank", rel: "noreferrer" } as const;

function InstallQorex() {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <a className={primary} href={QOREX_DOWNLOAD_URLS.chrome} {...ext}>QoreX for Chrome</a>
      <a className={btn} href={QOREX_DOWNLOAD_URLS.firefox} {...ext}>Firefox</a>
      <a className={btn} href={QOREX_DOWNLOAD_URLS.safari} {...ext}>Safari</a>
    </div>
  );
}

function connectWallet() {
  document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click();
}

interface Step { title: string; body: ReactNode; action?: ReactNode }

const REGISTER_KEY: Step = {
  title: "Register your post-quantum key",
  body: "In QoreX, make one send (any small amount). That registers your ML-DSA-87 key on QoreChain diana.",
};

const SWITCH_TESTNET: Step = {
  title: "Switch QoreX to testnet",
  body: (<>
    QoreX starts on mainnet and a website can't switch it for you. <strong>Extension:</strong> unlock it, tap the version
    number at the bottom 7 times, then choose <em>Switch to testnet (diana)</em>; the Home badge then shows TESTNET.{" "}
    <strong>Phone app:</strong> Settings, then <em>Use testnet (developers)</em>.
  </>),
};

const COIN60_ACCOUNT: Step = {
  title: "Add an Ethereum account in QoreX",
  body: (<>
    QoreX's default account is a different key and can't sign for an EVM address. In QoreX open <em>Your accounts</em>, choose{" "}
    <em>Add an Ethereum account (coin 60)</em> and select it. It has its own address, so the next steps use that account.
  </>),
};

const IMPORT_PHRASE: Step = {
  title: "Import the same phrase into MetaMask",
  body: "Import the same QoreX recovery phrase (a testing phrase only) into MetaMask on chain 9800, so MetaMask and QoreX show the same 0x address.",
};

const FAUCET_STEP: Step = {
  title: "Get free test QOR for that account",
  body: "Payouts are test QOR with no monetary value. Request some from the faucet for the coin-60 account's address.",
  action: <a className={`${btn} mt-2`} href={FAUCET_URL} {...ext}>Open the faucet</a>,
};

const STEPS: Record<TabId, Step[]> = {
  fund: [
    { title: "Install QoreX", body: "QoreX is the QoreChain wallet that holds your post-quantum key.", action: <InstallQorex /> },
    SWITCH_TESTNET,
    COIN60_ACCOUNT,
    FAUCET_STEP,
    REGISTER_KEY,
    IMPORT_PHRASE,
    { title: "Connect your EVM wallet",
      body: "Today the EVM wallet you send transactions from (for example MetaMask) must hold the same account as QoreX — QoreX can sign, but it cannot send EVM transactions yet.",
      action: <button type="button" className={`${btn} mt-2`} onClick={connectWallet}>Connect wallet</button> },
    { title: "Check the “Before you fund” list",
      body: "The Create page shows what's still missing and fixes most of it with one click, including Enable transactions.",
      action: <Link className={`${primary} mt-2`} to="/create">Open Create</Link> },
    { title: "Describe the bounty", body: "Pick the GitHub issue, the reward, a deadline and three verifiers (or let us pick 3 for you), then fund it." },
  ],
  claim: [
    { title: "Install QoreX", body: "You sign your claim with your post-quantum key.", action: <InstallQorex /> },
    SWITCH_TESTNET,
    COIN60_ACCOUNT,
    FAUCET_STEP,
    REGISTER_KEY,
    IMPORT_PHRASE,
    { title: "Find a bounty", body: "Browse open bounties and pick one you can finish.",
      action: <Link className={`${primary} mt-2`} to="/explore">Browse bounties</Link> },
    { title: "Claim it",
      body: "Post the claim line as a comment on the GitHub issue, then sign it with QoreX. Your wallet and QoreX must be the same account today.",
      action: <button type="button" className={`${btn} mt-2`} onClick={connectWallet}>Connect wallet</button> },
    { title: "Open the pull request and wait", body: "Verifiers review the work. After the 24-hour challenge window, withdraw your payout from your dashboard." },
  ],
  verify: [
    { title: "Install QoreX", body: "Verdicts are signed with your post-quantum key.", action: <InstallQorex /> },
    SWITCH_TESTNET,
    COIN60_ACCOUNT,
    FAUCET_STEP,
    REGISTER_KEY,
    { title: "List yourself as a verifier", body: "Sign one line with QoreX so funders can find you.",
      action: <Link className={`${primary} mt-2`} to={JOIN_VERIFIER_PATH}>Become a verifier</Link> },
    { title: "Review the work", body: "When a funder picks you, open the bounty's review page, check the claim and the pull request, and choose PAY or REFUND." },
    { title: "Sign with QoreX", body: "Two of three matching verdicts release the reward. Anyone can submit the merged verdicts." },
  ],
};

export default function Start() {
  const [tab, setTab] = useState<TabId>("fund");
  const base = useId();
  return (
    <div>
      <PageHeader>
        <h1 className="font-sans text-4xl font-semibold tracking-tight text-ink">Get started</h1>
        <p className="mt-2 max-w-xl text-sm text-charcoal">
          Pick what you want to do. Everything here runs on QoreChain diana testnet — test QOR, no monetary value.
        </p>
      </PageHeader>
      <PageBody>
        <div role="tablist" aria-label="What do you want to do?" className="flex gap-1 border-b border-ink/10">
          {TABS.map((t) => (
            <button key={t.id} role="tab" id={`${base}-tab-${t.id}`} aria-selected={tab === t.id}
              aria-controls={`${base}-panel-${t.id}`} onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-5 py-2.5 text-sm font-medium ${
                tab === t.id ? "border-deep text-ink" : "border-transparent text-gray hover:text-ink"}`}>
              {t.label}
            </button>
          ))}
        </div>
        {TABS.map((t) => (
          <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`}
            hidden={tab !== t.id} className="pt-6">
            <ol className="max-w-3xl space-y-4">
              {STEPS[t.id].map((s, i) => (
                <li key={s.title} className="flex gap-4 rounded-xl border border-ink/10 bg-white p-5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-leaf font-mono text-sm font-semibold text-ink">{i + 1}</span>
                  <div className="min-w-0">
                    <h2 className="font-semibold tracking-tight">{s.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-charcoal">{s.body}</p>
                    {s.action}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </PageBody>
    </div>
  );
}
