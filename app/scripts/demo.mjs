#!/usr/bin/env node
// demo.mjs — local walk-through of the full Postmark lifecycle (e2e deployment).
// Serves the built app, opens one headed Chromium window per role, injects each
// profile's EIP-6963 test wallet plus a role badge, optionally opens scoped EVM
// windows, and prints the signer commands to run in separate terminals.
//   npm run demo -- [--github stub|live] [--roles r1,r2,…] [--no-windows] [--headless] [--smoke]
// --roles opens browser windows, scoped EVM windows and signer commands only for the
// named roles (default: all six — funder, claimant, verifier0, verifier1, verifier2,
// disputer). A run without a dispute needs: --roles funder,claimant,verifier0,verifier1
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { chromium } from "@playwright/test";
import { installTestWallet, mockGithub, connectInjected,
  windowCtl, profileAddress, nodePublic, E2E_ESCROW } from "../e2e/testWallet.ts";
import { postmarkEscrowAbi } from "../src/chain/abi.ts";
import { parseRoles } from "./demoRoles.ts";

const SIGNER_PORTS = { claimant: 47321, verifier0: 47322, verifier1: 47323, verifier2: 47324 };
const PORT = 4173;
const PROFILES = `${homedir()}/.config/postmark/e2e`;

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const github = flag("github", "stub");
const noWindows = args.includes("--no-windows");
const headless = args.includes("--headless");
const smoke = args.includes("--smoke");
if (!["stub", "live"].includes(github)) {
  console.error("--github must be stub|live"); process.exit(2);
}
let ROLES;
try { ROLES = parseRoles(args); }
catch (e) { console.error(`[demo] ${e.message}`); process.exit(2); }

const ts = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[demo ${ts()}] ${m}`);

const ctxs = [];
const pages = {};
const openedWindows = [];
let browser = null, server = null;

async function cleanup() {
  log("closing…");
  for (const p of openedWindows) {
    try { windowCtl(["close"], p); log(`window closed: ${p}`); }
    catch { log(`window already closed/expired: ${p}`); }
  }
  for (const c of ctxs) await c.close().catch(() => {});
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

const appUrl = (path = "") => `http://localhost:${PORT}${path}`;
const ONE_WINDOW = ["open", "1200", "10", "600000", E2E_ESCROW];

// ---- build + serve (e2e deployment only) ----
async function portInUse() {
  try { await fetch(appUrl()); return true; } catch { return false; }
}

async function buildAndServe() {
  log("building app (VITE_DEPLOYMENT=e2e)…");
  execFileSync("npm", ["run", "build:e2e"], { stdio: "inherit" });
  if (await portInUse()) { // fail fast if something else owns the port
    console.error(`[demo] port ${PORT} is already in use — stop the other server first`);
    process.exit(1);
  }
  server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"],
    { stdio: ["ignore", "pipe", "inherit"] });
  server.on("exit", (c) => { if (c !== null && c !== 0) { console.error(`[demo] preview exited ${c}`); process.exit(1); } });
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error("preview did not come up")), 30_000);
    const poll = setInterval(async () => {
      if (await portInUse()) { clearInterval(poll); clearTimeout(to); res(); }
    }, 400);
  });
  log(`preview on ${appUrl()}`);
}

// ---- chain facts for the stub fixtures ----
const unixNow = () => BigInt(Math.floor(Date.now() / 1000));

/** First still-claimable Open bounty (newest first), for the smoke check. */
async function findOpenBounty(pub, nextId) {
  for (let i = nextId - 1n; i >= 1n; i--) {
    const b = await pub.readContract({ address: E2E_ESCROW, abi: postmarkEscrowAbi,
      functionName: "getBounty", args: [i] });
    if (b.state === 0 && b.deadline > unixNow() + b.claimTimeout) return i;
  }
  return null;
}

// ---- scoped windows per role ----
function openRoleWindows() {
  if (noWindows) { log("--no-windows: read-only run, no scoped windows opened"); return; }
  for (const role of ROLES) {
    try {
      windowCtl(ONE_WINDOW, role);
      openedWindows.push(role);
      log(`window opened: ${role} (1200 blocks, 10 txs, 600k uqor cap, target=escrow)`);
    } catch {
      log(`window open failed for ${role} — continuing read-only for it`);
    }
  }
}

// ---- one browser window per role ----
async function launchRole(role, { mergedAt, nextId }) {
  const ctx = await browser.newContext({ viewport: { width: 1120, height: 800 } });
  const page = await ctx.newPage();
  await installTestWallet(page, role);
  // visible role badge — injected, no app changes
  await page.addInitScript(({ role: r, addr }) => {
    window.addEventListener("DOMContentLoaded", () => {
      const b = document.createElement("div");
      b.textContent = `${r.toUpperCase()}  ${addr.slice(0, 8)}…${addr.slice(-4)}`;
      b.style.cssText = "position:fixed;top:0;right:0;z-index:2147483647;" +
        "font:500 11px/1 ui-monospace,monospace;letter-spacing:.15em;" +
        "background:#e1482f;color:#070b14;padding:5px 10px;border-radius:0 0 0 8px";
      document.body.appendChild(b);
    });
  }, { role, addr: profileAddress(role) });
  if (github === "stub") {
    await mockGithub(page, { mergedAt,
      synthesize: { claimant: profileAddress("claimant"), upToId: nextId + 50n } });
  }
  await page.goto(appUrl("/explore"));
  await connectInjected(page);
  ctxs.push(ctx);
  pages[role] = page;
  if (smoke) {
    await page.getByText(new RegExp(`^${role.toUpperCase()}  0x`, "i")).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: new RegExp(profileAddress(role).slice(0, 6), "i") })
      .first().waitFor({ timeout: 15_000 });
    log(`smoke: ${role} badge + wallet connected`);
  }
  log(`${role} window ready (${profileAddress(role)})`);
}

// ---- read-only smoke walkthrough ----
/** Review bounty #18 as `role` up to the built PAY verdict; returns its evidence line. */
async function reviewAsVerifier(role) {
  const pg = pages[role];
  await pg.goto(appUrl("/bounty/18/review"));
  await pg.getByRole("button", { name: /scan comments/i }).click();
  await pg.getByText(/identity matches/i).waitFor({ timeout: 60_000 });
  await pg.getByRole("button", { name: /find linked prs/i }).click();
  await pg.getByRole("button", { name: "#2", exact: true }).click();
  await pg.getByText(/merge_commit_sha present/i).waitFor({ timeout: 60_000 });
  await pg.getByRole("button", { name: "PAY", exact: true }).click();
  await pg.getByText(/message matches escrow\.verdictMessage/i).waitFor({ timeout: 60_000 });
  const ev = (await pg.getByText(/^evidenceHash 0x/).textContent()).trim();
  log(`smoke: ${role} review ok — ${ev.slice(0, 30)}…`);
  return ev;
}

async function claimantFindsClaimLine({ openId, nextId }) {
  const page = pages.claimant;
  if (openId !== null) {
    await page.goto(appUrl(`/bounty/${openId}`));
    await page.getByRole("button", { name: /posted it — find my comment/i }).click();
    await page.getByText(/found the claim line by @e2e-claimant/i).waitFor({ timeout: 60_000 });
    log(`smoke: claimant ClaimPanel found claim line on open bounty ${openId}`);
    return;
  }
  const hit = await page.evaluate(async (next) => {
    const r = await fetch(
      "https://api.github.com/repos/postmark-e2e/sandbox/issues/1/comments?per_page=100&page=1");
    const list = await r.json();
    return list.some((c) => c.body.includes(`bounty=${next}`));
  }, Number(nextId));
  if (!hit) throw new Error("comments endpoint missing claim line for next id");
  log(`smoke: no Open bounty — comments endpoint returns the claim line for #${nextId}`);
}

async function runSmoke(facts) {
  log("roles connected — running read-only walkthrough checks");
  // two verifier windows on the live Pending bounty: same identity match,
  // same PR checks, identical PAY evidence hash
  const verifiers = ROLES.filter((r) => r.startsWith("verifier")).slice(0, 2);
  const hashes = [];
  for (const v of verifiers) hashes.push(await reviewAsVerifier(v));
  if (hashes.length === 2) {
    if (hashes[0] !== hashes[1]) throw new Error(`evidence hashes differ: ${hashes}`);
    log(`smoke: identical PAY evidenceHash in ${verifiers.join(" and ")}`);
  } else log("smoke: fewer than two verifier roles — skipping the evidenceHash comparison");
  if (ROLES.includes("claimant")) await claimantFindsClaimLine(facts);
  else log("smoke: no claimant role — skipping the claim-line check");
  log(`smoke OK — ${ROLES.join(", ")} connected, badges visible`);
  await cleanup();
}

function printInstructions() {
  console.log(`
[demo] Signing roles need the local PQ signer, one terminal tab each
       (interactive TTY confirm — no --yes):
`);
  const signers = Object.entries(SIGNER_PORTS).filter(([role]) => ROLES.includes(role));
  if (signers.length === 0) console.log("  (none of the selected roles signs)\n");
  for (const [role, port] of signers) {
    console.log(
      `  # ${role} (port ${port})\n` +
      `  node scripts/signer.mjs serve --env ${PROFILES}/${role} ` +
      `--deployment e2e --origin ${appUrl()} --port ${port}\n`);
  }
  console.log(
    `[demo] Each signer prints an 8-char pairing code — paste it into the app's\n` +
    `       signer card (set the matching port) the first time that role signs.\n`);
  if (github === "stub") {
    console.log(
      `[demo] Stub-mode inputs:\n` +
      `       · issue URL for /create:  https://github.com/postmark-e2e/sandbox/issues/1\n` +
      `       · GitHub logins:          e2e-claimant (claim + identity) · e2e-disputer (dispute)\n` +
      `       · keep amount/reward/bond tiny — the funder has ~0.45 QOR (e.g. 0.01 / 0.005 / 0.005)\n`);
  }
}

async function main() {
  await buildAndServe();
  const pub = nodePublic();
  const nextId = await pub.readContract({ address: E2E_ESCROW,
    abi: postmarkEscrowAbi, functionName: "nextBountyId" });
  // One fixed merged_at for the whole run so every verifier builds the same PAY
  // evidence hash; synthesized claim/dispute comments cover every bounty id.
  const mergedAt = new Date(Number(unixNow()) * 1000).toISOString();
  const openId = await findOpenBounty(pub, nextId);
  log(`nextBountyId ${nextId}; fixed merged_at ${mergedAt}; open bounty ${openId ?? "none"}`);
  log(`roles: ${ROLES.join(", ")}`);

  openRoleWindows();
  browser = await chromium.launch({ headless });
  for (const role of ROLES) await launchRole(role, { mergedAt, nextId });
  if (smoke) await runSmoke({ openId, nextId });

  printInstructions();
  log(`github mode: ${github} · Ctrl-C closes every window and stops the preview`);
  await new Promise(() => {}); // stay up until Ctrl-C
}

await main();
