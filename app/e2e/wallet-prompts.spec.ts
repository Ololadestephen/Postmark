import { test, expect, type Page } from "@playwright/test";

// Stub MetaMask-like and QoreX-like wallets that record every provider call. Page load may only make
// non-interactive calls (eth_accounts, eth_chainId, capability reads); prompts need a user click.
const STUB = `(() => {
  const calls = (window.__calls = JSON.parse(sessionStorage.getItem("__calls") || "[]"));
  const save = () => sessionStorage.setItem("__calls", JSON.stringify(calls));
  const ADDR = "0x478F2A08a81be7CEa42bd34BD6900593fA56c4B6";
  const mk = (name, rdns) => {
    const p = { request: async ({ method }) => {
      calls.push(name + ":" + method); save();
      if (method === "eth_chainId") return "0x2648";
      if (method === "eth_accounts") return window.__authorized ? [ADDR] : [];
      if (method === "eth_requestAccounts" || method === "wallet_requestPermissions") {
        if (window.__reject) { const e = new Error("User rejected the request."); e.code = 4001; throw e; }
        window.__authorized = true; return [ADDR];
      }
      return null; }, on() {}, removeListener() {} };
    const info = { uuid: name + "-uuid", name, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider: p }) }));
    window.addEventListener("eip6963:requestProvider", announce); announce(); return p;
  };
  window.ethereum = mk("MetaMask", "io.metamask");
  const qx = mk("QoreX", "io.qorex.wallet");
  window.qorex = { evm: qx, native: {
    isQoreX: true, capabilities: ["listAccounts", "connectProofPicksAccount", "signAndBroadcast", "signArbitrary"],
    enable: async () => { calls.push("qorex.native:enable"); save(); },
    getKey: async () => { calls.push("qorex.native:getKey"); save(); return {}; },
    signDirect: async () => ({}), signArbitrary: async () => { throw new Error("n/a"); },
    listAccounts: async () => { calls.push("qorex.native:listAccounts"); save(); throw new Error("site not connected"); },
  } };
})();`;

const INTERACTIVE = /:(enable|getKey|connect|eth_requestAccounts|wallet_requestPermissions)$/;
const interactive = (page: Page) => page.evaluate(() => (JSON.parse(sessionStorage.getItem("__calls") || "[]") as string[]));

async function boot(page: Page, init = "") {
  await page.addInitScript(`window.__authorized = false; ${init}`);
  await page.addInitScript(STUB);
}
const settle = (page: Page) => page.waitForTimeout(2500);

test("page loads make no interactive wallet call, fresh or with a remembered connection", async ({ page }) => {
  await boot(page, `localStorage.getItem("seeded") || (localStorage.setItem("seeded","1"));`);
  for (const path of ["/", "/create", "/me"]) {
    await page.goto(path, { waitUntil: "networkidle" }); await settle(page);
    expect((await interactive(page)).filter((c) => INTERACTIVE.test(c)), `fresh ${path}`).toEqual([]);
  }
  await page.evaluate(() => {
    localStorage.setItem("wagmi.recentConnectorId", '"io.metamask"'); sessionStorage.setItem("__calls", "[]");
  });
  for (const path of ["/", "/create", "/bounty/1"]) {
    await page.goto(path, { waitUntil: "networkidle" }); await settle(page);
    expect((await interactive(page)).filter((c) => INTERACTIVE.test(c)), `remembered ${path}`).toEqual([]);
  }
});

test("a remembered connection that is no longer authorised is forgotten after one silent try", async ({ page }) => {
  await boot(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.setItem("wagmi.recentConnectorId", '"io.metamask"'));
  await page.goto("/create", { waitUntil: "networkidle" }); await settle(page);
  expect(await page.evaluate(() => localStorage.getItem("wagmi.recentConnectorId"))).toBeNull();
});

test("a cancelled connect is not retried on reload; Connect makes only the expected call", async ({ page }) => {
  await boot(page, "window.__reject = true;");
  await page.goto("/", { waitUntil: "networkidle" });
  expect(await interactive(page)).toEqual([]);
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "MetaMask" }).click();
  await expect(page.getByText("You cancelled the request in your wallet.")).toBeVisible();
  const afterClick = (await interactive(page)).filter((c) => INTERACTIVE.test(c));
  expect(afterClick.length).toBeGreaterThan(0);
  expect(afterClick.every((c) => c.startsWith("MetaMask:")), "only the chosen wallet is asked").toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("wagmi.recentConnectorId"))).toBeNull();
  await page.evaluate(() => sessionStorage.setItem("__calls", "[]"));
  await page.reload({ waitUntil: "networkidle" }); await settle(page);
  expect((await interactive(page)).filter((c) => INTERACTIVE.test(c))).toEqual([]);
});

test("a connected wallet stays connected when navigating to a page with its own wallet root", async ({ page }) => {
  await boot(page);
  await page.goto("/explore", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "MetaMask" }).click();
  await expect(page.getByRole("button", { name: /0x478F…c4B6/ })).toBeVisible();
  await page.getByRole("link", { name: "Dashboard", exact: true }).first().click();
  await expect(page.getByRole("tab", { name: "Funded" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Connect an EVM wallet to see your funded/)).toHaveCount(0);
});
