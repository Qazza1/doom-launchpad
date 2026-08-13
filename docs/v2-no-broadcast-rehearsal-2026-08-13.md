# V2 dual-RPC no-broadcast deployment rehearsal

Date: 2026-08-13

Status: passed on both configured Robinhood Chain mainnet RPC providers

This is simulation evidence only. No private key was loaded, no wallet was
connected, no transaction was signed, and no transaction was broadcast.

## Reviewed source

- Merged baseline: `2ff9180a7bcb37be16db91a1fc13a83931d075ec`
- Frozen `v2/src` digest:
  `ce824376a4639f5c8882d7723668576ebf5b1f9e21b596aba605463614164d24`
- Compiler: Solidity `0.8.36`
- Foundry: `1.7.1`
- EVM version: Cancun with via-IR enabled

The rehearsal script is
`v2/script/DeployRobinhoodV2Rehearsal.s.sol`. It deliberately contains no
`vm.startBroadcast` call and is guarded by both chain ID `4663` and an explicit
simulation acknowledgement.

## Sequence exercised

1. Construct `DoomLaunchDeployerV2`.
2. Construct `PositionLockerV2` against the recorded canonical dependencies.
3. Construct `V3GraduationManagerV2` and validate the 1% / 200-tick V3 tier.
4. Bind the locker registrar.
5. Construct `DoomLaunchFactoryV2` in its default paused state.
6. Bind the curve deployer to the factory.
7. Bind the graduation manager to the factory.

Both independent RPC simulations passed the postconditions for the immutable
roles, existing DoomRewards dependency, wrapped-native token, V3 factory,
position manager, one-time bindings, 0.001 ETH launch fee, 100-launch cap,
factory pause state, and `isLaunchConfigurationValid()`.

The local simulation returned the same temporary addresses on both providers:

- curve deployer: `0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3`
- position locker: `0xf13D09eD3cbdD1C930d4de74808de1f33B6b3D4f`
- graduation manager: `0x5c4a3C2CD1ffE6aAfDF62b64bb3E620C696c832E`
- launch factory: `0x6AE5E129054a5dBFCeBb9Dfcb1CE1AA229fB1Ddb`

These are local fork artifacts, not predicted or deployed mainnet addresses.
Actual mainnet addresses depend on the deployer nonce immediately before each
transaction.

## Exact nonce-10 payload and gas preview

After both providers independently reported deployer pending nonce `10`, the
unsigned transaction planner generated the exact seven payloads and an
auto-impersonated localhost fork executed them in order. Every receipt,
predicted CREATE address, binding, factory pause state, and network
configuration postcondition passed.

| Nonce | Step | Gas used |
|---:|---|---:|
| 10 | Deploy `DoomLaunchDeployerV2` | 5,008,670 |
| 11 | Deploy `PositionLockerV2` | 1,657,440 |
| 12 | Deploy `V3GraduationManagerV2` | 2,237,386 |
| 13 | Bind locker registrar | 49,382 |
| 14 | Deploy `DoomLaunchFactoryV2` | 1,726,508 |
| 15 | Bind curve deployer factory | 49,088 |
| 16 | Bind graduation manager factory | 49,138 |

The snapshot funding requirement was `0.001499637572355 ETH`. This includes
25% headroom on each estimated transaction gas limit and a further 25% funding
buffer at the observed EIP-1559 fee ceiling. The deployer balance was
`0.013256557821060110 ETH`, so the snapshot shortfall was zero. Gas prices and
nonce can change; the preflight and funding calculation must be rerun
immediately before any deployment approval.

No signer was loaded. Anvil auto-impersonated the deployer and every state write
was sent exclusively to `127.0.0.1`.

## Rabby wallet-rendering rehearsal

The owner completed all seven wallet prompts through Rabby on the isolated
preview chain ID `4663666`. The server read each mined transaction back from
the preview fork and verified the sender, recipient, nonce, zero value, full
calldata, predicted CREATE address, successful receipt, and sequence before
enabling the next prompt.

The verified preview used nonces `1010` through `1016` and passed these final
postconditions:

- the factory remained paused;
- the locker registrar was bound to the V2 graduation manager;
- the curve deployer was bound to the V2 factory;
- the graduation manager was bound to the V2 factory.

The V3 manager's `isNetworkConfigurationValid()` correctly returns false on
the preview chain because its immutable expected chain is production `4663`.
The same postcondition passed on production-chain forks through both providers
and in the exact chain-4663 localhost payload rehearsal.

Rabby preview CREATE addresses were:

- curve deployer: `0x59779F78C683B36A5520aDCc7E6fd29675Bb72db`
- position locker: `0xbe238efd5F18d7ebc442FF3d9EADcdfa1E17B791`
- graduation manager: `0xEc109124eC97F387951075fED792AB5F11ad0a7c`
- launch factory: `0xe26ddEB2FE09D764B93962f3720C5B77eD0aC6dA`

Those addresses are preview-only because the preview nonce is deliberately
offset above the real deployer nonce. No raw signed transaction was retained.
EIP-155 binds the preview signatures to `4663666`, so they are invalid on
Robinhood mainnet `4663`.

## Remaining gates

- No exact nonce or gas plan has been frozen.
- Mainnet deployment is not authorized.
- Factory resume is not authorized.
- The first launch is not authorized.
- The factory must remain paused after any eventual deployment until a separate
  explicit owner decision.
