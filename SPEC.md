# PostmarkEscrow v1 — normative design (implemented in `src/PostmarkEscrow.sol`)

Project: **Postmark**, a QoreChain Build Before Q-Day entry.

Build Before Q-Day, Post-Quantum dApp track. GitHub work is real; on diana
(EVM chain ID 9800, native ID `qorechain-diana`) payouts are **test QOR**.
No mainnet claim. `src/test-utils/` is test infrastructure only and is never deployed.

## Parties, assets and identity

A funder locks a principal for one repo and PR/issue without choosing a payee.
A contributor claims it by proving control of a live registered ML-DSA-87 key.
The claim records the claimant as payee and a nonzero `payeeIdentityHash`
committing to the GitHub identity/linking evidence. One unexpired claim is active
at a time; after expiry another valid claim may replace it. Funder and verifier
accounts cannot claim. Claim identity evidence is public and verified off chain.
Three verifier accounts are selected per bounty by the funder. The contract
enforces distinct accounts and public keys; it cannot tell whether the operators
behind them are independent. Today's curated verifiers are the Postmark
maintainer's bot, the maintainer's own human tie-breaker, and (optionally) a
per-funder bot running in the funder's repository, so independence depends on the
funder's choices. Operator independence and GitHub identity/merge facts are
verified off chain, not inferable cryptographically.

V1 accepts **native test QOR only**, accounted in wei units. There is no token
parameter, approval flow, or asset selection.

`workHash = keccak256(abi.encode("github", lowerCaseOwnerRepo, uint8(kind), uint256(id)))`,
where `kind=0` is issue and `kind=1` is PR. `lowerCaseOwnerRepo` is ASCII
`owner/repo`, no URL/trailing slash. The UI/verifiers canonicalize these bytes;
the contract receives only the hash. Multiple bounties on the same work are
allowed and differentiated by bounty ID. Verifiers must link an issue to its
qualifying merged PR in the evidence if the bounty targets an issue.

Principal `amount > 0`, positive `bondAmount`, and `challengeReward > 0` are
creation parameters, all in native test QOR. The funder escrows
`amount + challengeReward` up front, separately accounted. No protocol fee or
treasury in v1. Unused reward always goes back to the funder.
Deadline is a future uint64 timestamp; it is both the qualifying merge cutoff
and the last instant to submit an initial verdict. Merge-before-deadline alone
does not preserve a late verdict. This deliberate bounded submission rule must
be disclosed to contributors and verifiers.

`claimTimeout` is a uint64 duration in seconds, immutable per bounty:
`1 hours <= claimTimeout <= 7 days`. At creation require
`block.timestamp + claimTimeout <= deadline`, checked without truncation or
overflow. Each claim must also satisfy `now < deadline` and
`now + claimTimeout <= deadline`; thus the full claim duration must fit, even
for replacements. A bounty may become unclaimable near its deadline. Active
means `now < claimExpiresAt`; at exact expiry the claim is no longer active.

## Precompile boundary

Use the workshop/current docs ABI, with typed calls (empty/malformed return
data reverts closed):

```solidity
// 0x0000000000000000000000000000000000000a01
function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
    external view returns (bool valid);
// 0x0000000000000000000000000000000000000a02
function pqcKeyStatus(address account) external view
    returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
```

Every accepted signer must currently return registered, algorithm 1, exactly
2592 key bytes, possessionProven true. Each signature is 4627 bytes and must
pass pqcVerify. Check all three verifier accounts at creation and require
distinct key hashes. At each verdict submission/resolution read all three
live keys again and require their hashes distinct; validate at least two unique
verifier indices against those keys. Signature arrays have length exactly 2 or
3, same length as indices, indices strictly increasing and <3. No duplicate
signature can count twice. Relayer identity never authorizes a verdict.

Verifier account addresses are immutable per bounty. Native dual-signed key
rotation is supported by looking up their **current** keys, not cached keys:
old signatures cease to work on new submissions. No ECDSA-only admin can
replace an operator. After a verdict is accepted its authorization is recorded;
later rotation/revocation does not retroactively undo it. There is no late
verifier recheck at finalization, avoiding retroactive veto. Payee eligibility
is rechecked live before every actual payout/withdrawal to that address.

## Types and exact signing bytes

```solidity
enum State { Open, Claimed, Pending, Disputed, Paid, Refunded }
enum Outcome { PAY, REFUND }
enum Phase { INITIAL, DISPUTE }
struct Verdict {
    uint256 bountyId;
    Phase phase;
    Outcome outcome;
    address payee;
    uint64 mergedAt;
    bytes32 evidenceHash;
    uint256 nonce;
    uint256 claimRound;
}
```

### ClaimV1

Define `CLAIM_TYPEHASH = keccak256("ClaimV1(uint256 chainId,address escrow,uint256 bountyId,address claimant,bytes32 identityHash,uint256 claimRound)")`.
The signed claim payload is `abi.encode(CLAIM_TYPEHASH, block.chainid,
address(this), bountyId, claimant, identityHash, claimRound)`, ordinary ABI
encoding. Sign the raw QoreX-prefixed bytes, not a hash:
`bytes("qorechain-msg-v1|") || bytes(nativeChainId) || bytes("|") || payload`,
using empty ML-DSA context. IdentityHash must be nonzero.

Stored `claimRound` starts at 0. The signature covers **the next round**, stored
`claimRound + 1`, with claimant equal to msg.sender. `claim` verifies it against
msg.sender's live algorithm-1, possession-proven 2592-byte key using pqcVerify;
only after success does it increment/store the round. It sets payee = msg.sender,
payeeIdentityHash = identityHash, claimExpiresAt = now + claimTimeout and state
Claimed. Failure consumes no round. No relayed claim on another address's
behalf; caller equality prevents a copied signature claiming for the copier.
`claimMessage` exposes these exact bytes for off-chain signing.

### VerdictV1

Define `VERDICT_TYPEHASH = keccak256("PostmarkEscrowVerdictV1(uint256 chainId,address escrow,uint256 bountyId,uint8 phase,uint8 outcome,address payee,uint64 mergedAt,bytes32 evidenceHash,uint256 nonce,uint256 claimRound,bytes32 disputedVerdictHash,bytes32 disputeEvidenceHash)")`.
`payload = abi.encode(VERDICT_TYPEHASH, block.chainid, address(this), bountyId,
uint8(phase), uint8(outcome), payee, mergedAt, evidenceHash, nonce, claimRound,
disputedVerdictHash, disputeEvidenceHash)` with ordinary ABI 32-byte fields,
not packed concatenation or JSON. The last two fields are zero for INITIAL;
for DISPUTE they are the stored original payload hash and dispute evidence hash.
`verdictMessage(v)` returns raw `bytes("qorechain-msg-v1|") ||
bytes(nativeChainId) || bytes("|") || payload` (no prehash).
`nativeChainId` is an immutable constructor string restricted to
`[A-Za-z0-9._-]+`. The numeric EVM chain ID is separately included in payload.
`pendingVerdictHash = keccak256(payload)`; events let independent operators
reconstruct what was accepted. Signers use empty ML-DSA context per QoreX.

For INITIAL PAY: effective state must be Claimed, `now < claimExpiresAt`,
payee equals the current claimant, and claimRound equals the stored current
round. Require `0 < mergedAt <= block.timestamp`
and `mergedAt <= deadline`; evidenceHash nonzero. Before accepting PAY check
the payee's live registered algorithm-1 proven key. For INITIAL REFUND:
payee zero, mergedAt zero, evidenceHash nonzero, current claimRound (0 if never
claimed); effective state may be Open or Claimed. A quorum may attest early
ineligibility/refund; this also gets a challenge window. On either INITIAL
outcome, snapshot the active claimant and identity if present, otherwise zero
them; keep the monotonic claimRound even if the prior claim expired. Pending
freezes this snapshot: it no longer expires, cannot be replaced, and binds every
dispute verdict to its stored round. DISPUTE PAY must satisfy the original merge
cutoff and name that frozen claimant; it is invalid if no active claimant was
frozen. DISPUTE REFUND has zero payee/mergedAt. Its evidence hash is fresh
resolution evidence. A stale claimant or round never becomes payable merely
because a new claim uses the same address.

Each bounty nonce starts at 0. INITIAL requires exact current nonce and phase,
then increments it on acceptance. DISPUTE requires the new current nonce and
phase and increments on resolution. Nonce is consumed before any transfer.
Distinct phase, chain IDs, deployment address, bounty ID, claimRound and dispute bindings
prevent cross-purpose/cross-bounty/cross-chain/repeated resolution replay.

## State machine and time boundaries

| From | Call / guard | To / effects |
|---|---|---|
| nonexistent | create, exact native funding, valid bounds/verifier keys | Open, no claimant, claimRound = 0 |
| Open | valid PQ-signed claim, `now < deadline`, full timeout fits | Claimed, increment round, set claimant/identity/expiry |
| Claimed | time reaches `claimExpiresAt` before any verdict | Open (effective state), old claim no longer active |
| Claimed | another claim while `now < claimExpiresAt` | revert ClaimActive, including same-address renewal |
| Claimed | INITIAL PAY quorum, unexpired current claim/round, `now <= deadline` | Pending, freeze claimant snapshot, `challengeEndsAt = now + 24 hours` |
| Open or Claimed | INITIAL REFUND quorum at `now <= deadline`, current round | Pending, freeze active claimant if any, same 24h window |
| Open or Claimed | refundExpired, funder only, `now > deadline` | Refunded, principal + reward to funder |
| Pending | dispute by anyone, `now < challengeEndsAt`, exact bond | Disputed, store disputer/evidence, freeze ordinary finalization |
| Pending | finalize by anyone, `now >= challengeEndsAt` | Paid for PAY / Refunded for REFUND |
| Disputed | resolveDispute, fresh quorum, no timeout | Paid or Refunded according to resolution |
| Paid/Refunded | any settlement mutation | revert |

Effective Open includes a stored Claimed record at/after expiry. Views report
Open and no active claimant in that case; mutation paths normalize lazily and
clear expired payee/identity/expiry before using them, without resetting the
round. Time passing needs no transaction. `getBounty` reports normalized fields.
The next valid claim replaces the expired record. No expiration transition is
performed in Pending/Disputed: those snapshots remain frozen.

Deadline refund requires Open or Claimed, so a timely accepted verdict (including REFUND)
cannot be raced by refundExpired. Deadline itself still permits submission;
refund begins strictly later. The first valid verdict wins; no replacements or
second dispute. Disputing does not pay anyone until resolution.

An upheld dispute is exactly a resolution outcome different from the stored
initial outcome. The usual case is PAY challenged to REFUND: funder recovers
principal, disputer receives bond back plus reward. For completeness, a
REFUND challenged to PAY is also upheld if there was an active claimant frozen
at submission: that payee gets principal, disputer gets bond plus reward.
With no frozen claimant only REFUND resolution is valid; an appeal cannot
invent a payee after claims are closed. On rejection the initial outcome stands
and the bond is slashed **to the frozen claimant**, even if the result is REFUND;
if no claimant was frozen, the bond goes to the funder. The unused reward
returns to the funder. This compensates the contributor for a baseless delay,
avoids an admin-controlled treasury, and prevents a funder profiting by making
their own rejected dispute. Self-disputes remain possible but cannot extract
more than already escrowed: returning a self-funded reward is not new value.

Settlement credits a pull-payment ledger in the same transaction and sets the
terminal state; it makes no external asset transfers. No-dispute PAY credits
principal to payee and reward to funder; no-dispute REFUND credits both to
funder. Resolution credits principal according to the table plus bond/reward
rules above. A PAY terminal transition also checks the live payee key. Anyone
can finalize; an ineligible payee can restore/rotate its native key and retry.
`withdraw()` transfers the caller's full available native QOR credit to that same
caller; it cannot redirect funds. Any withdrawal by an address that has payee
credits requires the same live key eligibility before transfer.
Track gated and ungated credits separately so funder/disputer credits cannot
bypass payee gating; withdraw consumes both atomically or reverts if gated
credits exist and eligibility fails. No admin confiscation or rescue of tracked
funds. Forced native QOR donations are not bounty funding or withdrawable credit.

No dispute timeout or unilateral override in v1: loss/collusion of two operators
can lock disputed funds indefinitely. This liveness tradeoff prevents an ECDSA
timeout shortcut defeating the PQ quorum and must be prominent in the demo.

## Intended Solidity API

```solidity
constructor(string memory nativeChainId_);
function createBounty(uint256 amount, string calldata ownerRepo, uint8 kind, uint256 number,
    uint64 deadline, uint64 claimTimeout,
    address[3] calldata verifiers, uint256 bondAmount, uint256 challengeReward)
    external payable returns (uint256 bountyId);
function claim(uint256 bountyId, bytes32 identityHash, bytes calldata signature) external;
function claimMessage(uint256 bountyId, address claimant, bytes32 identityHash,
    uint256 claimRound) external view returns (bytes memory);
function submitVerdict(Verdict calldata v, uint8[] calldata signerIndices,
    bytes[] calldata signatures) external;
function dispute(uint256 bountyId, bytes32 evidenceHash) external payable;
function resolveDispute(Verdict calldata v, uint8[] calldata signerIndices,
    bytes[] calldata signatures) external;
function finalize(uint256 bountyId) external;
function refundExpired(uint256 bountyId) external;
function withdraw() external;
function verdictMessage(Verdict calldata v) external view returns (bytes memory);
function getBounty(uint256 bountyId) external view returns (Bounty memory);
function creditOf(address account) external view
    returns (uint256 ungated, uint256 payeeGated);
```

For create/dispute, msg.value is exactly total funding/bond. All other functions
nonpayable. `dispute` rejects zero evidence; the bond amount is immutable from
creation, not chosen smaller by the disputer. Checks-effects-interactions plus
nonReentrant on all mutators; a failed withdrawal restores the credit by revert.

Storage: immutable nativeChainId; `nextBountyId=1`; mapping ID => Bounty;
mapping account => ungated/gated native QOR credit totals; total native liabilities.
Bounty stores funder, amount, reward, workHash, deadline, claimTimeout,
claimRound, claimExpiresAt, payee, payeeIdentityHash,
address[3] verifiers, bondAmount, state, nonce,
initialOutcome, initialMergedAt, initialEvidenceHash, pendingVerdictHash,
challengeEndsAt, disputer and disputeEvidenceHash. Terminal state stays stored;
no deletion or ID reuse. No verifier secret/public keys stored in escrow.

Events (types and indexed fields):
```solidity
event BountyCreated(uint256 indexed bountyId, address indexed funder,
    uint256 amount, uint256 reward, bytes32 workHash, uint64 deadline,
    uint64 claimTimeout, address[3] verifiers, uint256 bondAmount);
event BountyWork(uint256 indexed bountyId, bytes32 indexed workHash,
    string ownerRepo, uint8 kind, uint256 number);
event Claimed(uint256 indexed bountyId, address indexed claimant,
    bytes32 identityHash, uint256 claimRound, uint64 expiresAt);
event VerdictSubmitted(uint256 indexed bountyId, bytes32 payloadHash, Outcome outcome,
    uint64 mergedAt, bytes32 evidenceHash, uint256 nonce, uint256 claimRound, uint64 challengeEndsAt);
event Disputed(uint256 indexed bountyId, address indexed disputer, uint256 bond, bytes32 evidenceHash);
event DisputeResolved(uint256 indexed bountyId, bytes32 payloadHash, Outcome outcome,
    bool upheld, bytes32 evidenceHash, uint256 nonce, uint256 claimRound);
event Settled(uint256 indexed bountyId, State terminalState);
event Credited(uint256 indexed bountyId, address indexed account,
    uint256 amount, bool payeeGated);
event Withdrawn(address indexed account, uint256 amount);
```

Errors: `UnknownBounty(uint256)`, `InvalidState(State,State)`, `InvalidParameters()`,
`NotFunder()`, `WrongValue(uint256,uint256)`,
`ClaimActive(uint64 expiresAt)`, `ClaimExpired()`, `NotClaimant()`,
`ClaimClosed()`, `ClaimWindowTooShort()`, `InvalidClaimTimeout()`,
`ClaimantExcluded(address)`, `InvalidClaimRound(uint256 expected,uint256 actual)`,
`BadClaimSignature()`,
`DeadlineNotPassed()`, `SubmissionClosed()`, `ChallengeClosed()`, `ChallengeOpen()`,
`InvalidPhase()`, `InvalidNonce(uint256,uint256)`, `InvalidVerdict()`,
`InvalidSigners()`, `DuplicateVerifierKey()`, `KeyIneligible(address)`,
`BadSignature(uint8)`, `PrecompileUnavailable()`, `NothingToWithdraw()`,
`TransferFailed()`, plus the chosen reentrancy-guard errors.
ClaimClosed covers claims at/after deadline or outside Open/Claimed;
ClaimWindowTooShort covers a full timeout not fitting before deadline.
ClaimExpired covers PAY without an active claim; NotClaimant covers a PAY
payee that differs from the current/frozen claimant. InvalidClaimRound applies
to verdicts; a replayed claim signature fails BadClaimSignature against the next
round's message. InvalidParameters covers zero identity/work hash and invalid
addresses/amounts; ClaimantExcluded covers the funder and all verifier accounts.
Wrap precompile failures/undecodable data into PrecompileUnavailable; a
well-formed false verification result is BadSignature, not unavailable.

## Scoped EVM windows and demo operation

Ordinary EVM transactions require a registered PQ key and an open account
authorization window; eth_call needs no window. A window is opened through a
native hybrid-signed transaction, **only on explicit operator request**.
The diana demo registers/proves disposable account keys, funds with faucet
test QOR, then opens a short window with limited transaction count and uqor
spend cap and `allowedTargets` listing just the deployed escrow. Read EVM nonce after opening
because the native sequence and EVM nonce share account identity. `nativeOnly`
is inappropriate for contract calls. Confirm the current SDK/window bounds
and live precompile activation before demo; deployment needs its own explicitly
scoped authorization rather than leaving a broadly privileged window open.
Target scope does not constrain internal calls: no generic routers on the target
list. Use tiny native spend limits.
The library intentionally does not simulate any of this chain admission logic.

## Threat model draft

The full threat model is in THREAT_MODEL.md; this section is its summary.

### Indefinite lock — no dispute timeout

**Two lost, unavailable or colluding operators can lock disputed funds forever.**
There is no timeout or ECDSA/admin escape hatch. Disputes are resolved by the
**same three-verifier set that signed the original verdict**, requiring a fresh
2-of-3 signature quorum. A dispute does **not** add independent review; the two
signers may be exactly the original two people. Independent operators are a
trust assumption, not an independent appeal mechanism.

### Claims, classical-key exposure and external facts

An ECDSA leak during an open window can submit/race permitted calls, spend
the window budget, create attacker-funded bounties, or lodge a bonded dispute;
it can drain exposed native wallet funds where scope permits. Eligibility
is not PQ authorization for a wallet withdrawal: someone controlling an ECDSA
key may withdraw that account's already credited funds to that same address
while its PQ registration is live. The escrow cannot protect funds after they
reach a compromised recipient wallet. A leak alone cannot forge verifier
ML-DSA signatures, forge a claimant's ClaimV1, replace frozen payee/operator identities, bypass the
challenge state machine, or redirect a credit to another address. Hybrid native
window opening/rotation remain dependent on chain enforcement and safe PQ keys.
The funder's ECDSA-authorized expiry refund is deliberate and cannot redirect
the funder's refund to an arbitrary account.

A compromised ECDSA key cannot claim without the claimant's PQ signature;
copied signatures are caller- and round-bound. Claims do not prove GitHub
ownership; verifiers must inspect identityHash evidence. Anyone eligible can
occupy an open bounty for a timeout, and can race/reclaim after expiry with a
fresh PQ signature. V1 has no claim bond or Sybil resistance. A timeout bounds
one reservation, not repeated griefing. The funder/verifier exclusion is by
account address, not a proof that the same humans lack alternative accounts.
Expiry may cost an honest contributor their reservation if they fail to submit
a quorum in time; Pending freezes only a timely accepted claim snapshot.

Two colluding or compromised verifiers can approve false facts or
reject legitimate disputes; no contract proves GitHub merge/identity facts.
Revoked/unproven keys fail live checks, but accepted verdicts remain historical
facts for this contract. A payee losing its PQ key may strand gated credit;
two unavailable verifiers strand a dispute. Compromised Node/npm/FFI invalidates
local test trust; the Node helper is never an on-chain verifier. Cross-chain
replay is bounded by both chain IDs and contract domain; same-address/same-ID
fork replay remains a network-level risk. Relayer censorship,
clock variance, and evidence availability remain explicit external risks.

## Foundry test plan (implemented in `test/escrow/`)

Use PqcTest with three independently seeded test operators; never always-true stubs.
Write tests for exact native funding, zero values, forced QOR,
native-transfer callback reentrancy, canonical work hash, invalid identities/deadlines,
duplicate operators/keys, missing/unproven/wrong algorithm/malformed registry
responses, inactive precompiles, and partial initialization rollback.
Claim tests: valid live-key claim and Claimed event; unregistered/revoked/unproven
or wrong-algorithm keys; malformed/bad signatures; copied signature from another
address; another bounty/chain/deployment and another round; successful claim
replay; same-address renewal and second claimant rejected while active;
replacement at/after expiry; claims at/after deadline rejected; full timeout not
fitting; min/max/overflow timeout bounds; funder/verifier claim rejection;
zero identity hash; exact expiry boundary and normalized Open views. Verify
claimRound increments only on success and never resets, expired fields clear,
stale claimant/round PAY fails, REFUND from Open/Claimed works, and Pending
freezes the active snapshot even after original expiry. No-claim REFUND cannot
resolve to PAY; rejected dispute bond uses the funder fallback in that case.
Cover 2/3 and 3/3 PAY/REFUND, bad/duplicate/unsorted indices, wrong key/message/
signature, every typed field mutation, wrong phase/domain/chain/bounty/nonce,
replay, relayed submissions, payee substitution, merge and submit cutoff bounds.
Test exact deadline and exact 24h boundaries; all illegal state transitions;
expired refund race versus timely verdict; anyone finalize; early/late/second
disputes; exact bond and zero evidence; frozen finalization; fresh dispute quorum
and evidence binding; both initial outcomes upheld/rejected; reward/bond ledger
conservation; replayed resolution; missing quorum indefinite lock as documented.
Cover live verifier rotation rejecting old signatures and accepting new ones,
revocation before submission versus after acceptance, payee revocation before
PAY settlement/withdrawal and restoration; gated/ungated credit mixing; failed
withdrawal rollback, transfer reentrancy, duplicate finalization, forced funds,
fuzz nonce/claimRound/state transitions and invariant native liabilities <= address(this).balance.
Integration on diana separately covers scoped windows, exhausted/expired windows,
real precompile return values, native PoP and hybrid key rotation; local FFI
tests cannot certify those chain-level properties.

## Implementation decisions (settled Nov 19)

These close the choices the sections above leave open. Where they are more specific, they win.

D1 Dependencies. OpenZeppelin Contracts 5.7.0 (exact pin) for `ReentrancyGuard` only; its
   `ReentrancyGuardReentrantCall` is the chosen guard error. No SafeERC20 or token code in v1.

D2 Creation. `amount > 0`, `bondAmount > 0`, `challengeReward > 0`, `workHash != 0`, verifiers nonzero,
   pairwise distinct and none equal to `msg.sender`, else `InvalidParameters()`. `claimTimeout` outside
   `[1 hours, 7 days]` is `InvalidClaimTimeout()`. `deadline <= now` is `InvalidParameters()`;
   `now + claimTimeout > deadline` is `ClaimWindowTooShort()`. `msg.value != amount + challengeReward` is
   `WrongValue(expected, got)`. All three verifiers must be eligible (`KeyIneligible(verifier)`) with
   pairwise distinct key hashes (`DuplicateVerifierKey()`).

D3 Claim check order: `UnknownBounty` -> normalize expiry -> state not Open/Claimed is `ClaimClosed()` ->
   active claim is `ClaimActive(expiresAt)` (same address too) -> `now >= deadline` is `ClaimClosed()` ->
   `now + claimTimeout > deadline` is `ClaimWindowTooShort()` -> `identityHash == 0` is
   `InvalidParameters()` -> funder or verifier caller is `ClaimantExcluded(caller)` -> caller key ineligible is
   `KeyIneligible(caller)` -> caller key hash equal to any verifier's present live key is
   `ClaimantExcluded(caller)` -> signature length != 4627 or well-formed false is `BadClaimSignature()`.
   Why the key check: a verifier must not be paid through a second account that shares its key.

D4 Expiry. Any mutation on a bounty first normalizes: stored Claimed with `now >= claimExpiresAt` becomes
   Open, payee/identity/expiry are cleared, `claimRound` is kept, and `ClaimReleased(bountyId, claimant,
   claimRound)` is emitted. `reopen(bountyId)` lets anyone do this explicitly (`ClaimActive` if still
   active, `InvalidState(current, Claimed)` if there is nothing to release). Views report normalized
   values without writing. Why: the event keeps "an event for every state change" true while the spec's
   lazy expiry still needs no transaction.

D5 Verdict check order (both phases): `UnknownBounty` -> normalize -> `InvalidState(current, expected)`
   (INITIAL expects Open/Claimed and reports `Open`; DISPUTE expects Disputed) -> `InvalidPhase()` ->
   `InvalidNonce(expected, got)` -> `InvalidClaimRound(expected, got)` -> INITIAL `now > deadline` is
   `SubmissionClosed()` -> fields -> signer shape -> verifier keys -> signatures -> PAY payee eligibility.
   Field rules: PAY with no active (INITIAL) or frozen (DISPUTE) claimant is `ClaimExpired()`; PAY payee
   != that claimant is `NotClaimant()`; then PAY needs `0 < mergedAt <= now`, `mergedAt <= deadline`,
   `evidenceHash != 0`, and REFUND needs `payee == 0`, `mergedAt == 0`, `evidenceHash != 0`, else
   `InvalidVerdict()`.

D6 Keys at submission, precompile handling, signer shape and time boundaries are unchanged from the
   escrow-only design: signing verifiers must be eligible, present keys pairwise distinct, a lone revoked
   non-signer is ignored; low-level `staticcall`s, malformed or missing responses are
   `PrecompileUnavailable()`, signatures of the wrong length are `BadSignature(index)`; dispute
   `now < challengeEndsAt`, finalize `now >= challengeEndsAt`, refund `now > deadline`.

D7 Credits (P principal, R reward, B bond; credits to the frozen claimant are gated, all others ungated):
   no-dispute PAY: P to claimant, R to funder. No-dispute REFUND: P+R to funder. Upheld: P per
   outcome, B+R to disputer. Rejected: P per outcome, B to frozen claimant or to the funder if none,
   R to funder. refundExpired: P+R to funder. Every PAY transition re-checks payee eligibility.

D8 Native ledger. `totalLiabilities` grows by every exact funding and bond and shrinks by every
   withdrawal. Invariant: `totalLiabilities <= address(this).balance`, and it equals escrowed-unsettled
   plus outstanding credits. `withdraw()` zeroes both credit kinds, then sends with `call`; failure is
   `TransferFailed()`. No `receive`/`fallback`.

D9 Events. `VerdictSubmitted.nonce` and `DisputeResolved.nonce` are the nonce the verdict signed. Storage
   writes and events come before receiving value (CEI); exact `msg.value` checks come first.

D10 Smaller orders. `claim` on Pending/Disputed/terminal is `ClaimClosed()` before any active-claim check.
    `reopen`: `UnknownBounty` -> `InvalidState(current, Claimed)` -> `ClaimActive`. `refundExpired`:
    `UnknownBounty`/`NotFunder` -> normalize -> state -> `DeadlineNotPassed`. An ineligible claimant key is
    `KeyIneligible(caller)`. PAY at exactly `now == deadline` cannot happen (a claim must end by the
    deadline), so exact-deadline submission is a REFUND case.

D11 Work reference on chain (Nov 19, for the web app). `createBounty` takes `ownerRepo`, `kind` and
    `number` instead of a precomputed `workHash`, computes `workHash` itself with the formula above,
    stores it, and emits `BountyWork` right after `BountyCreated`. `ownerRepo` must be 3 to 140 bytes,
    contain exactly one `/` that is neither first nor last, and use only `[a-z0-9._-]` (lowercase, so
    the canonical form is enforced, not trusted); `kind` must be 0 (issue) or 1 (PR); `number > 0`.
    Anything else is `InvalidParameters()`. Why: without a backend the app has to learn which GitHub
    item a bounty pays for from the chain, and computing the hash on chain means a funder cannot
    publish a reference that disagrees with the hash.
    The extra code took the unoptimized runtime over 24,576 bytes, so the optimizer is on (200 runs).

## Off-chain formats (web app, local signer, verifiers)

All hashes are `keccak256(abi.encode(...))` with the listed Solidity types. Strings are lowercase
where marked. GitHub numbers are the REST API ids.

**Identity (`claim.identityHash`).** Before claiming, the claimant posts a comment on the bounty's
issue or PR, from the GitHub account that will open the PR, containing this exact line:
`postmark-claim v1 chain=9800 escrow=<escrow 0x, lowercase> bounty=<id> claimant=<0x, lowercase>`.
`identityHash = keccak256(abi.encode("postmark-identity-v1", string githubLogin /*lowercase*/,
address claimant, uint256 commentId))`. Verifiers fetch
`GET /repos/{ownerRepo}/issues/comments/{commentId}`, check `user.login`, the line and the claimant,
and recompute the hash. The comment id is found by scanning the item's comments for the line.

**PAY evidence.** `evidenceHash = keccak256(abi.encode("postmark-evidence-v1", string ownerRepo,
uint256 prNumber, string mergeCommitSha /*40 hex, lowercase*/, uint64 mergedAt, string prAuthorLogin
/*lowercase*/))`. `mergedAt` is GitHub's `merged_at` in Unix seconds and must equal the verdict's
`mergedAt`. `prAuthorLogin` must equal the identity login. For an issue bounty, the PR must be in the
same repo and close or reference the issue (verifier judgment, shown by the tool from the issue
timeline).

**REFUND evidence.** `keccak256(abi.encode("postmark-refund-v1", string reasonCode, string detailsUrl))`,
with `reasonCode` one of `not-merged`, `ineligible`, `identity-mismatch`, `withdrawn`, `other`.

**Dispute evidence.** The disputer posts a comment on the bounty item containing
`postmark-dispute v1 chain=9800 escrow=<0x> bounty=<id>` plus their reasons;
`keccak256(abi.encode("postmark-dispute-v1", string githubLogin, uint256 commentId))`.

**Resolution evidence.** `keccak256(abi.encode("postmark-resolution-v1", uint256 disputeCommentId,
bytes32 basisHash))`, where `basisHash` is a PAY or REFUND evidence hash in the formats above.

**On-chain task bounties.** An issue (kind 0) may carry exactly one fenced block with info string
`postmark-task` in its body; an issue with none is an ordinary code bounty. The block is `key: value`
lines (`#` comments and blank lines ignored, keys `type`, `contract`, `function`, `codehash` only):

```
type: onchain-call | onchain-deploy | testing | url
contract: 0x<40 hex>        # required for onchain-call, forbidden otherwise
function: name(types)     # optional, onchain-call only; no spaces or parameter names
codehash: 0x<64 hex>      # optional, onchain-deploy only; keccak256 of the runtime bytecode
```

`testing` and `url` parse but are not auto-judged yet (bots abstain). For on-chain types the claim
line carries an extra field `brief=0x<64 hex>` where
`brief = keccak256(abi.encode("postmark-brief-v1", string canonicalText))` and `canonicalText` is the
canonical key-ordered rendering of the task (comments and whitespace do not change it; any field
change does). The claimant proves the work with one comment per transaction:
`postmark-proof v1 tx=0x<64 hex>`. Bots PAY the passing proof transaction posted by the
claimant's GitHub login with the earliest block timestamp (ties break to the lowest tx hash): the
transaction exists and succeeded, `tx.from` is the
payee, its block timestamp is at or after the claim time and at or before the deadline, and for
`onchain-call` `tx.to` is the task contract (plus a calldata-prefix match on the `function` selector,
first 4 bytes of `keccak256(signature)`, when given) — for `onchain-deploy` `tx.to` is null with a
receipt `contractAddress` (plus a runtime-codehash match when `codehash` is given). The claim time is
`claimExpiresAt − claimTimeout` while the claim is live, else the block timestamp of the latest
`Claimed` event for the bounty and round. PAY evidence is
`keccak256(abi.encode("postmark-onchain-v1", string type, bytes32 txHash, uint64 blockTimestamp,
address claimant))` with `mergedAt` = the transaction's block timestamp. A proof tx already used as
`initialEvidenceHash` on another bounty is skipped; bots abstain only when every passing proof is
taken. Any RPC failure or ambiguity is an
abstention, never a REFUND; the `not_planned` withdrawn refund still applies.

**Verdict bundle.** Verifiers sign separately and pass a JSON bundle along (file or paste):
`{"format":"postmark-verdict-bundle-v1","chainId":9800,"nativeChainId":"qorechain-diana",
"escrow":"0x…","verdict":{…all Verdict fields…},"evidence":{"format":"…","fields":{…}},
"message":"0x…","signatures":{"<index>":"0x…"}}`. Anyone may merge bundles for the same message
and submit. The app rebuilds the message from the verdict and the chain, recomputes the evidence
hash from `evidence`, and verifies each signature locally against the live registered key before
it offers to submit.

**Local signer.** ML-DSA-87 secrets never reach the web app. The local signer binds `127.0.0.1`,
accepts requests only from the configured app origin, rebuilds the message from the decoded fields
itself (it does not trust the app's bytes), refuses anything that does not start with
`qorechain-msg-v1|qorechain-diana|`, checks that its key is the account's live registered key, shows
a decoded summary and signs only after the user confirms in the terminal. When QoreX ships
`signArbitrary` (message signing v1, same prefix and bytes), the app uses it instead.

## Future work

ERC20 support: asset selection, per-asset credits/liabilities, SafeERC20 optional
return handling, exact incoming balance-delta checks, and explicit exclusion of
fee-on-transfer/rebasing tokens. Reassess malicious-token callbacks, approvals,
allowance exposure and scoped-window token targets before adding it. None of
this asset logic is part of v1.
