# Internal audit — 2026-07-28

**This is a first-party self-audit.** It was performed by the same agent that
wrote much of the code under review. It does not satisfy the independent-review
gate, none of the section-2 audit-checklist boxes are ticked by it, and the
deployment manifest's `independentReview` block remains empty. Treat every
conclusion below as a claim for the independent reviewer to check.

## Remediation status

The 2026-07-28 remediation is frozen at contract commit `740a473` (contract
digest `7aab9e3b…`) and has passed the full local gate. It remains subject to CI
and independent review:

- **M-1 remediated as a diagnostic control:** `V3LiquidityManager` reads
  `slot0` immediately after pool acquisition and reverts with
  `PoolPriceMismatch` before approvals or minting when the price is not exact.
  This makes the griefing attempt explicit; it does not eliminate the underlying
  permissionless-pool denial of service. Public factory v2 must treat prevention
  or bounded recovery as an architecture requirement.
- **M-2 accepted:** staggered release remains intentional. Interfaces must show
  the unreleased amount currently at risk, not the original 60% allocation.
- **L-1 fixed:** the canary observer assigns allocation division dust to escrow,
  exactly as the factory does.
- **L-2 fixed:** the factory now rejects supplies that are not a multiple of
  `1 ether`, so the documented bounds are whole-token bounds.
- **L-3 fixed:** tests require the deployment manifest digest, review-artifact
  digest, frozen commit, and audit-candidate commit to agree.
- **L-4 fixed in the production reducer:** raw permissionless deposits remain
  stored, while derived totals accept only the canonical factory, creator
  escrow, or position locker appropriate to each event class.
- **I-5 confirmed:** creator fee eligibility is intentionally inclusive at the
  exact deadline and becomes ineligible one chain-time second later.

## Scope and method

- Commit: `781e044` (branch head; `src/` digest matches
  `config/review-artifact.json`, frozen at `733895f`).
- Full line-by-line read of all eleven Solidity sources: `DoomToken`,
  `GmEscrow`, `DoomRewards`, `PositionLocker`, `V3LiquidityManager`,
  `DoomLaunchFactory`, and the five interfaces.
- Manual analysis of: access control, reentrancy ordering, ETH and token
  conservation, rounding, the staggered-release accounting introduced on
  2026-07-28, the two irreversible bindings, fee routing, Merkle claim logic,
  launch atomicity, and front-running/griefing surfaces.
- Supporting tooling and integration files reviewed where they consume contract
  state.
- Full local gate at the audit commit: 75 contract tests (2 fork tests separately
  passing against live mainnet state on 2026-07-28), 65 deployment, 17 death
  watch, 11 canary, 8 review, 8 rewards, 13 keeper — all green. Slither 0.11.5
  and Aderyn 0.6.8 are green in CI; they were not re-run locally.

## Findings

### M-1 · Launch can be griefed by pre-creating the V3 pool at a wrong price

**Severity: Medium (denial of service, recoverable, no fund loss).**
`DoomLaunchFactory` deploys each `DoomToken` with plain `CREATE`, so the token
address for the next launch is computable by anyone from the factory address and
its nonce. Uniswap V3's `createPool` never calls the token contracts, so a pool
can be created **for a token that does not exist yet**.

An attacker can therefore front-run a launch by creating and initializing the
`token/WETH` 1% pool at an arbitrary `sqrtPriceX96`.
`createAndInitializePoolIfNecessary` (V3LiquidityManager.sol:167) will then skip
initialization and keep the attacker's price. The full-range mint consumes
amounts in the ratio the pool price dictates, the 99.9999% utilization checks
fail (DoomLaunchFactory.sol:383, V3LiquidityManager.sol:177-178), and the whole
launch reverts. State rolls back cleanly — `totalNativeLiquidity` and
`nextLaunchId` are unwound — so nothing is lost, but the launch cannot proceed
while the poisoned price stands.

The utilization minimums do their real job here: the attacker cannot make the
launch *succeed* at a bad price and extract value; they can only make it fail.

**Recovery is not assumed:** an attacker can initialize the pool and may be able
to add one-sided liquidity. A price-moving swap is therefore not guaranteed to
be negligible, exact, or safe. On `PoolPriceMismatch`, stop launches, inspect
`slot0`, active liquidity, initialized ticks, and balances through two RPCs, and
do not submit a recovery swap unless it has been independently rehearsed with a
strict maximum loss. If those conditions cannot be proven, abandon the affected
factory and deploy a reviewed replacement.

**Recommended remediation (contract, requires re-freeze):** after
`createAndInitializePoolIfNecessary`, read `slot0` and revert with a dedicated
`PoolPriceMismatch` error when the pool price differs from `params.sqrtPriceX96`.
This does not remove the DoS, but it converts a misleading utilization revert
into a precise diagnosis and makes the recovery procedure obvious. Add the
recovery swap to the incident runbook either way. For the public v2 factory this
finding should be treated as mandatory input, because there the attacker has
economic motive (competitor griefing) and victims who cannot self-recover.

### M-2 · Staggered release weakens the default deterrent (accepted design)

**Severity: Medium (economic), explicitly accepted by the owner on 2026-07-28.**
Each honoured check-in releases one third of the escrow and is never clawed back
(GmEscrow.sol:releaseFor/finalizeDefault). A creator who checks in twice and
then abandons keeps 40% of total supply; under the previous cliff design a
default forfeited everything. The compensating controls are that the creator
receives 0% at launch, loses the 70% fee stream on default, and that "at stake"
is displayed per-window by Death Watch. This is the documented trade against the
day-three cliff overhang and is recorded here so the independent reviewer prices
it rather than discovers it.

### L-1 · Canary observer false-fails for supplies not divisible by 5 wei-units

`tools/canary/observe.mjs` checks
`record.escrowTokenAmount === supply * gmEscrowBps / 10000` (floor), but the
contract computes escrow as `supply − floor(supply × 40%)`
(DoomLaunchFactory.sol:335). The two differ by 1 wei whenever `supply % 5 != 0`,
because the contract's subtraction assigns the rounding dust to the escrow. The
contract itself is exact — allocations always sum to supply — but the observer
would report a healthy launch as failed. Harmless for round canary supplies;
wrong in general. Fix: compare escrow to `supply − creator − liquidity`.

### L-2 · Docs promise "whole tokens"; the contract accepts fractional supplies

Roadmap, spec, and the launch page describe supply as 1 million to 1 quadrillion
**whole tokens**, but `_validateLaunchParams` (DoomLaunchFactory.sol:511) only
bounds `totalSupply` between `1e6 ether` and `1e15 ether` and accepts any wei
value in between. No safety impact; it widens L-1 and makes indexer-side
percentage math wei-inexact. Either enforce `totalSupply % 1 ether == 0` in the
v2 factory or correct the documentation to "between 1e24 and 1e33 wei-units".

### L-3 · The manifest's contract digest is not cross-checked

`config/stage4-deployment-manifest.json` now records
`source.contractDigest`, and `config/review-artifact.json` holds the frozen
digest CI enforces against `src/`. Nothing verifies the two files agree with
each other, so the manifest could silently reference a stale digest while CI
stays green. One assertion in the manifest test suite closes it.

### L-4 · Permissionless deposit events are spoofable attribution for indexers

All four `DoomRewards.deposit*` functions are callable by anyone
(DoomRewards.sol:114-139): a 1-wei donation emits `FeeRewardsDeposited` or
`LpFeeRewardsDeposited` carrying any `launchId`/`positionId` the caller likes.
Funds are safe — deposits only add inventory — but an indexer attributing
rewards by event alone can be fed noise. The integration doc already requires
matching `CommitmentDefaulted` to a same-transaction deposit **from the exact
escrow**; the same source-address filter should be stated for fee and LP-fee
deposits (expected sources: the factory and the locker).

### Informational

- **I-1** `LaunchAllocations` emits `gmEscrowBps = 6000` while the actual escrow
  amount can exceed 60% by sub-wei dust (see L-1). Consumers should treat the
  amounts, not the bps, as authoritative.
- **I-2** The EOA checks on `approvedCreator` (code-length at construction and
  at launch) are bypassable by a contract calling from its own constructor if
  the approved address were counterfactual. Moot while the approved creator is
  the owner's known EOA; do not rely on this pattern for the public v2 factory.
- **I-3** ETH force-sent to the factory (selfdestruct) is unrecoverable, since
  `withdrawAccruedTreasuryFees` is bounded by internal accounting. Dust-level;
  fail-safe direction.
- **I-4** Tokens donated directly to a `GmEscrow` or the locker are stranded by
  design; already documented in the threat model.
- **I-5** Creator fee eligibility lasts up to and including the current
  deadline, so a collection seconds before a missed deadline still pays the
  creator 70% of accrued WETH fees. This follows the documented rule that only
  a *missed* deadline redirects; noted so the reviewer confirms the boundary is
  intended (`block.timestamp <= deadline`, PositionLocker.sol:335).

## What was checked and found sound

- **Conservation.** Factory ETH: `msg.value − nativeUsed` ends exactly as
  `treasuryFee + nftRewardFee + refund`; the manager enforces zero residual
  token/WETH/ETH balances on itself; the locker reconciles every collection and
  deposit by balance delta; `DoomRewards` reconciles every pull. Escrow tokens
  are only ever held, released, or forfeited (invariant-tested across the whole
  schedule).
- **Staggered release arithmetic.** Equal shares with the final ordinal taking
  the remainder; cannot strand dust; default forfeits exactly
  `committed − released`; funding check tracks the remainder.
- **Reentrancy posture.** Every external entry point that moves value is
  `nonReentrant`; state is written before external calls in `claim`,
  `recordGm`, `finalizeDefault`, and `launch`; refunds are the final statements.
- **Access control.** Both one-time bindings are binder-gated, single-shot, and
  verified in both directions (locker↔manager, manager↔factory) plus re-verified
  in the factory constructor across five dependency getters. Guardian can pause
  but never resume. Treasury withdrawals are treasury-only and
  accounting-bounded.
- **Permanent custody.** The locker has no release, decrease, approval, or
  arbitrary-call path; `collectFees` can only route, never unwind; registration
  is registrar-gated, once per position, and validated against the NPM's own
  position data; the factory independently re-validates the lock in the same
  transaction.
- **Merkle claims.** Domain-separated (`chainid`, vault address, campaign,
  account, amount), double-hashed leaves; claim and recycle windows are
  disjoint; excluded holder is hard-blocked; reserved/available accounting
  cannot double-spend.
- **Launch atomicity.** The pool cannot be front-run *into a successful* launch
  at a bad price (M-1 is DoS-only); position terms, pool code, configuration
  hash, and registration timestamp are all checked before the launch record is
  written.

## Recommended actions, in order

1. Add the `slot0` price assertion (M-1) and the recovery-swap procedure to the
   incident runbook. The contract change requires re-freezing
   `config/review-artifact.json` in the same commit.
2. Fix the observer's escrow comparison (L-1) and add the digest cross-check
   (L-3) — tooling only.
3. State the source-address filter for all deposit events in the indexer
   integration doc (L-4).
4. Resolve the whole-token question one way or the other (L-2) — for v2 at the
   latest.
5. Hand M-1, M-2, and I-5 to the independent reviewer as focus questions in
   `docs/independent-review-package.md`.

Implementation note: actions 1-5 are now implemented and the artifact is
re-frozen. CI confirmation and independent focused review remain open. The
incident runbook intentionally does not promise a recovery swap; it requires
evidence that any recovery is bounded for the observed hostile pool state.

The remediation gate passed 78 contract tests with 2 live-RPC fork tests skipped,
plus 65 deployment, 17 Death Watch, 12 canary, 7 review-artifact, 8 event-contract,
8 rewards, 13 keeper, and 22 production-indexer tests.
