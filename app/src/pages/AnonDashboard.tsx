import { PageBody, PageHeader } from "../components/Page";

/** The not-connected Dashboard: static, so it never waits for the wallet chunk. */
export function AnonDashboard() {
  return (
    <div>
      <PageHeader>
        <h1 className="font-sans text-4xl font-semibold tracking-tight text-ink">My bounties</h1>
      </PageHeader>
      <PageBody>
        <div className="rounded-2xl border border-dashed border-ink/20 bg-white p-10 text-center">
          <p className="text-lg font-medium text-ink">Connect an EVM wallet to see your funded bounties and credits.</p>
          <p className="mt-2 text-sm text-gray">Your balance, claims and verifier duties appear here once a wallet is connected.</p>
        </div>
      </PageBody>
    </div>
  );
}
