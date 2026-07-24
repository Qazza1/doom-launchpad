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

Status: complete. Local, fork, and GitHub Linux validation are green.

- [x] Deterministic NFT snapshot and Merkle-root generator.
- [x] Round-trip proof tests against the exact onchain domain-separated leaf.
- [x] Public campaign manifest containing chain ID, block number, NFT address,
  excluded holder, reward asset, vault, campaign ID, root, and allocations.
- [x] Reproducible independent root-verification command.
- [x] Zero-NFT-supply and treasury-exclusion operational tests.
- [x] Green GitHub CI and Stage 3.2 tagged handoff.

## Stage 3.3 — keeper and monitoring

Status: implementation and Telegram delivery validation complete. Deployed
address configuration remains a Stage 4 operation.

- [x] Creator reminders before each GM window and deadline.
- [x] Permissionless default-finalization review after missed deadlines.
- [x] Permissionless LP-fee collection monitoring.
- [x] Factory pause, dependency wiring, pool, locker, and reward-vault alerts.
- [x] Primary/fallback RPC handling and duplicate/cooldown-safe Telegram alerts.
- [x] No keeper action is required for asset safety; delayed execution affects
  freshness only.
- [x] Owner confirms receipt of the local Telegram setup alert.
- [ ] Fill and verify deployed addresses after Stage 4 deployment.

## Stage 3.4 — indexer, API, and public UI

Status: implementation complete locally; backend branch, website deployment,
and CI handoff remain open. No launch transaction is enabled.

- [x] Reorg-aware event ingestion, rewind, and derived-state rebuild.
- [x] Idempotent raw event storage by chain, transaction hash, and log index.
- [x] Confirmation depth and indexed-block freshness/confidence reporting.
- [x] Launchpad health, list, launch, token, and creator API routes.
- [x] Public per-launch page showing permanent LP state, creator commitment,
  next deadline, fee-routing totals, risk context, and confidence.
- [x] Token detail integration and honest pre-deployment/empty/error states.
- [x] Direct-contract interaction documentation so the website is not the only door.
- [x] Launch writing remains disabled until separate Stage 4/5 approval.
- [ ] Push the indexer branch and obtain green CI.
- [ ] Deploy the read-only indexer with no factory configuration.
- [ ] Deploy the public website after production API validation.
- [ ] Fill verified addresses and deployment block only after Stage 4.

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
