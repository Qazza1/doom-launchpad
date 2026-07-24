# Stage 4 constructor and nonce worksheet

This worksheet is preparation only. The canonical JSON manifest remains
fail-closed and contains no nonce, transaction hash, deployed address, approval,
or verification claim.

## Dependency-safe transaction order

All six transactions must be sent by the approved deployer/operator
`0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F`.

| Offset | Transaction | Required inputs |
| --- | --- | --- |
| `N` | Deploy `DoomRewards` | campaign manager, NFT collection, excluded treasury holder, WETH, 7-day minimum claim window |
| `N+1` | Deploy `PositionLocker` | canonical position manager, WETH, deployed rewards vault, treasury, deployer as one-time binder |
| `N+2` | Deploy `V3LiquidityManager` | chain ID 4663, deployer as one-time binder, V3 factory, position manager, WETH, deployed locker |
| `N+3` | `PositionLocker.bindRegistrar(manager)` | exact deployed liquidity manager |
| `N+4` | Deploy `DoomLaunchFactory` | frozen role addresses, rewards, WETH, manager, locker, 3 launches, 0.01 ETH per launch, 0.03 ETH global |
| `N+5` | `V3LiquidityManager.bindFactory(factory)` | exact deployed factory |

`N` must be read from the pending nonce immediately before the rehearsal and
again immediately before every real transaction. Any unexpected nonce change
invalidates all later predicted addresses and stops the deployment.

## Irreversible boundaries

- `bindRegistrar` can be called once and cannot be changed.
- `bindFactory` can be called once and cannot be changed.
- The factory constructor rejects a locker that is not already bound to the
  exact manager.
- The manager binding rejects a factory that does not point back to the exact
  manager.
- The factory starts paused. Deployment does not authorize resuming it.

## Values frozen in the audit candidate

- Creator allocation: 10%.
- Permanent V3 liquidity: 40%.
- GM escrow: 50%.
- Required GM check-ins: 3.
- Grace period: 12 hours.
- Creation fee: 3% of native liquidity actually used.
- Canary liquidity: exactly 0.01 ETH.
- Canary cap: 3 launches and 0.03 ETH aggregate native liquidity.
- V3 fee tier: 1%, tick spacing 200, full range.
- NFT fee share: 50% of creation fees to `DoomRewards`.

## Stop conditions

Stop before the next transaction if the nonce, chain ID, bytecode, constructor
arguments, dependency getter, role, configuration hash, balance, receipt status,
or expected address differs from the signed manifest. Never repair an
irreversible binding by deploying around it during the same session.
