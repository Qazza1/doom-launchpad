# Testnet Deployment and Configuration Plan

**No deployment was performed. Do not use real funds.** All values remain blocked placeholders until independently verified.

## Staged sequence

1. Verify the testnet chain ID, wrapped native token, V3 Factory, NonfungiblePositionManager, SwapRouter, Quoter, deployment provenance, fee tiers, and tick spacing.
2. Run `DeployLockerTestnetTemplate.s.sol` only on the verified testnet to deploy `PositionLocker` against the verified position manager.
3. Implement, review, compile, test, and deploy the concrete non-upgradeable `V3LiquidityManager` configured to that exact locker. This stage is currently blocked and no adapter is included.
4. Confirm on-chain that `liquidityManager.positionLocker()` equals the Stage 1 locker and that the locker reports the verified position manager.
5. Fill all role and product values in a separately reviewed deployment manifest.
6. Run `DeployTestnetTemplate.s.sol` to deploy `DoomRewards` and `DoomLaunchFactory` using the already-deployed locker and reviewed manager.
7. Verify source, constructor arguments, immutable values, code hashes, and `configurationHash` on the explorer.
8. Execute a zero-real-value rehearsal with test assets only, then run indexer/UI read-only validation before enabling any write UI.

## Required environment variables

```text
TESTNET_ONLY_ACK=true
TESTNET_CHAIN_ID=<verified>
TESTNET_NONFUNGIBLE_POSITION_MANAGER=<verified>
TESTNET_POSITION_LOCKER=<stage-1-address>
TESTNET_REVIEWED_V3_LIQUIDITY_MANAGER=<stage-2-address>
TESTNET_TREASURY_MULTISIG=<approved-testnet-multisig>
TESTNET_CAMPAIGN_MANAGER_MULTISIG=<approved-testnet-multisig>
TESTNET_UNCLAIMED_COMMUNITY_RECIPIENT=<approved-address>
TESTNET_MINIMUM_CLAIM_WINDOW_SECONDS=<approved>
TESTNET_LAUNCH_FEE_WEI=<approved-testnet-only>
TESTNET_MINIMUM_LP_LOCK_SECONDS=<approved>
TESTNET_MAXIMUM_LP_LOCK_SECONDS=<approved>
TESTNET_SUPPORTED_FEE_TIER=<verified>
TESTNET_TICK_SPACING=<verified>
```

The example supports one fee tier only to keep the template fail-closed. A reviewed deployment script may accept parallel arrays after the exact supported set is approved.
