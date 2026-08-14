# Permissionless V2 successor migration

## Why a successor is required

The Genesis V2 factory at `0x142760D2C865537c063492933FB71ddefA2372C6`
is non-upgradeable and checks `creatorAllowed[msg.sender]` inside `launch()`.
The deployer and graduation manager are also one-time bound to that factory.
The website cannot remove or bypass those on-chain checks.

## Public architecture

- Genesis launch ID `1` and its curve remain on the legacy factory.
- `DoomPublicLaunchFactoryV2` accepts any EOA wallet and issues IDs `2..100`.
- A fresh deployer, locker and graduation manager are bound to the public factory.
- Canonical Robinhood WETH, V3 factory, position manager and DoomRewards are reused.
- The public factory starts paused. Deployment does not activate launches.
- The operator alone can resume; the operator or emergency guardian can pause.
- Public contracts and the legacy Genesis factory are indexed together.

## Deliberate limitations

Smart-contract wallets are not accepted in this release. The creator identity must
be the transaction-originating EOA because GM check-ins, creator-fee claims and
the current signed-upload flow are wallet-address based. Supporting EIP-1271
wallets is a separate compatibility and security change.

## Audit status

This successor has not received an independent audit. On 2026-08-14 the owner
explicitly chose public launch before an external audit for capital reasons.
That decision does not authorize deployment, factory resume or any token launch.
Each mainnet action still requires a separate exact-transaction authorization.
