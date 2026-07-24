# Stage 3.4 validation

Validation date: 2026-07-25. No wallet key was loaded and no transaction was
signed or broadcast.

## Contract and operations gates

- 69 contract tests passed; 2 opt-in Robinhood fork tests were skipped in the
  normal local gate.
- 8 deterministic rewards-operations tests passed.
- 13 read-only keeper-monitoring tests passed.
- Runtime sizes remain within the frozen budgets:
  - `DoomLaunchFactory`: 20,574 bytes of a 23,500-byte budget.
  - `V3LiquidityManager`: 6,520 bytes of a 12,000-byte budget.
  - `PositionLocker`: 7,268 bytes of a 12,000-byte budget.
- GitHub Actions contracts, Foundry, Slither, and Aderyn validation passed for
  the Stage 3.4 head:
  `https://github.com/Qazza1/doom-launchpad/actions/runs/30120113221`.

## Indexer and API gates

- 5 Node tests passed on the production indexer commit.
- Reorg-aware, confirmation-delayed event storage and derived launch-state
  tests passed.
- API isolation regression coverage starts the real Railway entrypoint and
  proves `/health` remains responsive while background indexing begins.
- The production API and legacy analytics run in the existing Railway service.
- The API recovered from a legacy catch-up stall after background indexing and
  scoring were isolated from the HTTP thread in indexer commit `9230ca1`.
- Consecutive production health checks returned HTTP 200.
- The legacy indexer cursor advanced by 500 blocks during the final observation
  window with no active error.
- `GET /launchpad/health` reports:
  - `status: not_deployed`
  - `enabled: false`
  - `configured: false`
- No `DOOM_FACTORY` or deployment block is configured before Stage 4.

## Public website gates

- The static website is committed in
  `https://github.com/Qazza1/doomstreak-site` at `32f3c7f`.
- Vercel serves the committed production HTML at
  `https://www.doomstreak.xyz/`.
- The public UI consumes the Railway API and exposes honest loading, empty,
  partial-data, and pre-deployment states.
- Launch transactions remain disabled.
- The NFT game remains a primary navigation item.

## Remaining deployment input

- Exact deployed addresses and deployment block remain unavailable until Stage
  4 deployment and verification.
- The independent contract review, signing rehearsal, gas plan, deployment
  manifest, and source-verification rehearsal remain Stage 4 gates.
