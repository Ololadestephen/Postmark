# Build plan — Postmark (QoreChain Build Before Q-Day)

**Category:** Post-Quantum dApp (1st $1,500 / 2nd $750 / 3rd $500). Agents are a feature here, not the category.
**Product:** a post-quantum bounty board that pays out on verified outcomes, in native test QOR only. A funder locks QOR on a GitHub PR or issue; a contributor makes a PQ-signed, time-limited identity claim. Payout to that claimant needs ML-DSA-87 signatures from 2 of 3 independent verifiers, then a 24-hour challenge window. A bonded dispute freezes the payout; the same verifier set resolves it, not an independent appeal panel.
**Repo:** [Ololadestephen/Postmark](https://github.com/Ololadestephen/Postmark) (public). **Live app:** https://usepostmark.vercel.app
**Deadline:** Dec 2, 23:59 UTC. **Our target:** Dec 2, 12:00 UTC (1:00 PM WAT).
**Wording rule:** "real issues, testnet payouts". Diana QOR has no monetary value.
**Code rule:** all code is new, in this repo.

## Milestones

Each milestone is done only when its exit check passes. Report to Poke after each one.
Kane owns Nov 20–26, so T4–T6 are small daily escrow slices, not a full-build day.
The threat-model review runs in parallel rather than blocking all implementation until Nov 27.

| ID | Dates | Milestone | Exit check |
|----|-------|-----------|------------|
| T1 | Nov 19 | Spec + PQC test library | `forge test` 12/12 passing; SPEC.md written (done) |
| T2 | Nov 19–20 | Accounts and chain setup: register (GitHub, X, QoreX testnet address), faucet QOR, register an ML-DSA-87 key, attend workshop 3 (Nov 20, 16:30 UTC) | `pqcKeyStatus` returns live for our key on diana (exit check passed Nov 19: qor1y5t5h5af3nvr8t909zxefaxvxfpz06vawzg8sk / 0x25174bd3…e99d, alg 1, 2592-byte key sha256 31fc187d…788f, possession proven, registered by QoreX at height 10375785; `npm run key-status -- <addr>`. qor120ddkwut5hdquc7lya80937eu6c9kgt0lwukc0 is an unused second QoreX account with no key, not used by the project. Workshop 3 still open) |
| T3 | Nov 20 | Recruit 2 outside verifiers (co-founder plus one other person); ask on QoreChain Discord about demoing bounties on their lightnode docs issues | 3 verifier keys from 3 different people, registered; Discord answer logged (yes, or fall back to Soryn/fibcheck issues) (**changed Nov 21**: no outside verifiers recruited. The curated set is two maintainer-run bots — public bot in this repo, private bot in `postmark-verifier-bot` — plus the owner as human tie-breaker, all with live ML-DSA-87 keys. Bounties run on our own repo's issues, so no QoreChain-repo question was needed. The independence limit is stated in README and THREAT_MODEL.md) |
| T4a | Nov 21 | Create/fund slice: native QOR accounting, immutable verifier accounts, Open state | Foundry tests: exact msg.value, parameter bounds, live distinct verifier keys, liability accounting (**done Nov 19**) |
| T4b | Nov 22 | Claim slice: ClaimV1 signing, live claimant key, timeout and round replacement | Foundry tests: valid/invalid/replayed claims, excluded roles, active/expired/deadline boundaries (**done Nov 19**) |
| T4c | Nov 23 | Verdict slice: 2-of-3 INITIAL PAY/REFUND, claim-round binding, Pending snapshot | Foundry tests: quorum, stale claimant/round, domain/nonce replay, live key rotation, claim freeze (**done Nov 19**) |
| T5a | Nov 24 | Challenge slice: 24h timer, no-dispute finalize, expired-bounty refund to pull credits | Foundry tests: exact timer/deadline boundaries, anyone finalize, legal transitions, no double credit (**done Nov 19**) |
| T5b | Nov 25 | Dispute slice: exact bond, evidence, freeze, fresh same-set quorum resolution | Foundry tests: upheld/rejected outcomes, reward/bond accounting, no-claim REFUND, replay, indefinite lock (**done Nov 19**) |
| T6 | Nov 26 | Withdraw and hardening slice: native pull payments, live payee gating, reentrancy guards | Foundry tests: failed/reentrant withdrawal, mixed gated credits, forced QOR, state/liability invariants; full suite green (**done Nov 19, 122/122**) |
| T7 | Nov 21–26 (parallel) | Threat model + SPEC review: independence, same-set dispute limits, indefinite lock, claim griefing, leaked-ECDSA analysis | THREAT_MODEL.md reviewed against SPEC.md; trust/liveness limitations explicit (drafted Nov 19; T-13 human-judged tasks added Nov 23; owner review still open) |
| T8 | Nov 27 | Deploy on diana (chain 9800) through a scoped EVM window; QCAI audit run 1; workshop 4 clinic at 16:30 UTC | Contract addresses + txs in README; audit run 1 saved (deployed Nov 19, addresses in README; audit run 1 saved Nov 20, answered in docs/AUDIT.md) |
| T9 | Nov 28 | Fix findings, audit run 2, write docs/AUDIT.md | Regression tests for fixes; run 2 clean or every finding answered in docs/AUDIT.md (run 2 saved Nov 20; all findings answered in docs/AUDIT.md; 65/100, every finding answered) |
| T10 | Nov 29 | Simple QoreX UI: list, fund, claim, show verdict, challenge timer, dispute, withdraw | One bounty claimed and paid end to end on diana from the UI (**done Nov 20**: React/Vite app — W1 base `bea2279`, funder flow `fba4612`, claim flow + local PQ signer `0bab8b9`, verifier review + disputes `648e9a7`; full lifecycle claimed→verdict→dispute→resolved→withdrawn on the e2e instance, e2e bounty #17. **Production, Nov 22–24:** outside contributor @ToluEnoch claimed bounties #1–#3 on issues #1, #2 and #8; the bots signed 2-of-3 PAY; he finalized all three after the 24h window and withdrew 10.1 test QOR in tx `0x961bf677…ea6b`. Txs in README "Production bounties") |
| T11 | Nov 29 (only if T1–T10 are done) | Stretch: acceptance-check jobs with planted fakes, QoreSeal deliverables, `signArbitrary` identity, MCP tool | Each stretch item has its own tests; skip any that isn't ready (**Nov 23**: task bounties without a contract change. `onchain-call`/`onchain-deploy` judged by the bots, live as bounty #4 on issue #10, deadline Nov 29. `testing`/`url` judged by humans, built behind `VITE_HUMAN_TASKS=1` and off in production; they ship only if one testing bounty is paid on production by Nov 29 with 2 funder-picked human verifiers who aren't the owner, else they go in the README roadmap. Bot fix Nov 22: issue bounties need an exact `Fixes/Closes/Resolves #N`, after the bounty #2 mention incident in docs/AUDIT.md) |
| T12 | Nov 30–Dec 1 | Submission pack: README (prior-work line, testnet wording, kit credits), AI_USAGE.md, featured image, video under 3 min | Project page reads "verified", not just "declared" (README + AI_USAGE refreshed Nov 20; README production record, task types and QoreX limit Nov 24; featured image done; video script rewritten Nov 24, video to be produced with HyperFrames + ElevenLabs voice-over) |
| T13 | Dec 2 by 12:00 UTC | Submit, tick AI-native box, post with #BuildBeforeQDay | Submission confirmation received |
| T14 | Dec 6–15 | Stay reachable for judging; answer finalist change requests within 48h | No request older than 24h without an answer |

By Nov 23, create/fund/claim and the 2-of-3 verdict are tested. By Nov 26,
challenge/dispute/finalize/withdraw and the full regression suite are tested.

## Video outline (under 3 minutes)
Full shot list and voice-over: `notes/video-script.md`. Built in HyperFrames, voice-over by ElevenLabs.
1. The problem: one person with one classical key releases bounty money.
2. A real bounty on a real issue: funded on diana through a scoped EVM window.
3. An outside contributor claims with ML-DSA-87; two bots check the merged PR and sign PAY; `pqcVerify` checks them on chain.
4. A forged or classical-only verdict is refused; a bonded dispute would freeze the payout.
5. The 24h window passes, he finalizes and withdraws 10.1 test QOR.
6. Proof points (tests, two QCAI runs, threat model), honest limits, outro.

## Judging checklist
- [x] Scoped EVM window used and shown
- [x] `pqcVerify` and `pqcKeyStatus` used and shown in txs
- [x] Two-stage QCAI audit + docs/AUDIT.md
- [x] Foundry tests
- [x] Kits listed in package.json / foundry deps
- [x] MIT license, README credits, testnet addresses
- [x] Threat model, AI_USAGE.md, featured image
- [ ] Video (script ready; HyperFrames + ElevenLabs)
- [x] Daily small commits (live feed, "most active" chart)
