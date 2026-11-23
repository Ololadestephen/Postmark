# Postmark threat model (T4)

Scope: `PostmarkEscrow` v1 (native test QOR only) on diana (`qorechain-diana`, EVM chain 9800), its verifier
operators, the UI and the off-chain GitHub evidence. Payouts are testnet payouts (test QOR,
no monetary value). Normative rules live in SPEC.md; this file explains why they hold and
what they do not cover.

## Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| Escrowed principal, reward, dispute bond (native test QOR) | Escrow balance, per-bounty accounting | The thing being paid out |
| Credits (gated / ungated) | Escrow pull-payment ledger | Settled but not yet withdrawn |
| Verifier ML-DSA-87 secret keys | Each operator's machine | 2 of 3 decide every outcome |
| Claimant PQ key and claim | Chain PQC registry (`0x…0a02`), bounty claim record | Decides who can be paid, and gates payout and withdrawal |
| ECDSA account keys | Every wallet | Authorise ordinary EVM calls inside a window |
| GitHub facts (merge, author, link) | GitHub | What verdicts attest to |

## Actors and trust

- **Funder**: trusted only with their own money. Can create, and refund after the deadline if no verdict landed.
- **Claimant / payee**: there is no payee at creation. A contributor claims with an ML-DSA-87-signed ClaimV1 and becomes the payee for one claim timeout (1 h to 7 d, set by the funder). Trusted for nothing; must keep a live PQ key to be paid and to withdraw gated credit.
- **Verifiers (3)**: three accounts chosen by the funder; today usually the Postmark bot, the funder's own repo bot and a human tie-breaker, so they are not guaranteed to be operated by independent parties. Any 2 are trusted for the facts. 1 is never enough. The same three also resolve disputes, so a dispute is a second look by the same people, not an independent appeal.
- **Disputer**: anyone. Puts up the bond; trusted for nothing.
- **Relayer / UI**: untrusted. It can submit or withhold transactions but never authorises a verdict.
- **Chain**: trusted for consensus, the PQC registry and precompile correctness, and EVM-window enforcement.

## Trust boundaries

1. **Precompiles.** The escrow trusts `pqcVerify` and `pqcKeyStatus` results, and nothing else about keys. Missing, reverting or malformed responses fail closed (`PrecompileUnavailable`), not open (D6).
2. **Off-chain facts.** No contract proves a GitHub merge or identity. Verdicts commit to an `evidenceHash`, and the 24 h challenge window plus the bonded dispute are the check on those facts.
3. **EVM lane vs. native lane.** EVM calls are ECDSA-signed and admitted only inside a hybrid-signed, scoped window. The PQ protection for value is in the verdict quorum and the payee key gate, not in the EVM transaction signature.

## Threats and mitigations

### T-1 Classical key compromise (the Q-Day case)
An attacker who can forge or steal ECDSA keys (a future quantum attacker, or a plain leak).
- **Can:** use an open window: spend its tx/QOR budget, create attacker-funded bounties, lodge a bonded dispute, call `finalize` (harmless: anyone may). Withdraw that account's own credits to the same address while its PQ registration is live. A funder's key can trigger `refundExpired` once the deadline passes with no verdict, which is the funder's own refund.
- **Cannot:** forge a verdict (needs 2 ML-DSA-87 signatures from live keys) or a claim (needs the claimant's ML-DSA-87 signature, bound to the caller and round). Change verifiers or bond (immutable) or a frozen claimant. Redirect any credit to another address (`withdraw` pays `msg.sender` only). Skip the challenge window. Open a new window or rotate a PQ key (native, hybrid-signed).
- **Residual:** funds in a wallet whose ECDSA key is lost are lost once withdrawn. Mitigation in the demo: short windows, tiny caps, `allowedTargets` limited to the escrow.

### T-2 Verifier compromise or collusion
- 1 verifier: no effect. A quorum needs 2 distinct indices with distinct live keys (D5, D6).
- 2 verifiers: can attest false facts. The challenge window and dispute are the only check, and the same 2 can also reject a valid dispute. **Accepted risk**, stated in README and the demo. Mitigation is off chain: choose operators who don't share control, publish who runs each verifier, and keep evidence public.
- **Sybil verifiers** (one person, three accounts): distinct accounts and distinct keys are enforced on chain; human independence is not. Funders choose the verifier set and see who it is.
- **Verifier = funder:** rejected at creation (D2). **Funder or verifier claiming:** `ClaimantExcluded` (D3). **Claimant key shared with a verifier:** `ClaimantExcluded` (D3). Exclusion is by account and key; the same human with a fresh account and key is not detectable on chain.

### T-3 Replay and cross-binding
Each signature covers `qorechain-msg-v1|<nativeChainId>|payload`. The verdict payload binds typehash, EVM chain ID, escrow address, bounty ID, phase, outcome, payee, mergedAt, evidence, nonce, claimRound and (for disputes) the disputed payload hash and dispute evidence hash. The claim payload binds chain ID, escrow, bounty ID, claimant, identity hash and the next claimRound. So a signature cannot move across chains, deployments, bounties, phases, disputes or claim rounds, and a verdict for one claimant cannot pay a later claimant, even one at the same address. Signatures are counted once per verifier index (strictly increasing indices).
- **Residual:** a fork that keeps the same chain IDs and escrow address. This is a network-level risk.

### T-4 Key rotation and revocation
Keys are read live at every submission, so after a rotation old signatures stop working. A verdict that has been accepted stays accepted: no later re-check means no retroactive veto. One revoked verifier does not block the other two (D6). Two unavailable verifiers block disputes indefinitely (see T-7).

### T-5 Payee key loss
The claimant's credit is gated on a live PQ key at the PAY transition and at withdraw. If they lose the key, the credit is stuck until they restore or rotate it on the native lane. This is deliberate: an ECDSA-only payee cannot be paid. Funder and disputer credits are tracked separately, so the gate never strands them (D7, D8).

### T-6 Economic griefing via disputes
- **Funder self-dispute to delay or claw back:** a rejected dispute slashes the bond to the frozen claimant, and the unused reward only returns what the funder already put in. So a funder cannot profit and pays for any delay. With no frozen claimant (a no-claim REFUND) the bond goes to the funder; there is nobody to compensate, and the funder already holds the refund.
- **Third-party nuisance dispute:** costs the bond, which goes to the frozen claimant (or the funder) if the dispute is rejected. The bond size is fixed by the funder at creation, so a disputer cannot choose a smaller one.
- **Valid dispute:** the disputer gets the bond back plus the reward. This pays someone to watch.
- **Residual:** a funder can set a tiny bond and reward, which makes disputes cheap and their reward small. Shown in the UI so contributors can judge a bounty before working on it.

### T-7 Liveness
There is no dispute timeout and no admin override. If two verifiers vanish, disputed funds stay locked. This is the price of not letting an ECDSA-signed timeout bypass the PQ quorum, and it is shown in the demo. Before the deadline, the funder's refund path is not open, because a verifier REFUND verdict covers early ineligibility.

### T-8 Contract-level attacks
- **Reentrancy:** `nonReentrant` on every mutator; settlement only writes the ledger; withdraw zeroes credit and updates liabilities before the transfer. Tests include a reentrant native receiver on withdraw.
- **Assets:** native test QOR only, so there are no token callbacks, approvals or allowances. Funding and bonds need an exact `msg.value`.
- **Forced native funds / donations:** do not count as funding (no `receive`). `totalLiabilities` is tracked, with invariant `totalLiabilities <= address(this).balance`.
- **Precompile spoofing:** the addresses are constants and calls are low-level `staticcall`s with strict response checks.

### T-9 Timing
`block.timestamp` can drift a few seconds. Boundaries are explicit: claim `< deadline` with the full timeout fitting, a claim is active while `now < claimExpiresAt`, submit `<= deadline`, refund `> deadline`, dispute `< challengeEndsAt`, finalize `>= challengeEndsAt`. A merge before the deadline does not save a verdict submitted late. Contributors and verifiers are told this.

### T-10 Off-chain and supply chain
- Compromised Node, npm or FFI code invalidates **local** test results only. `scripts/pqc.mjs` and the mocks are never on chain and never deployed.
- Relayer censorship: anyone can submit a signed verdict, so verifiers can submit themselves.
- Evidence availability: an `evidenceHash` proves nothing if the evidence disappears. Verifiers publish evidence where the disputer can fetch it.

### T-11 Claim griefing and squatting
- **Squatting:** any account with a live PQ key can claim an Open bounty and hold it for one timeout. V1 has no claim bond and no Sybil resistance, so a timeout bounds one reservation, not repeated griefing by fresh accounts. Mitigation: the funder picks a short timeout; verifiers refuse PAY to a claimant whose identity evidence doesn't match the merged PR; a REFUND verdict is possible from Claimed.
- **Racing after expiry:** at exact expiry anyone may claim with a fresh signature for the next round. An honest contributor who misses the timeout loses the reservation. Pending freezes only a claim that was active when a verdict was accepted.
- **Copied claim signature:** the signature is bound to `msg.sender` and the next round, so a copier cannot use it, and a successful claim cannot be replayed.
- **Identity:** a claim proves key control, not GitHub ownership. `identityHash` commits to public evidence that verifiers check off chain.
- **Near the deadline:** a claim needs the whole timeout to fit before the deadline, so a bounty can become unclaimable shortly before it expires. This is by design and shown in the UI.

### T-12 On-chain task bounties
Issue bounties whose work is a diana transaction (`postmark-task` block in the issue body).
- **Brief edited after the claim:** the funder (issue owner) can rewrite the task block at any time.
  The claim line binds `brief = keccak256(abi.encode("postmark-brief-v1", canonicalText))`, so an
  edited brief no longer matches and the bots abstain — a changed brief can stall a payout, never
  steal one. Human verifiers and the dispute path decide contested cases. The claimant can also edit
  their own claim comment, but only to their own detriment: the comment id is bound into
  `identityHash`, and a fresh comment re-binds identity anyway.
- **Old transaction reuse:** a claimant cannot point at work done before the claim — the proof's
  block timestamp must be at or after the claim time. The same proof cannot pay two bounties:
  `initialEvidenceHash` commits to the tx hash, and bots abstain when another bounty already used it.
- **Indirect calls:** the task checks `tx.from` and `tx.to` on the outer transaction only, so a call
  routed through another contract (or a factory deploy) does not count. This is deliberate: the
  check verifies "the claimant's account sent this transaction", nothing deeper.
- **Meaning of the check:** the on-chain checks prove a transaction happened, not that it was
  useful. A junk `onchain-call` to the right contract passes — the task brief is the funder's
  responsibility, and disputes remain the recourse for junk work.
- **RPC dependence:** proof checking needs reads the GitHub checks do not (transaction, receipt,
  block, code). Every failure mode abstains rather than refunds, so a flaky node delays a verdict
  but cannot reverse it.

### T-13 Human-judged task bounties
Issue bounties whose work is judged by people (`testing` / `url` task blocks; the claimant posts a
`postmark-submission v1 url=…` comment).
- **Judgement is entirely the human verifiers':** the bots always abstain on these types. Nothing
  validates the URL's content — a PAY means "at least two of three verifiers chose to pay for that
  submission", and the review tool only surfaces the timestamps, login and brief binding. The Create
  flow requires at most one curated bot among the three verifiers for a reason: two bots plus one
  human could never reach quorum on their own.
- **Comment edits:** the claimant (or anyone editing their own comment) can change the comment text
  after posting. The evidence hash binds `commentId + githubLogin + url + createdAt`, not the body,
  so editing the report text after a verdict does not change the evidence — but a verifier could
  have read different text than what stands later. The review tool flags comments whose
  `updated_at` is after `created_at`; an edited submission is a warning, not a proof of fraud.
- **Collusion:** the funder picks all three verifiers, and funder-picked verifiers may collude with
  the funder — or with a claimant — to pay a worthless submission. The challenge/dispute window is
  the only protocol check; the bounty model already relies on it for code bounties, and it matters
  more here because no automated check gates the payment at all.
- **Brief binding:** same as T-12 — the claim's `brief` binds the task block, so editing or removing
  the block after the claim stalls payment (bots abstain; the review tool warns and disables PAY)
  rather than redirecting it.
- **Timing reuse:** a submission posted before the claim does not count (`createdAt` must be at or
  after the claim time) and one posted after the deadline cannot pay. `initialEvidenceHash` still
  commits to the chosen comment, so two bounties cannot pay the same submission.

## Out of scope for v1
GitHub identity proofs, claim bonds, protocol fees and treasury, ERC20 or multi-asset bounties (see SPEC.md Future work), upgrades or admin roles, mainnet deployment.

## Threat → test map

| Threat | Tests (`test/escrow/`) |
|---|---|
| T-1 classical key compromise | `Claim`: testCopiedSignatureCannotClaimForCopier; `Settlement`: testUngatedWithdrawBypassesGating, testGatedWithdrawNeedsEligibility, testFinalizePayByAnyone; `Verdict`: testSubmitPayThreeOfThreeAndRelayer |
| T-2 verifier quorum and independence | `Verdict`: testSubmitPayTwoOfThree, testInvalidSignerShapes, testBadSignatures, testRotatedIntoSharedKeyFails; `Create`: testRejectsZeroAndBadParams, testRejectsDuplicateKeys; `Claim`: testFunderAndVerifierCannotClaim, testClaimantSharingVerifierKeyExcluded |
| T-3 replay and cross-binding | `Message`: testClaimMessageMatchesAndVerifies, testInitialPayMessageMatchesAndVerifies, testDisputeMessageMatchesAndVerifies, testFieldBindingMutations, testDomainBinding, testDisputeSignatureNotReusableAcrossDisputes; `Claim`: testClaimDomainBinding, testClaimedReplayFails; `Verdict`: testCrossBountyReplay, testStaleRoundFails; `Dispute`: testReplayedResolutionReverts, testResolveDisputeBindsStoredHashes |
| T-4 rotation and revocation | `Keys`: testRotationBetweenVerdictAndResolution, testRevocationAfterAcceptanceKeepsVerdict, testResolveWithRevokedSignerFails, testNonSigningIneligibleIgnored; `Verdict`: testVerifierRotation, testNonSigningRevokedVerifierIgnored, testSignerRevokedFails |
| T-5 payee key loss | `Verdict`: testPayeeRevokedBeforePay; `Keys`: testClaimantRotationBetweenVerdictAndFinalize, testClaimantRotationAndReregisterStillPays, testGatedBondSlashNeedsPayeeKey; `Message`: testResolvePayNeedsEligiblePayee |
| T-6 dispute economics | `Dispute`: testResolveUpholdRefundAfterPay, testResolveUpholdPayAfterRefund, testResolveRejectedPay, testResolveRejectedRefundWithClaimant, testResolveRejectedRefundNoClaimant, testFunderCanDispute, testSecondDisputeReverts; `Settlement`: testLedgerConservation |
| T-7 liveness | `Keys`: testCannotMeetQuorumLocksDispute; `Dispute`: testFinalizeFrozenWhileDisputed |
| T-8 contract-level | `Create`: testRejectsWrongValue, testNoReceiveFallback, testCreateRollbackOnFailure, testRejectsWhenPrecompileDown, testRejectsWhenPrecompileEmptyOrMalformed; `Settlement`: testWithdrawReentrancy, testWithdrawTransferFailureRollsBack, testForcedFundsNotCredited; `Keys`: testMalformedKeyStatusOnSubmit, testMalformedVerifyReturn; `Claim`: testClaimPrecompileFailure; `Invariant`: invariant_liabilitiesCoveredAndExact |
| T-9 timing | `Verdict`: testSubmitAtExactDeadline, testSubmitAfterDeadlineReverts; `Claim`: testClaimClosedAtDeadline, testClaimWindowTooShort, testNormalizedOpenViewAtExactExpiry; `Create`: testClaimTimeoutBounds, testWindowMustFitDeadline; `Settlement`: testRefundExpiredRacesTimelyVerdict |
| T-10 off-chain | Not testable locally. Chain-level checks are part of the diana integration run (PLAN.md T8). |
| T-11 claim griefing | `Claim`: testRenewalAndSecondClaimantRejectedWhileActive, testReplacementAtAndAfterExpiry, testReopenReleasesExpiredClaim, testClaimRoundIncrementsOnlyOnSuccess; `Verdict`: testPayWithExpiredClaimFails, testPayWithoutClaimIsClaimExpired, testPendingFreezesSnapshotPastExpiry, testSubmitRefundFromOpenAndClaimed; `Dispute`: testResolvePayWithoutFrozenClaimantFails, testResolvePayWrongClaimantFails |

## Review status
Drafted Nov 19 and updated for claims and native-only QOR against the implemented contract (122/122 Foundry tests). SPEC.md decisions D1–D10 close the open implementation choices. Still to confirm on diana: live precompile return shapes, the EVM version, and window limits.
