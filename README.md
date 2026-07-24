# Doom Launchpad

Security-minded, test-first launchpad module for DoomStreak. This package is not deployed and is not yet production-ready.

## Included

- Written specification with all unresolved product/network parameters.
- Threat model and trust-boundary diagram.
- Ownerless fixed-supply `DoomToken`.
- Per-launch `GmEscrow`.
- Isolated Merkle-based `DoomRewards`.
- Ownerless `PositionLocker`.
- `DoomLaunchFactory` with a fixed-price-input, canonical Uniswap V3 adapter.
- Unit, fuzz, invariant, permission, reentrancy, fee/refund, and failure-path tests.
- Robinhood mainnet-fork compatibility tests and a deliberately non-broadcast deployment rehearsal.
- Additive indexer event schemas and static-site integration plan.
- Audit checklist and explicit mainnet blockers.

## Deployment boundary

No production broadcast script is included in Stage 3. The rehearsal script never calls
`vm.startBroadcast`, and the canary manifest keeps deployment and broadcasting disabled.
Independent contract review, a final signed manifest, deployer-wallet preparation, gas
estimation, source-verification rehearsal, and explicit deployment approval remain Stage 4
blockers.

## Local test commands

```bash
forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.6.1
forge install --no-git foundry-rs/forge-std@v1.16.1
forge fmt --check
forge test -vvv
```

To include the two read-only Robinhood mainnet-fork tests in PowerShell:

```powershell
.\tools\verify-local.ps1 -RunRobinhoodForkTests
```

Dependency tags above are build pins for this prototype and must be reviewed deliberately before audit. `foundry.toml` pins Solidity 0.8.36 because the project uses the IR pipeline and earlier versions are covered by a July 2026 compiler security advisory. The EVM target is Cancun because OpenZeppelin Contracts 5.6.1 emits `MCOPY`; a read-only Robinhood Chain mainnet call confirmed opcode support.

## Validation status

Stage 3 validation is complete with Foundry 1.7.1 and Solidity 0.8.36:

- 62 local tests pass and none fail.
- Two optional Robinhood mainnet-fork tests pass against the live deployed WETH and canonical Uniswap V3 contracts.
- Each of the two fuzz tests completes 512 runs.
- Each of the two stateful invariants completes 128 runs and 8,192 calls.
- `DoomLaunchFactory` runtime bytecode is 19,544 bytes, leaving 5,032 bytes below the EVM runtime limit.
- `V3LiquidityManager` runtime bytecode is 6,128 bytes.

The factory now enforces the approved 10% creator / 40% liquidity / 50% GM escrow allocation, three daily GM check-ins with a 12-hour grace period, a 365-day creator LP lock, a 10% creation fee split equally between treasury and NFT rewards, the approved-creator canary, emergency launch pausing, and hard launch/liquidity caps. Expired rewards recycle inside DoomRewards, and the excluded treasury holder cannot claim.

The V3 adapter fixes the 0.30% fee tier and full-range position, derives the initial price from the factory-enforced token/native amounts, requires at least 99.9999% utilization of both assets, locks the LP NFT atomically, routes a bounded token remainder into DoomRewards, refunds a bounded native remainder, and rejects residual adapter balances.

The frozen product decisions and safety state are in `config/robinhood-mainnet-canary.decisions.json`. Broadcasting and mainnet approval remain explicitly disabled. See `docs/stage-3-validation.md` for evidence and reproduction steps, and `docs/stage-4-inputs.md` for the next gate.

## Existing application preservation

No uploaded DoomStreak website, API, indexer, scorer, or package file is modified. Integration artifacts are additive plans/examples under `integration/`.

The old generic testnet templates remain for reference only and are not the current deployment path. The current mainnet-canary work is documented from `docs/stage-1-validation.md` through `docs/stage-3-validation.md`; none of those stages permits a real deployment.
