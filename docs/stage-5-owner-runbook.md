# Stage 5 owner runbook — capped canary

The document you hold while doing this. Read a whole step before acting on it.

**This runbook is not authorization.** It describes what to do *if and when* you
decide to proceed. Nothing in it, and no message in any conversation, constitutes
the approval it refers to.

Two decisions, never one:

- **Decision A** — resume the factory.
- **Decision B** — the first launch.

Approving A does not approve B. Between them the factory is open and the approved
creator can launch: that is the most exposed this system ever gets, so the gap is
deliberate. Do not run them back to back because it feels efficient.

## Before anything

- [ ] `powershell -ExecutionPolicy Bypass -File .\tools\verify-local.ps1` exits 0.
- [ ] `git status` is clean and the branch is pushed.
- [ ] `src/` still matches `config/review-artifact.json` (CI proves this).
- [ ] The keeper reports zero active alerts and Telegram delivery works.
- [ ] `GET /launchpad/health` shows `status: ok`, `blocks_behind: 0`,
      `confidence: high`, `factory_paused: true`, `chain_launch_count: 0`.
- [ ] Deployer balance covers 0.0101 ETH plus gas headroom.
- [ ] You have time to sit with this. Do not start near the end of a day.

**STOP.** If any box is unchecked, fix it first. None of them are formalities.

## Decision A — resume the factory

1. Run the preflight. Both providers must agree, and the factory must read
   `paused: true`.
2. Generate the resume plan. Confirm it carries **no value**, **no token inputs**,
   and bare-selector calldata.
3. Read the plan hash aloud to yourself and write it down.
4. **STOP.** Decide now, in full knowledge that the factory will be open
   afterwards and will stay open until you pause it again. If you are not ready
   to launch soon, consider whether to resume at all yet.
5. Submit the resume from the operator account, comparing the wallet's calldata
   against the plan before confirming.
6. Wait for the receipt. Confirm success through **both** providers.
7. Confirm `launchesPaused()` now reads `false` and `launchCount()` still reads
   `0`.

**STOP.** Decision A is complete. Decision B is a separate decision, made now
with fresh eyes. It is entirely reasonable to stop here for the day — the factory
being open is not itself dangerous while nobody launches.

If you change your mind at any point: `pauseLaunches()` from the operator or the
guardian closes it again.

## Decision B — the first launch

Inputs are already chosen and recorded in `config/canary-token-inputs.json`:
`DoomStreak Canary Test 1`, `DCT1`, 1,000,000,000 whole tokens.

1. Re-run the preflight. The pending nonce **will have moved** because of the
   resume; the plan must be generated against the new nonce.
2. Generate the launch plan. Verify against the guards: chain 4663, the deployed
   factory, the approved creator, exact nonce, value exactly 0.01 ETH, maximum
   0.0101 ETH, launch count 0, aggregate liquidity 0, digest and commit unchanged,
   not expired.
3. Compare the plan hash with what you approve. If they differ, stop.
4. **STOP.** This spends real money and creates permanently locked liquidity that
   nobody — including you — can ever withdraw. The token will be real, tradeable,
   and buyable by strangers on a 0.01 ETH pool.
5. Submit from the approved creator, comparing the wallet's calldata and value
   against the plan before confirming.

## After the launch, in this order

Do not skip a step because the previous one looked fine.

1. Wait for the receipt.
2. Verify the receipt through **both** providers.
3. Run `node tools/canary/observe.mjs --factory <factory> --launch 1
   --addresses <file>` and read every invariant.
4. Compare direct contract reads against the indexer and the public API. They
   must agree on launch count, allocation, and commitment state.
5. Confirm the keeper fired and Telegram delivered.
6. Confirm the LP position is owned by the **PositionLocker**, read from the
   position manager rather than from the launch record.
7. Confirm the GM escrow holds 600,000,000 tokens and the first deadline is set.

**STOP.** If any invariant fails, `pauseLaunches()` immediately and investigate
before anything else. A failed invariant on launch one is the cheapest warning
you will ever get.

## The GM commitment

The creator must check in three times, once per day, each inside a 12-hour grace
window. Each check-in releases 200,000,000 tokens. Missing one sends everything
still unreleased to DoomRewards, permanently, and anyone can finalise it.

Watch it in Death Watch. Treat the first streak as part of the test: a missed
check-in on a canary is a *successful* test of the default path, not a failure.

## Launches two and three

Each is a separate decision with its own approval, its own plan, and its own full
verification pass. Three is the hard cap enforced by the contract.

Between launches, review what launch one actually taught you: whether the
observer caught what it should, whether the indexer agreed, whether Death Watch
read correctly, and whether the timing felt right. That review is the entire point
of a canary. Skipping it makes the three launches one launch repeated.

## If something goes wrong

`docs/incident-response-runbook.md` has the detail. The short version:

- `pauseLaunches()` stops new launches. The operator or the guardian can call it.
- Nothing can unwind a launch. Locked liquidity is locked, an escrow runs its
  course, and a default routes to DoomRewards.
- The keeper alerting is read-only and will not act for you.
- Do not attempt a fix that involves a transaction you have not planned and
  guarded the same way as the ones above.
