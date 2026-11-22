# Postmark — Build Before Q-Day

[![Built on QoreChain](https://build.qorechain.io/badge/postmark.svg)](https://build.qorechain.io/p/postmark)

QoreChain Post-Quantum dApp track: a reusable **real ML-DSA-87 Foundry test
library**, plus `PostmarkEscrow`, a GitHub bounty escrow: contributors make a PQ-signed claim,
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

Sending transactions needs two things: a connected **QoreX wallet** (EVM address on chain 9800)
and a live **scoped EVM window** for the account — on diana, EVM writes are authorized through a
Cosmos-lane `MsgOpenEVMWindow` (block limit, tx count, value cap, optional allowed targets). The
app's preflight shows the exact QoreX steps when a window is missing or too small.

### Signing: QoreX, with a local signer as an Advanced option

Claim and verdict messages are signed in the browser with **QoreX** (`signArbitrary`, ML-DSA-87 hybrid
signing): click *Sign with QoreX*, approve, and the app verifies the returned signature against your live
registered key before anything is sent. QoreX still cannot send EVM transactions, so transactions come from
an EVM wallet (for example MetaMask) holding the **same account** as QoreX.

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

## Production bounties

Real GitHub issues in [Ololadestephen/postmark](https://github.com/Ololadestephen/postmark), funded on the production escrow
(`0x13De819fE37133d19287aAFE1991a921F84b9F45`) with test QOR, no monetary value. Verifiers: the Postmark bot, the funder's
own bot and the maintainer as a human tie-breaker.

| Bounty | Issue | Create tx | Claim | Verdict | Finalize | Withdraw |
|---|---|---|---|---|---|---|
| #1 | [issue #1](https://github.com/Ololadestephen/postmark/issues/1) | [`0x6e0a0548…514148`](https://dashboard.qorechain.io/explorer/tx/0x6e0a0548ab1eb584db1df015bb65338d2bac2a3c7c4b539bd987ef05b1514148) | pending | pending | pending | pending |
| #2 | [issue #2](https://github.com/Ololadestephen/postmark/issues/2) | [`0xf465ab3d…99bf2a`](https://dashboard.qorechain.io/explorer/tx/0xf465ab3d0802f1c1287b02f3d8fc4e6bb1f034ce4a55797d21ea2ac36899bf2a) | pending | pending | pending | pending |

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

**What the bot checks.** Every run, for each bounty that names its address as a verifier:

- **Claim identity.** A `postmark-claim v1 …` comment on the issue or PR for this chain, escrow, bounty and claimant, whose GitHub login, claimant and comment id hash to the bounty's stored identity hash.
- **The work.** For a PR bounty, that PR; for an issue bounty, PRs from the same repository that cross-reference it. A PR qualifies only if it is merged, merged before the deadline and before now, authored by the claimant's login, in the same repo, and has a merge commit.
- **PAY** only when exactly one PR qualifies. The evidence hash is built from the repo, PR, merge commit, merge time and author.
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
