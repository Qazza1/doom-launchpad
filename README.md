# Doom Launchpad

Audit-candidate smart-contract module for DoomStreak's capped Robinhood Chain
memecoin-launch canary. Nothing in this repository broadcasts a transaction or
authorizes a deployment.

## Canary design

- Ownerless, fixed-supply ERC-20 with no transfer tax or post-launch controls.
- Supply split: 10% creator, 40% permanent Uniswap V3 liquidity, 50% GM escrow.
- Three daily GM check-ins with a 12-hour grace period.
- A missed commitment sends the escrowed allocation to `DoomRewards`.
- Exactly 0.01 ETH liquidity, at most three launches, from one approved EOA.
- 3% creation fee, split equally between treasury and NFT-holder rewards.
- 1% full-range V3 position held permanently by an ownerless locker.
- Permissionless fee collection:
  - eligible creator: WETH 60% creator / 20% treasury / 20% rewards;
  - defaulted or overdue creator: WETH 0% / 20% / 80%;
  - launch-token fees: 100% rewards.
- Factory starts paused. The guardian can pause but only the operator can resume.

The authoritative product rules and delivery gates are in
[`docs/doom-launchpad-spec.md`](docs/doom-launchpad-spec.md) and
[`docs/roadmap.md`](docs/roadmap.md).

## Version-control boundary

The pre-redesign Stage 3 implementation is preserved at commit `3f777fc` and
annotated tag `stage-3-baseline`. Current work belongs to the
`stage3.1-audit-candidate` branch until all assurance gates pass.

## Local verification

Foundry 1.7.1 and Solidity 0.8.36 are pinned. Dependencies are:

```bash
forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.6.1
forge install --no-git foundry-rs/forge-std@v1.16.1
forge install --no-git Uniswap/v3-core@v1.0.0
forge install --no-git Uniswap/v3-periphery@v1.0.0
forge fmt --check
forge build --sizes
forge test -vv
```

On Windows, `tools/verify-local.ps1` runs the fail-closed manifest check and
the local suite. Add `-RunRobinhoodForkTests` for the two opt-in read-only fork
tests.

## Deployment boundary

`script/DeployRobinhoodCanaryRehearsal.s.sol` deliberately contains no
`vm.startBroadcast`. The manifest keeps deployment, broadcasting, and mainnet
approval disabled. An independent review, successful fork rehearsal, production
RPC inputs, signer preparation, exact gas funding, verified source/bytecode, and
the owner's explicit final approval are required before any broadcast script is
introduced.

The website, API, and existing indexer are not modified by this module.
Integration artifacts under `integration/` are additive plans for the later UI
and indexer stage.
