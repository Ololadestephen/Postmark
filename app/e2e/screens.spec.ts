import { openManualVerifiers, openLocalSigner } from "./support/easyUi";
import { test } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { installTestWallet, mockGithub, E2E_ESCROW } from "./testWallet";

const OUT = "../notes/screens/w3";
test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

test("landing + explore screenshots", async ({ page }, testInfo) => {
  const size = testInfo.project.name;
  await page.goto("/");
  await page.waitForSelector("text=Bounties that pay", { timeout: 30_000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/landing-top-${size}.png` });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.35));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/landing-mid-${size}.png` });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.75));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/landing-end-${size}.png` });
  await page.goto("/explore");
  await page.waitForSelector("text=/QOR|no bounties/i", { timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/explore-${size}.png` });
});

test("landing reduced-motion", async ({ page }, testInfo) => {
  const size = testInfo.project.name;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForSelector("text=Bounties that pay", { timeout: 30_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/landing-reduced-${size}.png` });
});

test("create form + dashboard screenshots", async ({ page }, testInfo) => {
  const size = testInfo.project.name;
  await mockGithub(page);
  await installTestWallet(page);

  await page.goto("/create");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/create-empty-${size}.png` });

  const connectBtn = page.getByRole("button", { name: /connect/i }).first();
  if (await connectBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await connectBtn.click();
    const pick = page.getByText("Postmark E2E");
    await pick.click({ timeout: 10_000 }).catch(() => undefined); // the wallet chunk loads on the click
    await page.locator("dialog").first().waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
  }
  await page.getByPlaceholder(/github\.com\/owner\/repo/i)
    .fill("https://github.com/postmark-e2e/sandbox/issues/1");
  await page.getByText("Postmark sandbox").waitFor({ timeout: 15_000 });
  const env = readFileSync(`${homedir()}/.config/postmark/e2e/verifier0.env`, "utf8");
  const v0 = env.match(/^ADDRESS=(0x[0-9a-fA-F]{40})/m)![1]!;
  await openManualVerifiers(page);
  for (let i = 0; i < 3; i++) {
    await page.getByPlaceholder(new RegExp(`Verifier ${i + 1}`)).fill(v0);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/create-error-${size}.png` });

  const v = (i: number) =>
    readFileSync(`${homedir()}/.config/postmark/e2e/verifier${i}.env`, "utf8")
      .match(/^ADDRESS=(0x[0-9a-fA-F]{40})/m)![1]!;
  for (let i = 0; i < 3; i++) {
    await page.getByPlaceholder(new RegExp(`Verifier ${i + 1}`)).fill(v(i));
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/create-filled-${size}.png` });

  // preflight-blocked panel (no-window guide) as the "pending" state —
  // stub the window REST so no transaction can ever be sent here
  await page.route("**/qore-rest/qorechain/pqc/v1/evm_window/*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ found: false, live: false }) }));
  await page.getByRole("button", { name: /create bounty/i }).click();
  await page.getByText(/open an evm access window in qorex/i)
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/create-pending-${size}.png` });

  await page.goto("/me");
  await page.waitForSelector("text=/FUNDED|haven't funded/i", { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/dashboard-${size}.png` });
});

test("claim panel + signer page screenshots", async ({ page }, testInfo) => {
  const size = testInfo.project.name;
  // claim steps on an Open bounty (read-only — no tx sent)
  const pub = (await import("./testWallet")).nodePublic();
  const { postmarkEscrowAbi } = await import("../src/chain/abi");
  const escrow = E2E_ESCROW;
  const next = (await pub.readContract({ address: escrow, abi: postmarkEscrowAbi,
    functionName: "nextBountyId" })) as bigint;
  let openId: bigint | null = null, claimedId: bigint | null = null;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  for (let id = next - 1n; id >= 1n && (openId === null || claimedId === null); id--) {
    const b = await pub.readContract({ address: escrow, abi: postmarkEscrowAbi,
      functionName: "getBounty", args: [id] }) as
      { state: number; deadline: bigint; claimTimeout: bigint };
    if (b.state === 0 && b.deadline > nowSec + b.claimTimeout + 600n && openId === null) openId = id;
    if (b.state === 1 && claimedId === null) claimedId = id;
  }
  if (openId !== null) {
    const claimant = "0x478F2A08a81be7CEa42bd34BD6900593fA56c4B6";
    const line = `postmark-claim v1 chain=9800 escrow=${escrow.toLowerCase()} bounty=${openId} claimant=${claimant.toLowerCase()}`;
    await mockGithub(page, { comments: [{ id: 987654321, user: { login: "e2e-claimant" },
      body: line, created_at: new Date().toISOString() }] });
    await installTestWallet(page, "claimant");
    await page.goto(`/bounty/${openId}`);
    const connectBtn = page.getByRole("button", { name: /connect/i }).first();
    if (await connectBtn.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await connectBtn.click();
      const pick = page.getByText("Postmark E2E");
      await pick.click({ timeout: 10_000 }).catch(() => undefined); // the wallet chunk loads on the click
    await page.locator("dialog").first().waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
    }
    await page.getByText(/postmark-claim v1 chain=9800/).first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/claim-step1-${size}.png` });
    // step 2 after the comment scan finds the line
    await page.getByRole("button", { name: /find my comment/i }).click();
    await page.getByText(/@e2e-claimant/).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/claim-step2-${size}.png` });
    // step 3 — after the local signer returns a verified signature
    const stateFile = new URL("./.signer-state.json", import.meta.url).pathname;
    if (existsSync(stateFile)) {
      const { pairingCode } = JSON.parse(readFileSync(stateFile, "utf8")) as { pairingCode: string };
      await openLocalSigner(page);
      await page.getByPlaceholder(/8-char code/i).fill(pairingCode);
      await page.getByRole("button", { name: /sign the claim/i }).click();
      await page.getByText(/verified locally/i).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/claim-step3-${size}.png` });
    }
    // /me with the claims section
    await page.goto("/me");
    await page.getByText(/my claims/i).first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/me-claims-${size}.png` });
  }
  if (claimedId !== null) {
    await page.goto(`/bounty/${claimedId}`);
    await page.getByText(/your claim is live|claimed/i).first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/claimed-${size}.png` });
  }
  await page.goto("/signer");
  await page.waitForSelector("text=The local signer", { timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/signer-${size}.png` });
});
