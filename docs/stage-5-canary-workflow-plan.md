# Stage 5 canary workflow — requirements and plan

Recorded 2026-08-01. **Nothing in this document authorizes anything.** It
specifies a workflow to be built; the workflow itself will contain no send path
until the owner separately approves adding one.

**Superseded in part, 2026-08-02.** The resume and the first launch both
happened. The factory is open, launch count is 1, and the binding fields below
that reference "launch count expected 0" and "total native liquidity expected 0"
were correct for launch 1 only — a plan is bound to the state observed when it is
generated, which `tools/canary/prepare.mjs` reads from chain rather than
assuming. Everything else here still holds. Current state and open blockers are
in `docs/stage-5-launch-1-review.md`; build progress is in
`docs/stage-5-build-stages.md`.

Every launch is a distinct owner decision, granted immediately before the action.

## The separation that defines this workflow

`resumeLaunches()` and `launch(params)` must never be bundled, and approving the
first can never imply the second. This is the single most important property
here: after a resume, the factory is open and the approved creator can launch,
so the window between the two decisions is the riskiest state the system will
ever be in. The workflow must make that window explicit and short, and must make
a launch impossible without its own fresh approval.

## Launch plan binding

A launch plan is valid only when every one of these matches at submission time.
Any mismatch fails closed:

- chain ID `4663`
- factory `0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE`
- sender `0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F`
- exact pending nonce
- exact calldata hash
- exact token name
- exact token symbol
- exact whole-token supply
- native liquidity exactly `0.01 ETH`
- maximum payable value `0.0101 ETH`
- current contract digest `7aab9e3b…`
- current source commit `740a473`
- plan expiry timestamp
- factory launch count expected `0`
- total native liquidity expected `0`

The plan hash must be deterministic over all of the above, so the owner can
compare what they approved with what the wallet is about to sign.

## To build, before any send path exists

1. Plan generator producing an unsigned plan plus its deterministic hash.
2. Read-only dual-provider preflight (chain, nonce, balance, paused state,
   launch count, aggregate liquidity, dependency bytecode).
3. Localhost preview of the exact call against a mainnet fork.
4. Rabby raw-transaction comparison against the planned calldata.
5. Chain, account, nonce, value, and calldata guards enforced at submission.
6. Simulation / fork rehearsal of the full launch.
7. Step-by-step owner runbook with explicit STOP checkpoints after every
   transaction.

Tests must prove:

- resume and launch cannot be bundled into one approval or one transaction;
- the tool cannot launch a second token automatically;
- a stale plan fails;
- a changed name, symbol, supply, address, nonce, value, or chain fails;
- no private key is ever loaded.

## Reuse rather than rebuild

Stage 4 already produced the safety patterns this needs, and they are proven:

- `tools/deployment/transaction-plan.mjs` — unsigned payload plan with a
  deterministic hash and no gas baked in.
- `tools/deployment/rabby-preview-server.mjs` — chain-isolated wallet preview
  that verifies the *mined* transaction rather than the payload the page sent,
  with two independent guards before every prompt.
- `tools/deployment/verify-deployment.mjs` — dual-provider state and masked
  bytecode comparison.
- `tools/deployment/funding-refresh.mjs` — freshness windows and fail-closed
  proposal validation.

The Stage 5 workflow should extend these rather than introduce a parallel
implementation with its own bugs.

## After a first launch, in this order

1. Wait for the receipt.
2. Verify the receipt through two providers.
3. Run `tools/canary/observe.mjs` against the launch.
4. Compare direct contract reads with the indexer and public API.
5. Confirm keeper and Telegram alerts fired.
6. Inspect permanent LP ownership at the position manager.
7. Confirm GM escrow custody and the first deadline.
8. Pause immediately if any invariant fails.
9. Do not authorize a second launch automatically. Three launches is the cap and
   each needs its own review.

## Still required from the owner

The first canary token inputs have not been chosen. Only three values are needed,
because everything else is frozen in the deployed factory:

- token name
- token symbol
- total whole-token supply, between 1,000,000 and 1,000,000,000,000,000

Do not ask for allocation, treasury, streak duration, liquidity amount, or fee.
Those are contract constants and cannot be varied.

## Open operational item — closed 2026-08-02

`PositionLocker.bindRegistrar` was mined at block 25102641, before the recorded
factory deployment block 25105648 that the keeper and indexer used as their start
block, so `RegistrarBound` fell outside the scan range permanently. Both now
start at 25082132, the first deployment: the indexer reports
`deployment_block: 25082132` and `config/keeper.mainnet.json` matches, with a
test pinning it at or below the binding's block.
