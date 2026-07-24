# Doom Launchpad roadmap

This roadmap is the authoritative delivery sequence. No stage authorizes a mainnet
broadcast unless it explicitly says so.

## Preserved baseline

- Git commit: `3f777fc`
- Git tag: `stage-3-baseline`
- Historical hashes: `SHA256SUMS.stage-3-baseline`
- Status: 62 local tests and two Robinhood mainnet-fork tests passed.
- Purpose: immutable comparison point before the economics and security rebuild.

## Stage 3.1 — audit-candidate rebuild

Status: contract rebuild and local/fork verification complete. Linux CI,
Aderyn, and Slither are green. External review and deployment preparation
remain open. No deployment.

### Contract security

- Replace the releasable time locker with a permanent-only position locker.
- Restrict position registration to the irreversibly bound V3 liquidity manager.
- Keep the position NFT permanently in the ownerless locker.
- Add permissionless LP-fee collection without any liquidity-decrease path.
- Treat a missed-but-not-yet-finalized GM deadline as creator-default-eligible
  when routing fees.
- Domain-separate reward leaves by chain, vault, campaign, account, and amount.
- Add explicit supply bounds and overflow-safe minimum-amount calculations.
- Validate initial price against the exact configured full-range tick ratios.
- Store the exact price passed to Uniswap instead of recomputing it.
- Return zero resolved schedule values and expose schedule/remaining-check-in helpers.

### Frozen canary economics

- Fixed supply allocation: 10% creator, 40% permanent liquidity, 50% GM escrow.
- Three daily GM check-ins with a 12-hour grace period.
- Failed GM allocation: 100% of the remaining escrow to DoomRewards.
- Pool fee: 1% Uniswap V3 fee tier.
- Creation fee: 3% of native liquidity, split 50% treasury / 50% DoomRewards.
- WETH LP fees while creator remains eligible:
  - 60% creator
  - 20% treasury
  - 20% DoomRewards
- WETH LP fees after default or a missed finalizable deadline:
  - 0% creator
  - 20% treasury
  - 80% DoomRewards
- Launch-token LP fees: 100% DoomRewards.
- Token supply: 1 million to 1 quadrillion whole tokens.
- Canary native liquidity: exactly 0.01 ETH per launch.
- Canary access: the existing single approved creator only.
- Canary caps: three launches and 0.03 ETH aggregate native liquidity.

### Engineering and assurance

- [x] Rewrite the specification and threat model to match deployed intent.
- [x] Expand unit, boundary, adversarial-handler, fuzz, invariant, and fork tests.
- [x] Add CI for format, build, tests, bytecode sizes, and pinned static analysis.
- [x] Add campaign-manager and incident-response runbooks.
- [x] Update event ABIs, integration examples, and manifest.
- [x] Run a fresh non-broadcast Robinhood mainnet rehearsal.
- [x] Push to GitHub and obtain a green Linux CI/Aderyn run.
- [x] Produce the final checksum bundle, audit-candidate commit, and tag after
  every implementation gate passes.

## Stage 3.2 — rewards operations

Status: planned after the contract interface freezes.

- Deterministic NFT snapshot and Merkle-root generator.
- Round-trip proof tests against the exact onchain domain-separated leaf.
- Public campaign manifest containing chain ID, block number, NFT address,
  excluded holder, reward asset, vault, campaign ID, root, and allocations.
- Reproducible independent root-verification command.
- Zero-NFT-supply and treasury-exclusion operational tests.

## Stage 3.3 — keeper and monitoring

Status: planned.

- Creator reminders before each GM window and deadline.
- Permissionless default finalization after missed deadlines.
- Permissionless LP-fee collection monitoring.
- Factory pause, dependency wiring, pool, locker, and reward-balance alerts.
- No keeper action may be required for asset safety; delayed execution affects
  freshness only.

## Stage 3.4 — indexer, API, and public UI

Status: planned.

- Reorg-aware event ingestion and rollback.
- Confirmation depth and indexed-block freshness reporting.
- Public per-launch page showing permanent LP proof, creator commitment,
  next deadline, default eligibility, fee-routing state, and confidence.
- Direct-contract interaction documentation so the website is not the only door.
- Launch writing remains disabled until Stage 4 approval.

## Stage 4 — independent review and deployment preparation

Status: not started.

- Independent smart-contract audit/review against one tagged commit.
- Remediation and focused re-review of every contract change.
- Production RPC and fallback RPC.
- Hardware-wallet or encrypted-keystore signing rehearsal.
- Exact gas estimate and deployer funding plan.
- Production deployment and post-deployment verification scripts.
- Blockscout source-verification rehearsal.
- Final signed manifest and explicit owner approval immediately before broadcast.

## Stage 5 — capped mainnet canary

Status: blocked by Stage 4.

- Deploy contracts while the factory remains paused.
- Verify source, bytecode, constructor arguments, roles, dependencies, bindings,
  balances, and configuration hashes.
- Separately approve factory resume.
- Execute at most three 0.01 ETH launches from the approved creator.
- Review each launch before permitting the next one.
