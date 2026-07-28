# Doom Launchpad

Audit-candidate smart-contract module for DoomStreak's capped Robinhood Chain
memecoin-launch canary. Nothing in this repository broadcasts a transaction or
authorizes a deployment.

## Canary design

- Ownerless, fixed-supply ERC-20 with no transfer tax or post-launch controls.
- Supply split: 0% creator at launch, 40% permanent Uniswap V3 liquidity, 60% GM escrow.
- Three daily GM check-ins with a 12-hour grace period.
- Each successful check-in releases one share; a miss sends only the unreleased remainder to `DoomRewards`.
- Exactly 0.01 ETH liquidity, at most three launches, from one approved EOA.
- 1% creation fee, split equally between treasury and NFT-holder rewards.
- 1% full-range V3 position held permanently by an ownerless locker.
- Permissionless fee collection:
  - eligible creator: WETH 70% creator / 15% treasury / 15% rewards;
  - defaulted or overdue creator: WETH 0% / 15% / 85%;
  - launch-token fees: 100% rewards.
- Factory starts paused. The guardian can pause but only the operator can resume.

The authoritative product rules and delivery gates are in
[`docs/doom-launchpad-spec.md`](docs/doom-launchpad-spec.md) and
[`docs/roadmap.md`](docs/roadmap.md).

## Version-control boundary

The pre-redesign Stage 3 implementation is preserved at commit `3f777fc` and
annotated tag `stage-3-baseline`. The old `stage-3.1-audit-candidate` tag is
historical and has been superseded. The current contract candidate is frozen by
the digest and commit in `config/review-artifact.json`; it does not yet have an
audit-complete tag.

## Local verification

Foundry 1.7.1 and Solidity 0.8.36 are pinned. Dependencies are:

```bash
forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.6.1
forge install --no-git foundry-rs/forge-std@v1.16.1
forge install --no-git uniswap-v3-core=Uniswap/v3-core@v1.0.0
forge install --no-git uniswap-v3-periphery=Uniswap/v3-periphery@v1.0.0
forge fmt --check
forge build --sizes
forge test -vv
```

On Windows, `tools/verify-local.ps1` runs the fail-closed manifest check and
the local suite. Add `-RunRobinhoodForkTests` for the two opt-in read-only fork
tests.

## Rewards operations

Stage 3.2 adds a deterministic ERC-721 snapshot collector, per-NFT allocation
generator, OpenZeppelin-compatible proof builder, and independent verifier under
`tools/rewards`. It never signs or broadcasts:

```bash
npm ci --prefix tools/rewards
npm test --prefix tools/rewards
```

See [`docs/rewards-operations.md`](docs/rewards-operations.md) and the
[`docs/campaign-manager-runbook.md`](docs/campaign-manager-runbook.md). While
the NFT supply is zero, the tools deliberately produce no campaign root.

## Keeper monitoring

Stage 3.3 adds a read-only Robinhood monitor with duplicate-safe Telegram
alerts. It holds no private key and has no transaction-broadcast path:

```bash
npm ci --prefix tools/keeper
npm test --prefix tools/keeper
```

First-time users should follow
[`docs/telegram-keeper-setup.md`](docs/telegram-keeper-setup.md). Runtime rules,
failure behavior, and deployment boundaries are documented in
[`docs/keeper-operations.md`](docs/keeper-operations.md).

## Deployment boundary

`script/DeployRobinhoodCanaryRehearsal.s.sol` deliberately contains no
`vm.startBroadcast`. `script/PreviewRobinhoodDeployment.s.sol` can execute the
six reviewed transactions only on a sentinel-protected localhost Anvil fork
through `tools/deployment/localhost-preview.ps1`; it loads no signer and has no
mainnet write path. The manifest keeps deployment, mainnet broadcasting, and
approval disabled. An independent review, successful fork rehearsal, production
RPC inputs, signer preparation, exact gas funding, verified source/bytecode, and
the owner's explicit final approval remain mandatory.

Stage 3.4 integrates the event schema into a separate read-only indexer branch
and the static DoomStreak website. No launch transaction is enabled. See
[`docs/indexer-public-ui.md`](docs/indexer-public-ui.md) for the reorg model,
public API, direct-contract reads, and fail-closed deployment order.

Stage 4 preparation adds a machine-checked fail-closed deployment manifest,
dependency-safe constructor and nonce worksheet, and a one-transaction-at-a-time
runbook. It does not add an authorized broadcast path. Start with
[`docs/stage-4-preparation-validation.md`](docs/stage-4-preparation-validation.md)
and [`docs/stage-4-deployment-runbook.md`](docs/stage-4-deployment-runbook.md).
The local sequence and gas preview is documented in
[`docs/stage-4-localhost-preview.md`](docs/stage-4-localhost-preview.md).
