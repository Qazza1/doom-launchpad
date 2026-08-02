# Indexer stall, 2026-08-02 — diagnosis

The indexer has not advanced since shortly before canary launch 1 and has never
indexed it. This is blocker 1 in `docs/stage-5-launch-1-review.md`.

The fix lives in the sibling repository `C:\Users\golis\Desktop\onchaindiligence-indexer`,
which is production and outside this repository. Nothing there was changed. This
document is the diagnosis, read-only, so the change can be made deliberately.

## Symptom

`GET /launchpad/health`:

```json
{"status":"stalled","cursor":25352711,"head":25367887,"blocks_behind":15164,
 "launches_indexed":0,"confidence":"low","last_indexed_at":1785618791,
 "last_scan_age_s":42466,
 "last_error":"1785661222: request timeout (code=TIMEOUT, version=6.17.0)"}
```

Launch 1 was mined at block 25352820. The cursor is at 25352711, 109 blocks
short, so the launch has never been seen. The real gap against the live head of
about 25,794,000 is roughly 441,500 blocks, not 15,164.

## What the numbers say

`head` and `cursor` stopped at the same moment. `sync()` sets `head` from
`provider.getBlockNumber()` as its **first** action, before any scanning:

```js
const head = await provider.getBlockNumber();
setMeta("head", head);
```

A frozen `head` therefore means that first call is failing, not that a particular
batch is unparseable. **This is not a launch-handling bug.** Every RPC request
the worker makes is timing out, and has been for about twelve hours. The
`last_error` timestamp keeps moving, so the poll loop is alive and failing, not
dead.

It also means the indexer was already about 15,000 blocks behind and catching up
when it stopped, rather than keeping pace and then tripping over the launch.

## Root cause candidate: the indexer is on the public RPC

`config.js` line 8:

```js
RPC_URL: "https://rpc.mainnet.chain.robinhood.com",
```

Hard-coded, with no `process.env` override, unlike the other tunables in the same
file. The keeper and every canary tool in this repository use private endpoints
supplied at run time and require two independent providers; the indexer uses the
shared public one alone.

That endpoint rate-limits. Reproduced from this machine today: after a period of
sustained reads it began answering with a Cloudflare `Just a moment...`
interstitial and HTTP 403, which is what a client sees as a stalled or timed-out
request. The indexer's catch-up load is exactly the traffic shape that provokes
it.

## What turns a rate limit into a twelve-hour outage

Three things, each fine alone:

1. **`getLogs` bisects on any error.** It splits the range and retries both
   halves whenever `provider.getLogs` throws — including on a timeout or a
   429, not just on "range too large". Each failure doubles the request count,
   with no depth bound, so a 1,000-block batch can fan out to about a thousand
   single-block calls. Against a throttling provider that is a retry storm that
   makes the throttling worse.

2. **The cursor advances only after a whole batch succeeds**, and `poll()`
   catches everything. A batch that keeps failing freezes progress
   indefinitely. There is no backoff, no bounded retry, and no escalation from
   "one poll failed" to "indexing has been down for hours".

3. **`blocks_behind` is derived from the stored `head`**, which is only written
   on a successful poll. The longer the stall, the more the number understates
   the gap. `status: stalled`, `stalled: true`, `last_scan_age_s`, and
   `confidence: low` are all correct and honest — but the one field a reader
   instinctively looks at is the one that decays.

## Suggested order of work

1. **Give the indexer the private endpoint.** Add a `process.env.RPC_URL`
   override in `config.js` and set it on Railway to the same provider the keeper
   uses. Cheapest change, addresses the probable cause, and removes the shared
   public endpoint as a single point of failure for the whole analytics stack.
2. **Bound the bisection.** Split only on errors that indicate an oversized
   range, cap the depth, and back off on timeouts and 429s instead of
   multiplying requests.
3. **Report the gap honestly when stale.** When `last_scan_age_s` exceeds the
   stall threshold, report `blocks_behind` as unknown rather than a number
   computed from a stale head, or refresh `head` on its own so the number stays
   true even when scanning is broken.
4. **Escalate a long stall.** Twelve hours of failure looked identical to twelve
   minutes from the outside. The keeper already has an alerting path; a stalled
   indexer deserves one.

## For launch 2

Blocker 1 is cleared when `/launchpad/health` reports `status: ok`,
`blocks_behind: 0`, `confidence: high`, and `launches_indexed: 1`, and
`/launchpad/launches` returns launch 1 with an allocation matching
`tools/canary/output/launch-1.json`.

Note that a restart alone will not backfill the launch if the cursor is left
where it is — it will, because the cursor sits *below* the launch block and the
scan walks forward from there. That is a piece of luck: the stall happened before
the launch rather than after it, so no history has to be replayed by hand.
