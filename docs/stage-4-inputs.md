# Stage 4 inputs and owner checklist

Stage 4 fail-closed preparation is in progress. Nothing in this file authorizes
a deployment.

## What is needed from the project owner

The public role and product addresses are already frozen. Do not send a private
key, seed phrase, keystore file, wallet recovery phrase, or RPC secret.

Before a real broadcast, the owner must provide or confirm:

1. A final yes/no approval after reviewing the independent security report.
2. Confirmation that the dedicated Rabby account at
   `0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F` remains isolated and accessible.
   Never import the unavailable SafePal recovery phrase into Rabby.
3. A dedicated Robinhood mainnet RPC endpoint. Its secret URL stays local in an
   environment variable and is never pasted into source control or chat.
4. Sufficient ETH on the deployer for deployment gas only. The exact amount is
   determined after a fresh gas rehearsal; do not fund it based on an estimate
   written in advance.
5. Confirmation that the campaign-manager and guardian wallets are accessible
   and connected to Robinhood Chain.
6. An independent reviewer or audit provider and the final report or commit hash
   they reviewed.
7. The exact Git commit and checksum bundle approved for deployment.

The NFT collection may still have zero minted supply at deployment. Fee rewards
remain isolated in DoomRewards until a valid NFT-holder snapshot campaign is
created.

Use an Alchemy Robinhood Mainnet endpoint as primary and an independently
hosted QuickNode Robinhood Mainnet endpoint as fallback. Follow
`docs/stage-4-rpc-setup.md`; the public Robinhood RPC remains a testing endpoint.

## Work Codex can prepare before owner action

- The production deployment and verification scripts, kept fail-closed.
- A deterministic deployment-order and nonce worksheet.
- Exact constructor-argument and immutable-value checks.
- A gas simulation on a fresh Robinhood mainnet fork.
- A deployment manifest with empty transaction hashes and contract addresses.
- A one-transaction-at-a-time runbook with stop conditions.
- Post-deployment `cast call`, bytecode, event, ownership, pause, and balance checks.
- Blockscout verification commands.
- Indexer event mappings and frontend read-only configuration.

## Stage 4 deployment order

The expected order is:

1. `DoomRewards`
2. `PositionLocker`
3. `V3LiquidityManager`
4. irreversible `PositionLocker.bindRegistrar(liquidityManager)`
5. `DoomLaunchFactory`
6. irreversible `V3LiquidityManager.bindFactory(factory)`

`DoomRewards` must exist before `PositionLocker`: the locker constructor checks
the rewards-vault bytecode and its configured WETH reward asset. The manager
must exist before it can be irreversibly registered with the locker, and the
locker registration must be complete before the factory constructor will
accept the dependency graph.

The factory must remain paused after deployment. Source verification, both
irreversible bindings, and every post-deployment assertion must pass before the
operator considers resuming it. The first canary launch is a separate approval
after deployment, not part of the deployment transaction sequence.
