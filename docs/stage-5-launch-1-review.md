# Canary launch 1 — review

Recorded 2026-08-02. **This document is not approval for launch 2.** It is the review the
runbook requires between launches, and it ends with blockers rather than a recommendation.

Launch 1 happened on 2026-08-01. Everything on chain is correct. Two of the four systems that
are supposed to agree about it do not, and the creator account can no longer afford launch 2.

## What was launched

| | |
|---|---|
| Transaction | `0xf46332c0645743a1c8b0baec50ab5bc72efa08e62f25bdaa52821772b747044c` |
| Block | 25352820, 2026-08-01T21:12:39Z |
| Sender / nonce | `0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F`, nonce 7 |
| Value | 0.0101 ETH; 0.00999999999999989 used as liquidity, 0.000099999999999998 fee, 110 wei refunded |
| Gas | 7,569,336 at 20,334,000 wei, about 0.000154 ETH |
| Token | `DoomStreak Canary Test 1` / `DCT1` `0xbebf865056a3fe9914e9edeaddd6ed763309ddb6` |
| Pool / position | `0x515b8e7271b81a20c9f5e1a69f96565a22db945d`, position 548289 |
| Escrow | `0x19b0780f01567c1c05349a1d8a113042c4cd07ed`, 600,000,000 DCT1 |

## The four sources

### Direct contract reads and the observer — agree

`node tools/canary/observe.mjs --factory 0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE --launch 1
--addresses tools/canary/output/deployed-addresses.json`, re-run 2026-08-02T09:00Z against a
Robinhood Chain endpoint: **every invariant holds**, zero failures.

Worth stating explicitly, because these are the properties nobody can undo later:

- Allocation is 0 / 400,000,000 / 600,000,000 and sums exactly to supply.
- The LP position is owned by the **PositionLocker** `0xdaE0…fAC0`, read from the position
  manager rather than from the launch record, and the record is marked permanent.
- The creation fee is 1% of the liquidity actually used and splits 50/50, to the wei.
- The escrow holds the full 600,000,000, routes defaults to DoomRewards, and carries the frozen
  three check-ins, 24-hour cadence, and 12-hour grace.
- The 108-wei liquidity remainder and 110-wei value refund are the expected rounding, and both
  reconcile.

### Death Watch — agrees

`node tools/deathwatch/watch.mjs --factory …` at block 25776655 reports one commitment, one
still live, `#1 DCT1 | waiting | 0/3 | at stake 600000000`, and emits one `launched` event. It
reads the chain directly, so this is a second reading of the same truth, not a second source.

### Keeper — healthy, after a correction

The keeper was firing one **critical** alert continuously: `factory:pause-state`, "Expected
launchesPaused=true, observed false", repeating every 300 seconds since the resume. That was not
a fault in the system being watched. `config/keeper.mainnet.json` still said the factory was
supposed to be paused, so the keeper was correctly reporting that the world disagreed with its
manifest.

`expectedFactoryPaused` is now `false`, and a dry run at block 25794258 reports **zero active
alerts**. The keeper sees launch 1, its permanent-lock check passes, and the GM rules are armed.

Two things follow from this, and both matter more than the fix:

- **A critical alert that repeats every five minutes and means nothing is how real alerts get
  missed.** It ran for roughly twelve hours. That is the actual finding from launch 1.
- **This must be flipped back to `true` the moment the factory is paused again**, or the keeper
  stops telling you about an unexpected pause — the one thing it exists to catch.

Telegram delivery could not be verified from here. Confirm that you actually received the
pause-state alert on your phone; if you did not, the delivery path is untested in production and
that is a blocker of its own.

### Indexer and public API — do not agree

`GET /launchpad/health` on 2026-08-02:

```json
{"status":"stalled","cursor":25352711,"launches_indexed":0,"confidence":"low",
 "blocks_behind":15164,"factory_paused":false,"chain_launch_count":1,
 "last_error":"request timeout (code=TIMEOUT, version=6.17.0)"}
```

The indexer stopped at block 25352711. Launch 1 was mined at 25352820, **109 blocks later**. It
has never been indexed and `launches_indexed` is `0`; `/launchpad/launches` returns an empty
array. The last successful scan was roughly twelve hours before this review, and `blocks_behind`
is itself stale: measured against the live head of 25794258 the real gap is about 441,500 blocks.

`factory_paused: false` and `chain_launch_count: 1` in that same response are direct chain reads,
which is why the health endpoint looks partly right. The indexed history behind it is empty.

The good news in the same response: `deployment_block` is `25082132`, so the start-block fix has
landed on the indexer and `RegistrarBound` is inside the scan range. `config/keeper.mainnet.json`
now uses the same block.

## The creator account cannot afford launch 2

Balance at review time: **0.00526 ETH**. Launch 2 needs 0.0101 ETH of value plus gas — about
0.0103 ETH all in, and `prepare.mjs` demands 0.0131 ETH including its default headroom. The
shortfall is roughly 0.0078 ETH. The preparation tool will refuse to produce a plan until this is
funded, which is the correct behaviour and not something to work around.

## Launch 2 rehearses cleanly

Stage D now exists (`tools/canary/fork-rehearsal.mjs`) and was run against a fork at block
25786384. The launch-2 plan executes: launch count 1 → 2, receipt status 1, 7,483,836 gas, and
every observer invariant holds on the fork.

The same tool, given a plan with the historical value bug — 0.01 ETH instead of 0.0101 — refuses
it before anything is mined:

```
the call reverts before it can be mined:
InsufficientNativeValue(uint256,uint256) 0x03ba5fc3 [10100000000000000, 10000000000000000]
```

That is the bug that reached a real wallet, named and quantified on a chain where it costs
nothing.

## Blockers before launch 2

Each of these is resolved or it is not. None of them are formalities.

1. **The indexer is stalled and has never seen launch 1.** Diagnosed in
   `docs/indexer-stall-2026-08-02.md`: every RPC request the worker makes is timing out, most
   likely because it is the one component still pointed at the shared public endpoint, which
   rate-limits. Resolved when `/launchpad/health` reports `status: ok`, `blocks_behind: 0`,
   `confidence: high`, and `launches_indexed: 1`, and `/launchpad/launches` returns launch 1 with
   an allocation matching the observer output above. Until then the runbook's "compare direct reads
   with the indexer and public API" step cannot be performed, and one of the three things the
   canary is meant to prove is unproven.
2. **Telegram delivery is unconfirmed for a real alert.** Resolved when you confirm you received
   the pause-state alert, or send a fresh test through the documented path.
3. **The creator account is underfunded.** Resolved when the balance covers 0.0101 ETH plus gas
   headroom and `prepare.mjs` stops refusing.
4. **The GM commitment for launch 1 is unresolved.** See below. Launching a second token while
   the first streak is still open adds a second deadline to track for no gain.
5. **The keeper config change is not deployed.** The repository is correct; Railway is running the
   old config until it redeploys.

## The GM commitment, which is running now

The first check-in window for DCT1:

- **Opens** 2026-08-02T21:12:39Z
- **Closes** 2026-08-03T09:12:39Z

The creator calls `recordGm()` on the escrow `0x19b0780f01567c1c05349a1d8a113042c4cd07ed` inside
that window; each honoured check-in releases 200,000,000 DCT1. Three of them, one per day, each
inside its own 12-hour grace period. Miss one and everything still unreleased goes to DoomRewards
permanently, and anyone can finalise it.

The keeper will now warn an hour before the window opens and escalate to critical in the last
fifteen minutes, so the alerting path gets tested by this too.

On a canary, a missed check-in is a **successful test of the default path**, not a failure — but
it is a one-way test. Decide deliberately which path you want launch 1 to take rather than
letting the clock decide for you.

## What launch 1 actually taught

- The contracts do exactly what the frozen economics say, to the wei, against real Uniswap
  V3-compatible dependencies. The rounding behaves and reconciles.
- The observer is trustworthy: it checked what mattered and did not report false comfort.
- The monitoring configuration drifted from reality the instant the factory was resumed, and
  nothing forced it to be updated. Expected-state files need to move with the state they describe.
- The indexer failing silently is the real gap. Two independent readings of the chain agreed;
  the derived layer everyone else sees was empty for half a day and its own health endpoint
  understated how far behind it was.
- Stage D should have existed before launch 1. It exists now, and it reproduces the historical
  failure exactly.
