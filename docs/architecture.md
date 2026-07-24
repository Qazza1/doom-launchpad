# Contract Interfaces and Architecture

## Dependency graph

```text
DoomLaunchFactory
  ├─ deploys DoomToken
  ├─ deploys GmEscrow (one per launch)
  ├─ transfers fixed allocations
  ├─ calls ILiquidityManager (concrete V3 implementation blocked)
  └─ records launch + accrues fee

GmEscrow
  └─ on default calls DoomRewards.depositFailedAllocation

Concrete V3LiquidityManager (not implemented)
  ├─ validates WETH, V3 Factory, NPM, Router, Quoter, fee tiers
  ├─ initializes/derives pool
  ├─ mints position NFT
  └─ transfers NFT directly to PositionLocker and registers lock

PositionLocker
  └─ after unlock, permissionlessly transfers NFT to fixed beneficiary

DoomRewards
  ├─ receives failed allocations
  ├─ campaign manager creates Merkle campaigns
  ├─ relayers submit claims
  └─ after deadline, anyone sweeps remainder to fixed community recipient
```

## Contracts

### DoomToken

- Constructor-only mint to the factory.
- `INITIAL_SUPPLY` immutable.
- Standard OpenZeppelin ERC-20 behavior.
- No owner or privileged function.

### DoomLaunchFactory

- Immutable treasury, rewards vault, liquidity manager, locker, launch fee, and lock-duration bounds.
- Immutable-at-deployment fee-tier/tick-spacing map.
- Validates metadata lengths, supply, allocations, native amount, commitment configuration, lock time, fee tier, ticks, and price.
- Uses exact token approval and checks that no launch token remains in the factory.
- Requires manager network configuration to report valid, returned pool code to exist, and direct locker terms/ownership to match the launch request.
- Accrues fees; only immutable treasury can withdraw.

### GmEscrow

- One instance per launch for isolation and simpler reconciliation.
- Immutable token, creator, rewards vault, amount, start, cadence, grace, and check-in count.
- Creator-only GM recording.
- Permissionless default finalization.
- No admin or rescue path.

### PositionLocker

- Immutable position-manager ERC-721 address.
- Permissionless registration only after the locker already owns the NFT.
- Per-position immutable-in-practice beneficiary and unlock time; record has no setter.
- Permissionless release after unlock.
- No owner, rescue, fee collection, or early release.

### DoomRewards

- Immutable campaign-manager and unclaimed-recipient addresses.
- Pull-based failed-allocation deposits.
- Per-token available and reserved accounting.
- Multiple numbered campaigns.
- Merkle claims with one claim per account per campaign.
- Permissionless post-deadline sweep to fixed recipient.

### ILiquidityManager

This interface is the deliberate V3 boundary. It requires:

- `createAndLockLiquidity(params)` returning pool and position ID.
- `positionLocker()` for constructor consistency checks.
- `isNetworkConfigurationValid()` to fail closed.
- `configurationHash()` for audit/indexer attribution.
- Factory post-condition validation reads `PositionLocker.lockState(positionId)` directly rather than trusting a manager-supplied Boolean.

The mock implementation used in tests is not a V3 implementation and must never be deployed as a real launch dependency.

## Launch function ABI

```solidity
function launch(LaunchParams calldata params)
    external
    payable
    returns (
        uint256 launchId,
        address token,
        address pool,
        uint256 positionId,
        address creatorEscrow
    );
```

`LaunchParams`:

```solidity
struct LaunchParams {
    string name;
    string symbol;
    uint256 totalSupply;
    uint16 creatorLiquidBps;
    uint16 liquidityBps;
    uint16 gmEscrowBps;
    uint256 nativeLiquidityAmount;
    uint32 requiredCheckIns;
    uint32 cadenceSeconds;
    uint32 gracePeriodSeconds;
    uint64 lpUnlockTime;
    address lpBeneficiary;
    uint24 poolFee;
    int24 tickLower;
    int24 tickUpper;
    uint160 sqrtPriceX96;
}
```

## V3 implementation stop point

No `V3LiquidityManager.sol` is included. Only an interface and test mock exist. Implementation is blocked until the verified Robinhood Chain dependency package listed in `v3-address-request.md` is supplied.
