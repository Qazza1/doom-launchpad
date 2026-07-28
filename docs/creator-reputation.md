# Creator Doom Record v1

Status: read-only indexer and public UI implemented. No contract term changes.

## Purpose

The Doom Record gives buyers a live view of one creator wallet's measured
history. It is additive to the legacy reputation enum and does not silently
change the v1 token-risk score.

The record is wallet-based, not identity-based. A creator can use a fresh
wallet, but that wallet starts **Unrated** and cannot carry history from another
address.

## Inputs

- Current liquidity for launches that are at least 48 hours old.
- Current liquidity for launches aged at least 30 days.
- Canonical completed and defaulted Doom commitment events.
- The two most recent measured, matured launches for abandonment decay.

Unchecked liquidity is never counted as survival or failure. A young token is
never counted as dead.

## Score

The raw 0–100 score is:

- 50% current survival among measured launches aged 48 hours or more.
- 30% completed versus defaulted Doom commitments.
- 20% current 30-day longevity.

Each ratio uses Laplace smoothing. The result shrinks toward 50 until enough
evidence exists. Recent abandonment subtracts a visible decay penalty, with a
larger penalty when both of the latest two judged launches are below the
liquidity floor.

Weighted evidence counts a measured 48-hour outcome as one and a resolved Doom
commitment as two:

- fewer than 3: low confidence and **Unrated**;
- 3–7: medium confidence;
- 8 or more: high confidence.

Tier thresholds after the evidence gate:

- **Gold:** score 80+, high confidence.
- **Silver:** score 65+, or score 80+ without high confidence.
- **Bronze:** score 50–64.
- **Watch:** score 30–49.
- **Doomed Record:** score below 30.

## Required public signals

Prior Doom defaults are always shown. Recent abandonment, completed
commitments, long-lived liquidity, limited history, score freshness, and both
evidence and index confidence are shown separately.

`alive_30d_now` means the launch is at least 30 days old and is above the
liquidity floor at the current measurement. It does not claim the pool remained
continuously liquid for all 30 days.

The same snapshot limitation applies to 48-hour outcomes: the record measures
current liquidity after the age threshold, not continuous liquidity or the
pool's exact balance at hour 48.

## Enforcement boundary

`terms_enforced` is `false` in v1. The canary contracts keep their fixed creation
fee and LP-fee splits. Better terms, featured placement, or lower fees must not
be advertised until factory #2 implements them and receives independent review.

The record is an analytics indicator, not identity proof, a safety guarantee, or
an accusation of fraud.
