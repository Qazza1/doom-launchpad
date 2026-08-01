# Stage 4 Robinhood mainnet deployment evidence

Stage 4 completed on 2026-08-01. The four contracts are deployed on Robinhood
Chain mainnet, the two one-time bindings are set, all public source is verified,
and the factory remains paused with zero launches.

This record does **not** authorize resuming the factory or launching a token.
Those are separate Stage 5 owner decisions.

## Frozen identity

- Contract source commit: `740a473bd0f2830a17650be7a3b4008be1f82441`
- Contract digest: `7aab9e3b0c0c7066ee31e89807900e63112b0c4815338825e02f5d85fa4684c8`
- Approved plan commit: `44d435afd0dca53a040ce8bfa58df444b99c6582`
- Plan SHA-256: `906033c5c54775b2a473578b1c470d470d6679f9453f838e0671e71aebf2ae82`
- Deployment tooling commit: `4dc783287ba8c149d0c5f93c06d664c4a064afba`
- Deployer: `0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F`

The independent third-party review gate was explicitly waived only for the
capped three-launch canary. The waiver is recorded in
`docs/stage-4-owner-risk-acceptance.md`; it is not an audit and does not apply to
a replacement or public factory.

## Contracts and transactions

| Step | Operation | Block | Gas used | Address / transaction |
|---:|---|---:|---:|---|
| 1 | Deploy DoomRewards | 25082132 | 1,002,237 | [`0x615f...d9dC`](https://robinhoodchain.blockscout.com/address/0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC) / [`0x0b43...0aca`](https://robinhoodchain.blockscout.com/tx/0x0b431bc40f72f314fd8be06e3573527f0c526058fe8bdeaa3dd6d55196c60aca) |
| 2 | Deploy PositionLocker | 25095185 | 1,664,106 | [`0xdaE0...fAC0`](https://robinhoodchain.blockscout.com/address/0xdaE01c32131fF283f403b4C1fD71018Fa31cfAC0) / [`0xa2c2...ee90`](https://robinhoodchain.blockscout.com/tx/0xa2c2d8d1821a81e679701561209c0d8cf0660e201f7a1e46292a59f2cd22ee90) |
| 3 | Deploy V3LiquidityManager | 25097810 | 1,583,099 | [`0xbf36...8519`](https://robinhoodchain.blockscout.com/address/0xbf36be8861ca4fe9920B10fc526E3fD039F88519) / [`0x9453...d03f`](https://robinhoodchain.blockscout.com/tx/0x94533f78568a3cf558692a1f73ca9d240d5463e2728248182bd03b50f72dd03f) |
| 4 | Bind locker registrar | 25102641 | 49,335 | [`0x712d...d49c`](https://robinhoodchain.blockscout.com/tx/0x712d9c406611601de083ab5aba38dadc0e74263721c8ca795f40c9b40520d49c) |
| 5 | Deploy DoomLaunchFactory | 25105648 | 4,710,371 | [`0xDC0D...D9dE`](https://robinhoodchain.blockscout.com/address/0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE) / [`0x1d84...128c`](https://robinhoodchain.blockscout.com/tx/0x1d84b1eb4d6cf80039a9f4c97f4558f7a9376b8415a798d6b34fe23175d7128c) |
| 6 | Bind liquidity-manager factory | 25107533 | 49,302 | [`0x40cd...e416`](https://robinhoodchain.blockscout.com/tx/0x40cd72f2b0a790f2ee26d4f215534d31894df06fa450263ccc93c8387022e416) |

Every receipt was checked before proceeding to the next nonce, and the two RPC
providers agreed on each receipt.

## Post-deployment verification

The read-only dual-provider verifier passed on 2026-08-01:

- all four runtime bytecodes match the frozen artifacts after masking only the
  compiler-declared immutable ranges;
- constructor values, roles, dependencies, one-time bindings, caps, fee splits,
  allocation constants, and network configuration match;
- `launchesPaused()` is `true`;
- `launchCount()` is `0`;
- maximum launches is `3`;
- per-launch native liquidity cap is `0.01 ETH` and the global cap is `0.03 ETH`.

The local receipt ledger SHA-256 was
`14923cddf5a3b733d75ada6f6f19b323f198ddbea262db0948f435c3ef887146`.
The local dual-provider verification report SHA-256 was
`9d512733616009285abc37a04bd0d25200cbdd92ffd6a6879c2b82ac9563f00f`.
RPC URLs and credentials were neither printed nor committed.

## Production keeper

The separate Railway service `doom-launchpad-keeper` completed its first
healthy read-only production cycle on 2026-08-01 at `16:51:14Z`, using keeper
commit `85b3b8b9c81e8813d1235b48a05cccef7c3475e0`:

- collected Robinhood mainnet block `25196211` on chain `4663`;
- evaluated the deployed factory, locker, rewards vault, roles, dependencies,
  caps, pause state, and reward accounting;
- reported zero active alerts;
- delivered and then resolved the intentionally surfaced RPC-collection alert;
- persisted Telegram deduplication state on a Railway volume;
- retained a 60-second monitoring interval;
- loaded no signing key and exposed no transaction path.

Telegram delivery and primary/fallback RPC operation are therefore proven from
the production host. This does not authorize resuming the factory.

## Explorer verification

Blockscout independently reports all four contracts as fully verified, not
partially verified, with unchanged bytecode. Each uses Solidity
`v0.8.36+commit.8a079791`, optimizer enabled with 200 runs, and Cancun EVM.

The public explorer currently labels PositionLocker's license as `none` even
though its primary source starts with `SPDX-License-Identifier: MIT`. This is
explorer metadata only; its full source and bytecode verification succeeded.

## Required paused state

The factory is deliberately unusable while paused. No authorization has been
given to call the resume function or execute the first canary launch. The next
safe work is read-only indexer and keeper configuration, followed by confirmation
depth and public-API comparison. Factory resume requires a new, explicit owner
approval after that operational validation.
