# Death Watch

The GM commitment already produces a three-day cliffhanger per launch. Nothing
currently broadcasts it. Death Watch is the layer that does.

It is the first Stage 6.5 mechanic because it needs **no contract change** and can
run from the moment the first canary token exists.

## Why this and not something cleverer

pump.fun's growth engine was the feed, not the bonding curve. Polymarket turned
uncertainty into content. A countdown with real money on it and a public winner or
loser at the end is the most shareable thing this product owns, and it already
exists in the contracts — it is simply invisible.

## What it reads

Everything comes straight from the chain: `launchCount()` and `getLaunch(id)` on
the factory, then each `GmEscrow`'s status, check-in counts, schedule, committed
and released amounts. No indexer, no database, no API key.

That matters for two reasons. It works the instant the canary deploys, and it can
never disagree with the contracts, because there is nothing in between.

The watcher is **read-only**. It has no signer and sends no transaction, so it can
never check in for a creator or finalise a default on anyone's behalf.

## The state machine

| Phase | Meaning |
|---|---|
| `waiting` | Between windows. Nothing to do yet. |
| `window_open` | The creator must check in now. The countdown targets the deadline. |
| `finalizable` | The deadline passed while still active. No longer savable; anyone can finalise the default. |
| `survived` | All check-ins honoured. Escrow fully released. |
| `dead` | Defaulted. The unreleased escrow went to the reward vault. |

`finalizable` is deliberately its own phase rather than being folded into `dead`.
The commitment is lost but not yet resolved, and that gap is the most watchable
moment the product has.

**At stake** is the unreleased remainder, not the whole commitment. With staggered
release, honoured check-ins are already the creator's and cannot be lost, so
showing the full escrow would overstate the drama by up to two thirds.

## What gets broadcast

Only transitions, never the current state on a timer. A feed that reposts itself
every poll is one people mute.

- `launched` — a new commitment appeared
- `window_open` — the check-in window opened
- `final_hour` — under an hour left, fired once per window
- `checked_in` — a day survived and a share released
- `deadline_missed` — the window closed unsaved
- `survived` — the full streak honoured
- `defaulted` — finalised, unreleased escrow moved to DoomRewards for future campaigns

Backfill is handled: a launch first seen already `survived` or `dead` announces
nothing, so pointing the watcher at existing history does not spam the channel
with obituaries.

Events render into the same alert shape the keeper's Telegram sender already
accepts, so escaping and delivery are the code paths that were already tested
rather than a second implementation.

## Run

```powershell
$env:ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com"
node .\tools\deathwatch\watch.mjs --factory <factory address>
```

Prints the feed and any new events and atomically writes a snapshot to the
Git-ignored `tools/deathwatch/output/feed.json`. Every read is pinned to one
explicit block and deadlines are evaluated against that block's chain timestamp,
not the computer clock.

Dry-run history is stored separately from the Telegram delivery checkpoint. A
dry run therefore cannot consume alerts that a later `--broadcast` run still
needs to send. Broadcast state advances only after successful delivery; partial
delivery records individual event IDs so unsent alerts remain retryable. The
delivery guarantee is at least once: a crash after Telegram accepts a message
but before the local ID checkpoint can duplicate that one message, but a failed
send cannot silently lose it.

Add `--broadcast` with `DEATHWATCH_TELEGRAM_BOT_TOKEN` and
`DEATHWATCH_TELEGRAM_CHAT_ID` set to publish. Without the flag it never sends,
which makes a dry run the default.

Use a **separate bot and channel** from the keeper. The keeper is private
operational alerting for the owner; Death Watch is public. Mixing them leaks
operational detail into a public channel.

## Untrusted input

Token `name()` and `symbol()` are creator-controlled. The decoder rejects an
absurd declared length, strips control characters, and the Telegram sender escapes
what remains. Nothing renders them as markup.

## Public web feed

The production analytics service exposes `GET /launchpad/death-watch`. It builds
the public feed from the reorg-aware launchpad index and evaluates every deadline
against the timestamp of the last confirmed indexed block. The website displays
that state in the **Death Watch** tab and refreshes it every 30 seconds.

The browser countdown is display-only. Reaching zero never changes a launch to
defaulted or default-eligible locally; the UI waits for the next confirmed index
response. Before deployment, while indexing is disabled, or when confirmed chain
time is unavailable, the feed shows an explicit fail-closed state.

Creator-controlled token names and symbols are escaped before being inserted into
the page. Each indexed launch links to the existing shareable `?launch=<id>`
detail view.

## Not built yet

- The Doom Pool betting layer, which is a prediction market and carries
  regulatory questions the spectator layer does not.
