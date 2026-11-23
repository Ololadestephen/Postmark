# Postmark — Build Before Q-Day

[![Built on QoreChain](https://build.qorechain.io/badge/postmark.svg)](https://build.qorechain.io/p/postmark)

QoreChain Post-Quantum dApp track: a reusable **real ML-DSA-87 Foundry test
library**, plus `PostmarkEscrow`, a bounty escrow for GitHub code work and on-chain tasks: contributors make a PQ-signed claim,
and payout needs 2-of-3 ML-DSA-87 verifier verdicts.
**Real issues, testnet payouts**: diana pays test QOR, which has no monetary value.

Repository: [github.com/Ololadestephen/Postmark](https://github.com/Ololadestephen/Postmark) · Project page: [build.qorechain.io/p/postmark](https://build.qorechain.io/p/postmark)

**Live demo:** [usepostmark.vercel.app](https://usepostmark.vercel.app) (diana testnet; test QOR has no monetary value)

## How it works

1. **Fund** — a funder locks test QOR on a GitHub issue or PR, naming three verifier accounts and a claim deadline.
2. **Claim** — a contributor posts their `postmark-claim v1 …` line as a GitHub comment, then claims with an ML-DSA-87 signature that binds their GitHub identity to their payout address.
3. **Verdict** — 2 of the 3 verifiers review the work off-chain and each sign a PAY or REFUND verdict; anyone relays the signatures to `submitVerdict`.
4. **Challenge** — a winning verdict sits Pending for 24 hours. Anyone can bond a dispute; a bonded dispute freezes the payout.
5. **Resolution** — the same verifier set signs a second DISPUTE-phase verdict; upheld sends the bond plus challenge reward to the disputer, rejected pays the original verdict.
6. **Withdraw** — payouts land as pull-payment credits; the payee withdraws to their own address (a live PQ key is required for gated credits).

### Task types

Every bounty points at a GitHub issue or PR on chain. An issue can also carry a `postmark-task` block that turns it into a task bounty; the contract is the same for every type (formats in [SPEC.md](SPEC.md)).

| Type | The work | Who decides | Status |
|---|---|---|---|
| Code (no task block) | A merged PR by the claimant that says `Fixes #N` (or Closes/Resolves) | The verifier bots | Live |
| `onchain-call` | A successful transaction from the claimant's address to a given contract, optionally a given function, after the claim and before the deadline | The verifier bots, from diana chain data | Live ([bounty #4](https://usepostmark.vercel.app/bounty/4)) |
| `onchain-deploy` | A direct contract creation from the claimant's address, optionally with a given runtime codehash | The verifier bots, from diana chain data | Live |
| `testing`, `url` | A `postmark-submission v1 url=…` comment, with the report below it for testing | Human verifiers (the bots abstain); at least two of the three must be people | Built, off by default (`VITE_HUMAN_TASKS=1`) until one is paid on production |

For task bounties the claim line carries a hash of the brief (`brief=0x…`). If the funder edits or removes the block after the claim, the bots abstain and the page says so. The claimant posts `postmark-proof v1 tx=0x…` for on-chain tasks; the claimed bounty page checks the transaction and builds that line.

## Deployment (diana testnet, testnet payouts only)

| Item | Value |
|---|---|
| PostmarkEscrow (production) | [`0x13De819fE37133d19287aAFE1991a921F84b9F45`](https://dashboard.qorechain.io/explorer/address/0x13De819fE37133d19287aAFE1991a921F84b9F45) (chain 9800, `qorechain-diana`) |
| Deploy tx | [`0xa01ae24d…3ffdbc`](https://dashboard.qorechain.io/explorer/tx/0xa01ae24d57869e0e16bbfbfec29a36a539bd65998600188d1f5439b0663ffdbc), block 10429957, 3,389,585 gas |
| Deployer | `0x9d7d0f1364d6F37115d1d5be1C89362595287313` (testnet-only key with a registered ML-DSA-87 key) |
| Scoped EVM window | opened `E0AEE6F4…35BE10` (600 blocks, 3 txs, 2 QOR cap; no target list, because a target list refuses contract creation), closed right after the deploy in `F6093526…2E2893` |

The on-chain code matches `forge inspect PostmarkEscrow deployedBytecode` byte for byte. Full record, including the
superseded first deployment: [`deployments/diana.json`](deployments/diana.json). Window tooling:
`npm run window -- status|register|open|close`. In the explorer, switch the network to Testnet (diana).

A dedicated **e2e instance** lives at
[`0xae80681E92b63eFEa78cB742dd612ecc940B896A`](https://dashboard.qorechain.io/explorer/address/0xae80681E92b63eFEa78cB742dd612ecc940B896A)
(deploy tx `0xc8325407…076cd4`, block 10396129) so test bounties never pollute the production
deployment's Explore view. Record: [`deployments/diana-e2e.json`](deployments/diana-e2e.json).

## Setup

Requires Node 22 (>=20.19) and Foundry. `ffi=true` is enabled — the PQC mocks shell out to
`scripts/pqc.mjs`, so tests need trusted local FFI execution.

```sh
npm ci                         # root: pins @qorechain/pqc + pinned Forge binary
git submodule update --init lib/forge-std
forge test -vv                 # or npm test (uses the pinned npm Forge binary)
cd app && npm ci && npm run dev
```

Check that an account's ML-DSA-87 key is live on diana: `npm run key-status -- qor1...`.

The web app targets the production deployment by default. To point it at the e2e instance:

```sh
cd app && VITE_DEPLOYMENT=e2e npm run dev     # or `npm run build:e2e` for a built bundle
```

Sending transactions needs two things: a connected EVM wallet on chain 9800 and a live **EVM access window** for the account. On diana, EVM writes are authorised through a Cosmos-lane `MsgOpenEVMWindow` (block limit, tx count, value cap). QoreX manages that message itself and rejects it from a website, so a user opens the window by hand: in QoreX on the same account, tap the **MetaMask on QoreChain** card (the 0x mark; on the phone app also Settings, Security, EVM access window), set **Blocks** 1000 (about 20 minutes), **Max transactions** 5 and a **Spending cap** that covers the amount plus fees (the cap counts each transaction's maximum fee), then confirm. Open it before clicking the action, because opening it advances the account nonce. The app shows these steps wherever a window is missing and has an "I opened it, check again" button.

### Signing: QoreX, with a local signer as an Advanced option

**QoreX must be on testnet.** QoreX starts on mainnet (`qorechain-vladi`) and a dapp cannot switch it; signing then fails with "message chain qorechain-diana does not match the active network". Extension: unlock it, tap the version number at the bottom 7 times, then choose *Switch to testnet (diana)* (the Home badge then shows TESTNET). Phone app: Settings, then *Use testnet (developers)*. The app reads QoreX's network (`eth_chainId`, no prompt) when you click a button that needs QoreX and stops with these steps instead of opening a prompt.

**QoreX setup, in order.** (1) Install QoreX. (2) Switch it to testnet (the 7-tap steps above). (3) In *Your accounts* choose *Add an Ethereum account (coin 60)* and select it: QoreX's default account is a coin-118 Cosmos key that can't sign for an EVM address, while the coin-60 account is derived from your recovery phrase at m/44'/60' and has its own address. (4) Fund that address from the faucet. (5) Make one send in QoreX so its post-quantum key registers. (6) Import the same recovery phrase (a testing phrase only) into MetaMask on chain 9800; MetaMask index 0 then shows the same 0x address. Funders, claimants and verifiers all need this. The app's "different accounts" message links these steps.

Claim and verdict messages are signed in the browser with **QoreX** (`signArbitrary`, ML-DSA-87 hybrid
signing): click *Sign with QoreX*, approve, and the app verifies the returned signature against your live
registered key before anything is sent. QoreX still cannot send EVM transactions, so transactions come from
an EVM wallet (for example MetaMask) holding the **same account** as QoreX.

**Send with QoreX (no MetaMask), off by default.** QoreX currently refuses `MsgCrossVMCall` ("QoreX cannot show what /qorechain.crossvm.v1.MsgCrossVMCall does, so it will not sign it"), so the buttons only appear in a build with `VITE_QOREX_NATIVE=1`. With it on, claim, finalize and withdraw also offer *Send with QoreX*: the app wraps the
escrow call in a `MsgCrossVMCall` and QoreX signs and broadcasts it (`signAndBroadcast`), with no EVM window.
Before sending it shows the maximum fee: withdraw uses a fixed 1,000,000 gas limit (0.10 QOR); claim and finalize
are simulated on diana for the exact call and padded for the hybrid signature. Funding a bounty and posting a
dispute bond stay on MetaMask, because a native cross-VM call can't attach QOR.

For developers, **Advanced: use the local signer** keeps the older terminal flow: `scripts/signer.mjs`, a small
HTTP service on 127.0.0.1 that holds the ML-DSA-87 key, asks for confirmation on the TTY, and only signs after
re-verifying the exact bytes the escrow will hash:

```sh
npm run signer -- serve --env ~/.config/postmark/<profile> --origin http://localhost:5173 --port 47321
```

The profile directory holds a mode-600 `config.env` with `MNEMONIC` (QoreX-derived key, optional
`HD_INDEX`) or `PQC_RECOVERY_CODE` (QRC1), plus the account's address files — the signer refuses to
start unless the derived key equals the account's live registered key. It prints a pairing code that
the app must send on every request. Offline `sign-claim` / `sign-verdict` subcommands print a
signature hex for copy/paste.

### Local demo

`cd app && npm run demo` serves the e2e build and opens one headed Chromium window per role (funder, claimant,
verifier0, verifier1, verifier2, disputer), each with its own test wallet, a scoped EVM window and the signer
command to run. `--roles` limits all three to the named roles; a run without a dispute only needs four:

```sh
cd app && npm run demo -- --roles funder,claimant,verifier0,verifier1
```

Other flags: `--github stub|live` (default `stub`), `--no-windows` (read-only, no scoped windows), `--headless`
and `--smoke` (read-only checks, then exit; works with any `--roles` subset). An unknown role name exits with
the list of valid roles.

## Production bounties

Real GitHub issues in [Ololadestephen/postmark](https://github.com/Ololadestephen/postmark), funded on the production escrow
(`0x13De819fE37133d19287aAFE1991a921F84b9F45`) with test QOR, no monetary value. Verifiers: the Postmark bot, the funder's
own bot and the maintainer as a human tie-breaker. Every verdict below was signed and relayed by the bots on their own schedule.

| Bounty | Work | Reward | Create | Claim | Verdict (PAY) | Finalize | State |
|---|---|---|---|---|---|---|---|
| #1 | [issue #1](https://github.com/Ololadestephen/postmark/issues/1) · [PR #7](https://github.com/Ololadestephen/Postmark/pull/7) | 0.05 | [`0x6e0a0548…4148`](https://dashboard.qorechain.io/explorer/tx/0x6e0a0548ab1eb584db1df015bb65338d2bac2a3c7c4b539bd987ef05b1514148) | [`0x1b250117…8c59`](https://dashboard.qorechain.io/explorer/tx/0x1b2501170991297e9e09926524ec8d86a64c8fe14a53be9b803e000f47e08c59) | [`0x4204c3d9…adaf`](https://dashboard.qorechain.io/explorer/tx/0x4204c3d9b2d3dbb9edae70fb42d5b0f0a42b6ef6fc834293a6b1846edaf4adaf) | [`0xc0ecea48…3347`](https://dashboard.qorechain.io/explorer/tx/0xc0ecea48fe5023590f9820884887d65ee05405a3c2cf962281786f5af2de3347) | Paid |
| #2 | [issue #2](https://github.com/Ololadestephen/postmark/issues/2) | 0.05 | [`0xf465ab3d…bf2a`](https://dashboard.qorechain.io/explorer/tx/0xf465ab3d0802f1c1287b02f3d8fc4e6bb1f034ce4a55797d21ea2ac36899bf2a) | [`0xa0b7243a…0a7c`](https://dashboard.qorechain.io/explorer/tx/0xa0b7243a70d1d69edf85bc204e6c549e256fade0465fbb366b271c75b48d0a7c) | [`0xb0dd5576…cc83`](https://dashboard.qorechain.io/explorer/tx/0xb0dd5576d2abf313f008a2a73d6420e510e4731941466e59bb248e6999f7cc83) | [`0xc16f2c36…86b4`](https://dashboard.qorechain.io/explorer/tx/0xc16f2c366e202e19d97d29c033522c23eb5f26b69b047a3b8c5a9127fa9d86b4) | Paid in error, see below |
| #3 | [issue #8](https://github.com/Ololadestephen/postmark/issues/8) · [PR #9](https://github.com/Ololadestephen/Postmark/pull/9) | 10 | [`0x6dcc70c2…b4b4`](https://dashboard.qorechain.io/explorer/tx/0x6dcc70c20de48b092c7a3faf39ff4eb2601780a5e19ee16f51255ff43e5bb4b4) | [`0x509ece7c…e7a2`](https://dashboard.qorechain.io/explorer/tx/0x509ece7c75739715ab46bb196e1ecc29fa98ba829de4a931039872c8ef71e7a2) | [`0xaacfa1c0…c101`](https://dashboard.qorechain.io/explorer/tx/0xaacfa1c0f5173dd2b42827567a28cabb1fb67f1c82451398272bb47f0a4fc101) | [`0xc1174bb5…98d0`](https://dashboard.qorechain.io/explorer/tx/0xc1174bb5b3f1c735c4f276f7877fd1703c1a7c4cb016bb01e94c4e1d3c3b98d0) | Paid |
| #4 | [issue #10](https://github.com/Ololadestephen/postmark/issues/10) (`onchain-call`) | 5 | [`0x542c98da…eaf0`](https://dashboard.qorechain.io/explorer/tx/0x542c98dac8092dbb82a49e6c502e07e7e0516c2a03228afc1746248317d5eaf0) | open | | | Open until 29 Nov 12:00 UTC |

**Withdrawal.** The claimant withdrew all three payouts, 10.1 test QOR, in one transaction:
[`0x961bf677…ea6b`](https://dashboard.qorechain.io/explorer/tx/0x961bf677522f4d636d7f10a21567a703258734a35452bdb529d3e2aff257ea6b).
He also sent the three finalize transactions himself after each challenge window closed.

**Who did the work.** Bounties #1 and #3 were claimed and completed by [@ToluEnoch](https://github.com/ToluEnoch), an outside contributor who is not a team member. He claimed them with his own registered ML-DSA-87 key and was paid through Postmark like any contributor.

**Bounty #2 was paid in error.** Its verdict came from a GitHub cross-reference: PR #9 (the bounty #3 work) was linked to issue #2 by a maintainer comment that mentioned it, and the bots then counted it. The bots now require a PR to close the exact issue. The 0.05 test QOR payout was left standing; the full incident is in [docs/AUDIT.md](docs/AUDIT.md).

## Testing

| Command | Covers |
|---|---|
| `forge test` (or `npm test`) | 126 Foundry tests: claims, verdicts, disputes, withdrawals, reentrancy, invariants — all against real ML-DSA-87 signatures, plus the live Diana precompiles in the `test-utils` mocks |
| `npm run test:signer` | Node tests for the local signer: origin/pairing refusal, message-mismatch and claimant-mismatch refusal, key-equality and file-mode startup checks, and calldata regression against Viem `encodeFunctionData` |
| `cd app && npm test` | Vitest suites: form validation, preflight decisions, comment-scan pagination, verdict-bundle merge/verify with real signatures, dispute hashes, mocked-clock finalize/dispute boundaries |
| `cd app && npm run test:chain` | Live-RPC byte-match tests: app-built `claimMessage`/`verdictMessage` (both phases) vs the deployed escrow on diana |
| `cd app && npm run typecheck && npm run build` | Strict TS + production bundle |
| `cd app && npm run e2e` | Playwright on real diana with an injected EIP-6963 test wallet: create → claim → 2-of-3 verdict → dispute → resolution → withdraw. Only GitHub is route-mocked. **Spends test QOR** from disposable profiles in `~/.config/postmark/e2e/` and opens scoped windows |
| `cd app && E2E_NO_WINDOWS=1 npx playwright test e2e/screens-w4.spec.ts` | Read-only/screenshot runs against existing e2e fixtures — no transactions, no windows |

## Run your own verifier

A verifier is an account with a registered ML-DSA-87 key that signs PAY or REFUND verdicts. `bot/` is a scheduled GitHub Action that does this automatically, so a claim doesn't wait on a person. The curated set is two bots plus a human tie-breaker: the Postmark verifier bot (a private-repo Action, every 15 minutes), the Postmark public verifier bot (the Action in this repository, with public run logs) and the maintainer as a human tie-breaker. All three are run by the Postmark maintainer today, so they are not independent parties; replace one with your own repo's bot for more independence.

**Become a verifier (self-service).** Anyone can list themselves without maintainer approval at `/verifiers/join` in the app. Connect QoreX, make sure your post-quantum key is live (one send registers it), enter your GitHub username and sign with QoreX. The app produces one line, `postmark-verifier v1 <0x address> <github login> <signature>`, to post as a comment on the public registry issue [Ololadestephen/Postmark#6](https://github.com/Ololadestephen/Postmark/issues/6). The signature covers the escrow address, your address and your login, so it can't be reused on another deployment or by another account. The Create picker lists a self-listing under "Self-listed verifiers (not vetted)" only if the commenter's GitHub login matches the login in the line, the key is live and the ML-DSA-87 signature verifies (newest 50 comments, latest valid comment per address wins, curated addresses are skipped). To leave the list, delete your comment. Self-listing proves you control a post-quantum key, not independence: funders choose whom to trust. "Pick 3 for me" uses the curated set only. The bot's dispute relay still trusts only the curated humans (`POSTMARK_HUMAN_VERIFIERS`), so a self-listed human verifier submits their own signature from the Review page in a dispute.

**What the bot checks.** Every run, for each bounty that names its address as a verifier:

- **Claim identity.** A `postmark-claim v1 …` comment on the issue or PR for this chain, escrow, bounty and claimant, whose GitHub login, claimant and comment id hash to the bounty's stored identity hash.
- **The work.** For a PR bounty, that PR; for an issue bounty, PRs from the same repository whose title or description closes that exact issue (`Fixes`, `Closes` or `Resolves #N`). A mere mention or cross-reference does not count (see the bounty #2 incident in [docs/AUDIT.md](docs/AUDIT.md)). A PR qualifies only if it is merged, merged before the deadline and before now, authored by the claimant's login, in the same repo, and has a merge commit.
- **On-chain tasks.** The claim line's brief hash must match the issue's current task block. Each `postmark-proof v1 tx=…` comment from the claimant's GitHub login is checked on diana: succeeded, sent by the claimant, after the claim, before the deadline, right contract and function (or a direct deployment with the right codehash). The earliest passing proof that hasn't already paid another bounty wins; its evidence hash covers the type, transaction, block time and claimant.
- **PAY** for a code bounty only when exactly one PR qualifies. The evidence hash is built from the repo, PR, merge commit, merge time and author.
- **REFUND** only when it is conclusive: a PR bounty whose PR was closed unmerged (`not-merged`) or merged by someone else (`ineligible`); an issue closed as not planned (`withdrawn`); or an issue completed by merged PRs none of which are the claimant's (`ineligible`).
- **Abstain** otherwise: past the deadline, no matching claim comment, GitHub unavailable (any API error), no merged PR from the claimant yet, several qualifying PRs, or the locally built message differs from the contract's `verdictMessage`. It never guesses.

**The comment protocol.** With `post-comments` on, the bot posts its signed verdict on the issue or PR: a `<!-- postmark-verdict v1 -->` marker, a one-line summary, and a `postmark-verdict-bundle-v1` JSON block holding exactly its own signature. Humans can post the same thing from the review page ("Copy as GitHub comment"). Anyone's run can collect two valid matching comments and relay them; a comment is only trusted after its signature verifies against that verifier's live key. The `(bot)`/`(human)` label in a comment is self-declared and ignored.

**The verdict board.** A bot's `GITHUB_TOKEN` can only comment in its own repository, so for a bounty on any other repo it can't post on the bounty's issue. Instead it posts its signed verdict on a *verdict board* issue in its own repo: `POSTMARK_VERDICT_BOARDS` (comma list of `owner/repo#issue`, default the public board `Ololadestephen/Postmark#4`). Posting: on the bounty's issue when the bounty is in the bot's own repo, otherwise on the first board in the bot's repo, otherwise not at all. Reading: every run reads verdict comments from the bounty's issue and every board, and de-duplicates them. Board comments are only more candidate signatures: each is still verified against the verifier's live key and the bounty's current nonce, round, phase, escrow and id, so a board can't inject anything. The `verdict-boards` action input sets the list.

**Quorum, disputes and the human tie-break.** The bot relays two valid, matching signatures for the current nonce and claim round, preferring its own. If it has its own verdict it only counts that message; if it abstained it may still relay a matching pair from comments. In a dispute the bot never overrules alone: it relays a resolution only when the chosen pair includes a human verifier, identified strictly by address (`POSTMARK_HUMAN_VERIFIERS`, default the curated human entries). Every transaction is simulated first and skipped if it would revert. Pending bounties whose challenge window has closed are finalized.

**Add the bot to your repository.**

1. Copy [`bot/examples/funder-workflow.yml`](bot/examples/funder-workflow.yml) to `.github/workflows/postmark-verifier.yml` and pin `Ololadestephen/Postmark/bot@<sha>` to a reviewed commit.
2. Create the verifier account and register its key (from this repo, with `npm ci`):

   ```sh
   node scripts/window.mjs new-account my-bot          # writes ~/.config/postmark/e2e/my-bot.env and my-bot-pqc.env
   node scripts/window.mjs --env ~/.config/postmark/deployer send <0x-or-qor1-of-my-bot> 300000   # 0.3 test QOR (300000 uqor)
   node scripts/window.mjs --env ~/.config/postmark/e2e/my-bot register
   node scripts/key-status.mjs <qor1-of-my-bot>        # expect registered, alg 1, 2592-byte key, possession proven
   ```

   Fund it from any account that has test QOR, such as the faucet. The bot needs a little test QOR for gas and for opening its transaction window.
3. Add two **encrypted repository secrets**: `POSTMARK_FUNDER_VERIFIER_KEY` (the `KEY=` value, 0x hex) and `POSTMARK_FUNDER_VERIFIER_PQC` (the `PQC_RECOVERY_CODE=` value). Never put them in a file.
4. Start with `dry-run: "true"` and read the run log and job summary. Switch it to `"false"` once the decisions look right.
5. Name the bot's `0x…` address as one of the three verifiers when you create a bounty.

**Security notes.** Trigger the workflow only on `schedule` and `workflow_dispatch`; never `pull_request` or `pull_request_target`, which would expose secrets to pull requests. Keys live only in encrypted secrets and are never logged. The bot refuses to run unless its derived ML-DSA-87 key is the account's live registered key. Each run opens one EVM window scoped to the escrow contract (about 300 blocks, a handful of transactions) and always closes it. The committed `bot/dist/postmark-verifier.mjs` is built from the sources (`npm run build` in `bot/`) and checked by `npm test`.

## Security notes and limitations

- Pull payments only; every value transfer is `nonReentrant`; every state change emits events.
- Keys and seeds never enter the repo — profiles live under `~/.config/postmark/` with mode-600 files; the signer enforces it.
- Known limits: **no dispute timeout** (a Disputed bounty stays locked unless the verifier set signs a resolution — see THREAT_MODEL.md), the **same-account requirement** (QoreX signs, but an EVM wallet must send the transaction from the same account until QoreX can send EVM transactions), and the unauthenticated **GitHub REST API rate limit** (60 req/h per IP) can stall comment scans.
- **QoreX can't send the escrow calls yet.** QoreX refuses to sign `MsgCrossVMCall` from websites ("QoreX cannot show what /qorechain.crossvm.v1.MsgCrossVMCall does, so it will not sign it"), so a QoreX-only route for claim, finalize and withdraw is blocked by the wallet, not by Postmark. The "Send with QoreX" buttons from [PR #9](https://github.com/Ololadestephen/Postmark/pull/9) are built and tested but stay off (`VITE_QOREX_NATIVE=1`); MetaMask with a scoped EVM window is the route today.
- **On-chain checks prove a transaction happened**, not that it was useful; the human-judged testing and URL types rest entirely on their human verifiers (THREAT_MODEL.md T-13).
- Trust model, griefing analysis and the full format spec: [THREAT_MODEL.md](THREAT_MODEL.md), [SPEC.md](SPEC.md).

## Audit

Both QCAI runs (Nov 20, Ethereum EVM/Solidity setting) scored 65/100; overall risk went from HIGH in run 1 to MEDIUM in run 2. Every finding from both runs is answered in [`docs/AUDIT.md`](docs/AUDIT.md) with the fix, the regression tests, or the reason it needs no contract change, next to both dated reports. That file also links every `pqcVerify` and `pqcKeyStatus` call to its exact source lines and covering tests. Quantum readiness shows "not scored" because the QCAI rates it only under the CosmWasm setting today.

* [Library setup, API, example and limitations](src/test-utils/README.md)
* [PostmarkEscrow specification and test plan](SPEC.md)
* [Threat model](THREAT_MODEL.md)

## Credits

- **QoreChain**: the Build Before Q-Day workshop-2 QDayVault ABI and precompile addresses, and the QoreChain docs and SDK guidance for EVM windows and QoreX. See the [library README](src/test-utils/README.md) for exact sources and revisions.
- **Libraries**: `@qorechain/pqc` and its shared vectors, noble post-quantum, Foundry and forge-std, and OpenZeppelin Contracts 5.7.0 (`ReentrancyGuard` only).
- **Animated UI components** in `app/src/components/reactbits/` are adapted from [React Bits](https://reactbits.dev) by David Haz under its MIT + Commons Clause licence (included in that folder), not the project's MIT licence.

The project is MIT; dependency and fixture licences remain their own. The repository is [github.com/Ololadestephen/Postmark](https://github.com/Ololadestephen/Postmark).

* [Build plan and milestones](PLAN.md)
* [Agent instructions](AGENTS.md)
