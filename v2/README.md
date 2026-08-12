# Doom Launchpad V2

This is the isolated bonding-curve engineering candidate. It does not modify
or replace the deployed three-launch canary contracts in `../src`.

## Frozen economics

- Creator pays `0.001 ETH` plus gas, not `0.05 ETH`.
- Buyers fund a two-way constant-product curve until it holds `0.05 ETH` net.
- Supply is split into 30% sold on the curve, 10% permanent full-range V3
  liquidity, and 60% delayed GM escrow.
- Buy/sell fee: 1%, routed 70/15/15 to creator/treasury/DoomRewards. Creator
  curve fees vest over the three post-graduation GM check-ins.
- The terminal curve price exactly matches the V3 initialization ratio.
- The final buy is capped at the exact target and refunds excess native value.
- There is no curve expiry. Every trade includes minimum-output and deadline
  protection.
- The factory starts paused, requires an EOA allowlist, and stops permanently
  after 100 launches.

## Contracts

- `DoomLaunchFactoryV2`: allowlist, launch cap, pause control, metadata record,
  and fixed launch-fee routing.
- `DoomLaunchDeployerV2`: one-time-bound creation-code carrier. Separating this
  contract keeps every runtime below the EIP-170 size limit.
- `DoomBondingCurve`: buy/sell accounting, exact graduation endpoint, fee
  custody, creator vesting, and automatic graduation.
- `GmEscrowV2`: 60% creator allocation; its clock begins only after graduation.
- `V3GraduationManagerV2`: canonical 1% full-range V3 mint with near-total
  utilization and no retained launch balances.
- `PositionLockerV2`: permanent NFT custody and immutable V3 fee routing.
- `DoomTokenV2`: ownerless fixed-supply ERC-20.

The existing DoomRewards vault may be reused because its deposit entry points
are permissionless and balance checked. The V2 locker, manager, deployer, and
factory must be newly deployed because their bindings are immutable.

## Verification

From `doom-launchpad`:

```powershell
..\.tools\foundry-v1.7.1\forge.exe test --root v2 -vv
..\.tools\foundry-v1.7.1\forge.exe build --root v2 --sizes
node --test tools\v2\test\curve-model.test.mjs
```

The Solidity suite contains unit, fuzz, stateful invariant, and canonical-V3
integration coverage. Mainnet fork validation remains a deployment gate.

## Fail-closed deployment order

No broadcast script is included in this candidate.

1. Deploy `DoomLaunchDeployerV2(operator)`.
2. Deploy `PositionLockerV2` with the canonical position manager, wrapped
   native token, existing DoomRewards, treasury, and operator as binder.
3. Deploy `V3GraduationManagerV2` with chain ID `4663`, the operator as binder,
   canonical V3 factory, canonical position manager, wrapped native token, and
   the new locker.
4. Call `PositionLockerV2.bindRegistrar(manager)`.
5. Deploy `DoomLaunchFactoryV2` with the unchanged roles and the new manager and
   deployer. It starts paused.
6. Call `DoomLaunchDeployerV2.bindFactory(factory)`.
7. Call `V3GraduationManagerV2.bindFactory(factory)`.
8. Verify `factory.isLaunchConfigurationValid() == true`, all bytecode,
   constructor arguments, role addresses, bindings, and constants.
9. Keep the factory paused until independent review, fork testing, manifest
   approval, and explicit authorization to resume.

Robinhood mainnet dependencies currently recorded by the project are:

- Wrapped native: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- Canonical V3 factory: `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`
- NonfungiblePositionManager: `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`
- Existing DoomRewards: `0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC`

These addresses must be revalidated on both RPC providers immediately before a
deployment rehearsal.
