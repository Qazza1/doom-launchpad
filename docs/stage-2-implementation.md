# Stage 2: economics and safety controls

> Historical record for the preserved `stage-3-baseline`. The 10% creation fee
> and releasable LP design are not part of the Stage 3.1 audit candidate.

Status: implemented and locally tested. Not approved for deployment.

## Implemented

- Factory-enforced supply allocation: 10% creator, 40% liquidity, and 50% GM escrow.
- Factory-enforced GM terms: three check-ins, 24-hour cadence, and 12-hour grace period.
- The full failed GM escrow is deposited into the isolated DoomRewards vault.
- Factory-enforced 365-day LP lock with the creator as the immutable release beneficiary.
- Creation fee equal to 10% of creator-provided native liquidity.
- Fee split: half remains withdrawable only by the immutable treasury; half is wrapped and deposited into DoomRewards.
- DoomRewards checks that the configured wrapped-native token matches the factory configuration.
- Expired, unclaimed campaigns recycle inventory back to available DoomRewards balance.
- The configured treasury NFT holder cannot claim, even if mistakenly included in a Merkle root.
- Zero NFT supply does not block launches or move rewards: WETH remains available in DoomRewards until a valid campaign exists.
- The factory starts paused. The emergency guardian and operator may pause new launches; only the operator may resume.
- Pausing cannot modify or stop existing GM escrows, reward claims, or LP releases.
- Canary gates are immutable: one approved creator, maximum launch count, per-launch liquidity ceiling, and global liquidity ceiling.
- Pool fee is fixed at 0.30% with tick spacing 60.

## Validation

- 57 tests pass and none fail.
- Each of the two fuzz tests completes 512 runs.
- Each of the two stateful invariants completes 128 runs and 8,192 calls.
- DoomLaunchFactory runtime bytecode is 17,320 bytes, leaving 7,256 bytes below the EVM runtime size limit.
- Formatting and compilation pass with Foundry 1.7.1, Solidity 0.8.36, Cancun EVM output, optimizer enabled, and the IR pipeline.

## Deliberate trust boundary

The campaign manager commits NFT ownership snapshots and per-holder allocations through a Merkle root. The vault enforces inventory accounting, claim deadlines, proof validity, one claim per account, and treasury exclusion, but it cannot independently reconstruct historical NFT ownership. Snapshot files and their generated roots must be published and independently verified before each campaign.

## Remaining blockers

- No production `V3LiquidityManager` exists yet.
- No Robinhood mainnet-fork test has exercised the official WETH and Uniswap V3 deployments.
- The mainnet deployment script and signed deployment manifest do not exist yet.
- The event ABI, indexer, API, and frontend have not been updated to the Stage 2 contract interface.
- No independent smart-contract review or audit has been completed.

Do not deploy Stage 2 directly. Stage 3 begins with the V3 adapter and read-only mainnet-fork compatibility tests.
