# OnchainDiligence indexer integration

This integration is additive. Launchpad ingestion must never block the existing
pool scanner or its cursor. The canonical event signatures are machine-readable
in `integration/indexer/doom-launchpad-events.json`.

## Canonical launch materialization

A launch is definition-complete only after the same transaction provides:

- `LaunchCreated`
- `LaunchAllocations`
- `LaunchCommitmentConfigured`
- `LaunchLiquidityUtilization`
- `LaunchLiquidityConfigured`
- `LaunchFeeProcessed`
- `PermanentPositionRegistered`

`LaunchCreated` identifies the factory, token, creator, pool, position, escrow,
and locker. Do not trust `getLaunch(id)` for existence unless `record.token` is
nonzero; unknown IDs return an empty struct.

## Minimum tables

```sql
CREATE TABLE doom_launches (
  chain_id TEXT NOT NULL,
  factory TEXT NOT NULL,
  launch_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  creator TEXT NOT NULL,
  pool TEXT NOT NULL,
  position_id TEXT NOT NULL,
  creator_escrow TEXT NOT NULL UNIQUE,
  position_locker TEXT NOT NULL,
  total_supply TEXT NOT NULL,
  creator_liquid_amount TEXT NOT NULL,
  liquidity_token_allocated TEXT NOT NULL,
  liquidity_token_used TEXT NOT NULL,
  liquidity_token_remainder TEXT NOT NULL,
  escrow_token_amount TEXT NOT NULL,
  native_requested TEXT NOT NULL,
  native_used TEXT NOT NULL,
  creation_fee TEXT NOT NULL,
  permanent INTEGER NOT NULL CHECK(permanent = 1),
  pool_fee INTEGER NOT NULL,
  tick_lower INTEGER NOT NULL,
  tick_upper INTEGER NOT NULL,
  sqrt_price_x96 TEXT NOT NULL,
  configuration_hash TEXT NOT NULL,
  created_block INTEGER NOT NULL,
  created_tx TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chain_id, factory, launch_id)
);

CREATE TABLE doom_commitments (
  chain_id TEXT NOT NULL,
  escrow TEXT PRIMARY KEY,
  launch_id TEXT NOT NULL,
  token TEXT NOT NULL,
  creator TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','completed','defaulted')),
  completed_check_ins INTEGER NOT NULL DEFAULT 0,
  committed_amount TEXT NOT NULL DEFAULT '0',
  released_amount TEXT NOT NULL DEFAULT '0',
  remaining_amount TEXT NOT NULL DEFAULT '0',
  next_check_in_at INTEGER,
  next_deadline INTEGER,
  default_eligible INTEGER NOT NULL DEFAULT 0,
  resolved_at INTEGER,
  last_tx TEXT NOT NULL
);

CREATE TABLE doom_permanent_positions (
  chain_id TEXT NOT NULL,
  locker TEXT NOT NULL,
  position_id TEXT NOT NULL,
  launch_id TEXT NOT NULL,
  pool TEXT NOT NULL,
  launch_token TEXT NOT NULL,
  creator TEXT NOT NULL,
  gm_escrow TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  owner_verified_at INTEGER,
  PRIMARY KEY (chain_id, locker, position_id)
);

CREATE TABLE doom_lp_fee_collections (
  chain_id TEXT NOT NULL,
  locker TEXT NOT NULL,
  position_id TEXT NOT NULL,
  launch_id TEXT NOT NULL,
  creator_eligible INTEGER NOT NULL,
  launch_token_to_rewards TEXT NOT NULL,
  weth_collected TEXT NOT NULL,
  weth_to_creator TEXT NOT NULL,
  weth_to_treasury TEXT NOT NULL,
  weth_to_rewards TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  PRIMARY KEY (chain_id, tx_hash, log_index)
);

CREATE TABLE doom_reward_campaigns (
  chain_id TEXT NOT NULL,
  rewards_contract TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  token TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  allocation TEXT NOT NULL,
  claim_deadline INTEGER NOT NULL,
  claimed_amount TEXT NOT NULL DEFAULT '0',
  recycled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chain_id, rewards_contract, campaign_id)
);
```

All uint values exposed through JSON must be decimal strings unless guaranteed
within JavaScript's safe-integer range.

## Reorg and verification rules

1. Store raw logs append-only by `(chain_id, block_hash, tx_hash, log_index)`.
2. Keep an independent cursor per chain and factory version.
3. Materialize idempotently only from canonical blocks.
4. On a reorg, roll back orphan-derived rows and replay from the common ancestor.
5. Expose indexed block, indexed timestamp, confirmation count, and confidence.
6. Verify escrow and locker bytecode against the reviewed artifacts.
7. Periodically verify NPM `ownerOf(positionId) == locker`.
8. Treat completion/default as terminal; reject conflicting materialized state.
9. Mark a default funded only when `CommitmentDefaulted` has a matching
   `FailedAllocationDeposited` from the exact escrow in the same transaction.
10. Reconcile every `PositionFeesCollected` split before displaying totals.
11. Track escrow release from `EscrowReleased`, which carries the per-check-in
    amount, the running `releasedTotal`, and the `remaining` balance. The escrow
    pays out one share per honoured check-in, so a commitment's held balance is
    the allocation minus what has already been released. Treating the whole
    allocation as still escrowed overstates what a missed deadline costs by up
    to two thirds.
12. Redirect only `remaining` on a default. `CommitmentDefaulted.rewardAmount` is
    the unreleased remainder, not the original commitment; check-ins already
    honoured are never clawed back.
13. Store every `DoomRewards` deposit event as raw canonical log data, but count
    it in derived launch totals only when the event's `source` argument matches
    the canonical launch contract below. The emitting `source_address` is the
    rewards vault and is not the caller.

| Reward event | Required `source` |
|---|---|
| `FailedAllocationDeposited` | that launch's exact `creatorEscrow` |
| `FeeRewardsDeposited` | that launch's exact factory |
| `LiquidityRemainderDeposited` | that launch's exact factory |
| `LpFeeRewardsDeposited` | that launch's exact `positionLocker` |

Derive these identities from the complete canonical event set before applying
reward totals. Factory fee and liquidity-remainder deposits can appear before
`LaunchCreated` in log order within the same transaction. Unknown or mismatched
sources remain visible as ignored raw deposits and must not affect public totals.

## Status and badge rules

- **Commitment active:** status is active and current time is not beyond
  `nextDeadline`.
- **Default eligible:** status is still active but current time is beyond the
  current deadline. The creator fee share is already ineligible onchain.
- **Survivor:** canonical completion event and token transfer reconcile.
- **Defaulted:** terminal default event plus matching rewards deposit.
- **Liquidity permanent:** canonical registration, exact 1%/full-range metadata,
  and current NPM ownership by the known locker.
- **Fee share active:** locker `creatorFeeEligible(positionId)` is true.

Never describe a permanent position merely as “locked until” a date.

## Public API additions

- `GET /launchpad/health`
- `GET /launchpad/launches`
- `GET /launchpad/death-watch`
- `GET /launchpad/launch/:id`
- `GET /launchpad/token/:token`
- `GET /launchpad/creator/:creator`

Safety facts, freshness, and confidence remain public even if advanced analytics
are later gated for NFT holders.
