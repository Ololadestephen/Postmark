import { test, expect, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { bytesToHex, encodeAbiParameters, hexToBytes } from "viem";
import { mldsa87 } from "@qorechain/pqc";
import { installTestWallet, mockGithub, E2E_ESCROW } from "./testWallet";

const OUT = "../notes/screens/verifier-signup";
test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

const pair = mldsa87.keygen(new Uint8Array(32).fill(7));
const PUBKEY = bytesToHex(pair.publicKey);
const GOOD = "0x1111111111111111111111111111111111111111";
const IMPOSTOR = "0x2222222222222222222222222222222222222222";
const message = (address: string, login: string) => bytesToHex(new TextEncoder().encode(
  `qorechain-msg-v1|qorechain-diana|postmark-verifier-v1|${E2E_ESCROW.toLowerCase()}|${address}|${login}`));
const sig = (address: string, login: string) => bytesToHex(mldsa87.sign(pair.secretKey, hexToBytes(message(address, login))));
const body = (address: string, login: string) =>
  "```\npostmark-verifier v1 " + address + " " + login + " " + sig(address, login) + "\n```";

const STATUS = encodeAbiParameters(
  [{ type: "bool" }, { type: "uint8" }, { type: "bytes" }, { type: "bool" }], [true, 1, PUBKEY, true]);
const isStatusCall = (r: { method?: string; params?: unknown[] }) => {
  const p = (r.params?.[0] ?? {}) as { to?: string; data?: string };
  return r.method === "eth_call" && p.to?.toLowerCase().endsWith("0a02")
    && [GOOD, IMPOSTOR].some((a) => p.data?.toLowerCase().includes(a.slice(2)));
};

async function liveKeysForStubs(route: Route) {
  const req = JSON.parse(route.request().postData() ?? "null");
  const list = (Array.isArray(req) ? req : [req]) as { id: number; method?: string; params?: unknown[] }[];
  const mine = list.filter(isStatusCall);
  if (mine.length === 0) return route.fallback();
  const rest = list.filter((r) => !isStatusCall(r));
  const remote = rest.length
    ? ((await (await route.fetch({ postData: JSON.stringify(Array.isArray(req) ? rest : rest[0]) })).json()) as unknown)
    : [];
  const all = [...mine.map((r) => ({ jsonrpc: "2.0", id: r.id, result: STATUS })), ...(Array.isArray(remote) ? remote : [remote])];
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Array.isArray(req) ? all : all[0]) });
}

test("only a valid self-listing shows in the Create picker", async ({ page }, testInfo) => {
  await mockGithub(page);
  await page.route("https://api.github.com/repos/Ololadestephen/Postmark/issues/6/comments*", (route) => route.fulfill({
    status: 200, headers: { "content-type": "application/json" },
    body: JSON.stringify([
      { id: 11, user: { login: "valid-user" }, body: body(GOOD, "valid-user"), created_at: "2026-01-01T00:00:00Z" },
      { id: 12, user: { login: "someone-else" }, body: body(IMPOSTOR, "victim"), created_at: "2026-01-02T00:00:00Z" },
    ]),
  }));
  await page.route(/evm-testnet\.qore\.host/, liveKeysForStubs);
  await installTestWallet(page);
  await page.goto("/create");
  await expect(page.getByText("Self-listed verifiers (not vetted)")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "@valid-user" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("@victim")).toHaveCount(0);
  await expect(page.getByText("@someone-else")).toHaveCount(0);
  await page.getByRole("button", { name: "@valid-user" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/picker-${testInfo.project.name}.png` });
});

test("join page renders without wallet prompts", async ({ page }, testInfo) => {
  await page.goto("/verifiers/join");
  await expect(page.getByRole("heading", { name: "Become a verifier" })).toBeVisible();
  await expect(page.getByText(/proves you control a post-quantum key/)).toBeVisible();
  await page.screenshot({ path: `${OUT}/join-${testInfo.project.name}.png`, fullPage: true });
});
