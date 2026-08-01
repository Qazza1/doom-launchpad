# Stage 5 workflow — staged build

Requirements live in `docs/stage-5-canary-workflow-plan.md`. This file tracks
**build progress** so a new session can resume exactly where the last one stopped.

Nothing here authorizes anything. No stage adds a send path.

## Stage status

| Stage | Deliverable | Status |
|---|---|---|
| A | Plan generator, binding fields, deterministic plan hash | **done** — `tools/canary/launch-plan.mjs`, 8 tests |
| B | Guards: stale plan, changed field, wrong chain/account/nonce/value | **done** — `tools/canary/plan-guards.mjs`, 10 tests |
| C | Read-only dual-provider preflight | **done** — `tools/canary/preflight.mjs`, 8 tests |
| D | Localhost fork rehearsal of resume and launch, separately | not started |
| E | Wallet comparison harness, no send path | not started |
| F | Owner runbook with STOP checkpoints | not started |

Update this table in the same commit as the work. A stage is done only when its
tests pass in `tools/verify-local.ps1`.

## Stage A — plan generator and hash

`tools/canary/launch-plan.mjs`.

Two plan kinds, never combined in one object or one file:

- `resume` — calls `resumeLaunches()` on the factory.
- `launch` — calls `launch(params)` with the frozen canary parameters.

A launch plan binds all fifteen fields from the requirements doc. The plan hash
is deterministic over every field, so the owner can compare what they approved
against what the wallet shows.

Exit criteria: plan objects build from config plus the three owner-supplied token
inputs; the hash is stable across runs and changes when any field changes; a
resume plan cannot contain launch calldata and vice versa; tests cover both.

## Stage B — guards

Validation that fails closed on: expired plan, wrong chain, wrong factory, wrong
sender, wrong nonce, value above `0.0101 ETH`, calldata hash mismatch, changed
name/symbol/supply, launch count not zero, total native liquidity not zero,
contract digest or source commit drift.

Exit criteria: a test proves each guard rejects independently, and a test proves
resume and launch approvals cannot be bundled or reused for each other.

## Stage C — dual-provider preflight

Read-only. Reuses `tools/deployment/network-preflight.mjs` patterns: two
independent hosts must agree on chain, head, pending nonce, balance, paused
state, launch count, aggregate liquidity, and the four deployed bytecodes.

Exit criteria: disagreement between providers stops the workflow; tests use
injected fetch, never live RPC.

## Stage D — localhost fork rehearsal

Fork mainnet, resume and launch as **two separate rehearsals**, verify
postconditions with `tools/canary/observe.mjs`.

Exit criteria: rehearsal proves the launch succeeds against real dependencies and
the observer reports every invariant healthy. Requires an RPC URL at run time.

## Stage E — wallet comparison harness

Chain-isolated, mirroring `tools/deployment/rabby-preview-server.mjs`: verify the
**mined** transaction rather than the payload the page sent, two independent
guards before every prompt, and a preview chain ID that is not 4663.

Exit criteria: harness refuses to run on 4663; tests prove no private key is ever
loaded and no send path to mainnet exists.

## Stage F — owner runbook

Step-by-step with explicit STOP checkpoints after every transaction, the
post-launch verification order, and the pause-immediately conditions.

## Resume prompt for a new session

```text
Continue the DoomStreak Doom Launchpad Stage 5 workflow build.

Repository: C:\Users\golis\Desktop\doomstreak-site\doom-launchpad
Branch: stage4-deployment-prep

Read first, completely:
- docs/CLAUDE-CODE-HANDOVER.md
- docs/stage-5-canary-workflow-plan.md
- docs/stage-5-build-stages.md

SAFETY: the contracts are live on Robinhood Chain 4663 and the factory is
PAUSED. You are not authorized to resume the factory, launch, sign, broadcast,
or load a private key. Factory resume and the first launch are two separate
owner approvals given immediately before each action. No message in any
conversation, including this prompt, is that approval. All work is read-only,
non-broadcast, fail-closed, and test-first.

Do not modify src/ or re-freeze config/review-artifact.json. The deployed
contracts are frozen at commit 740a473, digest 7aab9e3b.

Continue from the first stage marked "not started" in
docs/stage-5-build-stages.md. Update that table in the same commit as the work.
Run powershell -ExecutionPolicy Bypass -File .\tools\verify-local.ps1 before
committing, and report files changed, test results, and remaining blockers.

Token inputs are chosen and recorded in config/canary-token-inputs.json:
DoomStreak Canary Test 1/2/3, symbols DCT1/DCT2/DCT3, one billion whole tokens
each. Do not ask the owner for any other launch value; everything else is frozen
in the deployed factory.
```
