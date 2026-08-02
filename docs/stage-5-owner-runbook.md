# Stage 5 owner runbook — capped canary

The document you hold while doing this. Read a whole step before acting on it.

**This runbook is not authorization.** It describes what to do *if and when* you
decide to proceed. Nothing in it, and no message in any conversation, constitutes
the approval it refers to.

## Where this stands, 2026-08-02

Decisions A and B below are **done**. The factory was resumed on 2026-08-01 and
is open now; canary launch 1 minted DCT1 and every on-chain invariant holds. Both
sections are kept as written because launches 2 and 3 follow the same shape and
because a future pause makes Decision A live again.

- Factory: **resumed**, launch count **1**, aggregate liquidity 0.01 ETH.
- Launches remaining under the contract cap: **2**.
- DCT1 GM streak: open, 0/3, first window closes 2026-08-03T09:12:39Z.
- **Read `docs/stage-5-launch-1-review.md` before launch 2.** It lists blockers
  that are open right now: the indexer is stalled and has never seen launch 1,
  the creator account cannot afford launch 2, and Telegram delivery of a real
  alert is unconfirmed.

Two decisions, never one:

- **Decision A** — resume the factory.
- **Decision B** — a launch.

Approving A does not approve B. Between them the factory is open and the approved
creator can launch: that is the most exposed this system ever gets, so the gap is
deliberate. Do not run them back to back because it feels efficient. The same
rule holds for every later launch: each is its own decision, approved
immediately before the action.

## Before anything

- [ ] `powershell -ExecutionPolicy Bypass -File .\tools\verify-local.ps1` exits 0.
- [ ] `git status` is clean and the branch is pushed.
- [ ] `src/` still matches `config/review-artifact.json` (CI proves this).
- [ ] The keeper reports zero active alerts and Telegram delivery works.
- [ ] `GET /launchpad/health` shows `status: ok`, `blocks_behind: 0`,
      `confidence: high`, and a `chain_launch_count` and `launches_indexed` that
      both equal the number of launches that have actually happened. Before
      Decision A `factory_paused` reads `true`; while the canary runs it reads
      `false`. A `factory_paused` that disagrees with what you believe is a stop
      condition either way.
- [ ] Creator balance covers 0.0101 ETH plus gas headroom. `prepare.mjs` checks
      this and refuses; do not work around it.
- [ ] The previous launch has been reviewed in writing, and any open GM streak is
      one you are willing to keep tracking.
- [ ] You have time to sit with this. Do not start near the end of a day.

**STOP.** If any box is unchecked, fix it first. None of them are formalities.

## Running the preparation tool

Use the wrapper, which reads both endpoints through hidden prompts and clears
them afterwards. Alchemy and QuickNode are an appropriate independent pair.

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\canary\prepare.ps1 -Kind resume
powershell -ExecutionPolicy Bypass -File .\tools\canary\prepare.ps1 -Kind launch -Launch 1
```

Never paste an RPC URL into a chat, a commit, or a source file. They carry API
keys.

## Decision A — resume the factory (done 2026-08-01; applies again after any pause)

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

## Decision B — a launch (launch 1 done 2026-08-01; same steps for 2 and 3)

Inputs are already chosen and recorded in `config/canary-token-inputs.json`:
`DoomStreak Canary Test 1/2/3`, `DCT1/DCT2/DCT3`, 1,000,000,000 whole tokens each.
Pass `-Launch 2` or `-Launch 3` to select the right one.

1. Re-run the preflight. The pending nonce **will have moved** since the last
   plan; the plan must be generated against the new nonce.
2. Generate the launch plan. Verify against the guards: chain 4663, the deployed
   factory, the approved creator, exact nonce, value exactly 0.0101 ETH — the
   factory takes liquidity plus the maximum creation fee up front and refunds the
   remainder — launch count and aggregate liquidity matching what has actually
   happened so far, digest and commit unchanged, not expired.
3. **Rehearse it on a fork** before you open your wallet:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\tools\canary\fork-rehearsal.ps1 -Kind launch
   ```

   The rehearsal sends the exact plan on a local fork and checks every invariant.
   If it fails, the plan is wrong; do not submit it. Compare the **calldata
   hash** between the rehearsal report and the plan you submit — the plan hash
   changes with the nonce and expiry, the call does not.
4. Compare the plan hash with what you approve. If they differ, stop.
5. **STOP.** This spends real money and creates permanently locked liquidity that
   nobody — including you — can ever withdraw. The token will be real, tradeable,
   and buyable by strangers on a 0.01 ETH pool.
6. Submit from the approved creator, comparing the wallet's calldata and value
   against the plan before confirming.

## After the launch, in this order

Do not skip a step because the previous one looked fine.

1. Wait for the receipt.
2. Verify the receipt through **both** providers.
3. Run `node tools/canary/observe.mjs --factory <factory> --launch <n>
   --addresses <file>` and read every invariant.
4. Compare direct contract reads against the indexer and the public API. They
   must agree on launch count, allocation, and commitment state. An indexer that
   is stalled or reports `launches_indexed` below the chain's launch count has
   not agreed with anything — it has simply not looked.
5. Confirm the keeper fired and Telegram delivered. If a launch produces no
   keeper activity at all, ask why before treating silence as health.
6. Confirm the LP position is owned by the **PositionLocker**, read from the
   position manager rather than from the launch record.
7. Confirm the GM escrow holds 600,000,000 tokens and the first deadline is set.
8. Write the review down. `docs/stage-5-launch-1-review.md` is the shape.

**STOP.** If any invariant fails, `pauseLaunches()` immediately and investigate
before anything else. A failed invariant on launch one is the cheapest warning
you will ever get.

## The GM commitment

The creator must check in three times, once per day, each inside a 12-hour grace
window, by calling `recordGm()` on that launch's escrow. Each check-in releases
200,000,000 tokens. Missing one sends everything still unreleased to DoomRewards,
permanently, and anyone can finalise it.

For DCT1 the first window **opens 2026-08-02T21:12:39Z and closes
2026-08-03T09:12:39Z**, on escrow `0x19b0780f01567c1c05349a1d8a113042c4cd07ed`.

Watch it in Death Watch. Treat the first streak as part of the test: a missed
check-in on a canary is a *successful* test of the default path, not a failure —
but it is one-way, so decide which path you want rather than letting the clock
decide.

## Keeping the monitoring honest

`config/keeper.mainnet.json` states what the world is *supposed* to look like.
`expectedFactoryPaused` is `false` while the canary runs and must go back to
`true` the moment you pause the factory. It stayed `true` for about twelve hours
after the resume, and the keeper spent that time sending a critical alert every
five minutes that meant nothing. Update it in the same sitting as the pause or
resume, and redeploy the keeper so Railway is running the same file.

## Launches two and three

Each is a separate decision with its own approval, its own plan, its own fork
rehearsal, and its own full verification pass. Three is the hard cap enforced by
the contract.

Between launches, review what the previous launch actually taught you: whether
the observer caught what it should, whether the indexer agreed, whether Death
Watch read correctly, and whether the timing felt right. That review is the
entire point of a canary. Skipping it makes the three launches one launch
repeated. The launch 1 review is in `docs/stage-5-launch-1-review.md`, and its
open blockers gate launch 2.

## If something goes wrong

`docs/incident-response-runbook.md` has the detail. The short version:

- `pauseLaunches()` stops new launches. The operator or the guardian can call it.
- Nothing can unwind a launch. Locked liquidity is locked, an escrow runs its
  course, and a default routes to DoomRewards.
- The keeper alerting is read-only and will not act for you.
- Do not attempt a fix that involves a transaction you have not planned and
  guarded the same way as the ones above.
