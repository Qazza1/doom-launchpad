# Audit checklist and deployment blockers

Unchecked items block deployment unless explicitly identified as post-canary work
in `roadmap.md`.

## Reproducibility

- [x] Stage 3 baseline committed and annotated as `stage-3-baseline`.
- [x] Specification, roadmap, architecture, threat model, and event schemas match
  Stage 3.1 behavior.
- [ ] Audit-candidate commit and annotated tag created after final checks.
- [ ] Clean checkout reproduces dependencies, build, tests, sizes, and hashes.
- [ ] CI passes format, build, tests, size limits, Slither, and Aderyn.
- [ ] No unexplained high/medium static-analysis result.
- [ ] Exact compiler, EVM, optimizer, dependency tags, and source hashes published.

## Contracts

- [ ] Independent line-by-line review of all contracts, interfaces, mocks, and
  deployment scripts.
- [ ] No proxy, owner backdoor, arbitrary call, rescue, hidden mint, transfer tax,
  or mutable launch economics.
- [ ] Supply bounds, allocation rounding, fee/refund accounting, and canary caps
  fuzzed at boundaries.
- [ ] GM due/deadline boundaries and adversarial action ordering reviewed.
- [ ] Position registrar binding cannot be front-run or changed.
- [ ] Registered NPM position ownership, tokens, 1% fee, and ticks match exactly.
- [ ] Locker has no release/decrease/approve path and fee collection cannot change
  liquidity.
- [ ] Eligible/ineligible WETH and launch-token fee routes reconcile exactly.
- [ ] Overdue but unfinalized escrow cannot receive the creator fee share.
- [ ] Reward leaf domain, tree sorting, proofs, exclusions, reservations, and
  recycling verified end-to-end.
- [ ] Reentrancy, rejecting recipients, malicious managers, malformed pools, and
  nonstandard transfer behavior reviewed.
- [ ] Runtime/initcode sizes remain below chain limits with agreed margin.

## Robinhood/V3

- [x] Mainnet chain ID, WETH, V3 Factory, NPM, 1% fee spacing, and Cancun support
  previously verified.
- [ ] Fresh fork test confirms 1% pool creation, exact full-range ticks, price,
  permanent owner, refunds, and fee collection.
- [ ] Live bytecode hashes and official deployment provenance recorded at the
  audit-candidate commit.
- [ ] Non-broadcast deployment rehearsal passes from a clean checkout.
- [ ] Read-only post-deployment verifier independently checks every constructor,
  binding, constant, cap, and code hash.

## Operations

- [ ] Campaign-manager runbook and incident/pause runbook rehearsed.
- [ ] Deterministic Merkle generator and public manifest verifier completed.
- [ ] Hardware-wallet/encrypted-signer procedure and role-address checks completed.
- [ ] Production and fallback RPCs selected without storing secrets in Git.
- [ ] Keeper alerts cover GM windows, default eligibility, LP-fee collection, and
  dependency/owner anomalies.
- [ ] Indexer confirmation, raw-log storage, reorg rollback, freshness, and
  confidence tested.
- [ ] Direct-contract interaction guide works without the DoomStreak site.
- [ ] UI transaction simulation, chain/address guards, CSP, XSS, and dependency
  integrity reviewed.
- [ ] Legal/product copy avoids promises of buyer protection or investment return.

## Final canary gate

1. One external audit/review is completed against the exact tagged commit.
2. Every critical/high is fixed and reviewed; accepted lower findings are public.
3. Source verification and gas funding are rehearsed.
4. Deployment manifest is signed and still has `broadcast=false`.
5. Contracts are deployed paused and independently verified.
6. The owner gives a separate explicit approval to resume the factory.
7. At most three 0.01 ETH launches occur, with a review between launches.
