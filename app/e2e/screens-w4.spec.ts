import { test, expect } from "@playwright/test";
import { encodeAbiParameters, keccak256 } from "viem";
import { postmarkEscrowAbi } from "../src/chain/abi";
import {
  installTestWallet, mockGithub, nodePublic, profileAddress,
  connectInjected, pairingCodeFor, E2E_ESCROW as ESCROW,
} from "./testWallet";

const OUT = "../notes/screens/w4";
const PORTS = { v0: 47322, v1: 47323, v2: 47324 };
const CLAIMED_BOUNTY = 13n;   // live Claimed bounty (payee = claimant)
const DISPUTED_BOUNTY = 15n;  // live Disputed bounty (frozen view)
const PAID_BOUNTY = 16n;      // live Paid bounty (ruling: dispute rejected)

const FIXED_MERGED_AT = "2026-01-01T00:00:00Z";
const MERGED_AT_SEC = BigInt(Math.floor(Date.parse(FIXED_MERGED_AT) / 1000));
const SHA = "f".repeat(40);
const REPO = "postmark-e2e/sandbox";

const claimLine = (bountyId: bigint, claimant: string) =>
  `postmark-claim v1 chain=9800 escrow=${ESCROW.toLowerCase()} bounty=${bountyId} claimant=${claimant.toLowerCase()}`;

const shot = (page: import("@playwright/test").Page, name: string) =>
  page.screenshot({ path: `${OUT}/${name}-${test.info().project.name}.png`, fullPage: true });

const prFixture = {
  number: 2, title: "wire the funder flow", state: "closed", merged: true,
  merged_at: FIXED_MERGED_AT, merge_commit_sha: SHA,
  user: { login: "e2e-claimant" },
  html_url: "https://github.com/postmark-e2e/sandbox/pull/2",
};

const payEvidenceHash = () => keccak256(encodeAbiParameters(
  [{ type: "string" }, { type: "string" }, { type: "uint256" }, { type: "string" },
    { type: "uint64" }, { type: "string" }],
  ["postmark-evidence-v1", REPO, 2n, SHA, MERGED_AT_SEC, "e2e-claimant"]));

test.describe.configure({ mode: "serial" });

const getBounty = (id: bigint) => nodePublic().readContract({
  address: ESCROW, abi: postmarkEscrowAbi, functionName: "getBounty", args: [id],
}) as Promise<{ payee: `0x${string}`; nonce: bigint; claimRound: bigint }>;

/** Build the exact INITIAL PAY verdict the review UI builds for a Claimed
 * bounty, fetch the message bytes from the escrow, and sign via the two
 * running verifier signers — a real mergeable bundle, zero transactions. */
async function buildSignedBundle(bountyId: bigint) {
  const b = await getBounty(bountyId);
  const verdict = {
    bountyId, phase: 0, outcome: 0, payee: b.payee,
    mergedAt: MERGED_AT_SEC, evidenceHash: payEvidenceHash(),
    nonce: b.nonce, claimRound: b.claimRound,
  };
  const message = await nodePublic().readContract({
    address: ESCROW, abi: postmarkEscrowAbi, functionName: "verdictMessage",
    args: [verdict],
  }) as `0x${string}`;
  const signatures: Record<string, `0x${string}`> = {};
  for (const [key, port] of [["0", PORTS.v0], ["1", PORTS.v1]] as const) {
    const res = await fetch(`http://127.0.0.1:${port}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json", "origin": "http://localhost:4173",
        "x-postmark-pair": pairingCodeFor(port) },
      body: JSON.stringify({ kind: "verdict", verdict: {
        bountyId: bountyId.toString(), phase: 0, outcome: 0, payee: b.payee,
        mergedAt: MERGED_AT_SEC.toString(), evidenceHash: payEvidenceHash(),
        nonce: b.nonce.toString(), claimRound: b.claimRound.toString() } }),
    });
    const body = await res.json() as { signature?: `0x${string}`; error?: string };
    if (!res.ok || !body.signature) throw new Error(`signer ${port} refused: ${body.error}`);
    signatures[key] = body.signature;
  }
  return {
    format: "postmark-verdict-bundle-v1", chainId: 9800,
    nativeChainId: "qorechain-diana", escrow: ESCROW,
    verdict: { ...verdict, bountyId: bountyId.toString(),
      mergedAt: MERGED_AT_SEC.toString(), nonce: b.nonce.toString(),
      claimRound: b.claimRound.toString() },
    message, signatures,
  };
}

test("w4 review and dispute views", async ({ page }) => {
  test.setTimeout(300_000);
  const claimant = profileAddress("claimant");
  const b13 = await getBounty(CLAIMED_BOUNTY);
  if (b13.payee === "0x0000000000000000000000000000000000000000")
    test.skip(true, "claimed fixture bounty missing");

  await installTestWallet(page, "verifier0");
  await mockGithub(page, {
    comments: [
      { id: 987654321, user: { login: "e2e-claimant" },
        body: claimLine(CLAIMED_BOUNTY, claimant), created_at: new Date().toISOString() },
    ],
    pull: prFixture,
  });
  await page.goto(`/bounty/${CLAIMED_BOUNTY}/review`);
  await connectInjected(page);
  await page.getByRole("button", { name: /scan comments/i }).click();
  await expect(page.getByText(/identity matches/i)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /find linked prs/i }).click();
  await page.getByRole("button", { name: "#2", exact: true }).click();
  await expect(page.getByText(/merge_commit_sha present/i)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "PAY", exact: true }).click();
  await expect(page.getByText(/message matches escrow\.verdictMessage/i))
    .toBeVisible({ timeout: 60_000 });
  await shot(page, "review-checks");

  // real 2-of-3 mergeable bundle, built off-chain for free
  const bundle = await buildSignedBundle(CLAIMED_BOUNTY);
  await page.getByPlaceholder(/paste another verifier's bundle/i).fill(JSON.stringify(bundle));
  await page.getByRole("button", { name: /import & merge/i }).click();
  await expect(page.getByText(/^valid$/).first()).toBeVisible({ timeout: 60_000 });
  await shot(page, "review-merge");
});

test("w4 pending view shows the finalize-ready state once the window closed", async ({ page }) => {
  const st = (await nodePublic().readContract({ address: ESCROW, abi: postmarkEscrowAbi,
    functionName: "getBounty", args: [CLAIMED_BOUNTY] })) as { state: number; challengeEndsAt: bigint };
  expect(st.state, "e2e bounty 13 must be Pending").toBe(2);
  await page.goto(`/bounty/${CLAIMED_BOUNTY}`);
  await expect(page.getByText(/verdict pending/i)).toBeVisible({ timeout: 60_000 });
  const closed = st.challengeEndsAt <= BigInt(Math.floor(Date.now() / 1000));
  await expect(page.getByText(closed
    ? /Challenge window closed — ready to finalize/
    : /dispute this verdict/i).first()).toBeVisible();
  await shot(page, "pending");
});

test("w4 frozen, ruling and verifier dashboard", async ({ page, context }) => {
  test.setTimeout(120_000);
  await installTestWallet(page, "disputer");
  await page.goto(`/bounty/${DISPUTED_BOUNTY}`);
  await connectInjected(page);
  await expect(page.getByText(/payout frozen — disputed/i)).toBeVisible({ timeout: 60_000 });
  await shot(page, "frozen");

  await page.goto(`/bounty/${PAID_BOUNTY}`);
  await expect(page.getByText(/ruling/i).first()).toBeVisible({ timeout: 60_000 });
  await shot(page, "ruling");

  const vpage = await context.newPage();
  await installTestWallet(vpage, "verifier0");
  await vpage.goto("/me");
  await expect(vpage.getByRole("tab", { name: /verifying/i })).toBeVisible({ timeout: 60_000 });
  await vpage.screenshot({ path: `${OUT}/me-verifier-${test.info().project.name}.png`, fullPage: true });
});
