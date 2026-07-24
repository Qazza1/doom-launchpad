# Stage 3.4 indexer and public UI

Stage 3.4 is a read-only integration. It does not deploy contracts, accept a
private key, sign a transaction, or enable the website launch button.

## Integration components

- `onchaindiligence-indexer`, branch `stage3.4-launchpad-integration`
  - stores normalized launchpad logs idempotently by chain, transaction hash,
    and log index;
  - indexes only blocks behind the configured confirmation depth;
  - compares the saved cursor block hash with the canonical chain;
  - rewinds recent logs and rebuilds launch state when a reorg is detected;
  - exposes launch, creator, token, freshness, and confidence endpoints.
- `doomstreak-site/index.html`
  - shows an honest pre-deployment state while no factory is configured;
  - lists confirmed Doom launches when available;
  - adds shareable `?launch=<id>` public launch records;
  - adds the GM commitment and permanent-liquidity state to token detail pages;
  - keeps launch transactions disabled.

## Indexer configuration

Do not add these variables until the Stage 4 deployment is verified:

| Variable | Required | Meaning |
| --- | --- | --- |
| `DOOM_FACTORY` | yes | Verified `DoomLaunchFactory` address |
| `DOOM_FACTORY_DEPLOYMENT_BLOCK` | yes | Exact factory deployment block |
| `DOOM_POSITION_LOCKER` | optional | Verified locker; otherwise read from factory |
| `DOOM_REWARDS` | optional | Verified rewards vault; otherwise read from factory |
| `DOOM_CONFIRMATIONS` | no | Confirmations before publication; default `12` |
| `DOOM_BATCH_SIZE` | no | Maximum scan batch; default `1000` |
| `DOOM_REORG_REWIND_BLOCKS` | no | Reorg replay window; default `64` |

If the factory or deployment block is absent, the indexer fails closed and the
API reports `not_deployed`. The existing risk indexer continues to operate.

## Public API

- `GET /launchpad/health`
- `GET /launchpad/launches?limit=30`
- `GET /launchpad/launch/:id`
- `GET /launchpad/token/:address`
- `GET /launchpad/creator/:address`

`/health` and `/score/:token` also expose `last_indexed_at` and `confidence`.
Every launch response includes the launchpad index health used to produce it.

## Reorg model

1. Scan only through `head - DOOM_CONFIRMATIONS`.
2. Save both the confirmed cursor number and its block hash.
3. Before the next scan, compare the saved hash with the canonical block.
4. On mismatch, delete raw events inside the rewind window.
5. Rebuild every derived launch from the remaining raw event log.
6. Replay canonical confirmed blocks before publishing high confidence again.

The raw event table is the source of truth. Derived launch rows are disposable
and rebuildable.

## Direct public reads

The website must not be the only way to inspect a launch. After Stage 4, publish
the verified Blockscout contract pages and constructor arguments. Anyone can
then use Blockscout's **Read Contract** panel or a read-only RPC client for:

- `DoomLaunchFactory.getLaunch(launchId)`
- `DoomLaunchFactory.launchCount()`
- `DoomLaunchFactory.launchIdByToken(token)`
- `GmEscrow.status()`
- `GmEscrow.completedCheckIns()`
- `GmEscrow.nextCheckInAt()`
- `GmEscrow.nextDeadline()`
- `GmEscrow.remainingCheckIns()`
- `PositionLocker.isPermanentlyLocked(positionId)`
- `PositionLocker.lockState(positionId)`
- `PositionLocker.creatorFeeEligible(positionId)`
- `DoomRewards.availableRewards(token)`
- `DoomRewards.campaigns(campaignId)`

The permissionless write paths are `GmEscrow.finalizeDefault()` and
`PositionLocker.collectFees(positionId)`. The creator-only path is
`GmEscrow.recordGm()`. Do not submit any of them from an unverified address or
ABI. Stage 4 must publish the verified explorer links and a separate transaction
runbook before the UI exposes a write control.

## Deployment order

1. Merge and deploy the indexer code with no `DOOM_*` variables.
2. Confirm `/launchpad/health` reports `not_deployed`.
3. Deploy and verify the Stage 4 contracts while the factory remains paused.
4. Add the verified factory address and deployment block to the indexer.
5. Confirm the dependency addresses read from the factory match the signed
   deployment manifest.
6. Wait for the configured confirmation depth and verify launchpad health.
7. Deploy the public website.
8. Keep launch writing disabled until the separately approved Stage 5 canary.

