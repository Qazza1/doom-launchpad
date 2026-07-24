# OnchainDiligence Event Integration Plan

## Integration policy

Keep the existing V3 `PoolCreated` scanner, scorer, and API operational. Add a separate launchpad-event ingestion loop and additive tables. Do not make launchpad ingestion a prerequisite for the existing risk pipeline to advance its cursor.

The existing scanner may continue to discover the pool independently. Launchpad events provide authoritative launch configuration, escrow, position-lock, and reward-state facts. Correlate by token, pool, transaction hash, and launch ID.

## Canonical contract events

### DoomLaunchFactory

```solidity
event LaunchCreated(
    uint256 indexed launchId,
    address indexed token,
    address indexed creator,
    address pool,
    uint256 positionId,
    address creatorEscrow,
    address positionLocker
);

event LaunchAllocations(
    uint256 indexed launchId,
    uint256 totalSupply,
    uint16 creatorLiquidBps,
    uint16 liquidityBps,
    uint16 gmEscrowBps,
    uint256 creatorLiquidAmount,
    uint256 liquidityTokenAmount,
    uint256 escrowTokenAmount,
    uint256 nativeLiquidityAmount
);

event LaunchCommitmentConfigured(
    uint256 indexed launchId,
    uint32 requiredCheckIns,
    uint32 cadenceSeconds,
    uint32 gracePeriodSeconds
);

event LaunchLiquidityConfigured(
    uint256 indexed launchId,
    uint64 lpUnlockTime,
    address lpBeneficiary,
    uint24 poolFee,
    int24 tickLower,
    int24 tickUpper,
    uint160 sqrtPriceX96,
    bytes32 configurationHash
);

event LaunchFeeAccrued(
    uint256 indexed launchId,
    address indexed payer,
    uint256 amount,
    uint256 accruedFeesAfter
);

event NativeRefunded(
    uint256 indexed launchId,
    address indexed recipient,
    uint256 amount
);

event AccruedFeesWithdrawn(
    address indexed treasury,
    uint256 amount,
    uint256 accruedFeesAfter
);
```

The four launch-definition events share `launchId` and are emitted in one transaction. The materialized launch record becomes complete only after all four are observed.

### GmEscrow

```solidity
event CommitmentCreated(
    uint256 indexed launchId,
    address indexed token,
    address indexed creator,
    uint256 committedAmount,
    uint64 startTime,
    uint32 requiredCheckIns,
    uint32 cadenceSeconds,
    uint32 gracePeriodSeconds
);

event GmRecorded(
    uint256 indexed launchId,
    address indexed token,
    address indexed creator,
    uint32 completedCheckIns,
    uint64 recordedAt,
    uint64 nextCheckInAt,
    uint64 nextDeadline
);

event CommitmentCompleted(
    uint256 indexed launchId,
    address indexed token,
    address indexed creator,
    uint256 releasedAmount,
    uint64 completedAt
);

event CommitmentDefaulted(
    uint256 indexed launchId,
    address indexed token,
    address indexed creator,
    uint256 rewardAmount,
    address doomRewards,
    uint64 defaultedAt
);
```

### PositionLocker

```solidity
event PositionLocked(
    uint256 indexed positionId,
    address indexed pool,
    address indexed beneficiary,
    address positionManager,
    uint64 registeredAt,
    uint64 unlockTime
);

event PositionReleased(
    uint256 indexed positionId,
    address indexed pool,
    address indexed beneficiary,
    uint64 releasedAt
);
```

### DoomRewards

```solidity
event FailedAllocationDeposited(
    uint256 indexed launchId,
    address indexed token,
    address indexed source,
    uint256 amount,
    uint256 availableAfter
);

event CampaignCreated(
    uint256 indexed campaignId,
    address indexed token,
    bytes32 indexed merkleRoot,
    uint256 allocation,
    uint64 claimDeadline
);

event RewardClaimed(
    uint256 indexed campaignId,
    address indexed token,
    address indexed account,
    uint256 amount
);

event UnclaimedRewardsSwept(
    uint256 indexed campaignId,
    address indexed token,
    address indexed recipient,
    uint256 amount
);
```

## Normalized example payloads

All integer values that may exceed JavaScript safe-integer range are strings.

### Launch

```json
{
  "schema": "doom.launch.v1",
  "chain_id": "<ROBINHOOD_TESTNET_CHAIN_ID>",
  "block_number": "123456",
  "block_hash": "0x...",
  "tx_hash": "0x...",
  "log_index": 7,
  "launch_id": "1",
  "factory": "0xFactory",
  "token": "0xToken",
  "creator": "0xCreator",
  "pool": "0xPool",
  "position_id": "42",
  "creator_escrow": "0xEscrow",
  "position_locker": "0xLocker",
  "total_supply": "1000000000000000000000000000",
  "creator_liquid_amount": "100000000000000000000000000",
  "liquidity_token_amount": "700000000000000000000000000",
  "escrow_token_amount": "200000000000000000000000000",
  "native_liquidity_amount": "1000000000000000000",
  "commitment": {
    "required_check_ins": 7,
    "cadence_seconds": 86400,
    "grace_period_seconds": 14400
  },
  "lp_lock": {
    "unlock_time": 1810000000,
    "beneficiary": "0xBeneficiary"
  },
  "v3": {
    "fee": 3000,
    "tick_lower": -887220,
    "tick_upper": 887220,
    "sqrt_price_x96": "79228162514264337593543950336",
    "configuration_hash": "0x..."
  },
  "confirmed": false
}
```

### Commitment update

```json
{
  "schema": "doom.commitment.v1",
  "event": "GmRecorded",
  "launch_id": "1",
  "token": "0xToken",
  "escrow": "0xEscrow",
  "creator": "0xCreator",
  "completed_check_ins": 3,
  "recorded_at": 1770000000,
  "next_check_in_at": 1770086400,
  "next_deadline": 1770100800,
  "status": "active",
  "tx_hash": "0x...",
  "block_number": "123999"
}
```

### Default/reward funding

```json
{
  "schema": "doom.default.v1",
  "launch_id": "1",
  "token": "0xToken",
  "creator": "0xCreator",
  "escrow": "0xEscrow",
  "reward_vault": "0xDoomRewards",
  "amount": "200000000000000000000000000",
  "defaulted_at": 1770200000,
  "deposit_verified": true,
  "classification": "community_incentive",
  "tx_hash": "0x..."
}
```

### Reward claim

```json
{
  "schema": "doom.reward-claim.v1",
  "campaign_id": "8",
  "token": "0xToken",
  "account": "0xHolder",
  "amount": "250000000000000000000",
  "tx_hash": "0x...",
  "block_number": "130000"
}
```

## Additive database schema

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
  liquidity_token_amount TEXT NOT NULL,
  escrow_token_amount TEXT NOT NULL,
  native_liquidity_amount TEXT NOT NULL,
  required_check_ins INTEGER NOT NULL,
  cadence_seconds INTEGER NOT NULL,
  grace_period_seconds INTEGER NOT NULL,
  lp_unlock_time INTEGER NOT NULL,
  lp_beneficiary TEXT NOT NULL,
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
  next_check_in_at INTEGER,
  next_deadline INTEGER,
  resolved_at INTEGER,
  last_tx TEXT NOT NULL
);

CREATE TABLE doom_lp_locks (
  chain_id TEXT NOT NULL,
  position_locker TEXT NOT NULL,
  position_id TEXT NOT NULL,
  pool TEXT NOT NULL,
  beneficiary TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  unlock_time INTEGER NOT NULL,
  released_at INTEGER,
  PRIMARY KEY (chain_id, position_locker, position_id)
);

CREATE TABLE doom_reward_campaigns (
  chain_id TEXT NOT NULL,
  rewards_contract TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  token TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  allocation TEXT NOT NULL,
  claim_deadline INTEGER NOT NULL,
  swept_amount TEXT,
  PRIMARY KEY (chain_id, rewards_contract, campaign_id)
);
```

Store raw logs in an append-only table keyed by `(chain_id, block_hash, tx_hash, log_index)` for replay and reorg rollback.

## Ingestion sequence

1. Maintain a dedicated cursor key per chain and launchpad factory version.
2. Query logs in bounded chunks with the same split/retry pattern as the existing indexer.
3. Insert raw logs idempotently.
4. Decode events with the ABI artifact pinned to the factory version.
5. On `LaunchCreated`, create a pending launch row; merge `LaunchAllocations`, `LaunchCommitmentConfigured`, and `LaunchLiquidityConfigured` from the same transaction before marking the launch definition complete.
6. Verify `creatorEscrow` bytecode or code hash matches the reviewed `GmEscrow` artifact before granting a trusted badge.
7. Correlate `PositionLocked` by position ID and locker.
8. Treat `CommitmentCompleted` and `CommitmentDefaulted` as terminal and reject conflicting later state in the materialized view.
9. For default, require a matching `FailedAllocationDeposited` in the same transaction from the exact escrow and amount before marking reward funding verified.
10. Mark events confirmed only after the approved confirmation depth.
11. On reorg, delete materialized updates derived from orphaned raw logs and replay from the last canonical block.
12. Never block the legacy pool cursor when this consumer fails.

## Badge derivation

- **Commitment active:** launch has trusted escrow code; state is active; no terminal event. Show countdown to `nextDeadline`. When current time exceeds the deadline but default is not finalized, show `Default eligible` rather than `Defaulted`.
- **Commitment completed:** canonical `CommitmentCompleted` event and creator transfer reconciled.
- **Commitment defaulted:** canonical `CommitmentDefaulted` plus matching reward deposit from known escrow.
- **LP locked:** `PositionLocked` observed from the factory-emitted locker, NFT owner is the locker on a periodic read, lock is unreleased, and current time is before unlock. After unlock but before release, display `Unlock reached — position still held`, not `LP locked` without qualification.

## API additions

- `GET /launchpad/launch/:token`
- `GET /launchpad/creator/:wallet`
- `GET /launchpad/commitment/:escrow`
- `GET /launchpad/position/:positionId`
- `GET /launchpad/rewards/:token`
- `GET /launchpad/campaign/:campaignId`
- `GET /launchpad/feed?cursor=...`

Safety-critical fields remain unauthenticated and public. Advanced alerts, watchlists, saved filters, or workflow automation may be gated later.
