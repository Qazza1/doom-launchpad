# Stage 3.1 validation

Validated locally on 2026-07-24. No contracts were deployed and no real funds
were used.

## Implemented outcome

- Permanent-only ownerless position custody.
- One-time manager/locker/factory bindings and dependency cross-checks.
- Permissionless LP-fee collection with 60 / 20 / 20 eligible WETH routing,
  0 / 20 / 80 overdue/default routing, and 100% launch-token rewards.
- 3% creation fee, 1% V3 pool tier, exact full-range ticks, exact tick-ratio
  bounds, and explicit supply envelope.
- Domain-separated reward leaves and resolved GM schedule helpers.
- Adversarial GM invariant handler, current event schema, operations runbooks,
  CI, size budgets, and read-only deployment verifier.

## Evidence

- Foundry 1.7.1 / Solidity 0.8.36 / Cancun / IR pipeline.
- 68 local tests passed; 0 failed; two fork-only tests skipped in the local gate.
- Both read-only Robinhood mainnet-fork tests passed separately.
- Each fuzz test ran 512 cases.
- Each stateful invariant ran 128 sequences of 64 calls.
- Slither 0.11.5 high-severity gate passed after documented triage.
- Non-broadcast deployment rehearsal passed against Robinhood Chain mainnet.
- Real canonical NPM accepted zero-fee `collect` from the permanent locker and
  retained locker ownership afterward.

Runtime sizes:

| Contract | Bytes | Internal budget | EVM margin |
|---|---:|---:|---:|
| DoomLaunchFactory | 20,574 | 23,500 | 4,002 |
| V3LiquidityManager | 6,520 | 12,000 | 18,056 |
| PositionLocker | 7,268 | 12,000 | 17,308 |

## Open assurance gates

- Aderyn 0.6.8 cannot install on Windows by package design; its pinned Linux CI
  job must pass.
- CI cannot run until this repository is pushed to a GitHub remote.
- The checksum bundle and audit-candidate tag are intentionally deferred until
  CI is green.
- Independent audit/review, signing rehearsal, production RPC inputs, source
  verification, gas funding, and explicit deployment approval remain required.
