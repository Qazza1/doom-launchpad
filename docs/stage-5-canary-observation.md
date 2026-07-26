# Stage 5 canary observation

Stage 5 permits at most three launches of exactly 0.01 ETH each, with a review
between them. This tool is that review, made mechanical.

Until now the roadmap described what to check after a canary launch in prose.
Prose is what gets skimmed at the point where somebody has just spent real money
and wants to see the next launch work.

## Run

```powershell
$env:ROBINHOOD_RPC_URL = "<https endpoint>"
node .\tools\canary\observe.mjs --factory <factory> --launch 1 --addresses <deployed.json>
```

Read-only. It never sends a transaction, never resumes the factory, and exits
non-zero when any invariant fails.

The report lands in the Git-ignored `tools/canary/output/launch-<id>.json`.

## What it checks

Everything is derived from the launch record the factory stores, the GM escrow,
the token, the pool, and the position manager. Expected values come from
`config/robinhood-mainnet-canary.decisions.json`, not from constants written into
this tool.

**Allocation**
- creator gets exactly 10% of supply
- permanent liquidity gets exactly 40%
- GM escrow gets exactly 50%
- the three sum to the total supply, with nothing unaccounted for
- the token's own `totalSupply` matches the recorded supply

**Liquidity**
- liquidity actually used plus the remainder routed to rewards equals the
  allocation
- the launch is recorded as permanent
- a position id exists and a pool address was recorded
- **the LP position is owned by the permanent locker**, checked against the
  position manager rather than trusted from the launch record

**Fees**
- the creation fee is exactly 3% of the native liquidity actually used
- treasury and DoomRewards shares sum to the fee
- the DoomRewards share is exactly 50%

**Canary caps**
- native liquidity is exactly 0.01 ETH
- the launch count is within the cap of three
- aggregate native liquidity is within 0.03 ETH

**GM commitment**
- the escrow's creator and token match the launch
- the committed amount matches the recorded escrow allocation
- three check-ins, 24-hour cadence, 12-hour grace, all as frozen
- the first deadline is after the start time
- the escrow routes defaults to the deployed DoomRewards

**Custody**
- while the commitment is open, the escrow actually holds the full escrowed
  allocation. A record saying tokens are escrowed while the balance says
  otherwise is the failure worth catching.
- the pool holds at least the liquidity that was used

## What a failure means

Stop. Pause the factory and investigate before permitting the next launch. The
tool exits non-zero and names each broken invariant.

A pass does not authorize the next launch either. Stage 5 requires the owner to
review each launch and decide, and three launches is the hard cap.

## What it does not cover

- Indexer ingestion and public API agreement. Compare those separately against
  direct contract reads.
- Telegram keeper alerts, which are configured with the deployed addresses after
  Stage 4.
- Fee collection over time. This is a snapshot at observation time; LP fees
  accrue later and route through the locker.
- Anything about price or market behaviour, which is not an invariant.
