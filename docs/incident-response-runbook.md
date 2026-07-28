# Incident and pause runbook

Pausing stops only new launches. It cannot alter existing tokens, escrows,
permanent liquidity, fee routing, or reward claims.

## Guardian pause triggers

The emergency guardian or operator should pause immediately if:

- configured V3/NPM/WETH code or behavior appears inconsistent;
- pool or position post-condition monitoring fails;
- a factory/manager/locker/rewards accounting discrepancy appears;
- the indexer reports conflicting terminal escrow states;
- a new critical/high vulnerability affects the deployed bytecode;
- the frontend constructs unexpected chain, target, value, or calldata.

Record the transaction hash, block, evidence, affected launches, and public
status message. Never ask users to transfer assets to an “emergency” address.

## During pause

- Keep GM reminders, `finalizeDefault`, `collectFees`, claims, and recycling
  operational.
- Verify canonical onchain state directly through at least two RPCs.
- Preserve raw logs and identify the last canonical indexed block.
- Compare live bytecode, roles, bindings, caps, and configuration hashes to the
  signed deployment manifest.
- Publish facts and uncertainty; do not describe funds as recovered or protected
  without an onchain reconciliation.

## `PoolPriceMismatch` / pre-initialized V3 pool

`PoolPriceMismatch(expected, actual)` means the canonical token/WETH 1% pool
already exists at a price different from the factory's exact launch price. The
launch reverts atomically before minting the LP position; no launch record,
escrow, fee accrual, or native-liquidity accounting should persist.

1. Do not retry the launch and do not improvise a swap.
2. Record the factory, predicted token, pool, expected and actual
   `sqrtPriceX96`, transaction, block, and both RPC responses.
3. Read `slot0`, active liquidity, initialized ticks, token balances, and pool
   observations directly. A pool can be initialized before the token exists,
   and it may also contain one-sided liquidity.
4. Reconcile that the reverted launch changed no factory counter, cap,
   allocation, escrow, rewards, or locker state.
5. A recovery swap is permitted only after a fork rehearsal proves its exact
   calldata, price limit, maximum input/loss, post-swap price, and relaunch
   behavior against the observed pool state. Require a second-person review.
6. If bounded recovery cannot be proven, keep the factory paused and deploy a
   newly reviewed replacement. Never market the slot0 assertion as prevention;
   it is precise diagnosis and fail-closed behavior.

For public factory v2, permissionless pool pre-initialization is an architecture
blocker, not an operator runbook item.

## Resume gate

Only the operator can resume. Resume requires a written root-cause assessment,
confirmation that deployed contracts remain within their reviewed assumptions,
clean monitoring/indexer state, and a second-person review of the resume
transaction. If the deployed code is unsafe, keep the factory paused permanently;
there is no upgrade path.

## Key compromise

A compromised guardian can only pause. A compromised operator can pause/resume
and was also the approved canary creator, but cannot change existing positions or
escrows. A compromised campaign manager can publish unfair roots but cannot
withdraw. Rotate operational practice and deploy a new version where possible;
immutable addresses cannot be replaced in existing contracts.
