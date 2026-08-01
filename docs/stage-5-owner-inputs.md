# Stage 5 — owner inputs and the start-block change

Two things only the owner can supply or do. Neither authorizes a transaction.

## 1. The three token inputs

Everything else about a launch is a constant in the deployed factory. These three
are the only choices, and all three are **permanent** — the token has no rename,
no re-symbol, and no mint function after deployment.

### Token name

1 to 64 bytes of UTF-8. Shown on Blockscout, the site, and Death Watch.

### Token symbol

1 to 12 bytes. Convention is short and uppercase.

### Total supply

A whole number of tokens between **1,000,000** and **1,000,000,000,000,000**.
The factory rejects fractional supplies.

Recommended: **1,000,000,000** (one billion). It is the memecoin convention and it
divides cleanly under the frozen split, which makes every number in the UI and in
the observer easy to check by eye:

| Allocation | Amount |
|---|---:|
| Creator at launch | 0 |
| Permanent liquidity (40%) | 400,000,000 |
| GM escrow (60%) | 600,000,000 |
| Released per check-in | 200,000,000 |

Supply does not change the economics — it only sets the initial unit price, since
the pool starts with 40% of supply against 0.01 ETH.

### The part that matters more than the numbers

**These are real tokens on mainnet with permanent, unremovable liquidity.**
Anyone can find them and buy them. The pool holds 0.01 ETH, so a buy of a few
dollars moves the price enormously and a seller after it gets very little back.

Name them so that nobody can mistake a canary for a product launch. Something
explicitly like `DoomStreak Canary Test 1` / `DCT1` is appropriate. Avoid names
that look like a real memecoin launch, avoid anything that implies value or
future listing, and do not promote them.

Three launches, numbered, is the sensible pattern: the second and third are
separate approvals anyway, and distinct names make the observer output and the
Death Watch feed unambiguous.

## 2. The indexer and keeper start block

### What is wrong

`PositionLocker.bindRegistrar` was mined at block **25102641**. The indexer and
keeper both start scanning at the factory deployment block **25105648**, which is
3,007 blocks later. The `RegistrarBound` event is therefore permanently outside
the scan range even though the indexer subscribes to it.

Nothing is broken by this. The binding is correct and independently verifiable by
calling `authorizedRegistrar()` on the locker, which returns the liquidity
manager. It is a completeness gap in indexed history, not a safety issue.

### The honest caveat before you change anything

Lowering the configured start block **does not by itself re-scan the missed
range.** The indexer cursor is already far ahead, and it only resets when the
cursor is *below* the configured start block. Changing the variable makes future
deployments correct; it does not retroactively fetch block 25102641.

Capturing that one event would additionally require resetting the launchpad
cursor, which re-scans roughly 194,000 blocks of empty range.

So there are two defensible choices:

- **Change the config, do not reset the cursor.** Correct going forward, costs
  nothing, leaves one setup event unindexed. Recommended.
- **Change the config and reset the cursor.** Complete history, costs a re-scan
  and some RPC load. Only worth it if you want provenance of the binding visible
  in the index rather than by contract call.

Doing neither is also defensible. The gap is one event whose truth is checkable
on demand.

### How to change it

**Indexer (Railway).** The variable is `DOOM_FACTORY_DEPLOYMENT_BLOCK`.

1. Railway dashboard, project, service `OnchainDiligence-indexer`.
2. Variables tab, edit `DOOM_FACTORY_DEPLOYMENT_BLOCK` from `25105648` to
   `25082132`.
3. Save. Railway redeploys automatically.
4. Confirm with `GET /launchpad/health` that `deployment_block` reads
   `25082132`, `blocks_behind` is `0`, and `factory_paused` is still `true`.

**Keeper.** `config/keeper.mainnet.json` holds `factoryDeploymentBlock` in the
repository. Change it to `25082132`, commit, and redeploy the
`doom-launchpad-keeper` service so the image picks it up.

Do not paste RPC URLs, Telegram tokens, or any secret into chat or into a commit.
Railway variables are the only place those belong.

### Verifying afterwards

- `GET /launchpad/health` reports the new `deployment_block`, `status: ok`,
  `confidence: high`, `factory_paused: true`, `chain_launch_count: 0`.
- The keeper reports zero active alerts and still sees the factory paused.
- If you did reset the cursor, `blocks_behind` returns to `0` before you treat
  the index as trustworthy again.

Do this before the canary if you are going to do it at all. Changing indexing
configuration while a live launch is being observed removes the ability to tell
an indexing artefact from a real contract problem.
