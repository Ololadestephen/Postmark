# QCAI audit

| Run | Date | Setting | Source | Report | Result |
|---|---|---|---|---|---|
| 1 | 2026-11-20 | Ethereum (EVM/Solidity) | `src/PostmarkEscrow.sol` at `241d0c7` (deployed at `0xb781E296FB35ccd2497589526114373bA0bff79b`, now superseded) | [`audit/qcai-stage1-2026-11-20.pdf`](audit/qcai-stage1-2026-11-20.pdf) | 65/100, 6 findings (2 high, 2 medium, 1 low, 1 info) |
| 2 | 2026-11-20 | Ethereum (EVM/Solidity) | `src/PostmarkEscrow.sol` at `6babd14` (report label: `PostmarkEscrowV2`) | [`audit/qcai-stage2-2026-11-20.pdf`](audit/qcai-stage2-2026-11-20.pdf) | 65/100, MEDIUM overall, 6 findings (1 high, 3 medium, 2 low) |

## About the score

Both runs used the same setting, "Ethereum (EVM/Solidity)", which the Build Before Q-Day builder FAQ
recommends for Solidity contracts on QoreChain EVM; the "QoreChain (CosmWasm + PQC)" setting is for
CosmWasm contracts. Quantum readiness is "not scored" because the QCAI only produces that rating under the
CosmWasm setting today. In its place, [Juror-verifiable PQC checks](#juror-verifiable-pqc-checks) below
links every `pqcVerify` and `pqcKeyStatus` call to its exact source lines and the tests that cover it.

All 12 flags across the two runs were reviewed against the source. None is an exploitable defect: each one
is a deliberate design choice (permissionless `reopen` and `resolveDispute` relays, native QOR only) or a
risk the contract already handles (checked 0.8 arithmetic, fail-closed precompile parsing, fixed loop
bounds). Each has named Foundry tests. Several suggested fixes would weaken the design. Restricting who may
relay a dispute resolution or reopen an expired claim, for example, would let one party freeze a bounty, so
the contract was not changed to chase the number. The audited source is the deployed bytecode, and the
suite has 126 tests with 100% line coverage of `PostmarkEscrow.sol`.

Every run 1 finding is answered below. None was an exploitable defect: each describes a risk the
contract already handled, and the named tests prove it. After run 1 the source was hardened where
each flag was raised (`6babd14`): documentation, named bounds and two defensive checks, with the
external interface, events, errors and signed message formats unchanged (the exported ABI is
byte-identical). See "Changes after run 1" below.

The report's line numbers don't line up with the source (line 177 is `_validOwnerRepo`, line 540 is
inside `_keyStatus`), so each finding is matched to the code it describes.

## Findings

### 1. Missing access control on `reopen` (HIGH): by design, no change
`reopen(bountyId)` is permissionless on purpose (SPEC.md claim rules; owner decision on Nov 19).
It only works once a claim has expired (`ClaimActive` otherwise), and all it does is clear the
expired claimant and set the bounty back to Open. `claim()` does the same normalization itself, so
`reopen` adds no power anyone lacks. Limiting it to the funder or claimant would let either of them
hold an expired bounty Closed. The claimant would block new claims; the funder would block
contributors.
Tests: `Claim.t.sol` `testReopenReleasesExpiredClaim` (a stranger reopens; reverts while the claim
is active), `testReplacementAtAndAfterExpiry`, `testClaimRoundIncrementsOnlyOnSuccess`.

### 2. Potential overflow in credit management (HIGH): false positive
The contract compiles with `pragma solidity ^0.8.24`, so `+=` is checked and reverts on overflow;
SafeMath is redundant on 0.8. Credits also can't approach `2^256`: every credited wei is native QOR
already held by the contract (`amount + challengeReward` at funding, the exact bond at dispute).
Tests: `Invariant.t.sol` `invariant_liabilitiesCoveredAndExact` (the sum of all credits plus
unsettled escrow equals the balance after random call sequences), `Settlement.t.sol` `testBondCountsInLiabilities`.

### 3. Front-running in the claim process (MEDIUM): mitigated, documented
A copied claim is useless to a front-runner. The ML-DSA-87 claim signature covers `msg.sender`,
the chain id, the escrow address, the bounty id, the identity hash and the next `claimRound`. It is
checked against the live key registered to `msg.sender`, so it only works when sent by the
claimant's own account. Racing to be first with your own claim is claim squatting (THREAT_MODEL.md
T-11). A commitment scheme wouldn't stop that, because claims are first come, first served by
design. What limits squatting:
- the funder picks the claim timeout (1 hour to 7 days);
- one active claim at a time, which expires;
- verifiers sign PAY only for the claimant whose GitHub identity comment matches the merged PR's
  author;
- a verdict is bound to the claimant and the claim round, so it can't pay a later claimant;
- REFUND is possible from Claimed.

Tests: `Claim.t.sol` `testCopiedSignatureCannotClaimForCopier`, `testClaimedReplayFails`,
`testClaimBadSignatures`; `Verdict.t.sol` `testCrossBountyReplay`; T-11 row in THREAT_MODEL.md.

### 4. Unchecked return values from PQC precompiles (MEDIUM): false positive
Both precompile calls fail closed. `_pqcVerify` (`0x…0a01`) reverts `PrecompileUnavailable` unless
the call succeeds and returns exactly 32 bytes holding 0 or 1. `_keyStatus` (`0x…0a02`) checks:
- the call succeeded;
- at least 0xa0 bytes came back;
- `registered` and `proven` are each 0 or 1;
- the algorithm id fits in `uint8`;
- the bytes offset is exactly 0x80;
- the key length (with padding) fits in the returned data.

It reverts otherwise. Callers then require `registered`, algorithm 1, a 2592-byte key and proven
possession.
Tests: `Verdict.t.sol` `testKeyStatusPrecompileFailures`, `testVerifyPrecompileFailures`;
`Keys.t.sol` `testMalformedVerifyReturn`, `testMalformedKeyStatusOnSubmit`; `Create.t.sol`
`testRejectsWhenPrecompileDown`, `testRejectsWhenPrecompileEmptyOrMalformed`,
`testRejectsWrongAlgorithmAndShortKey`; `Claim.t.sol` `testClaimPrecompileFailure`.

### 5. Unbounded loop in key validation (LOW): false positive
Every loop has a small fixed bound:
- key checks loop over exactly 3 verifiers (at most 3 × 3 comparisons);
- signer loops run over 2 or 3 indices, and anything else reverts `InvalidSigners`;
- `_validOwnerRepo` scans at most 140 bytes and rejects longer input first;
- the constructor scans the chain id string once, at deployment.

No loop depends on storage growth or the number of bounties.
Tests: `Create.t.sol` `testRejectsBadWorkReference` (including the length limits),
`testConstructorRejectsBadChainId`; `Verdict.t.sol` `testInvalidSignerShapes` (bad index sets).

### 6. Missing ERC standards implementation (INFO): not applicable
Postmark escrows native test QOR only (SPEC.md, native-only decision). It issues no token and
holds none, so ERC-20/721/1155 don't apply. Integrations use the events (`BountyCreated`,
`BountyWork`, `Claimed`, `VerdictSubmitted`, `Disputed`, `DisputeResolved`, `Settled`, `Credited`)
and the public view functions.

## Changes after run 1 (`6babd14`)

| Finding | Before (run 1 source) | After |
|---|---|---|
| 1 `reopen` access | `/// Anyone may call.` | Full NatSpec: why it's permissionless, that it moves no funds or credits, its preconditions in revert order, and the event it emits. Code path unchanged. |
| 2 credit overflow | `pragma solidity ^0.8.24`; `_credit` and `withdraw` undocumented | Pragma pinned to `0.8.24`. NatSpec on the liability model: credits relabel value already in `totalLiabilities`, and `+=` is checked. New guard in `withdraw`: `if (total > address(this).balance) revert TransferFailed();`, unreachable under the invariant. |
| 3 claim front-running | No comment on the signature binding | NatSpec on `claim` and an inline comment at the signature check: the claim is bound to `msg.sender` and verified against the caller's own live key; squatting is limited by the timeout (T-11). |
| 4 precompile return values | Magic numbers `0xa0`, `0x80`, `32` | Named constants `KEYS_STATUS_MIN_BYTES`, `KEYS_STATUS_DATA_OFFSET`, `VERIFY_RET_BYTES`, with the values unchanged. Fail-closed NatSpec lists every check on both calls. |
| 5 loops | Literal `3` and `140` | `VERIFIER_COUNT = 3` and `MAX_OWNER_REPO_BYTES = 140` in every loop, each loop commented with its bound. New `MAX_CHAIN_ID_BYTES = 64` in the constructor: the only behavior change, and it only affects deployment input (`testConstructorChainIdLengthBound`). |
| 6 ERC standards | Title line only | Contract `@notice`/`@dev`: native test QOR only, why ERC-20/721/1155 don't apply, and the events and views integrations use. |

Tests: 126/126, including the new constructor bound test. Coverage of `PostmarkEscrow.sol` is 100% of
lines and 96.43% of branches; the drop from 97.47% is the deliberately unreachable `withdraw` guard
plus the new constructor branch. The hardened source is deployed to production at
`0x13De819fE37133d19287aAFE1991a921F84b9F45` (tx `0xa01ae24d57869e0e16bbfbfec29a36a539bd65998600188d1f5439b0663ffdbc`,
block 10429957). Its on-chain code is byte-equal to `forge inspect PostmarkEscrow deployedBytecode`. The run 1
deployment `0xb781E296…f79b` is kept as superseded in `deployments/diana.json`.

## Run 2 findings

The score stayed at 65/100. Overall risk changed from HIGH to MEDIUM; quantum readiness was not scored. The report flags the following. No further contract change or redeploy was made for this run.

| Finding | Severity | Source review |
|---|---|---|
| Privilege escalation in dispute resolution | Medium | The caller only relays. `resolveDispute` requires a fresh, valid 2-of-3 ML-DSA-87 quorum for the disputed bounty, binding the nonce, claim round and stored dispute hashes. A caller restriction would not strengthen verdict authorization and would remove the permissionless relay path. See `testResolveDisputeBindsStoredHashes` and `testDisputeSignatureNotReusableAcrossDisputes`. |
| Credit overflow | Medium | Checked Solidity 0.8.24 arithmetic and the liability invariant still apply; see run 1 finding 2. |
| Claim front-running | Low | Copied signatures are bound to the claimant; first-come reservation griefing remains a documented limitation, not eliminated by the timeout. See run 1 finding 3. |
| Unchecked precompile returns | High | Both helpers check the call success flag and validate the ABI response before use; malformed responses revert. See run 1 finding 4 and its regression tests. |
| Unbounded loop in key validation | Medium | Verifier iteration is fixed at three; signer lists are checked to contain two or three entries before iteration. The assembly copy is bounded by the validated return-data length, not by the bounty count. |
| Missing ERC-20 interface | Low | Native test QOR only; token support is intentionally out of scope. |

## Juror-verifiable PQC checks

Every place `src/PostmarkEscrow.sol` calls `pqcVerify` or `pqcKeyStatus`, directly or through a helper, with a permalink to the exact lines at commit `6babd14` (the audited and deployed source), what the check protects, and the Foundry tests that cover it. `forge test` runs all of them against real ML-DSA-87 signatures.

| Check | Code | What it protects | Foundry tests |
|---|---|---|---|
| `_keyStatus` | [L575-L612](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L575-L612) | Reads a key's status from the pqcKeyStatus precompile and fails closed (reverts `PrecompileUnavailable`) on any malformed or surprising response instead of treating it as "unregistered". | `Keys.t.sol`: `testMalformedKeyStatusOnSubmit`; `Verdict.t.sol`: `testKeyStatusPrecompileFailures`; `Create.t.sol`: `testRejectsWhenPrecompileDown`, `testRejectsWhenPrecompileEmptyOrMalformed`; `Claim.t.sol`: `testClaimPrecompileFailure` |
| `_pqcVerify` | [L614-L624](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L614-L624) | Calls the pqcVerify precompile and reverts rather than counting a failed or malformed answer as valid or invalid. | `Keys.t.sol`: `testMalformedVerifyReturn`; `Verdict.t.sol`: `testVerifyPrecompileFailures`, `testBadSignatures`; `Claim.t.sol`: `testClaimPrecompileFailure` |
| `_eligible` | [L636-L639](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L636-L639) | A key counts only if it is registered, algorithm 1 (ML-DSA-87), exactly 2592 bytes and possession-proven. | `Create.t.sol`: `testRejectsUneligibleKeys`, `testRejectsWrongAlgorithmAndShortKey`; `Settlement.t.sol`: `testGatedWithdrawNeedsEligibility`; `Message.t.sol`: `testResolvePayNeedsEligiblePayee` |
| `_eligibleKeyHash` | [L641-L647](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L641-L647) | Same eligibility rule, but reverts `KeyIneligible` and returns the key hash so verifier keys can be compared. | `Create.t.sol`: `testRejectsUneligibleKeys`, `testRejectsWrongAlgorithmAndShortKey` |
| `_requireDistinctEligibleKeys` | [L649-L657](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L649-L657) | At creation, all three verifiers must hold eligible keys and no two may share the same key. | `Create.t.sol`: `testRejectsUneligibleKeys`, `testRejectsDuplicateKeys` |
| `_keySharedWithVerifier` | [L626-L634](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L626-L634) | A claimant whose key equals a verifier's key cannot claim, so a verifier can't claim through a second address. | `Claim.t.sol`: `testClaimantSharingVerifierKeyExcluded` |
| `_checkSignersAndKeys` | [L512-L549](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L512-L549) | Requires 2 or 3 strictly increasing verifier slots whose keys are eligible and distinct before any signature is checked. | `Verdict.t.sol`: `testInvalidSignerShapes`, `testSignerRevokedFails`, `testRotatedIntoSharedKeyFails`; `Keys.t.sol`: `testNonSigningIneligibleIgnored`, `testResolveWithRevokedSignerFails` |
| `_verifySignatures` | [L551-L567](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L551-L567) | Each chosen verifier's ML-DSA-87 signature must verify over the exact verdict message with that verifier's live key. | `Verdict.t.sol`: `testBadSignatures`, `testVerifyPrecompileFailures`; `Message.t.sol`: `testDisputeSignatureNotReusableAcrossDisputes` |
| `createBounty` call site | [L176](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L176) | Refuses to create a bounty unless the three verifier keys are eligible and distinct. | `Create.t.sol`: `testRejectsUneligibleKeys`, `testRejectsDuplicateKeys` |
| `claim` call sites | [L238-L251](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L238-L251) | The claimant must hold an eligible live key, must not share a verifier's key, and the claim signature (bound to the caller and next round) must verify. | `Claim.t.sol`: `testClaimKeyIneligible`, `testClaimBadSignatures`, `testCopiedSignatureCannotClaimForCopier`, `testClaimantSharingVerifierKeyExcluded` |
| `submitVerdict` call sites | [L295-L297](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L295-L297) | A first verdict needs a valid 2-of-3 quorum, and a PAY verdict also needs the payee's key to be live. | `Verdict.t.sol`: `testBadSignatures`, `testInvalidSignerShapes`, `testRotatedIntoSharedKeyFails`; `Keys.t.sol`: `testMalformedKeyStatusOnSubmit` |
| `resolveDispute` call sites | [L338-L339](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L338-L339) | A dispute ruling needs a fresh valid 2-of-3 quorum bound to the stored dispute hashes, so a revoked or reused signature can't settle it. | `Keys.t.sol`: `testResolveWithRevokedSignerFails`, `testRotationBetweenVerdictAndResolution`; `Message.t.sol`: `testDisputeSignatureNotReusableAcrossDisputes`; `Dispute.t.sol`: `testResolveDisputeBindsStoredHashes` |
| `withdraw` call site | [L406](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L406) | Payee-gated credit leaves the contract only while the payee's PQ key is live; ungated credit is never blocked. | `Settlement.t.sol`: `testGatedWithdrawNeedsEligibility`, `testUngatedWithdrawBypassesGating`, `testMixedGatedUngatedAtomic` |
| `_settleOutcome` (PAY eligibility) | [L673](https://github.com/Ololadestephen/Postmark/blob/6babd147dd1452107862c1320615232ab1775005/src/PostmarkEscrow.sol#L673) | Crediting a PAY outcome re-checks that the payee's key is still eligible at settlement time. | `Message.t.sol`: `testResolvePayNeedsEligiblePayee`; `Keys.t.sol`: `testGatedBondSlashNeedsPayeeKey` |

## Where the contract uses QoreChain PQC

The EVM setting reports quantum readiness as "not scored", so here is where it comes in:
- `claim` checks the claimant's live ML-DSA-87 key (`pqcKeyStatus`) and verifies the claim
  signature (`pqcVerify`).
- `submitVerdict` and `resolveDispute` need 2 or 3 verifier ML-DSA-87 signatures over the full
  verdict payload, each verified by `pqcVerify` against that verifier's live key. Duplicate
  verifier keys are refused.
- `withdraw` pays gated (payee) credits only while the payee's PQ key is live.

So a leaked ECDSA key alone can't claim, release or withdraw a payout. All payouts are testnet
payouts in test QOR, which has no monetary value.
