# Owner decisions, 2026-08-02

Four decisions taken during the canary. Recorded because three of them change the
delivery sequence and one overrides a documented gate.

**None of these is an authorization to transact.** Every launch, deployment, and
broadcast still requires its own explicit owner approval given immediately before
the action.

## 1. Launch 1's GM streak should survive

The creator intends to complete all three check-ins on DCT1 rather than let the
commitment default.

The first window opens 2026-08-02T21:12:39Z and closes 2026-08-03T09:12:39Z, on
escrow `0x19b0780f01567c1c05349a1d8a113042c4cd07ed`, by calling `recordGm()`. Two
more follow, one per day, each with a 12-hour grace period.

Consequence worth stating: the default path — unreleased escrow routed to
DoomRewards, permissionless finalization — will therefore **not** be exercised by
launch 1. It remains covered by unit and fork tests but unproven on mainnet. If
you want it proven with real money, launch 2 or 3 is where that happens, and that
is a deliberate choice to make in advance rather than by missing an alarm.

## 2. Factory #2 targets Uniswap v3, not v4

v4 is deferred until the v3 public launchpad is working. The three verification
gates were answered the same day in `docs/v4-venue-gates-2026-08-02.md`: v4 is
deployed and active on chain 4663, and its core licence becomes MIT on
2027-06-15. Nothing in those answers forces the decision now, and deferring costs
nothing that cannot be recovered.

Consequence: Stage 6.5's v4-dependent mechanics — the bonding curve in particular
— are deferred with it. The v3 factory #2 can still carry permanent liquidity,
the GM commitment, creator reputation, and Death Watch.

## 3. The independent audit is deferred, not cancelled

> I want to waive the audit and launch it. I will do the audit later on.

This extends the 2026-07-29 waiver in `docs/stage-4-owner-risk-acceptance.md`,
which explicitly did **not** cover a public or replacement factory. It now does,
by the owner's decision.

What is different this time, stated once so the record is honest:

- The canary waiver covered 0.03 ETH of the owner's own money behind a
  constructor-enforced cap. A public factory has no cap and holds **other
  people's** liquidity, permanently, with no withdrawal path by design.
- The same properties that make the product trustworthy — permanent locks, no
  release path, irreversible bindings — mean a contract bug cannot be corrected
  after the fact. There is no admin escape hatch to fall back on, because that
  was the point.
- `docs/internal-audit-2026-07-28.md` is a first-party review and is not a
  substitute. Neither is any AI review, including this one.
- M-1 from that review is unremediated by design: permissionless pool
  pre-creation can grief a launch, mitigated only to a diagnostic revert. It is
  recorded as an architecture requirement for factory #2 and should be closed
  there rather than inherited.

The owner has been told this and has decided. Open question the owner still owes
an answer to: **what triggers the audit.** "Later" without a trigger becomes
never. A TVL threshold, a launch count, or a date all work; pick one and record
it here.

## 4. Stage 6 begins after the canary

The launcher-first product release starts once the canary is complete and the
blockers in `docs/stage-5-launch-1-review.md` are cleared. Preparatory work that
does not depend on factory #2 may begin during the canary.
