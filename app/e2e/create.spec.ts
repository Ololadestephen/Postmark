import { openManualVerifiers, openAdvancedSettings } from "./support/easyUi";
import { test, expect } from "@playwright/test";
import { installTestWallet, installProvider, mockGithub, verifierAddr } from "./testWallet";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const ISSUE_URL = "https://github.com/postmark-e2e/sandbox/issues/1";

test.use({ ignoreHTTPSErrors: true });
test.describe.configure({ retries: 0 }); // chain txs must not retry

test("funder creates a bounty on diana e2e escrow", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "chain tx — desktop only");
  await mockGithub(page);
  await installTestWallet(page);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/create");
  // connect the injected wallet
  const connectBtn = page.getByRole("button", { name: /connect/i }).first();
  if (await connectBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await connectBtn.click();
    const pick = page.getByText("Postmark E2E");
    await pick.click({ timeout: 10_000 }).catch(() => undefined); // the wallet chunk loads on the click
    await page.locator("dialog").first().waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
  }

  await page.getByPlaceholder(/github\.com\/owner\/repo/i).fill(ISSUE_URL);
  await expect(page.getByText("Postmark sandbox: wire the funder flow"))
    .toBeVisible({ timeout: 15_000 });

  // amounts: 0.2 / 0.05 / 0.05
  await openAdvancedSettings(page);
  const inputs = page.locator('input[inputmode="decimal"]');
  await inputs.nth(0).fill("0.2");
  await inputs.nth(1).fill("0.05");
  await inputs.nth(2).fill("0.05");

  // deadline now + 3h
  const dl = new Date(Date.now() + 3 * 3600_000);
  const local = new Date(dl.getTime() - dl.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);
  await page.getByRole("button", { name: "Pick a date" }).click();
  await page.locator('input[type="datetime-local"]').fill(local);
  await page.getByRole("button", { name: "1 h", exact: true }).click();

  await openManualVerifiers(page);
  for (let i = 0; i < 3; i++) {
    await page.getByPlaceholder(new RegExp(`Verifier ${i + 1}`)).fill(verifierAddr(i));
  }

  const btn = page.getByRole("button", { name: /create bounty/i });
  await expect(btn).toBeEnabled({ timeout: 20_000 });
  await btn.click();

  // submitted → confirmed → redirect to explore
  await expect(page.getByRole("status")
    .getByText(/submitted|confirming|confirmed/i))
    .toBeVisible({ timeout: 60_000 });
  await page.waitForURL("**/explore", { timeout: 90_000 });

  // explore shows it Open
  await expect(page.getByText("postmark-e2e/sandbox#1").first())
    .toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("open", { exact: false }).first()).toBeVisible();

  // dashboard lists it
  await page.goto("/me");
  await expect(page.getByText("postmark-e2e").or(page.getByText(/#\d+/)).first())
    .toBeVisible({ timeout: 75_000 });
  expect(errors).toEqual([]);
});

test("verifier without a PQ key is caught before sending", async ({ page }) => {
  await mockGithub(page);
  await installTestWallet(page);
  await page.goto("/create");
  await page.getByPlaceholder(/github\.com\/owner\/repo/i).fill(ISSUE_URL);
  await expect(page.getByText("Postmark sandbox")).toBeVisible({ timeout: 15_000 });
  // random fresh addresses with no keys
  for (let i = 0; i < 3; i++) {
    const a = "0x" + ((i + 1) * 7919).toString(16).padStart(8, "f") +
      "ab".repeat(16);
    await page.getByPlaceholder(new RegExp(`Verifier ${i + 1}`)).fill(a.slice(0, 42));
  }
  await page.getByRole("button", { name: /create bounty/i }).click();
  await expect(page.getByText(/no live|no key|ML-DSA/i).first())
    .toBeVisible({ timeout: 20_000 });
});

test("an account with no window sees the QoreX guide (no tx sent)", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "chain state — desktop only");
  await mockGithub(page);
  // the disputer profile has a live PQ key but no EVM window — preflight
  // must stop at the QoreX guide without ever reaching the wallet
  const env = readFileSync(`${homedir()}/.config/postmark/e2e/disputer.env`, "utf8");
  const disputer = env.match(/^ADDRESS=(0x[0-9a-fA-F]{40})$/m)![1]!;
  await installProvider(page, (req) => {
    if (req.method === "eth_accounts" || req.method === "eth_requestAccounts") return [disputer];
    if (req.method === "eth_chainId") return "0x2648";
    if (req.method === "eth_sendTransaction")
      throw new Error("a transaction was sent — preflight failed");
    throw new Error("unexpected " + req.method);
  });
  await page.goto("/create");
  const connectBtn = page.getByRole("button", { name: /connect/i }).first();
  if (await connectBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await connectBtn.click();
    const pick = page.getByText("Postmark E2E");
    await pick.click({ timeout: 10_000 }).catch(() => undefined); // the wallet chunk loads on the click
    await page.locator("dialog").first().waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
  }
  await page.getByPlaceholder(/github\.com/i).fill(ISSUE_URL);
  await openManualVerifiers(page);
  for (let i = 0; i < 3; i++) {
    await page.getByPlaceholder(new RegExp(`Verifier ${i + 1}`)).fill(verifierAddr(i));
  }
  await page.getByRole("button", { name: /create bounty/i }).click();
  await expect(page.getByText(/no open evm authorisation window/i))
    .toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/open an evm access window in qorex/i))
    .toBeVisible();
});
