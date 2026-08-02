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

- Fixed supply allocation: 0% creator at launch, 40% permanent liquidity, 60% GM escrow.
- Three daily GM check-ins with a 12-hour grace period.
- Escrow release: an equal share per check-in; the final one takes the remainder.
- Failed GM allocation: 100% of the *unreleased* escrow to DoomRewards. Honoured
  check-ins are never clawed back.
- Pool fee: 1% Uniswap V3 fee tier.
- Creation fee: 1% of native liquidity, split 50% treasury / 50% DoomRewards.
- WETH LP fees while creator remains eligible:
  - 70% creator
  - 15% treasury
  - 15% DoomRewards
- WETH LP fees after default or a missed finalizable deadline:
  - 0% creator
  - 15% treasury
  - 85% DoomRewards
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
- [x] Fill and verify deployed addresses after Stage 4 deployment. The production
  keeper runs read-only on Railway with the verified addresses in
  `config/keeper.mainnet.json`, two RPC providers, no signing key, and zero
  active alerts.

## Stage 3.4 — indexer, API, and public UI

Status: read-only production rollout complete. The existing analytics backend
now exposes the launchpad API, the public website consumes it, and both remain
fail-closed before contract deployment. No launch transaction is enabled.

- [x] Reorg-aware event ingestion, rewind, and derived-state rebuild.
- [x] Idempotent raw event storage by chain, transaction hash, and log index.
- [x] Confirmation depth and indexed-block freshness/confidence reporting.
- [x] Launchpad health, list, launch, token, and creator API routes.
- [x] Public per-launch page showing permanent LP state, creator commitment,
  next deadline, fee-routing totals, risk context, and confidence.
- [x] Token detail integration and honest pre-deployment/empty/error states.
- [x] Direct-contract interaction documentation so the website is not the only door.
- [x] Launch writing remains disabled until separate Stage 4/5 approval.
- [x] Push the indexer branch and add a deterministic Node CI workflow.
- [x] Obtain and record the green indexer CI run.
- [x] Deploy the read-only indexer with no factory configuration.
- [x] Deploy the public website after production API validation.
- [x] Fill the read-only indexer with the verified factory address and deployment
  block, then validate its public API against direct contract reads. Confirmed
  2026-08-01: the public API reports the correct factory, `blocks_behind: 0`,
  `confidence: high`, `factory_paused: true`, and zero launches, matching direct
  contract reads taken the same day.
- [x] Move the indexer and keeper start block from the factory deployment block
  25105648 to the first deployment 25082132, so `PositionLocker.RegistrarBound`
  at block 25102641 stops falling outside the scan range. Done 2026-08-02: the
  indexer reports `deployment_block: 25082132` and `config/keeper.mainnet.json`
  matches. The cursor was not reset, so that one event stays unindexed and
  remains checkable through `authorizedRegistrar()`, as planned.
- [ ] Restore the indexer. As of 2026-08-02 it is stalled at block 25352711 with
  a request timeout, 109 blocks before canary launch 1, and has never indexed the
  launch. Direct reads and Death Watch are correct; the derived layer is empty.
  This blocks launch 2. See `docs/stage-5-launch-1-review.md`.

## Stage 4 — independent review and deployment preparation

Status: completed on 2026-08-01. Contracts were deployed one transaction at a
time, independently verified, and left paused. Evidence:
`docs/stage-4-mainnet-deployment-evidence.md`.

- [x] Independent reviewer package, frozen artifact checksums, and a CI job that
  fails if reviewed contract sources drift:
  `docs/independent-review-package.md`.
- [ ] Independent smart-contract audit/review against one tagged commit.
- [ ] Remediation and focused re-review of every contract change.
- [x] Record the owner's explicit 2026-07-29 risk acceptance to proceed without
  independent third-party review for the capped three-launch canary only.
- [x] Remediate the 2026-07-28 first-party findings: exact V3 pool-price
  assertion, whole-token validation, canary dust accounting, manifest digest
  cross-check, canonical reward-deposit attribution, and deadline-boundary test.
- [x] Re-freeze the remediated contract digest and include the changes in the
  independent review target.
- [x] Obtain green CI for the re-frozen remediation.
- [x] Production RPC and fallback RPC secret-safe preflight.
- [x] Dedicated Rabby address/control proof.
- [x] Exact six-transaction localhost execution preview; Rabby remains
  disconnected. Evidence for commit `f2dee52`:
  `docs/stage-4-localhost-preview-validation.md`.
- [x] Chain-isolated Rabby preview harness, built and tested:
  `docs/stage-4-rabby-transaction-preview.md`.
- [x] Six-transaction Rabby transaction preview against localhost only. Passed
  2026-07-25 on isolated chain 46630; all six gas figures match the impersonated
  localhost preview exactly.
- [x] Funding-refresh tool that re-reads nonce, fees, and balance from both
  providers and writes a proposal without touching the canonical manifest:
  `docs/stage-4-funding-refresh.md`.
- [x] Exact gas estimate and deployer funding plan for the final reviewed commit,
  followed by exact owner-approved funding of the calculated shortfall.
- [x] Fail-closed deployment manifest and constructor/nonce worksheet.
- [x] Correct dependency-safe deployment and irreversible-binding order.
- [x] Production deployment and post-deployment verification scripts. The
  deployment path is an unsigned six-transaction plan submitted through Rabby one
  transaction at a time, never an auto-broadcasting script:
  `docs/stage-4-transaction-plan.md`.
- [x] Blockscout source-verification rehearsal. Evidence:
  `docs/stage-4-blockscout-verification.md`. Verification of deployed source
  itself remains a Gate F step.
- [x] Explicit owner approval bound to the plan hash and commit immediately
  before broadcast. The public completed deployment record is
  `config/robinhood-mainnet-stage4-deployment.json`; the original fail-closed
  template remains unchanged.

## Stage 5 — capped mainnet canary

Status: deployed, verified, operationally integrated, and paused. The production
keeper is healthy, the live index is current while historical backfill proceeds,
and the public launchpad API agrees with the zero-launch on-chain state. Factory
resume and the first canary launch remain separately blocked pending explicit
owner approval.

- [x] Deploy contracts while the factory remains paused.
- [x] Read-only post-deployment verifier for bytecode, constructor values, roles,
  dependencies, bindings, caps, and the paused state, through two providers:
  `tools/deployment/verify-deployment.mjs`.
- [x] Read-only per-launch observer covering allocation, permanent LP custody,
  fee routing, canary caps, GM commitment, and escrow custody:
  `docs/stage-5-canary-observation.md`.
- [x] Verify source and constructor arguments on the explorer after deployment.
- [x] Run the production read-only keeper with two RPC providers and verified
  deployed addresses; confirm Telegram delivery and zero active alerts.
- [x] Bring the production launchpad index to confirmed head and compare the
  public health, launches, and Death Watch endpoints with the paused on-chain
  state. The older analytics history gap remains explicit and is backfilling
  without delaying live ingestion.
- [x] Re-run the complete local safety suite after operational integration:
  frozen review identity, deployment tooling, canary observer, Death Watch,
  contracts, integration events, rewards operations, and keeper tests.
- Separately approve factory resume.
- Execute at most three 0.01 ETH launches from the approved creator.
- Review each launch with the observer before permitting the next one.
- Compare indexer ingestion and the public API against direct contract reads.

## Stage 6 — launcher-first product release

Status: product direction frozen; implementation and live transactions are
blocked until the Stage 5 canary passes and the owner gives separate production
approval.

- Make the memecoin launchpad the default DoomStreak homepage.
- Replace the mixed commitment-collection page with one focused coin-launch
  journey; keep the existing NFT game prominent in the primary navigation.
- Use a short guided flow:
  1. Upload token image.
  2. Enter name, ticker, description, and optional social links.
  3. Review fixed supply allocation, native liquidity, creation fee, permanent
     LP lock, three GM deadlines, and default routing.
  4. Connect/switch the wallet, simulate, review gas, and explicitly confirm.
- Upload and pin metadata through the application. Do not require creators to
  understand or paste an IPFS base URI.
- Do not ask creators for a treasury address, arbitrary streak duration, daily
  fee, token allocation, or other values frozen by launchpad economics.
- Clearly label immutable inputs and show the exact token, WETH, and fee routing
  before signature.
- After launch, open a shareable token page immediately and list the token in
  New/Live launches after the required confirmations.
- Put commitment state, next GM deadline, permanent LP proof, creator history,
  risk context, freshness, and confidence on every launch page.
- Provide honest pending, reverted, indexing, and partial-data states. Never
  imply that a submitted transaction is a completed launch.
- Keep the interface terminal-like and credible; reserve the playful DoomStreak
  voice for status labels, empty states, and celebrations.
- Move the legacy NFT commitment-collection launcher into a separate product
  route or retire it from the memecoin creation path.

## Stage 6.5 — launchpad v2 differentiation mechanics

Status: designed, not committed. Full detail and open questions in
`docs/launchpad-v2-mechanics.md`.

Factory #1 can only ever perform three launches of exactly 0.01 ETH, because the
canary caps are contract constants enforced by the constructor. A second factory
is therefore required for public launching regardless of these mechanics.

- [x] Death Watch engine and Telegram broadcast, reading the chain directly with
  no indexer dependency: `docs/death-watch.md`.
- [x] Death Watch public web feed on the site, backed by confirmed indexer chain
  time and fail-closed before deployment.
- [x] Creator Doom Record v1 derived from the analytics dataset, tracking
  post-streak survival and decaying when recent launches are abandoned. Public
  tiers are read-only; contract-enforced economics remain a factory #2 task.
- [ ] Holder insurance: a share of forfeited escrow paid to holders of the dead
  token at default. Blocked on resolving the self-dealing vector.
- [ ] Bonding-curve launch phase that graduates into the permanently locked V3
  position, so buyers fund liquidity and launching costs only gas.
- [ ] Graduation starts the GM clock rather than ending the story.
- [ ] Holder daily streaks with NFT-holder multipliers.
- [ ] Hard mode: longer self-selected commitments for better fee splits.
- [ ] Decide the v2 minimum pool depth. Below roughly 0.05 ETH a pool is not
  tradeable.

## Stage 7 — analytics v2 and NFT-gated advanced tools

Status: planned after the launcher-first release.

- Reorganize analytics around decisions: New, Trending, Graduating, High Risk,
  Creator Reputation, Watchlist Alerts, and Launchpad Benchmarks.
- Preserve one consistent token-detail page with risk, liquidity, volume,
  holders, creator history, launchpad, permanent LP status, score freshness,
  confidence, and a shareable URL.
- [x] Ship browser-local watchlist snapshots and alert history for creator
  launches, liquidity falls, commitment outcomes, risk changes, and Doom Record
  changes. This read-only version checks on visits or manual refresh; background
  and push delivery remain a later milestone.
- Keep essential launch and risk information public.
- Introduce NFT-holder access only for clearly labelled advanced analytics,
  exports, deeper wallet graphs, or faster alerts after ownership and reward
  operations are proven.
- Measure data freshness, API completeness, creation-flow completion, failed
  simulations, launches, GM survival, and repeat creator usage before expanding
  the feature set.
