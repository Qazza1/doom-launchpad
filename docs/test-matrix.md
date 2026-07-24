# Test matrix

Local status: 68 tests pass, 0 fail, and two opt-in Robinhood fork tests are
skipped unless explicitly enabled.

| Requirement | Coverage |
|---|---|
| Fixed supply, untaxed transfers, no owner controls | `DoomToken.t.sol` |
| Exact 10 / 40 / 50 allocations | factory happy path and 512-run supply fuzz |
| 3% creation fee and 50 / 50 routing | fee quote, accounting, refund, zero-NFT tests |
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
| Eligible WETH fee split 60 / 20 / 20 | locker fee-routing test |
| Overdue/default WETH split 0 / 20 / 80 | default and overdue-unfinalized tests |
| Launch-token fees 100% to rewards | locker token-fee test |
| Permissionless collector receives nothing | keeper collection test |
| Domain-separated Merkle leaves | reward claim and invalid-proof tests |
| Claims, reservations, recycling | `DoomRewards.t.sol` plus 512-run claim fuzz |
| V3 utilization and dust handling | manager/factory utilization tests |
| Returned pool/position spoof resistance | factory post-condition tests |
| Native payout failure and reentrancy | rejecting treasury and malicious-manager tests |
| Adversarial GM sequencing | randomized boundary handler + accounting invariants |
| Fixed supply/accounting invariants | 128 runs × 64 calls |
| Canonical Robinhood dependencies | two opt-in read-only mainnet-fork tests |

Before deployment, CI, pinned Slither/Aderyn, both fork tests, source verification,
contract-size checks, and independent review must also pass against one tagged
commit.
