# Audit checklist and deployment blockers

Last reviewed: 2026-07-28.

This list is split by **who** can honestly tick each box. Mixing them was making
the document wrong in the safe direction, which is still wrong: a checklist full
of stale unchecked boxes trains you to skim it.

- **Section 1** is first-party work with committed evidence. We can tick these.
- **Section 2** is what the independent reviewer must confirm. We must not tick
  these, no matter how many of our own tests pass.
- **Section 3** is open work, blocked work, and operational rehearsals.

Unchecked items in sections 2 and 3 block deployment unless an item has a
specific, written owner exception. The 2026-07-29 exception applies only to
section 2 for this capped three-launch canary; section 3 remains blocking.

## 1. Verified by us, with evidence

### Reproducibility

- [x] Stage 3 baseline committed and annotated as `stage-3-baseline`.
- [x] Specification, roadmap, architecture, threat model, and event schemas match
  current contract behaviour, including the 0/40/60 split and staggered release.
- [x] Review artifact frozen by digest in `config/review-artifact.json`. The
  annotated tag is created once the code is final, so it names exactly what was
  reviewed. `stage-3.1-audit-candidate` is superseded and kept as history.
- [x] Clean checkout reproduces dependencies, build, tests, and sizes. CI installs
  pinned dependencies from scratch on every push.
- [x] Reviewed contract sources cannot drift unnoticed. The `review-artifact` CI
  job fails whenever `src/` stops matching the frozen digest, so a contract change
  must re-freeze in the same diff: `docs/independent-review-package.md`.
- [x] Every event the contracts emit is declared to the indexer, checked in both
  directions by `tools/deployment/test/integration-events.test.mjs`.
- [x] CI passes format, build, tests, size limits, Slither 0.11.5, and Aderyn
  0.6.8.
- [x] Static-analysis results triaged with written rationale:
  `docs/static-analysis.md`.
- [x] Exact compiler, EVM version, optimizer settings, dependency tags, and
  source hashes published: `docs/independent-review-package.md`.

### Robinhood / V3

- [x] Mainnet chain ID, WETH, V3 Factory, NPM, 1% fee spacing, and Cancun support
  verified.
- [x] Non-broadcast deployment rehearsal passes from a clean checkout.
- [x] Exact six-transaction localhost execution preview:
  `docs/stage-4-localhost-preview-validation.md`.
- [x] Six-transaction wallet transaction preview on an isolated chain, with all
  gas figures matching the impersonated preview:
  `docs/stage-4-rabby-transaction-preview.md`.
- [x] Read-only post-deployment verifier checks every constructor value, binding,
  constant, cap, and runtime bytecode hash through two independent providers:
  `tools/deployment/verify-deployment.mjs`.
- [x] Source verification rehearsed against the live explorer, including the
  exact compiler build: `docs/stage-4-blockscout-verification.md`.

### Operations

- [x] Deterministic Merkle generator and public manifest verifier completed
  (Stage 3.2).
- [x] Dedicated signer procedure and role-address control proof completed. The
  owner chose a dedicated Rabby account over the missing hardware wallet, and
  proved control by signature: `docs/stage-4-rabby-and-rehearsal.md`.
- [x] Production and fallback RPCs selected without storing secrets in Git.
- [x] Keeper alerts cover GM windows, default eligibility, LP-fee collection, and
  dependency/owner anomalies (Stage 3.3).
- [x] Indexer confirmation depth, raw-log storage, reorg rollback, freshness, and
  confidence tested (Stage 3.4).
- [x] Direct-contract interaction guide works without the DoomStreak site
  (Stage 3.4).

## 2. Only the independent reviewer can tick these

Our tests cover every item below, and that is not the same as review. These stay
unchecked until a real external review reports on them. See
`docs/independent-review-package.md`.

Owner exception: independent third-party review was not completed. The owner
accepted that residual risk for the capped three-launch canary only on
2026-07-29. These boxes intentionally remain unchecked:
`docs/stage-4-owner-risk-acceptance.md`.

- [ ] Independent line-by-line review of all contracts, interfaces, mocks, and
  deployment scripts.
- [ ] No proxy, owner backdoor, arbitrary call, rescue, hidden mint, transfer tax,
  or mutable launch economics.
- [ ] Supply bounds, allocation rounding, fee/refund accounting, and canary caps
  correct at boundaries.
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
- [ ] Every accepted finding remediated and re-reviewed.

## 3. Open

### Before deployment

- [x] Fresh run of both opt-in Robinhood fork tests. Passed 2026-07-28 against
  live Robinhood Chain state with the reworked 0/40/60 economics, staggered
  release, 1% creation fee, and the 70/15/15 locker split. Re-run from the final
  commit before deployment.
- [ ] Live dependency bytecode hashes recorded at the reviewed commit. The
  preflight compares them across providers but does not commit them.
- [ ] Campaign-manager runbook and incident/pause runbook rehearsed. Both exist
  as documents and have unit-test coverage; neither has been walked
  operationally.
- [ ] Funding worksheet generated from the final reviewed commit:
  `docs/stage-4-funding-refresh.md`.
- [ ] Final manifest and explicit owner approval immediately before broadcast.

### Blocked until after deployment

- [ ] Keeper configured with verified deployed addresses.
- [ ] Indexer configured with verified addresses and deployment block.
- [ ] Source and constructor arguments verified on the explorer.

### Stage 6 and later

- [ ] UI transaction simulation, chain/address guards, CSP, XSS, and dependency
  integrity reviewed.
- [ ] Legal/product copy avoids promises of buyer protection or investment
  return.

## Final canary gate

1. One external review is completed against the exact tagged commit, or the
   recorded capped-canary owner exception applies to the unchanged digest.
2. Every critical and high finding is fixed and re-reviewed; accepted lower
   findings are public.
3. Source verification and gas funding are rehearsed.
4. The deployment manifest is complete and still has `broadcast=false`.
5. Contracts are deployed paused and independently verified.
6. The owner gives a separate explicit approval to resume the factory.
7. At most three 0.01 ETH launches occur, with a review between launches.
