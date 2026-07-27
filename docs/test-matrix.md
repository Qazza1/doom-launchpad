# Test matrix

Local status: 75 contract tests pass and 0 fail. Both opt-in Robinhood fork tests
are skipped by the normal gate and last passed against live mainnet state on
2026-07-28.

| Requirement | Coverage |
|---|---|
| Fixed supply, untaxed transfers, no owner controls | `DoomToken.t.sol` |
| Exact 0 / 40 / 60 allocations | factory happy path and 512-run supply fuzz |
| Creator receives nothing at launch | happy-path balance assertion |
| Escrow releases one share per check-in | per-check-in release and indivisible-commitment tests |
| Default forfeits only the unreleased remainder | partial-release default test |
| Release schedule sums to the commitment | schedule bound and total tests |
| 1% creation fee and 50 / 50 routing | fee quote, accounting, refund, zero-NFT tests |
| Exact 0.01 ETH and three-launch envelope | canary liquidity and launch-cap tests |
| Supply bounds | lower/upper boundary and fuzz tests |
| EOA-only approved creator | constructor and authorization tests |
| Factory starts paused; guardian cannot resume | pause permission tests |
| GM cadence/deadline boundaries | `GmEscrow.t.sol` |
| Default deposit balance reconciliation | default, non-pulling, and reentrancy tests |
| Resolved schedule helpers | GM schedule tests |
| Permanent position ownership | `PositionLocker.t.sol` and V3 adapter test |
| Registrar cannot be front-run | one-time binding and unauthorized-register tests |
| Canonical 1% fee and full-range ticks | locker and manager negative tests |
| Eligible WETH fee split 70 / 15 / 15 | locker fee-routing test |
| Overdue/default WETH split 0 / 15 / 85 | default and overdue-unfinalized tests |
| Launch-token fees 100% to rewards | locker token-fee test |
| Permissionless collector receives nothing | keeper collection test |
| Domain-separated Merkle leaves | reward claim and invalid-proof tests |
| Claims, reservations, recycling | `DoomRewards.t.sol` plus 512-run claim fuzz |
| V3 utilization and dust handling | manager/factory utilization tests |
| Returned pool/position spoof resistance | factory post-condition tests |
| Native payout failure and reentrancy | rejecting treasury and malicious-manager tests |
| Adversarial GM sequencing | randomized boundary handler + accounting invariants |
| Escrow conservation across the whole schedule | held + released + forfeited invariant, 128 runs × 64 calls |
| Canonical Robinhood dependencies | two opt-in read-only mainnet-fork tests |
| Every emitted event is declared to the indexer | integration event-contract test, both directions |
| Death Watch phases, urgency, and broadcast diffing | `tools/deathwatch/test/feed.test.mjs` |
| Deployed bytecode and state through two providers | `tools/deployment/test/verify-deployment.test.mjs` |
| Canary launch invariants | `tools/canary/test/observe.test.mjs` |

Before deployment, CI, pinned Slither/Aderyn, both fork tests, source verification,
contract-size checks, and independent review must also pass against one tagged
commit.
