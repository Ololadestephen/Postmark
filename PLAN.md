# Build plan — Postmark (QoreChain Build Before Q-Day)

**Category:** Post-Quantum dApp (1st $1,500 / 2nd $750 / 3rd $500). Agents are a feature here, not the category.
**Product:** a post-quantum bounty board that pays out on verified outcomes, in native test QOR only. A funder locks QOR on a GitHub PR or issue; a contributor makes a PQ-signed, time-limited identity claim. Payout to that claimant needs ML-DSA-87 signatures from 2 of 3 independent verifiers, then a 24-hour challenge window. A bonded dispute freezes the payout; the same verifier set resolves it, not an independent appeal panel.
**Repo:** Ololadestephen/Postmark (draft; create/push only after owner approval).
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
| T3 | Nov 20 | Recruit 2 outside verifiers (co-founder plus one other person); ask on QoreChain Discord about demoing bounties on their lightnode docs issues | 3 verifier keys from 3 different people, registered; Discord answer logged (yes, or fall back to Soryn/fibcheck issues) |
| T4a | Nov 21 | Create/fund slice: native QOR accounting, immutable verifier accounts, Open state | Foundry tests: exact msg.value, parameter bounds, live distinct verifier keys, liability accounting (**done Nov 19**) |
| T4b | Nov 22 | Claim slice: ClaimV1 signing, live claimant key, timeout and round replacement | Foundry tests: valid/invalid/replayed claims, excluded roles, active/expired/deadline boundaries (**done Nov 19**) |
| T4c | Nov 23 | Verdict slice: 2-of-3 INITIAL PAY/REFUND, claim-round binding, Pending snapshot | Foundry tests: quorum, stale claimant/round, domain/nonce replay, live key rotation, claim freeze (**done Nov 19**) |
| T5a | Nov 24 | Challenge slice: 24h timer, no-dispute finalize, expired-bounty refund to pull credits | Foundry tests: exact timer/deadline boundaries, anyone finalize, legal transitions, no double credit (**done Nov 19**) |
| T5b | Nov 25 | Dispute slice: exact bond, evidence, freeze, fresh same-set quorum resolution | Foundry tests: upheld/rejected outcomes, reward/bond accounting, no-claim REFUND, replay, indefinite lock (**done Nov 19**) |
| T6 | Nov 26 | Withdraw and hardening slice: native pull payments, live payee gating, reentrancy guards | Foundry tests: failed/reentrant withdrawal, mixed gated credits, forced QOR, state/liability invariants; full suite green (**done Nov 19, 122/122**) |
| T7 | Nov 21–26 (parallel) | Threat model + SPEC review: independence, same-set dispute limits, indefinite lock, claim griefing, leaked-ECDSA analysis | THREAT_MODEL.md reviewed against SPEC.md; trust/liveness limitations explicit (drafted Nov 19; waiting on owner review) |
| T8 | Nov 27 | Deploy on diana (chain 9800) through a scoped EVM window; QCAI audit run 1; workshop 4 clinic at 16:30 UTC | Contract addresses + txs in README; audit run 1 saved (deployed Nov 19, addresses in README; audit run 1 saved Nov 20, answered in docs/AUDIT.md) |
| T9 | Nov 28 | Fix findings, audit run 2, write docs/AUDIT.md | Regression tests for fixes; run 2 clean or every finding answered in docs/AUDIT.md (run 2 saved Nov 20; all findings answered in docs/AUDIT.md; 65/100, every finding answered) |
| T10 | Nov 29 | Simple QoreX UI: list, fund, claim, show verdict, challenge timer, dispute, withdraw | One bounty claimed and paid end to end on diana from the UI (**done Nov 20**: React/Vite app — W1 base `bea2279`, funder flow `fba4612`, claim flow + local PQ signer `0bab8b9`, verifier review + disputes `648e9a7`; full lifecycle claimed→verdict→dispute→resolved→withdrawn on the e2e instance, e2e bounty #17) |
| T11 | Nov 29 (only if T1–T10 are done) | Stretch: acceptance-check jobs with planted fakes, QoreSeal deliverables, `signArbitrary` identity, MCP tool | Each stretch item has its own tests; skip any that isn't ready |
| T12 | Nov 30–Dec 1 | Submission pack: README (prior-work line, testnet wording, kit credits), AI_USAGE.md, featured image, video under 3 min | Project page reads "verified", not just "declared" (README + AI_USAGE refreshed Nov 20; image and video open) |
| T13 | Dec 2 by 12:00 UTC | Submit, tick AI-native box, post with #BuildBeforeQDay | Submission confirmation received |
| T14 | Dec 6–15 | Stay reachable for judging; answer finalist change requests within 48h | No request older than 24h without an answer |

By Nov 23, create/fund/claim and the 2-of-3 verdict are tested. By Nov 26,
challenge/dispute/finalize/withdraw and the full regression suite are tested.

## Video outline (under 3 minutes)
1. The problem, in 20 seconds: classical keys and trusted oracles.
2. A live bounty on a real issue: fund, PQ-sign a claim, pay testnet QOR after the 2-of-3 verdict.
3. A release attempt signed only with a classical key gets refused.
4. A dispute freezes the payout.
5. Audit fixes, then the outro.

## Judging checklist
- [ ] Scoped EVM window used and shown
- [ ] `pqcVerify` and `pqcKeyStatus` used and shown in txs
- [ ] Two-stage QCAI audit + docs/AUDIT.md
- [ ] Foundry tests
- [ ] Kits listed in package.json / foundry deps
- [ ] MIT license, README credits, testnet addresses
- [ ] Threat model, AI_USAGE.md, video, featured image
- [ ] Daily small commits (live feed, "most active" chart)
