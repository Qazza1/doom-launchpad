# Contract interfaces and architecture

## Dependency graph

```text
DoomLaunchFactory
  ├─ deploys ownerless DoomToken
  ├─ deploys one GmEscrow per launch
  ├─ transfers the fixed 0 / 40 / 60 allocations
  ├─ pays native liquidity to V3LiquidityManager
  ├─ deposits half of the 1% creation fee in DoomRewards
  └─ records the launch and accrues the treasury half

V3LiquidityManager
  ├─ is irreversibly bound to one DoomLaunchFactory
  ├─ validates canonical V3 Factory, NPM, WETH, 1% tier, and locker
  ├─ initializes the pool and mints a full-range position
  └─ transfers the position to PositionLocker and registers it atomically

PositionLocker
  ├─ is irreversibly bound to one V3LiquidityManager registrar
  ├─ holds each registered position permanently
  └─ permissionlessly collects and routes fees at immutable percentages

GmEscrow
  ├─ releases one committed share to the creator after each valid GM
  └─ deposits only the unreleased remainder in DoomRewards after a permissionless default

DoomRewards
  ├─ accounts for failed allocations, creation-fee rewards, LP fees, and dust
  ├─ reserves inventory in domain-separated Merkle campaigns
  └─ recycles unclaimed inventory after the deadline
```

## Trust and immutability

The token, escrow outcome, LP custody, LP-fee percentages, supply split, V3
terms, and role addresses have no setter or upgrade path. The factory operator
can pause/resume only future launches. The guardian can only pause. The campaign
manager can commit reward roots and allocations but cannot withdraw inventory.
The treasury can withdraw only already-accrued native creation fees.

`PositionLocker` deliberately exposes no release, decrease-liquidity, approval,
arbitrary-call, or rescue function. Only its bound manager can register a
position. Accidental NFT transfers cannot be registered by an attacker and are
permanently stranded.

## Launch ABI

```solidity
struct LaunchParams {
    string name;
    string symbol;
    uint256 totalSupply;
    uint256 nativeLiquidityAmount;
}
```

All other launch terms are factory constants. The canary accepts supplies from
1 million through 1 quadrillion whole 18-decimal tokens and requires exactly
0.01 ETH of requested native liquidity.

## Binding order

1. Deploy `DoomRewards`.
2. Deploy `PositionLocker` with the intended NPM, WETH, rewards, treasury, and
   one-time binder.
3. Deploy `V3LiquidityManager` with the intended factory binder.
4. Bind the locker registrar to the manager.
5. Deploy `DoomLaunchFactory`; its constructor cross-checks the locker, manager,
   WETH, rewards, treasury, canary caps, and approved EOA.
6. Bind the manager to the factory.
7. Keep the factory paused until post-deployment verification is complete.

The duplicated fee/tick constants in factory, manager, and locker are deliberate
independent post-condition checks. A mismatch fails closed.
